# Solicited Advice

AI agent that lives in a WhatsApp group and answers AI questions in David's voice. Every response is reviewed via Telegram before it's sent.

## Prerequisites

- **Node.js 20+** (required by Baileys v7). Check: `node --version`
- A **throwaway WhatsApp account** on a prepaid SIM -- never use your personal account
- A **Telegram bot token** from [@BotFather](https://t.me/BotFather) and your personal Telegram chat ID
- An **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com)
- A **Brave Search API key** (free tier, 2,000/month) from [brave.com/search/api](https://brave.com/search/api/)

## Setup

```sh
npm install
cp .env.example .env
```

Edit `.env` with your keys:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) on Telegram |
| `TELEGRAM_CHAT_ID` | Message your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and look for `"chat":{"id":...}` |
| `BRAVE_SEARCH_API_KEY` | [brave.com/search/api](https://brave.com/search/api/) |
| `ALLOWED_GROUP_JIDS` | Found on first run (see below) |

## First run (QR pairing)

```sh
npm run build
npm start
```

A QR code prints in the terminal. Scan it with the **throwaway WhatsApp account**. Credentials are saved to `baileys_auth_info/` -- subsequent starts connect without a QR scan.

On first connection the bot logs all joined groups and their JIDs. Copy the target JID into `ALLOWED_GROUP_JIDS` in `.env`:

```
ALLOWED_GROUP_JIDS=120363XXXXXXXXXX@g.us
```

## Development

```sh
npm run dev      # start with hot reload (tsx watch)
npm test         # run all tests
npm run build    # compile TypeScript to dist/
```

## Production (PM2 on Windows)

Use `pm2.cmd` on Windows -- the bare `pm2` command isn't in PATH by default.

### Start the bot

```sh
npm run build
pm2.cmd start node --name solicited-advice -- dist/index.js
pm2.cmd save
```

### Common commands

```sh
pm2.cmd list                        # check status (should show "online")
pm2.cmd logs solicited-advice       # tail live logs
pm2.cmd restart solicited-advice    # restart after code changes
pm2.cmd stop solicited-advice       # stop the bot
pm2.cmd delete solicited-advice     # remove from PM2 entirely
```

### Reboot recovery

```sh
npm i -g pm2-windows-startup
npx pm2-windows-startup install
pm2.cmd save
```

### Restart loop fix

If the bot gets stuck in a restart loop (WhatsApp "connection replaced" cascade), stop first, then start:

```sh
pm2.cmd stop solicited-advice
# wait 5 seconds
pm2.cmd start solicited-advice
```

## Approval workflow

When someone @mentions the bot in the WhatsApp group, a draft reply appears in your Telegram chat. Reply with:

- **`a`** -- approve and send as-is
- **`e Your edited text`** -- send with your edits
- **`r`** -- reject (nothing sent); you'll be asked for a reason so Claude can retry

Unanswered drafts expire after 30 minutes.

## How it works

1. Baileys connects to WhatsApp via WebSocket
2. Bot detects `@Solicited-Advice` mentions in allowed groups
3. Recent group messages are gathered as context
4. Claude drafts a reply using David's voice guidelines and web search
5. Draft goes to David's Telegram for approval
6. Approved messages are posted as quoted replies in the group

## Project structure

```
config/              bot-config.json, system-prompt-core.md (voice rules)
src/
  bot/               WhatsApp connection, message handling, buffering
  agent/             Claude agent loop, approval gate, tools, web search
  storage/           Examples corpus (approved responses)
  index.ts           Entry point -- wires everything together
```
