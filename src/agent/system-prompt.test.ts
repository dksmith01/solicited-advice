/**
 * system-prompt.test.ts
 *
 * Tests for buildSystemBlocks().
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSystemBlocks } from "./system-prompt.js";

describe("buildSystemBlocks", () => {
  const examplesContent =
    "Example 1: Randy asked about beverage sales.\nExample 2: Derek asked about prompting.";

  it("returns an array of exactly 2 elements", () => {
    const blocks = buildSystemBlocks(examplesContent);
    assert.equal(blocks.length, 2);
  });

  it("both blocks have cache_control: { type: 'ephemeral' }", () => {
    const blocks = buildSystemBlocks(examplesContent);
    for (const block of blocks) {
      // cache_control is typed as any on the block; cast to access it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cc = (block as any).cache_control;
      assert.deepEqual(cc, { type: "ephemeral" });
    }
  });

  it("second block content matches the provided examplesContent exactly", () => {
    const blocks = buildSystemBlocks(examplesContent);
    assert.equal(blocks[1].text, examplesContent);
  });

  it("first block type is 'text'", () => {
    const blocks = buildSystemBlocks(examplesContent);
    assert.equal(blocks[0].type, "text");
  });
});
