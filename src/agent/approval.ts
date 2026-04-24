/**
 * approval.ts
 *
 * Approval gate for the Solicited Advice bot — Unit 6.
 *
 * Implements the OnToolCallFn interface. When the agent calls
 * send_whatsapp_message, this module:
 *   1. Sends a draft preview to David's Telegram chat.
 *   2. Waits for an a / e <text> / r reply (up to config.approvalTimeoutMs).
 *   3. Executes or suppresses the WhatsApp send accordingly.
 *   4. Records the outcome via appendEntry.
 *
 * All other tools (append_to_examples_file, etc.) are auto-passed through.
 */

import TelegramBot from "node-telegram-bot-api";
import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import type { BotConfig, ApprovedEntry } from "../types.js";
import type { OnToolCallFn, ToolCallResult } from "./index.js";
import { APPROVAL_REQUIRED_TOOLS } from "./tools.js";
import { searchWeb } from "./search.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function preview(text: string, maxLen = 80): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
}

/**
 * Extract a simple alias from a WhatsApp JID.
 * e.g. "15551234567@s.whatsapp.net"  → "15551234567"
 *      "1234567890-1234567890@g.us"  → "group"
 */
function aliasFromJid(jid: string): string {
  if (jid.endsWith("@g.us")) return "group";
  const local = jid.split("@")[0];
  return local ?? "member";
}

// ---------------------------------------------------------------------------
// createApprovalGate
// ---------------------------------------------------------------------------

/**
 * Returns an OnToolCallFn that routes send_whatsapp_message calls through
 * Telegram for human approval, and auto-passes all other tools.
 *
 * Required environment variables:
 *   TELEGRAM_BOT_TOKEN  — bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — David's personal chat ID (numeric string)
 */
export function createApprovalGate(
  sock: WASocket,
  config: BotConfig,
  appendEntry: (entry: ApprovedEntry) => Promise<void>,
  getQuotedMessage: () => WAMessage | undefined
): OnToolCallFn {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    throw new Error("[approval] TELEGRAM_BOT_TOKEN is not set");
  }
  if (!chatId) {
    throw new Error("[approval] TELEGRAM_CHAT_ID is not set");
  }

  // Start the Telegram bot in polling mode once and reuse for all calls.
  const bot = new TelegramBot(token, { polling: true });

  const onToolCall: OnToolCallFn = async (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string
  ): Promise<ToolCallResult> => {
    // -----------------------------------------------------------------------
    // Non-approval-gated tools — execute immediately and return results.
    // -----------------------------------------------------------------------
    if (!APPROVAL_REQUIRED_TOOLS.has(toolName)) {
      if (toolName === "search_web") {
        const query = String(toolInput.query ?? "");
        console.log(`[search] query: "${query}"`);
        const results = await searchWeb(query);
        return {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: results,
        };
      }
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: `Tool ${toolName} executed successfully.`,
      };
    }

    // -----------------------------------------------------------------------
    // send_whatsapp_message — requires human approval.
    // -----------------------------------------------------------------------
    const messageText = String(toolInput.message_text ?? "");
    const recipientJid = String(toolInput.recipient_jid ?? "");
    const alias = aliasFromJid(recipientJid);

    // Format the Telegram prompt.
    const prompt = [
      messageText,
      "",
      "Reply with:",
      "• a — approve and send as-is",
      "• e Your edited text — approve with edits",
      "• r — reject (don't send)",
      "",
      "(auto-expires in 30 min)",
    ].join("\n");

    // Send the draft to Telegram.
    await bot.sendMessage(chatId, prompt);

    // -----------------------------------------------------------------------
    // Wait for a valid reply, race against timeout.
    // -----------------------------------------------------------------------
    const decision = await Promise.race([
      waitForDecision(bot, chatId),
      timeoutAfter(config.approvalTimeoutMs),
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);

    // -----------------------------------------------------------------------
    // Handle the decision.
    // -----------------------------------------------------------------------
    if (decision === "timeout") {
      console.log(
        `[TIMEOUT] ${timestamp()} approval expired — draft: "${preview(messageText)}"`
      );
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "Approval timed out. Do not retry.",
      };
    }

    if (decision.action === "reject") {
      // Ask David for an optional reason — if given, Claude gets another shot.
      await bot.sendMessage(
        chatId,
        "Rejected. Reply with a reason and Claude will try again, or reply 'skip' to drop it. (2 min timeout)"
      );

      const reason = await Promise.race([
        waitForReason(bot, chatId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000)),
      ]);

      console.log(
        `[REJECTED] ${timestamp()} — draft: "${preview(messageText)}"${reason ? ` — reason: "${reason}"` : ""}`
      );
      await appendEntry({
        date: dateStr,
        alias,
        question: "WhatsApp message",
        status: "rejected",
        originalDraft: messageText,
      });

      if (reason) {
        return {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: `David rejected this draft. His feedback: "${reason}". Please write a different response taking this feedback into account, then call send_whatsapp_message again.`,
        };
      }

      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "User rejected the message. Do not retry.",
      };
    }

    if (decision.action === "edit") {
      const editedText = decision.text;
      console.log(
        `[EDITED] ${timestamp()} — draft: "${preview(messageText)}" → "${preview(editedText)}"`
      );
      await sock.sendMessage(recipientJid, { text: editedText }, { quoted: getQuotedMessage() });
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

    // decision.action === "approve"
    console.log(
      `[APPROVED] ${timestamp()} — draft: "${preview(messageText)}"`
    );
    await sock.sendMessage(recipientJid, { text: messageText }, { quoted: getQuotedMessage() });
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

  return onToolCall;
}

