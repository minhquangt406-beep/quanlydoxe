const express = require("express");

const app = express();
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.NODE_INTERNAL_PORT || 3100);
const XKIRO_API_KEY = (process.env.XKIRO_API_KEY || "").trim();
const XKIRO_MODEL = process.env.XKIRO_MODEL || "openai/gpt-5.6-sol";
const XKIRO_BASE_URL = (process.env.XKIRO_BASE_URL || "https://api.xkiro.com/v1").replace(/\/$/, "");
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
  if (!WEB_SEARCH_ENABLED || !XKIRO_API_KEY) return [];
  const response = await fetch(`${XKIRO_BASE_URL}/search`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${XKIRO_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "xkiro/web-search",
      query: String(query || "").slice(0, 500),
      max_results: 5,
      country: "VN",
      search_recency_filter: "noLimit"
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `xKiro Search HTTP ${response.status}`);
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows.map(r => ({
    title: String(r.title || "").trim(),
    url: String(r.url || "").trim(),
    snippet: String(r.snippet || "").trim(),
    source: String(r.source || "").trim(),
    published_at: r.published_at || null
  })).filter(r => r.title && r.url).slice(0, 5);
}

async function callXKiro({ history, prompt }) {
  const messages = [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: prompt }];
  const response = await fetch(`${XKIRO_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${XKIRO_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: XKIRO_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 700
    }),
    signal: AbortSignal.timeout(90000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `xKiro HTTP ${response.status}`);
  const answer = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error("xKiro trả về phản hồi rỗng");
  return answer;
}

app.get("/health", (req, res) => res.json({
  status: "ok", service: "quanlydoxe-node-chat",
  xkiro_configured: !!XKIRO_API_KEY,
  web_search: WEB_SEARCH_ENABLED,
  web_search_provider: "xKiro",
  xkiro_base_url: XKIRO_BASE_URL,
  xkiro_model: XKIRO_MODEL
}));

app.get("/status", async (req, res) => {
  const result = {
    service: "quanlydoxe-node-chat",
    xkiro_configured: !!XKIRO_API_KEY,
    xkiro_model: XKIRO_MODEL,
    xkiro_base_url: XKIRO_BASE_URL,
    web_search_enabled: WEB_SEARCH_ENABLED,
    web_search_provider: "xKiro",
    network: "unknown"
  };
  try {
    const r = await fetch(`${XKIRO_BASE_URL}/models`, { signal: AbortSignal.timeout(8000) });
    result.network = r.ok ? "connected" : `http_${r.status}`;
  } catch (e) {
    result.network = "unreachable";
    result.network_error = e.message;
  }
  result.ready = !!XKIRO_API_KEY && result.network === "connected";
  res.status(result.ready ? 200 : 503).json(result);
});

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

  if (XKIRO_API_KEY) {
    try {
      const answer = await callXKiro(built);
      return res.json({ answer, sources: webResults.map(x => ({ url: x.url, title: x.title })), web_search: useWeb && webResults.length > 0, provider: "xKiro" });
    } catch (e) {
      console.error("[xKiro]", e.message);
      return res.status(502).json({ error: `xKiro không phản hồi: ${e.message}`, code: "XKIRO_UPSTREAM_ERROR" });
    }
  }

  return res.status(503).json({ error: "XKIRO_API_KEY chưa được cấu hình trên Render.", code: "XKIRO_KEY_MISSING" });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Parking AI Node.js listening on ${PORT}`));
