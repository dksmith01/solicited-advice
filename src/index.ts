/**
 * index.ts
 *
 * Entry point for the Solicited Advice bot.
 * Wires together:
 *   - Config loading
 *   - Storage (examples corpus)
 *   - WhatsApp connection (Baileys)
 *   - Message buffering
 *   - Message handler (mention detection + queuing)
 *   - Claude agent (agentic loop)
 *   - Approval gate (Telegram)
 *   - Graceful shutdown
 */

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { BotConfig, AgentTurn } from "./types.js";
import { startConnection, getCurrentSocket } from "./bot/connection.js";
import { MessageBuffer } from "./bot/message-buffer.js";
import { createMessageHandler, type MessageHandler } from "./bot/message-handler.js";
import { runAgentTurn } from "./agent/index.js";
import { buildSystemBlocks } from "./agent/system-prompt.js";
import { createApprovalGate } from "./agent/approval.js";
import { loadExamples, appendEntry } from "./storage/examples.js";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages.js";

// ---------------------------------------------------------------------------
// 1. Load config/bot-config.json
// ---------------------------------------------------------------------------

const configPath = path.resolve(
  fileURLToPath(new URL("../config/bot-config.json", import.meta.url))
);

let config: BotConfig;
try {
  const raw = await readFile(configPath, "utf-8");
  config = JSON.parse(raw) as BotConfig;
} catch (err) {
  console.error("[startup] Failed to load config/bot-config.json:", err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Check required environment variables
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
] as const;

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    console.error(`[startup] Required env var ${key} is not set. Exiting.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 3. Load examples corpus → build system prompt blocks (cached for all turns)
// ---------------------------------------------------------------------------

const examplesContent = await loadExamples();
const systemBlocks: TextBlockParam[] = buildSystemBlocks(examplesContent);

// ---------------------------------------------------------------------------
// 4. Create message buffer (shared between connection and message handler)
// ---------------------------------------------------------------------------

const buffer = new MessageBuffer();

// ---------------------------------------------------------------------------
// 5. Start the WhatsApp connection
//    Pass a getMessageFn that consults the buffer for Baileys' retry logic.
// ---------------------------------------------------------------------------

// Message handler — set after startConnection resolves. Until then, we buffer.
let messageHandler: MessageHandler | null = null;

function onMessage(messages: WAMessage[], type: string): void {
  if (messageHandler) {
    messageHandler(messages, type);
  } else {
    for (const msg of messages) buffer.push(msg);
  }
}

console.log("[startup] Connecting to WhatsApp…");

const sock: WASocket = await startConnection(onMessage, async (key) => {
  const msg = buffer.getMessage(key);
  return msg?.message ?? undefined;
});

// ---------------------------------------------------------------------------
// 6. Create approval gate (needs sock, which is now available)
// ---------------------------------------------------------------------------

// Per-turn quoted message ref — safe because queue depth is 1 (one approval at a time).
let currentQuotedMessage: WAMessage | undefined;

const approvalGate = createApprovalGate(
  getCurrentSocket,
  config,
  async (entry) => appendEntry(entry),
  () => currentQuotedMessage
);

// ---------------------------------------------------------------------------
// 7. Build onAgentTurn and wire the message handler
// ---------------------------------------------------------------------------

async function onAgentTurn(turn: AgentTurn): Promise<void> {
  currentQuotedMessage = turn.quotedMessage;
  try {
    await runAgentTurn(
      turn.mentionText,
      turn.recentContextMessages,
      systemBlocks,
      approvalGate,
      turn.groupJid
    );
  } finally {
    currentQuotedMessage = undefined;
  }
}

// sock.user?.id is populated by the time startConnection resolves (Baileys sets
// it during the 'connection.update' open event, which fires before the promise
// resolves for new connections; for reconnect paths it may be from cached creds).
const botJid = sock.user?.id ?? "";
// sock.user may also carry a .lid field in Baileys v7 (LID-based identity).
// WhatsApp now sends @mentions using the LID, so we must match against both.
const botLid = ((sock.user as unknown) as Record<string, unknown>)?.lid as string | undefined ?? "";

if (!botJid) {
  console.warn(
    "[startup] sock.user?.id is empty — @mention detection will not work until the socket is fully open."
  );
}

const botJids = [botJid, botLid].filter(Boolean);
console.log(`[startup] Bot identifiers: ${JSON.stringify(botJids)}`);

const allowedGroupJids = (process.env.ALLOWED_GROUP_JIDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

messageHandler = createMessageHandler(getCurrentSocket, buffer, config, botJids, allowedGroupJids, onAgentTurn);

console.log(`[startup] Bot ready. JID: ${botJid || "(pending QR scan)"}`);

// ---------------------------------------------------------------------------
// 8. Graceful shutdown
// ---------------------------------------------------------------------------

function cleanup(): void {
  console.log("[shutdown] Closing WhatsApp connection…");
  try {
    getCurrentSocket().end(undefined);
  } catch (err) {
    console.error("[shutdown] Error closing socket:", err);
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// ---------------------------------------------------------------------------
// 9. Top-level unhandled rejection handler — log but let PM2 decide.
// ---------------------------------------------------------------------------

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  // Do NOT exit — let PM2 decide based on its restart policy.
});
