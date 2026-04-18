/**
 * agent/index.ts
 *
 * Manual agentic loop for the Solicited Advice bot.
 * Drives a Claude conversation turn by turn, routing tool calls to the
 * approval gate (or auto-executing non-gated tools in Unit 8).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { tools, APPROVAL_REQUIRED_TOOLS } from "./tools.js";

/** The result returned from a tool call handler. */
export type ToolCallResult = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};

/**
 * Callback invoked for every tool call the agent makes.
 * For approval-required tools, the implementation will block until David
 * approves, edits, or rejects the draft.
 * For auto-approved tools, the implementation executes immediately.
 *
 * Returns a ToolCallResult that is fed back into the next agent turn.
 */
export type OnToolCallFn = (
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId: string
) => Promise<ToolCallResult>;

// Shared Anthropic client — reads ANTHROPIC_API_KEY from env automatically.
const client = new Anthropic();

const MODEL = "claude-sonnet-4-6";

/**
 * Run one full agent turn (which may involve multiple Claude API round-trips
 * if the model calls tools).
 *
 * @param mentionText           The raw mention text that triggered this turn
 *                              (e.g. "@Solicited-Advice how do I get started?")
 * @param recentContextMessages Recent group messages for context, formatted as
 *                              "[Name]: message text" strings (oldest first).
 * @param systemBlocks          Pre-built, cached system prompt blocks from
 *                              buildSystemBlocks().
 * @param onToolCall            Handler invoked for each tool_use block. Returns
 *                              the tool_result to feed back to the model.
 */
export async function runAgentTurn(
  mentionText: string,
  recentContextMessages: string[],
  systemBlocks: TextBlockParam[],
  onToolCall: OnToolCallFn,
  groupJid: string
): Promise<void> {
  // Build the initial user message: recipient JID, recent context, then mention.
  const contextSection =
    recentContextMessages.length > 0
      ? `Recent group conversation:\n${recentContextMessages.join("\n")}\n\n`
      : "";

  const userMessageText = `[recipient_jid: ${groupJid}]\n\n${contextSection}${mentionText}`;

  // Conversation history for this turn (grows as tool calls are processed).
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessageText },
  ];

  // Agentic loop — continue until end_turn or an unexpected stop reason.
  while (true) {
    let response: Anthropic.Message;

    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemBlocks as Anthropic.TextBlockParam[],
        tools,
        messages,
      });
    } catch (err) {
      // Log and return — do NOT rethrow so Baileys stays alive.
      console.error("[agent] messages.create failed:", err);
      return;
    }

    // Log prompt cache stats when available.
    const usage = response.usage as Anthropic.Usage & {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    if (
      usage.cache_creation_input_tokens != null ||
      usage.cache_read_input_tokens != null
    ) {
      console.log(
        "[agent] cache stats — created:",
        usage.cache_creation_input_tokens ?? 0,
        "read:",
        usage.cache_read_input_tokens ?? 0
      );
    }

    if (response.stop_reason === "end_turn") {
      // Model finished naturally — nothing more to do.
      break;
    }

    if (response.stop_reason !== "tool_use") {
      // Unexpected stop reason (e.g. max_tokens). Log and bail out.
      console.warn("[agent] unexpected stop_reason:", response.stop_reason);
      break;
    }

    // Collect all tool_use blocks from this response.
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // stop_reason was tool_use but no tool blocks — shouldn't happen.
      console.warn("[agent] stop_reason=tool_use but no tool_use blocks found");
      break;
    }

    // Push the assistant turn into the conversation history.
    messages.push({ role: "assistant", content: response.content });

    // Process each tool call and collect results.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      const toolInput = block.input as Record<string, unknown>;

      // Both approval-required and auto-approved tools go through onToolCall.
      // The caller (Unit 6 / Unit 8) is responsible for gating or executing
      // based on whether block.name is in APPROVAL_REQUIRED_TOOLS.
      const result = await onToolCall(block.name, toolInput, block.id);

      // Log whether this tool required approval.
      const requiresApproval = APPROVAL_REQUIRED_TOOLS.has(block.name);
      console.log(
        `[agent] tool_call name=${block.name} approval_required=${requiresApproval} id=${block.id}`
      );

      toolResults.push({
        type: "tool_result",
        tool_use_id: result.tool_use_id,
        content: result.content,
      });
    }

    // Feed all tool results back as a new user turn and continue the loop.
    messages.push({ role: "user", content: toolResults });
  }
}
