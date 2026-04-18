# solicited-advice

An AI agent that lives in a WhatsApp group and answers AI questions in David's voice. Every response is reviewed via Telegram before it's sent.

## Prerequisites

- **Node.js 20+** (required by Baileys v7). Check: `node --version`
- **npm 10+**
- A **throwaway WhatsApp account** on a prepaid SIM — never use your personal account
- A **Telegram bot token** from [@BotFather](https://t.me/BotFather) and your personal Telegram chat ID

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
BOT_PHONE_NUMBER=+12125551234
TELEGRAM_BOT_TOKEN=123456789:AAF...
TELEGRAM_CHAT_ID=987654321
```

To find your Telegram chat ID: message your bot once, then visit
`https://api.telegram.org/bot<TOKEN>/getUpdates` and look for `"chat":{"id":...}`.

### 3. Configure allowed groups

On first run the bot logs all group JIDs the throwaway account belongs to.
Copy the target JID into `config/bot-config.json`:

```json
{
  "allowedGroupJids": ["120363XXXXXXXXXX@g.us"]
}
```

Leave the array empty to allow all groups (not recommended for production).

### 4. Windows Defender exclusions (prevents EBUSY errors)

Open PowerShell as Administrator and run:

```powershell
Add-MpPreference -ExclusionPath "$PWD\baileys_auth_info"
Add-MpPreference -ExclusionPath "$PWD\data"
```

### 5. Build

```bash
npm run build
```

## First run (QR pairing)

```bash
npm run dev
```

A QR code will print in the terminal. Scan it with the **throwaway WhatsApp account** (not your personal account). Credentials are saved to `baileys_auth_info/` — subsequent starts connect without a QR scan.

## Production (PM2)

### Install PM2

```bash
npm install -g pm2
```

### Start the bot

```bash
pm2 start pm2.config.js
pm2 save
```

### Windows reboot recovery

`pm2 startup` generates systemd/launchd commands that don't apply on Windows. Use one of:

**Option A — pm2-windows-startup (recommended):**
```bash
npm install -g pm2-windows-startup
pm2-startup install
```

**Option B — Task Scheduler:**
Create a task that runs `pm2 resurrect` on user login.

### Useful PM2 commands

```bash
pm2 list                          # check status
pm2 logs solicited-advice         # tail logs
pm2 stop solicited-advice         # stop (PM2 will restart unless you pm2 delete)
pm2 restart solicited-advice      # manual restart
```

## Approval workflow

When someone @mentions the bot in the WhatsApp group, a draft reply appears in your **Telegram** chat. Reply with:

- `a` — approve and send as-is
- `e Your edited text here` — send with your edits
- `r` — reject (nothing sent to WhatsApp)

Approvals expire after **30 minutes** — unanswered drafts are silently dropped.

## Windows validation checklist

Before introducing the bot to the real group, run it in a test group for 24+ hours and verify:

- [ ] AV exclusion: `baileys_auth_info/` and `data/` added to Windows Defender
- [ ] Power plan: "High Performance" (prevents NIC sleep during idle)
- [ ] USB suspend disabled: Device Manager → USB Root Hub → Power Management → uncheck "allow computer to turn off this device to save power"
- [ ] PM2 reboot recovery configured (see above)
- [ ] Bot reconnects after laptop sleep/wake (within ~60 seconds)
- [ ] No duplicate messages on reconnect
- [ ] `pm2 stop solicited-advice` cleanly closes the Baileys socket
- [ ] 24-hour test run with no unhandled errors in `pm2 logs solicited-advice`

## Development

```bash
npm run dev      # tsx watch — auto-restarts on file changes
npm run build    # compile TypeScript
npm test         # run all tests
```

## Backing up approved-responses.md

`data/approved-responses.md` is gitignored (it contains real friend conversations). Back it up periodically:

```bash
cp data/approved-responses.md data/approved-responses-backup-$(date +%Y%m%d).md
```
