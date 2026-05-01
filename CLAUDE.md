# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Solicited Advice** is an AI agent that lives in a WhatsApp group ("AI Curious") of non-technical-but-smart friends in their early 50s. The agent has two functions:

1. **WhatsApp participant** — monitors the group for AI questions and responds in David's voice: practical, jargon-free, encouraging experimentation, with specific first steps tailored to the person asking.
2. **Content pipeline** — retrieves the best conversations and repurposes them into social media posts (LinkedIn, Twitter/X, blog).

Longer-term vision: the agent becomes a public product other groups can adopt.

## David's Advice Style

The agent must internalize this voice. Key principles:
- Encourage experimentation and using AI to learn AI
- Keep it short, practical, jargon-free — audience is smart but non-technical
- Point to specific thought leaders / resources David trusts
- Give concrete first steps ("here's what I would do in your situation")
- Connect to the person's actual workflow, not generic AI use cases

See `pre-work/example1.md` and `pre-work/example2.md` for gold-standard examples of this advice style.

## Current Status

**Phase: Ready for live rollout** (as of 2026-04-19)

All 9 implementation units are code-complete and passing integration tests. The bot connects, detects @mentions, routes drafts to Telegram for approval, sends quoted replies to the group, and now searches the web for current information via Brave Search.

MVP architecture and scope are locked in [docs/brainstorms/2026-04-17-mvp-bot-brainstorm.md](docs/brainstorms/2026-04-17-mvp-bot-brainstorm.md). The implementation plan is at [docs/plans/2026-04-17-001-feat-whatsapp-advice-bot-mvp-plan.md](docs/plans/2026-04-17-001-feat-whatsapp-advice-bot-mvp-plan.md).

**Live in "AI-Curious" as of 2026-04-19.** Friends can @mention the bot for real.

**Next steps:**
- Monitor early responses for quality and voice consistency
- Watch for `[agent] end_turn with text` warnings (Claude skipping the tool)
- Repo is public on GitHub — share as a learning artifact

**Session learnings (2026-04-19):**
- Recent context was leaking into Claude's focus — fixed by labeling context as background-only and labeling the current mention explicitly
- Added `search_web` tool (Brave Search API) so Claude can look up recent AI releases; requires `BRAVE_SEARCH_API_KEY` in `.env`
- Tightened system prompt: refusals/redirects/ethics blocks must also go through `send_whatsapp_message` — Claude was silently dropping them
- Added "words to never use" list to David's Voice section ("Honestly", "Frankly", etc.)

**Session learnings (2026-04-24):**
- Voice rules (never-use phrases, interaction patterns) live in `config/system-prompt-core.md` — edit there, not in code
- Telegram approval prompt format (what David sees) is assembled in `src/agent/approval.ts` in the `prompt` array (~line 111)
- Bot was opening replies with "Good question!" — added sycophantic opener ban to system prompt's never-use list
- Bot was asking conversation-stimulating follow-up questions — tightened clarifying-question rule: only ask if genuinely needed, never to prompt discussion

**Session learnings (2026-05-01):**
- Baileys reconnect was leaking memory (2.1 GB in 2 days) — recursive `startSock` never ended old sockets. Fixed with module-level `currentSock` variable and `getCurrentSocket()` getter pattern
- After reconnect, handlers went silently deaf — captured `sock` reference was stale. All consumers now use `getSock: () => WASocket` getter instead of direct reference
- `pm2 restart` causes a WhatsApp "connection replaced" cascade — always use `pm2 stop` + wait + `pm2 start`
- Repo connected to david-brain; first compound lesson promoted to vault

## Documented Solutions

