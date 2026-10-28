# keep-warm

Keeps Claude's prompt cache warm. The cache lasts one hour after the last request; once it expires, the next message re-reads the whole chat at full price. While on, this plugin sends a tiny "reply ok" prompt after 55 idle minutes, a cheap cache read that restarts the hour.

## Use


`/keep-warm` toggles it on and off; the setting is remembered across sessions. The status line counts down the time left on the cache (`warm 12m`, `cold`, or `small chat`). Any real turn resets the idle clock, so pings only happen while you are away, and only for chats over 50k tokens. A toast confirms each ping. It switches itself off for the session after 5 idle pings in a row.
