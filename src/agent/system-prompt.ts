/**
 * system-prompt.ts
 *
 * Builds the cached system prompt blocks for every Claude API call.
 * Called ONCE at startup; the result is reused for every messages.create call.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages.js";

/**
 * Build the two-block system prompt array with prompt caching enabled.
 *
 * Block 1: The core system prompt (voice, rules, scope guard) — read from
 *           config/system-prompt-core.md at startup.
 * Block 2: Gold-standard examples of David's advice style, passed in by the
 *           caller (loaded from pre-work/example1.md + pre-work/example2.md).
 *
 * Both blocks use cache_control: { type: "ephemeral" } so Claude caches them
 * across turns (minimum 1024 tokens for Sonnet).
 */
export function buildSystemBlocks(examplesContent: string): TextBlockParam[] {
  const corePromptPath = fileURLToPath(
    new URL("../../config/system-prompt-core.md", import.meta.url)
  );
  const corePromptText = readFileSync(corePromptPath, "utf-8");

  const block1: TextBlockParam = {
    type: "text",
    text: corePromptText,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cache_control: { type: "ephemeral" } as any,
  };

  const block2: TextBlockParam = {
    type: "text",
    text: examplesContent,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cache_control: { type: "ephemeral" } as any,
  };

  return [block1, block2];
}
