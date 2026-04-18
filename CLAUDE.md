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

**Phase: Integration testing** (as of 2026-04-18)

All 9 implementation units are code-complete and committed to `main`. The bot connects, detects @mentions, routes drafts to Telegram for approval, and sends quoted replies to the group.

MVP architecture and scope are locked in [docs/brainstorms/2026-04-17-mvp-bot-brainstorm.md](docs/brainstorms/2026-04-17-mvp-bot-brainstorm.md). The implementation plan is at [docs/plans/2026-04-17-001-feat-whatsapp-advice-bot-mvp-plan.md](docs/plans/2026-04-17-001-feat-whatsapp-advice-bot-mvp-plan.md).

**Outstanding:** Claude occasionally returns `end_turn` with plain text instead of calling `send_whatsapp_message` (observed on scope-guard/off-topic questions). Added `[agent] end_turn with text` warning log to diagnose. Next session: restart `npm run dev`, trigger an off-topic @mention, and read the warning log to see what Claude said — then tighten the system prompt scope-guard section to explicitly direct Claude to use the tool even for redirects.

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
- Reboot recovery on Windows: `pm2 startup` emits systemd instructions — use `npm i -g pm2-windows-startup && pm2-startup install` or a Task Scheduler task running `pm2 resurrect`
- Prompt cache minimum: 1024 tokens per block for Sonnet (2048 applies to Opus); `cache_control` only accepts `{ type: "ephemeral" }` — no `ttl` field
- Group JID allowlist: bot uses `allowedGroupJids` in `bot-config.json`; discover the JID via `sock.groupFetchAllParticipating()` on first run and copy it into config

## Agent Loop Gotchas

- **Claude must be told to use the tool**: `config/system-prompt-core.md` must explicitly say "use `send_whatsapp_message` for ALL responses." Without this Claude returns `end_turn` with plain text that the loop discards silently.
- **Pass groupJid in the user message**: `runAgentTurn` prepends `[recipient_jid: ${groupJid}]` to the user message so Claude knows the correct tool argument. Without this Claude hallucinates the recipient and DMs the sender instead of replying to the group.
- **dotenv**: `src/index.ts` starts with `import "dotenv/config"` — PM2 does not auto-load `.env`.
- **end_turn logging**: `[agent] end_turn with text` warning in the terminal means Claude returned prose without calling a tool — check the system prompt.

## Git Workflow

- **Main branch only** — no feature branches until coding begins.
- Push to `main` directly for all changes during the planning phase.
- `.claude/settings.local.json` and `approved-responses.md` are gitignored (local preferences and real friend conversations should not be in a public repo).

## Tech Constraints

- **Free/local-first**: prefer solutions that run locally or use free tiers before incurring cloud costs.
- **Windows (Dell laptop)** — Claude Code, GitHub, and standard dev tools are installed. Laptop set to never sleep; auto-restart-on-reboot via Task Scheduler is a later concern.
- **Lean startup approach**: build the smallest thing that validates the idea before scaling.