`docs/solutions/` contains documented solutions to past problems (runtime errors, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.

## Key Decisions (MVP)

Quick reference — see brainstorm doc for rationale:

- **Scope:** Live WhatsApp participant only. Content pipeline is v2.
- **Stack:** Node / TypeScript, `Baileys` (WhatsApp), Claude Agent SDK (TS).
- **LLM billing:** David's Claude Pro subscription via Agent SDK — zero marginal cost at friend-group volume.
- **Architecture:** Agent-native. Bot is a Claude agent with structured tools; `send_whatsapp_message` is approval-gated.
- **Approval UX:** Telegram bot (chosen in Unit 2 spike). `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` required in `.env`.
- **Triggering:** `@Solicited-Advice` mentions only.
- **Hosting:** Windows laptop during MVP; migrate to Oracle Free Tier or $5/mo VPS once validated.
- **WhatsApp account:** Throwaway account on a prepaid SIM; David's personal account is untouched.

## Baileys v7 Implementation Notes

- npm package version: `7.0.0-rc.9` (exact) — `^7.0.0` fails to resolve; v7 is still in RC as of 2026-04
- Event API: `sock.ev.on('messages.upsert', ...)` — `sock.ev.process()` does not exist in v7
- **LID @mention detection**: WhatsApp sends mentions as LID (`225980358598881@lid`), not phone number. `createMessageHandler` accepts `botJids: string[]` — pass both `sock.user?.id` and `(sock.user as any)?.lid`. Compare the number portion (before `@` and before `:`) against each.
- **Quoted replies**: `sock.sendMessage(jid, { text }, { quoted: originalMsg })` — third arg is the options object
- Correct cache package: `node-cache` (not `@cacheable/node-cache` — that's a different library with a different API)
- ESM config: `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` — `"Bundler"` accepts extensionless imports that Node's ESM resolver rejects at runtime; all local imports need explicit `.js` extensions
- Reboot recovery on Windows: use `npm i -g pm2-windows-startup && npx pm2-windows-startup install && pm2.cmd save` (see Process Management section below)
- Prompt cache minimum: 1024 tokens per block for Sonnet (2048 applies to Opus); `cache_control` only accepts `{ type: "ephemeral" }` — no `ttl` field
- Group JID allowlist: bot uses `ALLOWED_GROUP_JIDS` in `.env` (comma-separated); discover the JID via `sock.groupFetchAllParticipating()` on first run and copy it into `.env`

## Agent Loop Gotchas

- **Claude must be told to use the tool**: `config/system-prompt-core.md` must explicitly say "use `send_whatsapp_message` for ALL responses." Without this Claude returns `end_turn` with plain text that the loop discards silently.
- **Pass groupJid in the user message**: `runAgentTurn` prepends `[recipient_jid: ${groupJid}]` to the user message so Claude knows the correct tool argument. Without this Claude hallucinates the recipient and DMs the sender instead of replying to the group.
- **dotenv**: `src/index.ts` starts with `import "dotenv/config"` — PM2 does not auto-load `.env`.
- **end_turn logging**: `[agent] end_turn with text` warning in the terminal means Claude returned prose without calling a tool — check the system prompt.

## Git Workflow

- **Main branch only** — no feature branches until coding begins.
- Push to `main` directly for all changes during the planning phase.
- `.claude/settings.local.json` and `approved-responses.md` are gitignored (local preferences and real friend conversations should not be in a public repo).

## Process Management (PM2 on Windows)

- Use `pm2.cmd` not `pm2` — the binary isn't in PATH by default on Windows
- Start the bot: `pm2.cmd start node --name solicited-advice -- dist/index.js` (`pm2 start npm -- run start` fails on Windows)
- Always build first: `npm run build` then start via `dist/index.js` (`npm run dev` uses `tsx watch` and is dev-only)
- If `pm2-windows-startup` isn't in PATH: `npx pm2-windows-startup install`
- After any process changes: `pm2.cmd save` to persist across reboots
- Check bot status: `pm2.cmd list` (status `online` = running)
- View logs: `pm2.cmd logs solicited-advice`

## Tech Constraints

- **Free/local-first**: prefer solutions that run locally or use free tiers before incurring cloud costs.
- **Windows (Dell laptop)** — Claude Code, GitHub, and standard dev tools are installed. Laptop set to never sleep; auto-restart-on-reboot via Task Scheduler is a later concern.
- **Lean startup approach**: build the smallest thing that validates the idea before scaling.

<!-- BEGIN david-brain BRAIN CONNECTION -->
## david-brain Brain

This repo is connected to `david-brain`, a brain for cross-repo lessons, playbooks, conventions, pointers, and shared skills.

At the start of significant work, search the configured brain for relevant lessons, playbooks, conventions, and client-safe context. Present useful hits briefly and let the user decide what to apply.

When a compound workflow creates `docs/solutions/`, `docs/plans/`, or similar durable project knowledge, automatically notice the new output and offer to use `send-to-brain` to promote an enriched copy to the configured brain. The offer requires user approval before writing to the brain.

Use `.brain-config` for this repo's sensitivity, domain tags, and configured brains.

Use `/start` at the beginning of a session to check for a previous session handoff and choose how to proceed.

## Coding Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
<!-- END david-brain BRAIN CONNECTION -->
