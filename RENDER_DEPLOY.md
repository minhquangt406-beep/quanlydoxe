# Deploy quanlydoxe on Render

This project is a single Docker Web Service named `quanlydoxe`.

## Why this version fixes the failed deploy

The previous image installed Node.js from the base Debian repository. The current OpenAI Node SDK requires a supported modern Node.js runtime, so this Dockerfile installs Node.js 22 explicitly before installing the chatbot dependencies.

The container runs:
- FastAPI on Render's `$PORT` (default 8000 locally)
- Node.js chatbot internally on `127.0.0.1:3100`

## Environment variables on the existing `quanlydoxe` service

Required for OpenAI chatbot:

```text
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5.6-luna
WEB_SEARCH_ENABLED=true
WEB_SEARCH_CONTEXT_SIZE=medium
NODE_AI_SINGLE_SERVICE=true
NODE_AI_URL=http://127.0.0.1:3100
```

Optional DeepSeek fallback:

```text
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Do not create a separate `parking-ai-chat` Render service.

## Deploy

Push the contents of this project to the GitHub repository connected to `quanlydoxe`, then use Render's Manual Deploy / Deploy latest commit.

After deploy, check:

```text
https://quanlydoxe.cloud/api/health
```

Expected:

```json
{"status":"ok","service":"parking-ai-pro"}
```

The internal Node service is not exposed publicly; FastAPI calls it through `127.0.0.1:3100`.
