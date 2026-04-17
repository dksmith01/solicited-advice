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

**Phase: Brainstorm complete — ready for planning** (as of 2026-04-17)

MVP architecture and scope are locked in [docs/brainstorms/2026-04-17-mvp-bot-brainstorm.md](docs/brainstorms/2026-04-17-mvp-bot-brainstorm.md). That doc is the source of truth for design decisions; read it first.

**Accomplished this session:** Scoped MVP to Function 1 only (live WhatsApp participant), chose stack (Node/TS + Baileys + Claude Agent SDK on Pro subscription), decided approval UX (Claude Desktop Dispatch with local-CLI fallback), compounding loop (growing `approved-responses.md`), graduated supervision with <20% edit-rate trigger to autonomous.

**Next step:** Run `/compound-engineering:workflows:plan` to turn the brainstorm into a concrete implementation plan.

## Key Decisions (MVP)

Quick reference — see brainstorm doc for rationale:

- **Scope:** Live WhatsApp participant only. Content pipeline is v2.
- **Stack:** Node / TypeScript, `Baileys` (WhatsApp), Claude Agent SDK (TS).
- **LLM billing:** David's Claude Pro subscription via Agent SDK — zero marginal cost at friend-group volume.
- **Architecture:** Agent-native. Bot is a Claude agent with structured tools; `send_whatsapp_message` is approval-gated.
- **Approval UX:** Claude Desktop Dispatch (confirmed on Pro). Fallback to local CLI if Dispatch edit-flow is insufficient.
- **Triggering:** `@Solicited-Advice` mentions only.
- **Hosting:** Windows laptop during MVP; migrate to Oracle Free Tier or $5/mo VPS once validated.
- **WhatsApp account:** Throwaway account on a prepaid SIM; David's personal account is untouched.

## Git Workflow

- **Main branch only** — no feature branches until coding begins.
- Push to `main` directly for all changes during the planning phase.
- `.claude/settings.local.json` and `approved-responses.md` are gitignored (local preferences and real friend conversations should not be in a public repo).

## Tech Constraints

- **Free/local-first**: prefer solutions that run locally or use free tiers before incurring cloud costs.
- **Windows (Dell laptop)** — Claude Code, GitHub, and standard dev tools are installed. Laptop set to never sleep; auto-restart-on-reboot via Task Scheduler is a later concern.
- **Lean startup approach**: build the smallest thing that validates the idea before scaling.
