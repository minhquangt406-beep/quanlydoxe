# Chatbot miễn phí cho QuanLyDoXe

Chatbot dùng Gemini API Free làm chính và OpenRouter Free làm dự phòng. Dữ liệu vận hành của bãi xe vẫn do FastAPI truyền vào context.

## Environment trên Render - service `quanlydoxe`

- `GEMINI_API_KEY`: API key từ Google AI Studio
- `GEMINI_MODEL=gemini-3.8-flash`
- `OPENROUTER_API_KEY`: API key OpenRouter (tùy chọn, dùng fallback)
- `OPENROUTER_MODEL=openrouter/free`
- `WEB_SEARCH_ENABLED=true`
- `WEB_SEARCH_URL=https://html.duckduckgo.com/html/`

Gemini API có free tier cho một số model. OpenRouter có các model free nhưng có giới hạn request. Web search trong bản này dùng lớp tìm kiếm web bên ngoài rồi đưa kết quả vào prompt; đây không phải Google Search grounding trả phí của Gemini.
