---
title: Baileys v7 reconnect pitfalls
date: 2026-05-01
category: runtime-errors
module: bot/connection
problem_type: runtime_error
component: tooling
severity: high
symptoms:
  - Memory grew to 2.1 GB in 2 days under normal bot load
  - "After reconnect, incoming WhatsApp messages were silently ignored: no errors, no warnings"
  - "pm2 restart triggered a connection-replaced cascade: 40+ restarts before PM2 gave up"
root_cause: memory_leak
resolution_type: code_fix
related_components:
  - assistant
  - development_workflow
tags:
  - baileys
  - websocket
  - reconnect
  - memory-leak
  - stale-reference
  - pm2
  - whatsapp
  - nodejs
---

# Baileys v7 reconnect pitfalls

## Problem

A WhatsApp bot built on Baileys v7 (Node/TypeScript, PM2 on Windows) had three interrelated reconnect bugs: recursive socket restarts leaked memory to 2.1 GB in two days, stale socket references caused completely silent message processing failures after reconnect, and bare `pm2 restart` triggered an unrecoverable WhatsApp "connection replaced" cascade.

## Symptoms

**Memory leak:**
- Process RSS climbed steadily from ~100 MB baseline to 2.1 GB over 2 days
- No crash or error -- leak is gradual and silent
- Only detected by external monitoring (`pm2 list`, Task Manager)

**Stale socket (silent failure):**
- Bot appeared online (PM2 shows `online`, WhatsApp shows connected)
- Incoming @mentions produced zero response -- no reply, no error, no log output
- Failure began immediately after the first disconnect/reconnect cycle

**PM2 restart cascade:**
- `pm2 restart solicited-advice` triggered 40+ automatic restarts in rapid succession
- Logs showed repeated "connection replaced" (status 440) entries
- Bot unreachable until manually stopped and started with a delay

## What Didn't Work

**Recursive `startSock()` without cleanup** -- the original reconnect design called `startSock()` from within its own disconnect handler. Each call created a new socket and registered new event listeners, but the old socket was never ended. The closure chain kept all dead sockets reachable, preventing GC.

```typescript
// Before -- old socket never cleaned up
async function startSock(onMessage, getMessageFn) {
  const sock = makeWASocket({...});
  sock.ev.on("connection.update", async ({ connection }) => {
    if (connection === "close") {
      await startSock(onMessage, getMessageFn); // recursive, leaks
    }
  });
}
```

**Captured `sock` reference at startup** -- `createMessageHandler` and `createApprovalGate` both accepted `sock: WASocket` and closed over that specific instance. After reconnect, a new socket was created but handlers still referenced the old dead one. Compounding this, `index.ts` used a `messageHandlerRegistered` boolean flag that made the `onMessage` callback a no-op after first setup -- so even the new socket's messages were ignored.

**`pm2 restart` with WhatsApp** -- PM2 spawns the replacement process before fully terminating the old one. Both processes briefly connect simultaneously. WhatsApp sends status 440 to the evicted process, which called `process.exit(1)`. PM2 interprets exit code 1 as a crash and restarts, creating a cascade.

## Solution

### 1. End old socket before reconnecting

```typescript
// connection.ts
let currentSock: WASocket | null = null;

export function getCurrentSocket(): WASocket {
  if (!currentSock) throw new Error("Socket not initialized");
  return currentSock;
}

async function startSock(onMessage, getMessageFn) {
  if (currentSock) {
    try { currentSock.end(undefined); } catch {}
    currentSock = null;
  }
  const sock = makeWASocket({...});
  currentSock = sock;
  // ... register listeners, reconnect handler same as before
}
```

### 2. Getter pattern instead of captured reference

```typescript
// message-handler.ts -- Before
export function createMessageHandler(sock: WASocket, ...): void {
  sock.ev.on("messages.upsert", ...) // stale after reconnect
}

// message-handler.ts -- After
export function createMessageHandler(getSock: () => WASocket, ...): MessageHandler {
  return function handleMessages(messages, type) {
    // getSock() always resolves to the live socket
    getSock().sendMessage(...)
  };
}
```

Same change in `approval.ts`: `sock: WASocket` becomes `getSock: () => WASocket`.

In `index.ts`, replace the flag pattern with always-delegate:

```typescript
let messageHandler: MessageHandler | null = null;
function onMessage(messages, type) {
  if (messageHandler) {
    messageHandler(messages, type); // handler owns buffering
  } else {
    for (const msg of messages) buffer.push(msg); // pre-init safety net
  }
}
// At startup:
messageHandler = createMessageHandler(getCurrentSocket, ...);
```

### 3. Stop-wait-start instead of restart

```sh
pm2.cmd stop solicited-advice
# wait 5 seconds
pm2.cmd start solicited-advice
```

## Why This Works

**Memory leak fix:** `sock.end(undefined)` closes the WebSocket transport and removes internal Baileys event emitters. Nulling `currentSock` removes the last strong reference, allowing GC to collect the entire object graph each socket owns. The module-level variable replaces the implicit closure chain with a single managed slot.

**Stale socket fix:** The getter pattern defers socket resolution from registration-time to call-time. Every `sendMessage` call evaluates `getSock()` at the moment it executes, not at handler-registration time. Since `getCurrentSocket()` reads from the module-level `currentSock` -- which `startSock()` always updates -- every call gets the current live socket regardless of how many reconnects have occurred.

**PM2 cascade fix:** Stopping the process first lets WhatsApp's session fully close before a new process negotiates, so status 440 is never triggered.

## Prevention

- Never pass a `WASocket` instance directly to long-lived handlers. Always pass a `() => WASocket` getter.
- Module-level socket variable is the single source of truth. Never capture it in a closure at initialization time.
- Always use `pm2 stop` + delay + `pm2 start` for WhatsApp bots. Never bare `pm2 restart`.
- Set a memory restart threshold as a safety net: `pm2 start ... --max-memory-restart 500M`.
- Monitor RSS via `pm2 monit` during the first 24 hours after any reconnect-path changes.

## Related Issues

- MVP plan doc (`docs/plans/2026-04-17-001-feat-whatsapp-advice-bot-mvp-plan.md`, lines 283-289) originally specified the recursive `startSock()` pattern without noting these pitfalls
- `CLAUDE.md` Baileys v7 notes section covers related topics (LID detection, ESM config, PM2 setup) but not the getter pattern or cleanup rule
- Session history: first build attempt failed because Baileys' event emitter requires an event name for `removeAllListeners()` -- simplified to `sock.end()` only (session history)
- Telegram `ENOTFOUND` errors during the restart cascade were a red herring -- stale logs from zombie processes, not an actual DNS issue (session history)
