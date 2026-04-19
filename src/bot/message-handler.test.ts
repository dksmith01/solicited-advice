/**
 * message-handler.test.ts
 *
 * Unit tests for src/bot/message-handler.ts.
 * Uses Node's built-in test runner (node:test).
 *
 * Run with: node --import tsx/esm --test src/bot/message-handler.test.ts
 */

import { describe, test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageBuffer } from "./message-buffer.js";
import { createMessageHandler } from "./message-handler.js";
import type { BotConfig, AgentTurn } from "../types.js";
import type { WAMessage } from "@whiskeysockets/baileys";

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

type UpsertPayload = { messages: WAMessage[]; type: string };
type UpsertHandler = (payload: UpsertPayload) => void;

interface MockSocket {
  ev: {
    on: ReturnType<typeof mock.fn>;
    /** Fire the registered messages.upsert handler directly. */
    emit: (payload: UpsertPayload) => void;
  };
  sendMessage: ReturnType<typeof mock.fn>;
}

function makeMockSocket(): MockSocket {
  let upsertHandler: UpsertHandler | null = null;

  const evOn = mock.fn((event: string, handler: UpsertHandler) => {
    if (event === "messages.upsert") {
      upsertHandler = handler;
    }
  });

  const sendMessage = mock.fn(
    async (_jid: string, _content: unknown) => ({ key: { id: "sent-msg" } })
  );

  return {
    ev: {
      on: evOn,
      emit(payload: UpsertPayload) {
        if (upsertHandler) upsertHandler(payload);
      },
    },
    sendMessage,
  };
}

const BOT_JID = "15551234567:42@s.whatsapp.net";
const GROUP_JID = "1122334455@g.us";
const BOT_MENTION_JID = "15551234567@s.whatsapp.net"; // as it appears in mentionedJid

const DEFAULT_CONFIG: BotConfig = {
  autonomousMode: false,
  approvalTimeoutMs: 30_000,
  maxContextMessages: 10,
  queueDepthMax: 1,
  maxInboundMessageChars: 2000,
  allowedGroupJids: [],
};

/** Build a recent (not stale) timestamp in seconds. */
function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** Build a stale timestamp (> 5 minutes ago). */
function staleSecs(): number {
  return Math.floor((Date.now() - 6 * 60 * 1000) / 1000);
}

function makeMentionMsg(overrides?: Partial<WAMessage>): WAMessage {
  return {
    key: { remoteJid: GROUP_JID, id: "msg-mention", fromMe: false, participant: "sender@s.whatsapp.net" },
    messageTimestamp: nowSecs(),
    message: {
      extendedTextMessage: {
        text: "@SolicitedAdvice what should I try first?",
        contextInfo: {
          mentionedJid: [BOT_MENTION_JID],
        },
      },
    },
    ...overrides,
  } as unknown as WAMessage;
}

