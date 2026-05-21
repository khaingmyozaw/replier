# reply-bot (Telegram -> VLESS updater)

This bot can reply users with an updated `vless://...` link.

## Features

- If a user sends a `vless://...` link: the bot updates the host/port to your configured values.
- If a user sends a VLESS username/email: the bot looks up the client in your `3x-ui` panel and generates a VLESS Reality link (best-effort based on your inbound configuration).

## Setup

1. Create `.env` from `.env.example`.
2. Add your `TELEGRAM_BOT_TOKEN`.
3. Add `PANEL_USERNAME` and `PANEL_PASSWORD` for the 3x-ui panel.

## Run

```bash
npm run dev
```

