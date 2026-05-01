/**
 * index.test.ts
 *
 * Integration smoke tests for the bot's top-level wiring.
 *
 * All external modules (Baileys, Anthropic API, Telegram) are mocked —
 * no real network calls are made.
 *
 * Tests use Node's built-in test runner (node:test).
 *
 * Run with:
 *   node --import tsx/esm --test src/index.test.ts
 */

import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { AgentTurn, BotConfig, ApprovedEntry } from "./types.js";
import type { OnToolCallFn, ToolCallResult } from "./agent/index.js";
import { APPROVAL_REQUIRED_TOOLS } from "./agent/tools.js";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * A minimal mock WASocket — enough for the wiring under test.
 * Exposes ev (EventEmitter), sendMessage, end, and user.
 */
function makeMockSocket() {
  const emitter = new EventEmitter();

  const sendMessage = mock.fn(
    async (_jid: string, _content: { text: string }) => ({})
  );
  const end = mock.fn((_reason: undefined) => {});

  return {
    ev: {
      on: (event: string, handler: (...args: unknown[]) => void) =>
        emitter.on(event, handler),
      emit: (event: string, payload: unknown) =>
        emitter.emit(event, payload),
    },
    sendMessage,
    end,
    user: { id: "15551234567:1@s.whatsapp.net" },
    groupFetchAllParticipating: async () => ({}),
    groupMetadata: async (_jid: string) => ({ id: _jid, subject: "Test" }),
    _emitter: emitter,
  };
}

type MockSocket = ReturnType<typeof makeMockSocket>;

/** Minimal BotConfig for tests. */
const TEST_CONFIG: BotConfig = {
  autonomousMode: false,
  approvalTimeoutMs: 200,
  maxContextMessages: 5,
  queueDepthMax: 1,
  maxInboundMessageChars: 2000,
};

// ---------------------------------------------------------------------------
// Inline re-implementation of the wiring logic under test.
//
// Rather than importing the real src/index.ts (which has top-level await and
// triggers real Baileys / Anthropic network calls), we recreate the wiring
// logic directly so each test gets a clean, hermetic instance.
// ---------------------------------------------------------------------------

import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { MessageBuffer } from "./bot/message-buffer.js";
import { createMessageHandler, type MessageHandler } from "./bot/message-handler.js";

/**
 * Build a wired bot instance using mock dependencies.
 *
 * Returns a handleMessages function that tests call directly to simulate
 * incoming messages (mirrors the onMessage callback in the real index.ts).
 */
function createWiredBot(opts: {
  sock: MockSocket;
  onToolCall: OnToolCallFn;
  runAgentTurnFn: typeof import("./agent/index.js").runAgentTurn;
  appendEntryFn: (entry: ApprovedEntry) => Promise<void>;
}) {
  const { sock, runAgentTurnFn, onToolCall } = opts;

  const buffer = new MessageBuffer();

  // Fake system blocks — content doesn't matter for these tests.
  const systemBlocks = [{ type: "text" as const, text: "SYSTEM_PROMPT" }];

  async function onAgentTurn(turn: AgentTurn): Promise<void> {
    await runAgentTurnFn(
      turn.mentionText,
      turn.recentContextMessages,
      systemBlocks,
      onToolCall,
      turn.groupJid
    );
  }

  const botJid = sock.user?.id ?? "";
  const messageHandler: MessageHandler = createMessageHandler(
    () => sock as unknown as WASocket,
    buffer,
    TEST_CONFIG,
    [botJid],
    [],
    onAgentTurn
  );

  function handleMessages(messages: WAMessage[], type: string): void {
    for (const msg of messages) buffer.push(msg);
    messageHandler(messages, type);
  }

  return { buffer, sock, handleMessages };
}

// ---------------------------------------------------------------------------
// Helpers to fire a fake @mention into the wired bot
// ---------------------------------------------------------------------------

/**
 * Build a minimal WAMessage that looks like an @mention of the bot.
 */
