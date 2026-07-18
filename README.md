# reply-bot (Telegram -> VLESS updater)

This bot can reply users with updated `vless://...` links for one or more endpoints.

## Features

- If a user sends a `vless://...` link (or bare UUID): the bot looks up that **UUID** on each endpoint’s panel and returns keys only for servers that have it.
- If a user sends a VLESS username/email: the bot looks up that identity on each endpoint and returns keys for every server where it exists.
- Fallback: if panel credentials aren’t configured, pasted `vless://...` links still get host/port rewritten per endpoint.
- Stores each user’s Telegram `chat_id` / `user_id` in `data/subscribers.json` so you can notify them later.

## Setup

1. Create `.env` from `.env.example`.
2. Add your `TELEGRAM_BOT_TOKEN`.
3. Optionally set `ADMIN_TELEGRAM_IDS` (comma-separated) for `/subscribers` and `/notify`.
4. Configure two endpoints:

```env
ENDPOINT_1_NAME=Server 1
ENDPOINT_1_PANEL_URL=https://host1:7334/
ENDPOINT_1_PANEL_USERNAME=admin
ENDPOINT_1_PANEL_PASSWORD=...
ENDPOINT_1_TLS_INSECURE=true
ENDPOINT_1_PUBLIC_HOST=host1

ENDPOINT_2_NAME=Server 2
ENDPOINT_2_PANEL_URL=https://host2:7334/
ENDPOINT_2_PANEL_USERNAME=admin
ENDPOINT_2_PANEL_PASSWORD=...
ENDPOINT_2_TLS_INSECURE=true
ENDPOINT_2_PUBLIC_HOST=host2
```

If both endpoints share the same panel login, set `PANEL_URL` / `PANEL_USERNAME` / `PANEL_PASSWORD` once and only set `ENDPOINT_N_PUBLIC_HOST` (and optional `NAME` / `PUBLIC_PORT`) per endpoint.

### Auth note (newer 3x-ui)

Current 3x-ui panels require a CSRF token for username/password login. This bot handles that automatically.

Preferred (no login/CSRF): create an API token in **Settings → Security → API Token**, then set `ENDPOINT_N_API_TOKEN=...`.

For self-signed HTTPS panels, set `ENDPOINT_N_TLS_INSECURE=true`.

## Notifications

Anyone who messages the bot is recorded in `data/subscribers.json` (gitignored).

Admin-only commands (requires `ADMIN_TELEGRAM_IDS`):

- `/subscribers` — list stored chat IDs (preview)
- `/notify <message>` — broadcast a text message to all stored chats

## Run

```bash
npm run dev
```
