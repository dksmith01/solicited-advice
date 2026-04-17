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

**Phase: Planning complete — ready for implementation** (as of 2026-04-17)

MVP architecture and scope are locked in [docs/brainstorms/2026-04-17-mvp-bot-brainstorm.md](docs/brainstorms/2026-04-17-mvp-bot-brainstorm.md). That doc is the source of truth for design decisions; read it first.

The concrete implementation plan is at [docs/plans/2026-04-17-001-feat-whatsapp-advice-bot-mvp-plan.md](docs/plans/2026-04-17-001-feat-whatsapp-advice-bot-mvp-plan.md). Read this before writing any code — it defines file structure, build order, and all key technical decisions.

**Accomplished this session:** Turned the brainstorm into a full 10-unit implementation plan. Resolved all open questions (approved-responses.md format, concurrent @mention handling, graduation mechanics, approval timeout behavior). Key clarifications: `@anthropic-ai/sdk` is the "Agent SDK" (no separate product), Dispatch approval UX is unverified (Unit 2 is a spike — readline CLI is the assumed default), `cache_control` has no `ttl` field, stale-message replay guard added to Unit 4.

**Next step:** Review the plan at `docs/plans/2026-04-17-001-feat-whatsapp-advice-bot-mvp-plan.md`, then run `/compound-engineering:ce-work` to begin implementation with Unit 1 (project scaffolding).

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
