/**
 * examples.ts
 *
 * Loads approved-response examples for the agent's system prompt and
 * appends new entries as interactions are resolved.
 */

import { readFile, appendFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApprovedEntry } from "../types.js";

/**
 * Default data directory: <project-root>/data
 * Resolved from this file's location (src/storage/ → ../../data).
 */
function defaultDataDir(): string {
  return path.resolve(fileURLToPath(new URL("../../data", import.meta.url)));
}

/**
 * loadExamples(dataDir?)
 *
 * Returns the raw markdown string of approved responses.
 * - If data/approved-responses.md exists, returns that (runtime accumulation).
 * - Otherwise falls back to data/approved-responses-seed.md (shipped examples).
 */
export async function loadExamples(dataDir?: string): Promise<string> {
  const dir = dataDir ?? defaultDataDir();
  const runtimePath = path.join(dir, "approved-responses.md");
  const seedPath = path.join(dir, "approved-responses-seed.md");

  try {
    await access(runtimePath);
    return await readFile(runtimePath, "utf-8");
  } catch {
    // Runtime file doesn't exist — use seed
    return await readFile(seedPath, "utf-8");
  }
}

/**
 * formatEntry(entry)
 *
 * Formats an ApprovedEntry as a markdown section per the schema:
 *
 *   ## <date> · <alias> · <status>
 *
 *   **Q:** <question>
 *
 *   **Draft:** <originalDraft>   (only for edited / rejected)
 *
 *   **Sent:** <sentText>         (only for approved / edited)
 */
function formatEntry(entry: ApprovedEntry): string {
  const lines: string[] = [
    `## ${entry.date} · ${entry.alias} · ${entry.status}`,
    "",
    `**Q:** ${entry.question}`,
  ];

  if (entry.status === "edited" || entry.status === "rejected") {
    lines.push("", `**Draft:** ${entry.originalDraft ?? ""}`);
  }

  if (entry.status === "approved" || entry.status === "edited") {
    lines.push("", `**Sent:** ${entry.sentText ?? ""}`);
  }

  return lines.join("\n");
}

/**
 * appendEntry(entry, dataDir?)
 *
 * Appends a formatted entry to data/approved-responses.md.
 * Creates the file if it doesn't yet exist.
 * Errors are logged but not rethrown so the bot stays alive.
 */
export async function appendEntry(
  entry: ApprovedEntry,
  dataDir?: string
): Promise<void> {
  const dir = dataDir ?? defaultDataDir();
  const runtimePath = path.join(dir, "approved-responses.md");
  const formatted = formatEntry(entry);

  try {
    let needsSeparator = false;
    try {
      await access(runtimePath);
      needsSeparator = true;
    } catch {
      // File doesn't exist yet — no separator needed before first entry
    }

    if (needsSeparator) {
      await appendFile(runtimePath, `\n\n---\n\n${formatted}`, "utf-8");
    } else {
      await writeFile(runtimePath, formatted, "utf-8");
    }
  } catch (err) {
    console.error("[examples] Failed to append entry:", err);
  }
}
