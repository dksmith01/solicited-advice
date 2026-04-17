---
date: 2026-04-17
topic: mvp-bot
---

# Solicited-Advice MVP — Brainstorm

## What We're Building

A WhatsApp bot named **Solicited-Advice** that joins David's "AI Curious" friend group as a separate account, answers AI questions in David's voice when @mentioned, and compounds over time as David approves/edits its drafts.

MVP scope is **Function 1 only** from the initial idea (live participant). Function 2 (content pipeline for LinkedIn/blog posts) is deferred to v2.

The core signal we want from the MVP: *does the bot sound enough like David that friends find the advice valuable, and does the approval/edit loop sharpen it over time?*

## Why This Approach

We evaluated content-pipeline-first and private-copilot alternatives and rejected both: the live-participant version is the only one that tests the actual hypothesis (friends engaging with an AI-David in context). Everything else is downstream of that answer.

Stack choices prioritize **free/local first** per David's explicit constraint:
- Bot runs on David's Windows laptop (no cloud cost)
- LLM is Claude Agent SDK on David's existing Pro subscription (no marginal cost)
- WhatsApp access via `whatsapp-web.js` or `Baileys` driving a throwaway WhatsApp account on a cheap prepaid SIM (protects David's real account from any ToS fallout)

Graduated supervision maximizes signal without burning embarrassment risk: every draft is David-approved until the bot proves it can stand on its own.

## Key Decisions

- **Scope**: Live participant only. Content pipeline = v2.
- **Stack**: Node / TypeScript. Chosen for light laptop footprint (no Chromium), active maintenance, and native alignment with the TS-first Agent SDK and Baileys.
- **WhatsApp library**: [`Baileys`](https://github.com/WhiskeySockets/Baileys) — direct WebSocket, no Puppeteer, tens of MB vs. hundreds. Rejected `whatsapp-web.js` (heavier, Chromium-based). Both are unofficial; both recover similarly from WhatsApp protocol changes.
- **WhatsApp account**: Throwaway account on a cheap prepaid SIM, paired via QR code. David's personal account is untouched.
- **Triggering**: `@Solicited-Advice` mentions only. No auto-detect-question classifier in MVP.
- **LLM**: Claude Agent SDK (TypeScript) on David's Pro subscription. Zero marginal cost for friend-group volume. Swap to API key if public later.
- **Architecture**: Agent-native, not script-that-calls-LLM. The bot is a Claude agent with structured tools (`listen_for_mentions`, `send_whatsapp_message`, `append_to_examples_file`, etc.). `send_whatsapp_message` is configured to require approval before executing — this is what enables Dispatch to own the approval UX cleanly.
- **Approval UX**: Claude Desktop Dispatch first. Confirmed available on Pro. When the bot calls the approval-gated `send_whatsapp_message` tool, David gets a push notification and approves/rejects from phone or desktop. Fallback if Dispatch edit UX turns out to be insufficient: a small local CLI or Telegram bot for approvals (~2–4 hours to build).
- **Hosting**: Windows laptop (set to never sleep). Migrate to Oracle Free Tier / cheap VPS once validated. Windows auto-restarts handled later via Task Scheduler auto-launch.
- **Approval workflow**: Graduated supervision. All drafts reviewed by David; bot flips to autonomous when edit rate < 20% over a rolling 20-response window.
- **Voice encoding**: Static system prompt (David's principles + persona) + dynamic `approved-responses.md` that grows as David approves/edits drafts. `example1.md` and `example2.md` seed the file. System prompt also instructs the bot to *ask clarifying questions when queries are vague* (captures David's reframing move from example1).
- **Conversational context**: @mention message + last ~15 group messages. No persistent per-user memory in MVP.
- **Safety floor**: System prompt enforces scope (good-faith AI-advice questions only), refuses medical/legal/financial without caveats, defers sensitive/personal stuff to David. Approval UX surfaces off-scope requests so David handles them directly; edit patterns feed the compounding loop and sharpen the classifier organically.
- **Kill switch**: David can remove bot from group or kill the laptop process instantly.
- **Bot identity**: `Solicited-Advice`. Group gets a plain-language onboarding message explaining what it is, that David is in the loop, and how to opt out.
- **Repo hygiene**: Repo is public as a teaching artifact. `approved-responses.md` must be `.gitignore`d (or anonymized before commit) because it contains real friend conversations. System prompt, code, and this brainstorm are public.

## Flagged for Future Phases

Not in MVP scope; reassess when/if warranted:

- **Content pipeline (Function 2)** — needs a corpus of bot-era conversations first
- **Claude Managed Agents evaluation** — hosted alternative to laptop/VPS; evaluate when migrating off the laptop
- **Claude Desktop Dispatch** — David hopes to use this for the approval UX (approve/edit notifications to laptop/phone). Confirm capability during implementation; good fit if it works
- **Hybrid-by-signal approval (option d from Q6)** — bot classifies confidence/sensitivity and only routes edge cases for approval. Natural evolution after graduation to autonomous
- **Richer per-user memory** — bot remembers prior threads with each friend. Adds surveillance-creep risk; only if users ask for continuity
- **Retrieval over examples file** — when `approved-responses.md` exceeds ~50 entries, embed and retrieve the K most relevant per query instead of stuffing the whole file
- **Migrate off laptop** — to Oracle Free Tier ARM VM, a Raspberry Pi, or a $5/mo VPS. 30-minute Dockerize-and-deploy job
- **Public deployment** — if the bot joins other groups, switch LLM to metered API key (Pro subscription is personal-use only at that point) and revisit WhatsApp ToS exposure

## Open Questions for the Planning Phase

- **Dispatch edit-flow verification**: Approve/reject via Dispatch is documented; editing a draft from the phone before it sends is not explicitly covered. Verify during implementation. If insufficient, fall back to local CLI or Telegram approval.
- **Phone number for the bot account**: Prepaid SIM vs. Google Voice vs. eSIM. Cheap SIMs ($10–15 one-time) are most reliable; VoIP numbers get banned by WhatsApp.
- **Prompt/examples storage format**: Plain markdown is fine for MVP, but decide whether each approved response includes metadata (timestamp, asker, what was edited) that would be useful for analytics later.
- **Graduation dashboard**: How does David actually see "edit rate over the last 20 responses"? Simplest version: a one-liner script that prints the metric. Fancier: a tiny status page.
- **Windows-specific agent SDK gotchas**: Any rough edges running Claude Agent SDK (TS) long-lived on Windows? Worth a spike before the main build.

## Next Steps

→ Run `/compound-engineering:workflows:plan` to turn this into an implementation plan, or continue refining this brainstorm if anything feels unresolved.
