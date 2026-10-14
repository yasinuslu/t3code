# Push notifications

T3 Code can push a message to your phone or browser when an agent or a scheduled task needs you. The server keeps every message in an inbox and pushes it by priority: **urgent** (needs you now, alerts loudly), **normal** (finished work worth a glance), **quiet** (inbox only, no push).

## Turn them on

1. Open T3 Code over HTTPS. A plain `http://` address cannot receive pushes.
2. On an iPhone, tap Share → Add to Home Screen, then open T3 Code from the home screen. iOS only allows pushes for an installed web app (iOS 16.4 or newer).
3. Open **Settings → General → Bildirimleri aç** and allow notifications. **Test bildirimi gönder** sends one to check.

Each browser or home-screen app subscribes separately, and a push goes to the server the app was opened from. The bell in the chat header lists the inbox; tap an item to open its link.

## Send one

Agents and scheduled tasks call the `notify_user` tool of the T3 Code MCP server with `title`, `body`, an optional `link` and `priority`. A `tag` collapses repeats: a later message with the same tag replaces the earlier one. Scripts use the running server's CLI:

```
t3 notify --title "Build failed" --body "main is red" --link https://example.org/run/1 --priority urgent --tag ci:main
```
