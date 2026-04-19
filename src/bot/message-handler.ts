/**
 * message-handler.ts
 *
 * Registers the messages.upsert event listener on the Baileys socket.
 * Responsibilities:
 *   - Buffer every incoming group message
 *   - Detect @mentions of the bot
 *   - Assemble context and call onAgentTurn
 *   - Enforce a per-group concurrent-request queue (max 1 active + 1 queued)
 */

import { isJidGroup, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import type { AgentTurn, BotConfig } from "../types.js";
import type { MessageBuffer } from "./message-buffer.js";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Normalise Baileys' messageTimestamp field to a plain number (milliseconds).
 * The field can arrive as a JS number (seconds) or a Long-like object.
 */
function toTimestampMs(raw: WAMessage["messageTimestamp"]): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return raw * 1000;
  // Long object (from protobufjs): has .toNumber() or .low
  if (typeof (raw as { toNumber?: () => number }).toNumber === "function") {
    return (raw as { toNumber: () => number }).toNumber() * 1000;
  }
  // Fallback for plain-object Long: use .low as the lower 32 bits
  if (typeof (raw as { low?: number }).low === "number") {
    return (raw as { low: number }).low * 1000;
  }
  return Number(raw) * 1000;
}

/**
 * Extract the plain text content of a WAMessage, checking multiple field paths
 * in priority order. Returns an empty string when no text is available.
 */
function extractText(msg: WAMessage): string {
  return (
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    msg.message?.imageMessage?.caption ??
    ""
  );
}

/**
 * Register a messages.upsert handler on the socket.
 *
 * @param sock          Live Baileys socket
 * @param buffer        Shared MessageBuffer instance
 * @param config        Runtime bot config
 * @param botJid        Full JID of the bot account (e.g. "15551234567:42@s.whatsapp.net")
 * @param onAgentTurn   Async callback invoked for each approved @mention
 */
export function createMessageHandler(
  sock: WASocket,
  buffer: MessageBuffer,
  config: BotConfig,
  botJids: string[],
  allowedGroupJids: string[],
  onAgentTurn: (turn: AgentTurn) => Promise<void>
): void {
  // Extract the number portion from each bot JID (strips device suffix and domain).
  // Covers both phone JID (13056459014) and LID (225980358598881).
  const botNumbers = new Set(
    botJids.map((jid) => jid.split("@")[0].split(":")[0]).filter(Boolean)
  );

  // Per-group concurrency state
  const isProcessing = new Map<string, boolean>();
  const queue = new Map<string, AgentTurn>();

  /** Process a turn and, when done, start the queued one (if any). */
  async function runTurn(groupJid: string, turn: AgentTurn): Promise<void> {
    isProcessing.set(groupJid, true);
    try {
      await onAgentTurn(turn);
    } finally {
      const next = queue.get(groupJid);
      if (next) {
        queue.delete(groupJid);
        // Start the queued turn without awaiting — keeps the event loop free.
        void runTurn(groupJid, next);
      } else {
        isProcessing.set(groupJid, false);
      }
    }
  }

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // Only process real incoming notifications.
    if (type !== "notify") return;

    for (const msg of messages) {
      // Skip our own outbound messages.
      if (msg.key.fromMe === true) continue;

      const groupJid = msg.key.remoteJid;

      // Stale-message guard — prevents @mentions replayed on reconnect.
      const ageMs = Date.now() - toTimestampMs(msg.messageTimestamp);
      if (ageMs > STALE_THRESHOLD_MS) continue;

      // Always buffer the message (before any further filtering).
      buffer.push(msg);

      // Only process group messages.
      if (!groupJid || !isJidGroup(groupJid)) continue;

      // Group allowlist check.
      if (
        allowedGroupJids.length > 0 &&
        !allowedGroupJids.includes(groupJid)
      ) {
        continue;
      }

      // Check whether the bot is @mentioned (LID-safe: compare number portion only).
      const mentionedJids: string[] =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];

      const mentioned = mentionedJids.some(
        (jid) => botNumbers.has(jid.split("@")[0].split(":")[0])
      );

      if (!mentioned) continue;

      // Extract message text (may be empty for image-only messages).
      let text = extractText(msg);
      if (text.length > config.maxInboundMessageChars) {
        text = text.slice(0, config.maxInboundMessageChars);
      }

      // Assemble recent context, skipping media-only messages (no text).
      const recentRaw = buffer.getRecent(groupJid, config.maxContextMessages);
      const recentContextMessages: string[] = [];
      for (const m of recentRaw) {
        const content = extractText(m);
        if (!content) continue;
        const sender = m.key.participant ?? m.key.remoteJid ?? "unknown";
        recentContextMessages.push(`[${sender}]: ${content}`);
      }

      const turn: AgentTurn = {
        groupJid,
        mentionText: text,
        recentContextMessages,
        quotedMessage: msg,
      };

      // Concurrent queue enforcement.
      if (!isProcessing.get(groupJid)) {
        void runTurn(groupJid, turn);
      } else if (!queue.has(groupJid)) {
        // One turn already processing — queue this one.
        queue.set(groupJid, turn);
      } else {
        // Both slots occupied — send holding message and drop.
        void sock.sendMessage(groupJid, {
          text: "I'm working on another reply — please re-mention me in a moment",
        });
      }
    }
  });
}