function makePlainMsg(text: string): WAMessage {
  return {
    key: { remoteJid: GROUP_JID, id: "msg-plain", fromMe: false, participant: "sender@s.whatsapp.net" },
    messageTimestamp: nowSecs(),
    message: { conversation: text },
  } as unknown as WAMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMessageHandler", () => {
  let sock: MockSocket;
  let buffer: MessageBuffer;
  let agentTurnCalls: AgentTurn[];
  let onAgentTurn: (turn: AgentTurn) => Promise<void>;

  beforeEach(() => {
    sock = makeMockSocket();
    buffer = new MessageBuffer();
    agentTurnCalls = [];
    onAgentTurn = async (turn) => {
      agentTurnCalls.push(turn);
    };
  });

  // -------------------------------------------------------------------------
  // 1. A message with bot's JID in mentionedJid triggers onAgentTurn
  // -------------------------------------------------------------------------
  test("@mention triggers onAgentTurn with correct groupJid and mentionText", async () => {
    createMessageHandler(
      sock as unknown as import("@whiskeysockets/baileys").WASocket,
      buffer,
      DEFAULT_CONFIG,
      [BOT_JID],
      onAgentTurn
    );

    const msg = makeMentionMsg();
    sock.ev.emit({ messages: [msg], type: "notify" });

    // Allow any microtask callbacks to settle.
    await new Promise((r) => setImmediate(r));

    assert.equal(agentTurnCalls.length, 1, "onAgentTurn should be called once");
    assert.equal(agentTurnCalls[0].groupJid, GROUP_JID);
    assert.ok(
      agentTurnCalls[0].mentionText.length > 0,
      "mentionText should not be empty"
    );
  });

  // -------------------------------------------------------------------------
  // 2. Non-@mention message is buffered but does NOT trigger onAgentTurn
  // -------------------------------------------------------------------------
  test("non-@mention message is buffered but does not trigger onAgentTurn", async () => {
    createMessageHandler(
      sock as unknown as import("@whiskeysockets/baileys").WASocket,
      buffer,
      DEFAULT_CONFIG,
      [BOT_JID],
      onAgentTurn
    );

    const msg = makePlainMsg("just chatting");
    sock.ev.emit({ messages: [msg], type: "notify" });
    await new Promise((r) => setImmediate(r));

    assert.equal(agentTurnCalls.length, 0, "onAgentTurn should NOT be called");
    const buffered = buffer.getRecent(GROUP_JID, 10);
    assert.equal(buffered.length, 1, "message should still be in the buffer");
  });

  // -------------------------------------------------------------------------
  // 3. msg.key.fromMe === true is silently skipped
  // -------------------------------------------------------------------------
  test("fromMe=true message is silently skipped (not buffered, not triggering agent)", async () => {
    createMessageHandler(
      sock as unknown as import("@whiskeysockets/baileys").WASocket,
      buffer,
      DEFAULT_CONFIG,
      [BOT_JID],
      onAgentTurn
    );

    const msg = makeMentionMsg({ key: { remoteJid: GROUP_JID, id: "msg-from-me", fromMe: true } } as Partial<WAMessage>);
    sock.ev.emit({ messages: [msg], type: "notify" });
    await new Promise((r) => setImmediate(r));

    assert.equal(agentTurnCalls.length, 0, "fromMe message should not trigger agent");
    const buffered = buffer.getRecent(GROUP_JID, 10);
    assert.equal(buffered.length, 0, "fromMe message should not be buffered");
  });

  // -------------------------------------------------------------------------
  // 4. Non-group message (individual JID) is silently skipped
  // -------------------------------------------------------------------------
  test("non-group (DM) message is silently skipped after buffering", async () => {
    createMessageHandler(
      sock as unknown as import("@whiskeysockets/baileys").WASocket,
      buffer,
      DEFAULT_CONFIG,
      [BOT_JID],
      onAgentTurn
    );

    const dmMsg: WAMessage = {
      key: { remoteJid: "9876543210@s.whatsapp.net", id: "dm-001", fromMe: false },
      messageTimestamp: nowSecs(),
      message: {
        extendedTextMessage: {
          text: "@SolicitedAdvice hi from DM",
          contextInfo: { mentionedJid: [BOT_MENTION_JID] },
        },
      },
    } as unknown as WAMessage;

    sock.ev.emit({ messages: [dmMsg], type: "notify" });
    await new Promise((r) => setImmediate(r));

    assert.equal(agentTurnCalls.length, 0, "DM should not trigger agent");
  });

  // -------------------------------------------------------------------------
  // 5. Second concurrent @mention enqueues; third triggers holding message
  // -------------------------------------------------------------------------
  test("second @mention is queued; third triggers holding message", async () => {
    // Make onAgentTurn block until we release it.
    let releaseFirst: (() => void) | null = null;
    let firstStarted = false;

    const blockingOnAgentTurn = async (turn: AgentTurn) => {
      agentTurnCalls.push(turn);
      firstStarted = true;
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    };

    createMessageHandler(
      sock as unknown as import("@whiskeysockets/baileys").WASocket,
      buffer,
      DEFAULT_CONFIG,
      [BOT_JID],
      blockingOnAgentTurn
    );

    // First @mention — starts processing
    const msg1 = makeMentionMsg({ key: { remoteJid: GROUP_JID, id: "msg-1", fromMe: false, participant: "a@s.whatsapp.net" } } as Partial<WAMessage>);
    sock.ev.emit({ messages: [msg1], type: "notify" });
    await new Promise((r) => setImmediate(r));
    assert.ok(firstStarted, "first turn should have started");

    // Second @mention — should be queued
    const msg2 = makeMentionMsg({ key: { remoteJid: GROUP_JID, id: "msg-2", fromMe: false, participant: "b@s.whatsapp.net" } } as Partial<WAMessage>);
    sock.ev.emit({ messages: [msg2], type: "notify" });
    await new Promise((r) => setImmediate(r));

    // No holding message yet — second is queued, not dropped
    assert.equal(
      sock.sendMessage.mock.calls.length,
      0,
      "no holding message for the second @mention (it should be queued)"
    );

    // Third @mention — both slots occupied; should trigger holding message
    const msg3 = makeMentionMsg({ key: { remoteJid: GROUP_JID, id: "msg-3", fromMe: false, participant: "c@s.whatsapp.net" } } as Partial<WAMessage>);
    sock.ev.emit({ messages: [msg3], type: "notify" });
    await new Promise((r) => setImmediate(r));

    assert.equal(
      sock.sendMessage.mock.calls.length,
      1,
      "holding message should be sent for the third @mention"
    );
    const holdingText = (sock.sendMessage.mock.calls[0].arguments[1] as { text: string }).text;
    assert.ok(
      holdingText.includes("working on another reply"),
      "holding message should reference being busy"
    );

    // Release the first turn so the test can end cleanly
    releaseFirst!();
    await new Promise((r) => setImmediate(r));
  });

  // -------------------------------------------------------------------------
  // 6. @mention with no text content (image-only, no caption) doesn't throw
  // -------------------------------------------------------------------------
  test("@mention with image-only (no caption) is handled without throwing", async () => {
    createMessageHandler(
      sock as unknown as import("@whiskeysockets/baileys").WASocket,
      buffer,
      DEFAULT_CONFIG,
      [BOT_JID],
      onAgentTurn
    );

    const imageOnlyMsg: WAMessage = {
      key: { remoteJid: GROUP_JID, id: "img-001", fromMe: false },
      messageTimestamp: nowSecs(),
      message: {
        extendedTextMessage: {
          text: "",
          contextInfo: { mentionedJid: [BOT_MENTION_JID] },
        },
        imageMessage: { caption: "" },
      },
    } as unknown as WAMessage;

    let threw = false;
    try {
      sock.ev.emit({ messages: [imageOnlyMsg], type: "notify" });
      await new Promise((r) => setImmediate(r));
    } catch {
      threw = true;
    }

    assert.equal(threw, false, "should not throw for image-only @mention");
    // Agent turn is still triggered (empty mentionText is acceptable)
    assert.equal(agentTurnCalls.length, 1, "agent turn should still fire");
  });

  // -------------------------------------------------------------------------
  // 7. Stale message (timestamp > 5 min ago) is skipped even with @mention
  // -------------------------------------------------------------------------
  test("stale @mention (> 5 min old) is skipped", async () => {
    createMessageHandler(
      sock as unknown as import("@whiskeysockets/baileys").WASocket,
      buffer,
      DEFAULT_CONFIG,
      [BOT_JID],
      onAgentTurn
    );

    const staleMsg = makeMentionMsg({ messageTimestamp: staleSecs() } as Partial<WAMessage>);
    sock.ev.emit({ messages: [staleMsg], type: "notify" });
    await new Promise((r) => setImmediate(r));

    assert.equal(agentTurnCalls.length, 0, "stale @mention should not trigger agent");
  });

  // -------------------------------------------------------------------------
  // 8. Buffer respects 30-message cap
  // -------------------------------------------------------------------------
  test("buffer correctly caps at 30 messages", async () => {
    createMessageHandler(
      sock as unknown as import("@whiskeysockets/baileys").WASocket,
      buffer,
      DEFAULT_CONFIG,
      [BOT_JID],
      onAgentTurn
    );

    for (let i = 1; i <= 31; i++) {
      const msg = makePlainMsg(`message ${i}`);
      // Give each a unique id so they're distinct
      (msg.key as { id: string }).id = `bulk-${i}`;
      sock.ev.emit({ messages: [msg], type: "notify" });
    }

    await new Promise((r) => setImmediate(r));

    const all = buffer.getRecent(GROUP_JID, 50);
    assert.equal(all.length, 30, "buffer should cap at 30 messages");
    assert.equal(all[0].key.id, "bulk-2", "bulk-1 should have been evicted");
  });
});
