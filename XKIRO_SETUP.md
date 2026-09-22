# xKiro AI setup

Render Environment Variables:

```text
XKIRO_API_KEY=sk-xt-...
XKIRO_BASE_URL=https://api.xkiro.com/v1
XKIRO_MODEL=openai/gpt-5.6-sol
WEB_SEARCH_ENABLED=true
NODE_AI_SINGLE_SERVICE=true
NODE_AI_URL=http://127.0.0.1:3100
NODE_INTERNAL_PORT=3100
```

The support chat now uses xKiro as the only remote AI provider. Parking availability/price/contact questions continue to use the local database path. Current/web questions use xKiro Web Search (`/v1/search`) before the model answer.

Never commit `XKIRO_API_KEY` to GitHub.

Diagnostics:
- `/api/ai/status`
- Node internal `/status`
- Node internal `/health`
