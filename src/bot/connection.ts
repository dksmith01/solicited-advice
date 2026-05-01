/**
 * connection.ts
 *
 * Establishes and maintains a stable WhatsApp WebSocket connection via Baileys v7.
 * Handles QR display, auth persistence, reconnects, and group JID discovery.
 */

import NodeCache from "node-cache";
import qrcode from "qrcode";
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type GroupMetadata,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { rmSync } from "node:fs";
import pino from "pino";

// Retry counter cache lives OUTSIDE startSock so it survives reconnects.
const msgRetryCounterCache = new NodeCache({ stdTTL: 60 });

// Group metadata cache — populated on group events so makeWASocket can use it.
const groupMetaCache = new NodeCache({ stdTTL: 3600 });

// Track the active socket so we can clean it up before reconnecting.
let currentSock: WASocket | null = null;

export function getCurrentSocket(): WASocket {
  if (!currentSock) throw new Error("WhatsApp socket not initialized");
  return currentSock;
}

// pino's Logger satisfies Baileys' ILogger interface structurally;
// cast via unknown since ILogger isn't re-exported from the package root.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logger = pino({ level: "info" }) as unknown as any;

/** Signature that matches Baileys' SocketConfig.getMessage exactly. */
type GetMessageFn = (key: WAMessageKey) => Promise<proto.IMessage | undefined>;

/**
 * Start (or restart) a WhatsApp connection.
 *
 * @param onMessage    Called with each messages.upsert payload.
 * @param getMessageFn Optional lookup used by Baileys to retry failed messages.
 *                     Must return `proto.IMessage | undefined` (the message body only,
 *                     not the full WAMessage wrapper). Unit 4 provides a real store.
 *                     Defaults to always returning undefined.
 */
export async function startConnection(
  onMessage: (messages: WAMessage[], type: string) => void,
  getMessageFn?: GetMessageFn
): Promise<WASocket> {
  const resolvedGetMessage: GetMessageFn =
    getMessageFn ?? (async (_key) => undefined);

  return startSock(onMessage, resolvedGetMessage);
}

async function startSock(
  onMessage: (messages: WAMessage[], type: string) => void,
  getMessageFn: GetMessageFn
): Promise<WASocket> {
  // Clean up previous socket to prevent memory leaks on reconnect.
  if (currentSock) {
    try { currentSock.end(undefined); } catch { /* already closed */ }
    currentSock = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false, // deprecated in v7; we render manually via qrcode package
    markOnlineOnConnect: false,
    msgRetryCounterCache,
    shouldSyncHistoryMessage: () => false,
    syncFullHistory: false,
    cachedGroupMetadata: async (jid: string) => {
      return groupMetaCache.get<GroupMetadata>(jid);
    },
    getMessage: getMessageFn,
  });

  currentSock = sock;

  // Persist credentials whenever they change.
  sock.ev.on("creds.update", saveCreds);

  // Keep group metadata cache warm.
  sock.ev.on("groups.update", (updates) => {
    for (const update of updates) {
      if (update.id) {
        const existing = groupMetaCache.get<GroupMetadata>(update.id);
        if (existing) {
          groupMetaCache.set(update.id, { ...existing, ...update });
        }
      }
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
    try {
      const meta = await sock.groupMetadata(update.id);
      groupMetaCache.set(update.id, meta);
    } catch {
      // Non-fatal: cache miss is acceptable.
    }
  });

  // Core connection state handler.
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Render QR code to terminal when prompted.
    if (qr) {
      try {
        const qrString = await qrcode.toString(qr, { type: "terminal", small: true });
        process.stdout.write("\nScan this QR code with WhatsApp:\n");
        process.stdout.write(qrString + "\n");
      } catch (err) {
        logger.error({ err }, "Failed to render QR code");
      }
    }

    if (connection === "open") {
      logger.info("WhatsApp connection open");
      // Discover group JIDs so David can copy the right one into ALLOWED_GROUP_JIDS in .env.
      try {
        const groups = await sock.groupFetchAllParticipating();
        logger.info("=== Joined WhatsApp groups ===");
        for (const [jid, meta] of Object.entries(groups)) {
          logger.info({ jid, subject: meta.subject }, "Group");
          // Cache metadata while we have it.
          groupMetaCache.set(jid, meta);
        }
        logger.info("=== Copy the desired JID into ALLOWED_GROUP_JIDS in .env ===");
      } catch (err) {
        logger.warn({ err }, "groupFetchAllParticipating failed");
      }
    }

    if (connection === "close") {
      const boom = lastDisconnect?.error as Boom | undefined;
      const statusCode = boom?.output?.statusCode;

      logger.info({ statusCode }, "Connection closed");

      switch (statusCode) {
        case DisconnectReason.loggedOut: // 401
          logger.error("Logged out — delete baileys_auth_info and re-scan QR. Exiting.");
          process.exit(1);
          break;

        case DisconnectReason.connectionReplaced: // 440
          logger.error("Connection replaced by another session. Exiting.");
          process.exit(1);
          break;

        case DisconnectReason.badSession: // 500
          logger.warn("Bad session — deleting auth state and reconnecting.");
          try {
            rmSync("baileys_auth_info", { recursive: true, force: true });
          } catch (err) {
            logger.error({ err }, "Failed to delete baileys_auth_info");
          }
          await startSock(onMessage, getMessageFn);
          break;

        default:
          // 408 (connectionLost/timedOut), 428 (connectionClosed),
          // 503 (unavailableService), 515 (restartRequired), etc.
          logger.warn({ statusCode }, "Transient disconnect — reconnecting.");
          await startSock(onMessage, getMessageFn);
          break;
      }
    }
  });

  // Forward incoming messages to the caller.
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    onMessage(messages, type);
  });

  return sock;
}
