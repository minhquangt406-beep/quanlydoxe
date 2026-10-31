FROM node:22-bookworm-slim AS chatbot
WORKDIR /build/node-chatbot
COPY node-chatbot/package.json node-chatbot/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM python:3.12-slim-bookworm
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=chatbot /usr/local/bin/node /usr/local/bin/node
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=chatbot /build/node-chatbot/node_modules ./node-chatbot/node_modules
RUN chmod +x /app/start.sh && mkdir -p /app/data
ENV NODE_AI_SINGLE_SERVICE=true \
    NODE_INTERNAL_PORT=3100 \
    NODE_AI_URL=http://127.0.0.1:3100 \
    WEB_SEARCH_ENABLED=true \
    WEB_SEARCH_CONTEXT_SIZE=medium \
    PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["/bin/sh", "/app/start.sh"]
