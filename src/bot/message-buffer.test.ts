/**
 * message-buffer.test.ts
 *
 * Unit tests for src/bot/message-buffer.ts.
 * Uses Node's built-in test runner (node:test).
 *
 * Run with: node --import tsx/esm --test src/bot/message-buffer.test.ts
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MessageBuffer } from "./message-buffer.js";
import type { WAMessage } from "@whiskeysockets/baileys";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(
  remoteJid: string,
  id: string,
  text?: string
): WAMessage {
  return {
    key: { remoteJid, id, fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: text ? { conversation: text } : undefined,
  } as unknown as WAMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessageBuffer", () => {
  // -------------------------------------------------------------------------
  // 1. push adds a message to the buffer for that group JID
  // -------------------------------------------------------------------------
  test("push adds a message for the correct group JID", () => {
    const buf = new MessageBuffer();
    const msg = makeMsg("group1@g.us", "msg-001", "hello");
    buf.push(msg);

    const recent = buf.getRecent("group1@g.us", 10);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].key.id, "msg-001");
  });

  // -------------------------------------------------------------------------
  // 2. getRecent returns the last N messages
  // -------------------------------------------------------------------------
  test("getRecent returns only the last N messages", () => {
    const buf = new MessageBuffer();
    for (let i = 1; i <= 10; i++) {
      buf.push(makeMsg("group1@g.us", `msg-${i}`, `text ${i}`));
    }

    const recent = buf.getRecent("group1@g.us", 3);
    assert.equal(recent.length, 3);
    assert.equal(recent[0].key.id, "msg-8");
    assert.equal(recent[1].key.id, "msg-9");
    assert.equal(recent[2].key.id, "msg-10");
  });

  // -------------------------------------------------------------------------
  // 3. Buffer caps at 30 messages — 31st push evicts the oldest
  // -------------------------------------------------------------------------
  test("buffer caps at 30 messages (31st push evicts the oldest)", () => {
    const buf = new MessageBuffer();
    for (let i = 1; i <= 31; i++) {
      buf.push(makeMsg("group1@g.us", `msg-${i}`, `text ${i}`));
    }

    const all = buf.getRecent("group1@g.us", 50);
    assert.equal(all.length, 30, "buffer should hold exactly 30 messages");
    // msg-1 should have been evicted; msg-2 is now oldest
    assert.equal(all[0].key.id, "msg-2", "oldest message after eviction should be msg-2");
    assert.equal(all[29].key.id, "msg-31", "newest message should be msg-31");
  });

  // -------------------------------------------------------------------------
  // 4. getMessage finds a message by remoteJid + id
  // -------------------------------------------------------------------------
  test("getMessage returns the correct message by key", () => {
    const buf = new MessageBuffer();
    const msg = makeMsg("group2@g.us", "find-me", "looking for this");
    buf.push(msg);
    buf.push(makeMsg("group2@g.us", "other", "noise"));

    const found = buf.getMessage({ remoteJid: "group2@g.us", id: "find-me" });
    assert.ok(found, "should find the message");
    assert.equal(found.key.id, "find-me");
  });

  // -------------------------------------------------------------------------
  // 5. getMessage returns undefined for an unknown key
  // -------------------------------------------------------------------------
  test("getMessage returns undefined for an unknown key", () => {
    const buf = new MessageBuffer();
    buf.push(makeMsg("group3@g.us", "exists", "hi"));

    const result = buf.getMessage({ remoteJid: "group3@g.us", id: "does-not-exist" });
    assert.equal(result, undefined);

    const result2 = buf.getMessage({ remoteJid: "unknown-group@g.us", id: "exists" });
    assert.equal(result2, undefined);
  });
});
