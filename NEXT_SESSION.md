## Resume: Solicited Advice (WhatsApp AI advice bot)

**Phase:** Live in "AI-Curious" group. Bot is running via PM2.

**Last session (2026-05-01):** Fixed Baileys v7 reconnect memory leak (2.1GB→91MB), stale socket bug (silent message failures after reconnect), and PM2 restart cascade. Added README. Connected repo to david-brain and promoted first compound lesson to vault.

**Next steps:**
- Monitor memory over 24-48 hours to confirm the leak is fully resolved (`pm2.cmd monit`)
- Fix the pre-existing `tools.test.ts` failure (expects 2 tools, finds 3 after `search_web` was added)
- Consider adding a reconnect integration test (verify `getCurrentSocket()` returns new socket after disconnect)
- Review the simplicity suggestions from the compound review (collapse `startConnection` wrapper, flatten two-phase init)

**Read first:** `CLAUDE.md`, `docs/solutions/runtime-errors/baileys-v7-reconnect-pitfalls-2026-05-01.md`
