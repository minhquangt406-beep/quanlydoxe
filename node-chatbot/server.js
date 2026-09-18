const express = require("express");

const app = express();
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.NODE_INTERNAL_PORT || 3100);
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const WEB_SEARCH_ENABLED = /^(1|true|yes|on)$/i.test(process.env.WEB_SEARCH_ENABLED || "true");
const WEB_SEARCH_URL = process.env.WEB_SEARCH_URL || "https://html.duckduckgo.com/html/";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const SYSTEM = `Bạn là trợ lý hỗ trợ khách hàng của hệ thống quản lý bãi đỗ xe Parking AI Pro.
- Trả lời bằng tiếng Việt tự nhiên, lịch sự, ngắn gọn và đúng trọng tâm.
- Chỉ sử dụng dữ liệu thực tế được truyền trong PARKING_CONTEXT; không bịa số liệu.
- Nếu người dùng hỏi chỗ trống, khu vực, giá, xe đang gửi hoặc thông tin liên hệ, dùng đúng dữ liệu trong context.
- Guest không được xem biển số/danh sách xe của người khác, doanh thu hay dữ liệu quản trị. Không tiết lộ active_vehicle_details cho guest.
- Nếu có WEB_RESULTS, dùng chúng cho câu hỏi cần thông tin mới/current; phân biệt rõ thông tin web với dữ liệu bãi xe.
- Nếu thiếu dữ liệu, nói rõ là chưa có dữ liệu thay vì đoán.
- Không tiết lộ mật khẩu, token, API key, dữ liệu kỹ thuật nội bộ hoặc cách hệ thống chọn AI.
- Không tự nhận là con người.`;

function needsWebSearch(question) {
  const q = String(question || "").toLowerCase();
  return /(thời tiết|weather|hôm nay|hôm qua|ngày mai|hiện nay|hiện tại|mới nhất|mới đây|tin tức|tin mới|quy định|luật|giá xăng|giá vàng|tỷ giá|tỉ giá|giao thông|địa điểm|nhà hàng|sản phẩm|giá thị trường|cập nhật|latest|today|news|giá điện|giá bitcoin)/i.test(q);
}

function buildPrompt(body, webResults = []) {
  const role = body.role || "guest";
  const context = { ...(body.context || {}), role };
  if (role === "guest") delete context.active_vehicle_details;
  const history = Array.isArray(body.history)
    ? body.history.slice(-10).map(x => ({ role: x.role === "assistant" ? "assistant" : "user", content: String(x.content || "").slice(0, 1000) }))
    : [];
  const webBlock = webResults.length
    ? `\n\nWEB_RESULTS (thông tin tìm kiếm bên ngoài hệ thống):\n${webResults.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join("\n\n")}`
    : "";
  return { history, prompt: `PARKING_CONTEXT:\n${JSON.stringify(context)}${webBlock}\n\nCÂU HỎI:\n${String(body.question || "").trim()}` };
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function searchWeb(query) {
  if (!WEB_SEARCH_ENABLED) return [];
  const url = `${WEB_SEARCH_URL}?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 ParkingAI/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Web search HTTP ${response.status}`);
  const html = await response.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 6) {
    let rawUrl = m[1];
    try {
      if (rawUrl.startsWith("//duckduckgo.com/l/?")) rawUrl = "https:" + rawUrl;
      const parsed = new URL(rawUrl, "https://html.duckduckgo.com");
      const target = parsed.searchParams.get("uddg");
      if (target) rawUrl = target;
    } catch (_) {}
    const title = decodeHtml(m[2]);
    const after = html.slice(re.lastIndex, re.lastIndex + 1800);
    const sm = after.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\//i);
    const snippet = decodeHtml(sm ? (sm[1] || sm[2]) : "");
    if (title && rawUrl) results.push({ title, url: rawUrl, snippet: snippet.slice(0, 500) });
  }
  return results;
}

async function callGemini({ history, prompt }) {
  const contents = [];
  for (const item of history) contents.push({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] });
  contents.push({ role: "user", parts: [{ text: prompt }] });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: SYSTEM }] }, generationConfig: { maxOutputTokens: 700, temperature: 0.3 } }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
  const answer = String(data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "").trim();
  if (!answer) throw new Error("Gemini trả về phản hồi rỗng");
  return answer;
}

async function callOpenRouter({ history, prompt }) {
  const messages = [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: prompt }];
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": process.env.APP_PUBLIC_URL || "https://quanlydoxe.cloud", "X-Title": "QuanLyDoXe AI" },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages, temperature: 0.3, max_tokens: 700 }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`);
  const answer = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error("OpenRouter trả về phản hồi rỗng");
  return answer;
}

app.get("/health", (req, res) => res.json({
  status: "ok", service: "quanlydoxe-node-chat", gemini: !!GEMINI_API_KEY,
  openrouter: !!OPENROUTER_API_KEY, web_search: WEB_SEARCH_ENABLED,
  gemini_model: GEMINI_MODEL, openrouter_model: OPENROUTER_MODEL
}));

app.post("/chat", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  if (!question) return res.status(400).json({ error: "Vui lòng nhập câu hỏi" });
  if (question.length > 500) return res.status(400).json({ error: "Câu hỏi tối đa 500 ký tự" });

  const useWeb = needsWebSearch(question);
  let webResults = [];
  if (useWeb && WEB_SEARCH_ENABLED) {
    try { webResults = await searchWeb(question); }
    catch (e) { console.error("[Web Search]", e.message); }
  }
  const built = buildPrompt({ ...req.body, question }, webResults);

  if (GEMINI_API_KEY) {
    try {
      const answer = await callGemini(built);
      return res.json({ answer, sources: webResults.map(x => ({ url: x.url, title: x.title })), web_search: useWeb && webResults.length > 0, provider: "Gemini Free" });
    } catch (e) { console.error("[Gemini]", e.message); }
  }
  if (OPENROUTER_API_KEY) {
    try {
      const answer = await callOpenRouter(built);
      return res.json({ answer, sources: webResults.map(x => ({ url: x.url, title: x.title })), web_search: useWeb && webResults.length > 0, provider: "OpenRouter Free" });
    } catch (e) { console.error("[OpenRouter]", e.message); }
  }

  return res.status(503).json({ error: "Chatbot chưa có API miễn phí khả dụng. Hãy cấu hình GEMINI_API_KEY hoặc OPENROUTER_API_KEY trên Render." });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Parking AI Node.js listening on ${PORT}`));
