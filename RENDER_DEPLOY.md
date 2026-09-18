# SmartPark / quanlydoxe – Render deployment

Bản này chạy **một Web Service duy nhất tên `quanlydoxe`**. Node.js chatbot chạy nội bộ cùng container với FastAPI, nên không cần tạo service `parking-ai-chat` riêng.

## Render
- Web Service: `quanlydoxe`
- Runtime: Docker
- Dockerfile: `./Dockerfile`
- Health Check: `/api/health`
- `NODE_AI_URL`: `http://127.0.0.1:3100`
- `NODE_AI_SINGLE_SERVICE`: `true`

## Environment Variables
Bắt buộc để chatbot AI hoạt động:
- `OPENAI_API_KEY`: API key của OpenAI
- `OPENAI_MODEL`: `gpt-5.6-luna`
- `WEB_SEARCH_ENABLED`: `true`
- `WEB_SEARCH_CONTEXT_SIZE`: `medium`

Có thể thêm DeepSeek làm fallback:
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL=deepseek-chat`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`

Không cần `NODE_AI_URL` trỏ tới một Render service khác; bản này tự chạy Node.js tại `127.0.0.1:3100`.

## Deploy
1. Push toàn bộ nội dung ZIP vào root GitHub repository hiện tại.
2. Render → `quanlydoxe` → Manual Deploy → Deploy latest commit.
3. Kiểm tra `/api/health`.
4. Kiểm tra chatbot bằng nút **AI CHAT** ở góc phải.

Không commit `.env` hoặc API key lên GitHub.
