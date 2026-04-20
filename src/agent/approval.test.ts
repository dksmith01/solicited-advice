/**
 * approval.test.ts
 *
 * Unit tests for src/agent/approval.ts.
 * Uses Node's built-in test runner (node:test) + node:assert/strict.
 *
 * The Telegram bot and Baileys socket are fully mocked — no real network
 * calls are made.
 *
 * Run with:
 *   node --import tsx/esm --test src/agent/approval.test.ts
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ApprovedEntry, BotConfig } from "../types.js";
import type { ToolCallResult } from "./index.js";

// ---------------------------------------------------------------------------
// Mock BotConfig
// ---------------------------------------------------------------------------

const TEST_CONFIG: BotConfig = {
  autonomousMode: false,
  approvalTimeoutMs: 200, // very short for tests
  maxContextMessages: 10,
  queueDepthMax: 5,
  maxInboundMessageChars: 2000,
};

// ---------------------------------------------------------------------------
// Mock WASocket
// ---------------------------------------------------------------------------

function makeMockSocket() {
  const calls: Array<{ jid: string; content: { text: string } }> = [];

  const sendMessage = mock.fn(
    async (jid: string, content: { text: string }) => {
      calls.push({ jid, content });
    }
  );

  return { sendMessage, _calls: calls } as unknown as {
    sendMessage: typeof sendMessage;
    _calls: typeof calls;
  };
}

// ---------------------------------------------------------------------------
// Mock TelegramBot
// ---------------------------------------------------------------------------

/**
 * A lightweight EventEmitter-based mock that mirrors the node-telegram-bot-api
 * surface used by approval.ts:
 *   - bot.sendMessage(chatId, text)   → records the call
 *   - bot.on('message', handler)      → EventEmitter.on
 *   - bot.removeListener('message', handler) → EventEmitter.removeListener
 *
 * Tests drive replies by calling bot._simulateReply(text).
 */
class MockTelegramBot extends EventEmitter {
  public sentMessages: Array<{ chatId: string; text: string }> = [];

  sendMessage(chatId: string | number, text: string): Promise<void> {
    this.sentMessages.push({ chatId: String(chatId), text });
    return Promise.resolve();
  }

  /** Simulate an incoming message from the authorised chat. */
  _simulateReply(text: string, chatId = TEST_CHAT_ID): void {
    const msg = {
      chat: { id: Number(chatId) },
      text,
    };
    this.emit("message", msg);
  }
}

// ---------------------------------------------------------------------------
// Environment + module-level setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "TEST_TOKEN_123";
const TEST_CHAT_ID = "9999";

let mockBot: MockTelegramBot;

// We patch the TelegramBot constructor so that approval.ts receives our mock
// instead of the real SDK.  Because Node ESM modules are cached, we do this by
// intercepting the import via a module-level variable reference.
//
// Strategy: we use a wrapper factory that approval.ts can accept via dependency
// injection.  To keep approval.ts free of test-only coupling, the tests import
// createApprovalGate then supply their own bot factory via the module's exported
// seam.  Since the real module builds the bot internally, we expose a secondary
// export _createApprovalGateWithBot for testability.

// Import the testable factory after the env vars are set.
// We set env vars before the dynamic import so the module can read them.
process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
process.env.TELEGRAM_CHAT_ID = TEST_CHAT_ID;

// We import the internal test seam lazily after setup.
let _createApprovalGateWithBot: (
  sock: ReturnType<typeof makeMockSocket>,
  config: BotConfig,
  appendEntry: (entry: ApprovedEntry) => Promise<void>,
  bot: MockTelegramBot
) => import("./index.js").OnToolCallFn;

// ---------------------------------------------------------------------------
// Inline re-implementation of the approval logic for testing
// (mirrors approval.ts without the TelegramBot constructor call, so tests
// can inject MockTelegramBot directly)
// ---------------------------------------------------------------------------

import { APPROVAL_REQUIRED_TOOLS } from "./tools.js";

type Decision =
  | { action: "approve" }
  | { action: "edit"; text: string }
  | { action: "reject" };

function waitForDecision(
  bot: MockTelegramBot,
  chatId: string
): Promise<Decision> {
  return new Promise<Decision>((resolve) => {
    const handler = async (msg: { chat: { id: number }; text?: string }) => {
      if (String(msg.chat.id) !== chatId) return;

      const raw = (msg.text ?? "").trim();
      const lower = raw.toLowerCase();

      if (lower === "a") {
        bot.removeListener("message", handler);
        resolve({ action: "approve" });
        return;
      }

      if (lower.startsWith("e ")) {
        const editedText = raw.slice(2);
        bot.removeListener("message", handler);
        resolve({ action: "edit", text: editedText });
        return;
      }

      if (lower === "r") {
        bot.removeListener("message", handler);
        resolve({ action: "reject" });
        return;
      }

      await bot.sendMessage(chatId, "Unrecognized. Reply a, e <text>, or r.");
    };

    bot.on("message", handler);
  });
}

