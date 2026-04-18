/**
 * examples.test.ts
 *
 * Tests for src/storage/examples.ts using node:test + node:assert/strict.
 * File I/O uses a temp directory so the real data files are never touched.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadExamples, appendEntry } from "./examples.js";
import type { ApprovedEntry } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `examples-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

const SEED_CONTENT = "## 2026-04-01 · Randy · approved\n\n**Q:** Seed question\n\n**Sent:** Seed answer";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("examples storage", () => {
  before(async () => {
    tmpDir = await makeTmpDir();
    // Write a seed file so loadExamples has something to fall back to
    await writeFile(path.join(tmpDir, "approved-responses-seed.md"), SEED_CONTENT, "utf-8");
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // 1. loadExamples returns seed when approved-responses.md does not exist
  it("returns seed content when approved-responses.md does not exist", async () => {
    // Use a fresh sub-dir with only the seed file
    const dir = path.join(tmpDir, "test1");
    await mkdir(dir);
    await writeFile(path.join(dir, "approved-responses-seed.md"), SEED_CONTENT, "utf-8");

    const result = await loadExamples(dir);
    assert.equal(result, SEED_CONTENT);
  });

  // 2. loadExamples returns runtime file when approved-responses.md exists
  it("returns runtime file content when approved-responses.md exists", async () => {
    const dir = path.join(tmpDir, "test2");
    await mkdir(dir);
    await writeFile(path.join(dir, "approved-responses-seed.md"), SEED_CONTENT, "utf-8");
    const runtimeContent = "## 2026-04-18 · Test · approved\n\n**Q:** Runtime Q\n\n**Sent:** Runtime A";
    await writeFile(path.join(dir, "approved-responses.md"), runtimeContent, "utf-8");

    const result = await loadExamples(dir);
    assert.equal(result, runtimeContent);
  });

  // 3. appendEntry with status "approved" writes heading + Q + Sent (no Draft)
  it("appendEntry approved: writes heading, Q, and Sent — no Draft field", async () => {
    const dir = path.join(tmpDir, "test3");
    await mkdir(dir);

    const entry: ApprovedEntry = {
      date: "2026-04-18",
      alias: "Alice",
      question: "How do I use AI at work?",
      status: "approved",
      sentText: "Start with small tasks and experiment daily.",
    };

    await appendEntry(entry, dir);
    const content = await readFile(path.join(dir, "approved-responses.md"), "utf-8");

    assert.match(content, /## 2026-04-18 · Alice · approved/);
    assert.match(content, /\*\*Q:\*\* How do I use AI at work\?/);
    assert.match(content, /\*\*Sent:\*\* Start with small tasks/);
    assert.doesNotMatch(content, /\*\*Draft:\*\*/);
  });

  // 4. appendEntry with status "edited" writes heading + Q + Draft + Sent
  it("appendEntry edited: writes heading, Q, Draft, and Sent", async () => {
    const dir = path.join(tmpDir, "test4");
    await mkdir(dir);

    const entry: ApprovedEntry = {
      date: "2026-04-18",
      alias: "Bob",
      question: "What is prompt engineering?",
      status: "edited",
      originalDraft: "Prompt engineering is about writing good prompts.",
      sentText: "Prompt engineering is crafting instructions that guide AI responses.",
    };

    await appendEntry(entry, dir);
    const content = await readFile(path.join(dir, "approved-responses.md"), "utf-8");

    assert.match(content, /## 2026-04-18 · Bob · edited/);
    assert.match(content, /\*\*Q:\*\* What is prompt engineering\?/);
    assert.match(content, /\*\*Draft:\*\* Prompt engineering is about writing good prompts\./);
    assert.match(content, /\*\*Sent:\*\* Prompt engineering is crafting/);
  });

  // 5. appendEntry with status "rejected" writes heading + Q + Draft (no Sent)
  it("appendEntry rejected: writes heading, Q, and Draft — no Sent field", async () => {
    const dir = path.join(tmpDir, "test5");
    await mkdir(dir);

    const entry: ApprovedEntry = {
      date: "2026-04-18",
      alias: "Carol",
      question: "Is AI going to take my job?",
      status: "rejected",
      originalDraft: "AI will transform many jobs over the next decade.",
    };

    await appendEntry(entry, dir);
    const content = await readFile(path.join(dir, "approved-responses.md"), "utf-8");

    assert.match(content, /## 2026-04-18 · Carol · rejected/);
    assert.match(content, /\*\*Q:\*\* Is AI going to take my job\?/);
    assert.match(content, /\*\*Draft:\*\* AI will transform/);
    assert.doesNotMatch(content, /\*\*Sent:\*\*/);
  });

  // 6. Two appendEntry calls produce two parseable headings
  it("two appendEntry calls produce two headings separated by ---", async () => {
    const dir = path.join(tmpDir, "test6");
    await mkdir(dir);

    const entry1: ApprovedEntry = {
      date: "2026-04-18",
      alias: "Dave",
      question: "First question?",
      status: "approved",
      sentText: "First answer.",
    };

    const entry2: ApprovedEntry = {
      date: "2026-04-18",
      alias: "Eve",
      question: "Second question?",
      status: "approved",
      sentText: "Second answer.",
    };

    await appendEntry(entry1, dir);
    await appendEntry(entry2, dir);

    const content = await readFile(path.join(dir, "approved-responses.md"), "utf-8");

    // Both headings present
    assert.match(content, /## 2026-04-18 · Dave · approved/);
    assert.match(content, /## 2026-04-18 · Eve · approved/);

    // Separator present between entries
    assert.match(content, /---/);

    // Count headings — should be exactly 2
    const headings = content.match(/^## /gm);
    assert.equal(headings?.length, 2);
  });

  // 7. appendEntry catches and logs a write error without rethrowing
  it("appendEntry catches write errors without rethrowing", async () => {
    // Pass a path that cannot be written (a non-existent nested directory)
    const badDir = path.join(tmpDir, "does-not-exist", "nested");

    const entry: ApprovedEntry = {
      date: "2026-04-18",
      alias: "Frank",
      question: "Will this throw?",
      status: "approved",
      sentText: "It should not.",
    };

    // Capture console.error to verify it was called
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      // Should NOT throw
      await assert.doesNotReject(appendEntry(entry, badDir));
    } finally {
      console.error = originalError;
    }

    // At least one error should have been logged
    assert.ok(errors.length > 0, "console.error should have been called with the write error");
  });
});