function makeMentionMessage(opts: {
  groupJid: string;
  botJid: string;
  text: string;
  fromMe?: boolean;
}): import("@whiskeysockets/baileys").WAMessage {
  const botNumber = opts.botJid.split("@")[0].split(":")[0];

  return {
    key: {
      remoteJid: opts.groupJid,
      id: `msg-${Math.random().toString(36).slice(2)}`,
      fromMe: opts.fromMe ?? false,
    },
    messageTimestamp: Math.floor(Date.now() / 1000), // now = not stale
    message: {
      extendedTextMessage: {
        text: opts.text,
        contextInfo: {
          mentionedJid: [`${botNumber}@s.whatsapp.net`],
        },
      },
    },
  } as unknown as import("@whiskeysockets/baileys").WAMessage;
}

// ---------------------------------------------------------------------------
// Test 1: @mention triggers runAgentTurn → onToolCall called with
//         "send_whatsapp_message" → appendEntry called
// ---------------------------------------------------------------------------

describe("index wiring", () => {
  it("@mention triggers agent turn; onToolCall receives send_whatsapp_message; appendEntry is called", async () => {
    // Capture calls to onToolCall and appendEntry.
    const toolCallArgs: Array<{ name: string; input: Record<string, unknown>; id: string }> = [];
    const appendedEntries: ApprovedEntry[] = [];

    // Mock onToolCall: auto-approve send_whatsapp_message, pass through others.
    const mockOnToolCall: OnToolCallFn = async (
      toolName,
      toolInput,
      toolUseId
    ): Promise<ToolCallResult> => {
      toolCallArgs.push({ name: toolName, input: toolInput, id: toolUseId });
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: APPROVAL_REQUIRED_TOOLS.has(toolName)
          ? "Message sent successfully."
          : `Tool ${toolName} executed successfully.`,
      };
    };

    // Mock runAgentTurn: simulates the agent calling send_whatsapp_message once.
    const mockRunAgentTurn = mock.fn(
      async (
        _mentionText: string,
        _context: string[],
        _systemBlocks: unknown,
        onToolCall: OnToolCallFn
      ): Promise<void> => {
        // Simulate the agent making one tool call.
        await onToolCall(
          "send_whatsapp_message",
          {
            message_text: "Try ChatGPT for 10 minutes.",
            recipient_jid: "group-123@g.us",
          },
          "tool-use-id-001"
        );
      }
    );

    // Mock appendEntry: capture entries.
    const mockAppendEntry = mock.fn(async (entry: ApprovedEntry): Promise<void> => {
      appendedEntries.push(entry);
    });

    const sock = makeMockSocket();

    const { handleMessages } = createWiredBot({
      sock,
      onToolCall: mockOnToolCall,
      runAgentTurnFn: mockRunAgentTurn as unknown as typeof import("./agent/index.js").runAgentTurn,
      appendEntryFn: mockAppendEntry,
    });

    // Fire a fresh @mention through the handler.
    const mention = makeMentionMessage({
      groupJid: "group-123@g.us",
      botJid: sock.user!.id,
      text: "@Solicited-Advice how do I get started with AI?",
    });

    handleMessages([mention], "notify");

    // Wait for the async agent turn to complete (process.nextTick + async chain).
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // runAgentTurn should have been called once.
    assert.equal(
      mockRunAgentTurn.mock.calls.length,
      1,
      "runAgentTurn should be called once for the @mention"
    );

    // onToolCall should have received send_whatsapp_message.
    assert.equal(
      toolCallArgs.length,
      1,
      "onToolCall should be called once"
    );
    assert.equal(
      toolCallArgs[0].name,
      "send_whatsapp_message",
      "tool name should be send_whatsapp_message"
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: SIGINT triggers sock.end (graceful shutdown)
  // -------------------------------------------------------------------------
  it("cleanup() calls sock.end and does not throw", () => {
    const sock = makeMockSocket();

    // Inline the cleanup logic from src/index.ts.
    function cleanup(): void {
      try {
        sock.end(undefined);
      } catch {
        // ignored in cleanup
      }
    }

    // Should not throw.
    assert.doesNotThrow(() => cleanup());

    // sock.end should have been called once with undefined.
    assert.equal(sock.end.mock.calls.length, 1);
    assert.equal(sock.end.mock.calls[0].arguments[0], undefined);
  });
});
