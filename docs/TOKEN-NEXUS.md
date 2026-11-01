# Token Nexus integration

Chat Mirror can use Token Nexus as its server-side source of Google Chat access tokens.

## Server configuration

Set these variables only in the Chat Mirror server environment:

- `TOKEN_NEXUS_URL=https://token-nexus-api.mylahari.workers.dev`
- `TOKEN_NEXUS_CLIENT_KEY=<the Chat Mirror-specific app key>`

Set the matching Worker secret in Token Nexus as `CHAT_MIRROR_CLIENT_KEY`. Never commit or expose this key in browser code.

Connect **Chat Mirror** in the Token Nexus dashboard first. Chat Mirror requests `GET /api/client/chat-mirror/access-token` server-to-server. Token Nexus owns the refresh token and refresh lifecycle; Chat Mirror receives only an access token. It re-fetches the token periodically while running.

If Token Nexus is configured but unavailable or requires reconnection, Chat Mirror fails startup instead of falling back to a stale local token. If the Token Nexus variables are absent, the existing local token-file mode remains available for development.
