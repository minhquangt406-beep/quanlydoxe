FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY node-chatbot/package.json ./node-chatbot/package.json
RUN cd node-chatbot && npm install --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV NODE_AI_SINGLE_SERVICE=true
ENV NODE_AI_URL=http://127.0.0.1:3100
ENV WEB_SEARCH_ENABLED=true
ENV WEB_SEARCH_CONTEXT_SIZE=medium

EXPOSE 8000

CMD ["/app/start.sh"]
