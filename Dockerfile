FROM python:3.12-slim-bookworm

WORKDIR /app

# Render's Python image may ship an older Debian Node.js package.
# Install Node.js 22 explicitly because the current OpenAI Node SDK requires Node.js 22+.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && node --version \
    && npm --version \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY node-chatbot/package.json ./node-chatbot/package.json
RUN cd node-chatbot && npm install --omit=dev --no-audit --no-fund

COPY . .
RUN chmod +x /app/start.sh && mkdir -p /app/data

ENV NODE_AI_SINGLE_SERVICE=true \
    NODE_INTERNAL_PORT=3100 \
    NODE_AI_URL=http://127.0.0.1:3100 \
    WEB_SEARCH_ENABLED=true \
    WEB_SEARCH_CONTEXT_SIZE=medium \
    PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["/app/start.sh"]