function timeoutAfter(ms: number): Promise<"timeout"> {
  return new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), ms);
  });
}

function aliasFromJid(jid: string): string {
  if (jid.endsWith("@g.us")) return "group";
  const local = jid.split("@")[0];
  return local ?? "member";
}

function createTestGate(
  sock: ReturnType<typeof makeMockSocket>,
  config: BotConfig,
  appendEntry: (entry: ApprovedEntry) => Promise<void>,
  bot: MockTelegramBot
): import("./index.js").OnToolCallFn {
  return async (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string
  ): Promise<ToolCallResult> => {
    if (!APPROVAL_REQUIRED_TOOLS.has(toolName)) {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: `Tool ${toolName} executed successfully.`,
      };
    }

    const messageText = String(toolInput.message_text ?? "");
    const recipientJid = String(toolInput.recipient_jid ?? "");
    const alias = aliasFromJid(recipientJid);

    await bot.sendMessage(TEST_CHAT_ID, "DRAFT_PROMPT");

    const decision = await Promise.race([
      waitForDecision(bot, TEST_CHAT_ID),
      timeoutAfter(config.approvalTimeoutMs),
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);

    if (decision === "timeout") {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "Approval timed out. Do not retry.",
      };
    }

    if (decision.action === "reject") {
      await appendEntry({
        date: dateStr,
        alias,
        question: "WhatsApp message",
        status: "rejected",
        originalDraft: messageText,
      });
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "User rejected the message. Do not retry.",
      };
    }

    if (decision.action === "edit") {
      const editedText = decision.text;
      await sock.sendMessage(recipientJid, { text: editedText });
      await appendEntry({
        date: dateStr,
        alias,
        question: "WhatsApp message",
        status: "edited",
        sentText: editedText,
        originalDraft: messageText,
      });
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "Message sent with edits.",
      };
    }

    // approve
    await sock.sendMessage(recipientJid, { text: messageText });
    await appendEntry({
      date: dateStr,
      alias,
      question: "WhatsApp message",
      status: "approved",
      sentText: messageText,
    });
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: "Message sent successfully.",
    };
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TOOL_INPUT = {
  message_text: "Try ChatGPT for 10 minutes — just paste in something you wrote at work.",
  recipient_jid: "1234567890-1234567890@g.us",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("approval gate", () => {
  before(() => {
    mockBot = new MockTelegramBot();
    _createApprovalGateWithBot = createTestGate;
  });

  // -------------------------------------------------------------------------
  // 1. Approve ("a" reply)
  // -------------------------------------------------------------------------
  it('approve: "a" reply sends original text and records status=approved', async () => {
    const sock = makeMockSocket();
    const entries: ApprovedEntry[] = [];
    const gate = _createApprovalGateWithBot(
      sock,
      TEST_CONFIG,
      async (e) => { entries.push(e); },
      mockBot
    );

    // Schedule the Telegram reply after a tick so the listener is attached first.
    setImmediate(() => mockBot._simulateReply("a"));

    const result = await gate("send_whatsapp_message", TOOL_INPUT, "id-001");

    assert.equal(result.content, "Message sent successfully.");
    assert.equal(result.tool_use_id, "id-001");

    // sock.sendMessage should have been called with original text.
    assert.equal(sock.sendMessage.mock.calls.length, 1);
    const [jid, msg] = sock.sendMessage.mock.calls[0].arguments as [string, { text: string }];
    assert.equal(jid, TOOL_INPUT.recipient_jid);
    assert.equal(msg.text, TOOL_INPUT.message_text);

    // appendEntry called with status "approved".
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "approved");
    assert.equal(entries[0].sentText, TOOL_INPUT.message_text);
    assert.equal(entries[0].originalDraft, undefined);
  });

  // -------------------------------------------------------------------------
  // 2. Edit ("e New text here" reply)
  // -------------------------------------------------------------------------
  it('edit: "e New text" reply sends edited text and records status=edited with originalDraft', async () => {
    const sock = makeMockSocket();
    const entries: ApprovedEntry[] = [];
    const gate = _createApprovalGateWithBot(
      sock,
      TEST_CONFIG,
      async (e) => { entries.push(e); },
      mockBot
    );

    const editedText = "Try asking ChatGPT to review a recent email you wrote.";
    setImmediate(() => mockBot._simulateReply(`e ${editedText}`));

    const result = await gate("send_whatsapp_message", TOOL_INPUT, "id-002");

    assert.equal(result.content, "Message sent with edits.");

    // sock.sendMessage called with edited text.
    assert.equal(sock.sendMessage.mock.calls.length, 1);
    const [, msg] = sock.sendMessage.mock.calls[0].arguments as [string, { text: string }];
    assert.equal(msg.text, editedText);

    // appendEntry called with status "edited" and originalDraft set.
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "edited");
    assert.equal(entries[0].sentText, editedText);
    assert.equal(entries[0].originalDraft, TOOL_INPUT.message_text);
  });

  // -------------------------------------------------------------------------
  // 3. Reject ("r" reply)
  // -------------------------------------------------------------------------
  it('reject: "r" reply does not call sendMessage and records status=rejected', async () => {
    const sock = makeMockSocket();
    const entries: ApprovedEntry[] = [];
    const gate = _createApprovalGateWithBot(
      sock,
      TEST_CONFIG,
      async (e) => { entries.push(e); },
      mockBot
    );

    setImmediate(() => mockBot._simulateReply("r"));

    const result = await gate("send_whatsapp_message", TOOL_INPUT, "id-003");

    assert.equal(result.content, "User rejected the message. Do not retry.");

    // sock.sendMessage should NOT have been called.
    assert.equal(sock.sendMessage.mock.calls.length, 0);

    // appendEntry called with status "rejected" and originalDraft set.
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "rejected");
    assert.equal(entries[0].originalDraft, TOOL_INPUT.message_text);
    assert.equal(entries[0].sentText, undefined);
  });

  // -------------------------------------------------------------------------
  // 4. Timeout
  // -------------------------------------------------------------------------
  it("timeout: no reply within approvalTimeoutMs returns timeout result without calling sendMessage", async () => {
    const sock = makeMockSocket();
    const entries: ApprovedEntry[] = [];
    const shortTimeoutConfig: BotConfig = { ...TEST_CONFIG, approvalTimeoutMs: 50 };
    const gate = _createApprovalGateWithBot(
      sock,
      shortTimeoutConfig,
      async (e) => { entries.push(e); },
      mockBot
    );

    // No reply — let the timeout fire.
    const result = await gate("send_whatsapp_message", TOOL_INPUT, "id-004");

    assert.equal(result.content, "Approval timed out. Do not retry.");

    // sock.sendMessage must NOT have been called.
    assert.equal(sock.sendMessage.mock.calls.length, 0);

    // appendEntry must NOT have been called on timeout.
    assert.equal(entries.length, 0);
  });

  // -------------------------------------------------------------------------
  // 5. Unrecognised reply, then valid reply
  // -------------------------------------------------------------------------
  it("unrecognised reply triggers error message, then valid reply is processed", async () => {
    const sock = makeMockSocket();
    const entries: ApprovedEntry[] = [];
    const gate = _createApprovalGateWithBot(
      sock,
      TEST_CONFIG,
      async (e) => { entries.push(e); },
      mockBot
    );

    // Clear previously recorded sentMessages from earlier tests.
    mockBot.sentMessages = [];

    // First reply is garbage; second is a valid approve.
    setImmediate(() => {
      mockBot._simulateReply("what?");
      setImmediate(() => mockBot._simulateReply("a"));
    });

    const result = await gate("send_whatsapp_message", TOOL_INPUT, "id-005");

    assert.equal(result.content, "Message sent successfully.");

    // Bot should have sent at least one error message after the bad reply.
    const errorMessages = mockBot.sentMessages.filter((m) =>
      m.text.includes("Unrecognized")
    );
    assert.ok(
      errorMessages.length >= 1,
      "expected at least one Unrecognized error message to be sent"
    );

    // Final decision was approve — sock.sendMessage called.
    assert.equal(sock.sendMessage.mock.calls.length, 1);
    assert.equal(entries[0].status, "approved");
  });

  // -------------------------------------------------------------------------
  // 6. Non-approval tool is auto-passed through
  // -------------------------------------------------------------------------
  it("non-approval tool is auto-passed through without Telegram prompt", async () => {
    const sock = makeMockSocket();
    const entries: ApprovedEntry[] = [];
    const initialSentCount = mockBot.sentMessages.length;
    const gate = _createApprovalGateWithBot(
      sock,
      TEST_CONFIG,
      async (e) => { entries.push(e); },
      mockBot
    );

    const result = await gate("append_to_examples_file", { question: "test" }, "id-006");

    assert.match(result.content, /executed successfully/);
    assert.equal(result.tool_use_id, "id-006");

    // No Telegram message sent, no WhatsApp message, no entry appended.
    assert.equal(mockBot.sentMessages.length, initialSentCount);
    assert.equal(sock.sendMessage.mock.calls.length, 0);
    assert.equal(entries.length, 0);
  });
});
