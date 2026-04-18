/**
 * tools.ts
 *
 * Tool definitions for the Solicited Advice Claude agent.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * All tools available to the agent.
 *
 * send_whatsapp_message  — approval-gated; David must approve before the
 *                          message is delivered to the group.
 * append_to_examples_file — auto-approved; records approved/edited/rejected
 *                           responses to build the examples corpus over time.
 */
export const tools: Anthropic.Tool[] = [
  {
    name: "send_whatsapp_message",
    description:
      "Send a WhatsApp message to a group or individual. This tool requires human approval before execution — David will review the draft and may approve, edit, or reject it before it is sent.",
    input_schema: {
      type: "object",
      properties: {
        message_text: {
          type: "string",
          description: "The text of the WhatsApp message to send.",
        },
        recipient_jid: {
          type: "string",
          description:
            "The WhatsApp JID (group or individual) to send the message to, e.g. '1234567890-1234567890@g.us'.",
        },
      },
      required: ["message_text", "recipient_jid"],
    },
  },
  {
    name: "append_to_examples_file",
    description:
      "Record an interaction (question + response) to the examples corpus. Auto-approved — no human gate required. Use this after every interaction that reaches a final state (approved, edited, or rejected) to help improve future responses.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question or message that was asked in the group.",
        },
        response: {
          type: "string",
          description:
            "The final response text that was sent (or would have been sent).",
        },
        person: {
          type: "string",
          description:
            "The name or alias of the person who asked the question (optional).",
        },
        status: {
          type: "string",
          enum: ["approved", "edited", "rejected"],
          description:
            "Whether the response was approved as-is, edited by David before sending, or rejected.",
        },
        original_draft: {
          type: "string",
          description:
            "The original agent draft, if David edited it before sending (optional).",
        },
      },
      required: ["question", "response", "status"],
    },
  },
];

/**
 * Tools in this set require human approval before the agent result is
 * returned to the agentic loop. The approval gate (Unit 6) checks this set.
 */
export const APPROVAL_REQUIRED_TOOLS = new Set<string>([
  "send_whatsapp_message",
]);