// ---------------------------------------------------------------------------
// Decision types
// ---------------------------------------------------------------------------

type DecisionApprove = { action: "approve" };
type DecisionEdit = { action: "edit"; text: string };
type DecisionReject = { action: "reject" };
type Decision = DecisionApprove | DecisionEdit | DecisionReject;

// ---------------------------------------------------------------------------
// waitForDecision
// ---------------------------------------------------------------------------

/**
 * Attaches a one-shot message listener to the Telegram bot and resolves
 * with the parsed decision. Invalid replies cause an error message to be
 * sent back and the listener waits again. The listener is removed once a
 * valid decision is reached.
 */
function waitForDecision(
  bot: TelegramBot,
  chatId: string
): Promise<Decision> {
  return new Promise<Decision>((resolve) => {
    const handler = async (msg: TelegramBot.Message) => {
      // Only accept messages from the authorised chat.
      if (String(msg.chat.id) !== chatId) return;

      const raw = (msg.text ?? "").trim();
      const lower = raw.toLowerCase();

      if (lower === "a") {
        bot.removeListener("message", handler);
        resolve({ action: "approve" });
        return;
      }

      if (lower.startsWith("e ")) {
        const editedText = raw.slice(2); // preserve original casing
        bot.removeListener("message", handler);
        resolve({ action: "edit", text: editedText });
        return;
      }

      if (lower === "r") {
        bot.removeListener("message", handler);
        resolve({ action: "reject" });
        return;
      }

      // Unrecognised — send error and keep listening.
      await bot.sendMessage(chatId, "Unrecognized. Reply a, e <text>, or r.");
    };

    bot.on("message", handler);
  });
}

// ---------------------------------------------------------------------------
// waitForReason
// ---------------------------------------------------------------------------

/**
 * After a rejection, waits for David to provide an optional reason.
 * Resolves with the reason string, or null if David replies 'skip'.
 * Caller is responsible for racing this against a timeout.
 */
function waitForReason(bot: TelegramBot, chatId: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const handler = (msg: TelegramBot.Message) => {
      if (String(msg.chat.id) !== chatId) return;
      const text = (msg.text ?? "").trim();
      bot.removeListener("message", handler);
      resolve(text.toLowerCase() === "skip" ? null : text);
    };
    bot.on("message", handler);
  });
}

// ---------------------------------------------------------------------------
// timeoutAfter
// ---------------------------------------------------------------------------

function timeoutAfter(ms: number): Promise<"timeout"> {
  return new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), ms);
  });
}
