/**
 * tools.test.ts
 *
 * Tests for the agent tools array and APPROVAL_REQUIRED_TOOLS set.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tools, APPROVAL_REQUIRED_TOOLS } from "./tools.js";

describe("tools", () => {
  it("tools array has exactly 2 entries", () => {
    assert.equal(tools.length, 2);
  });

  it("APPROVAL_REQUIRED_TOOLS contains 'send_whatsapp_message'", () => {
    assert.equal(APPROVAL_REQUIRED_TOOLS.has("send_whatsapp_message"), true);
  });

  it("APPROVAL_REQUIRED_TOOLS does NOT contain 'append_to_examples_file'", () => {
    assert.equal(
      APPROVAL_REQUIRED_TOOLS.has("append_to_examples_file"),
      false
    );
  });

  it("both tools have non-empty descriptions and input schemas", () => {
    for (const tool of tools) {
      assert.ok(
        typeof tool.description === "string" && tool.description.length > 0,
        `tool '${tool.name}' should have a non-empty description`
      );
      assert.ok(
        tool.input_schema != null,
        `tool '${tool.name}' should have an input_schema`
      );
      // Verify the schema has at least a 'properties' key.
      const schema = tool.input_schema as { properties?: unknown };
      assert.ok(
        schema.properties != null,
        `tool '${tool.name}' input_schema should have properties`
      );
    }
  });
});
