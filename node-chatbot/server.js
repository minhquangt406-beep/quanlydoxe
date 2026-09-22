const express = require("express");

const app = express();
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.NODE_INTERNAL_PORT || 3100);
const XKIRO_API_KEY = (process.env.XKIRO_API_KEY || "").trim();
const XKIRO_MODEL = process.env.XKIRO_MODEL || "deepseek/deepseek-v4-pro:free";
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
- Nếu có WEB_RESULTS, bắt buộc ưu tiên các nguồn đó cho câu hỏi cần thông tin mới/current. Không dùng trí nhớ để thay thế kết quả tìm kiếm.
- Khi trả lời từ WEB_RESULTS, đối chiếu ít nhất 2 nguồn nếu có thể; ưu tiên nguồn chính thống, báo chí uy tín hoặc nguồn chuyên ngành. Nếu các nguồn khác nhau, nêu rõ sự khác biệt.
- Với câu hỏi xếp hạng/giá trị/người nổi tiếng/sự kiện mới, phải nói rõ mốc thời gian và không biến một nguồn thành sự thật tuyệt đối nếu chưa đủ căn cứ.
- Có thể dẫn nguồn bằng [1], [2] tương ứng với WEB_RESULTS.
- Nếu thiếu dữ liệu, nói rõ là chưa có dữ liệu thay vì đoán.
- Không tiết lộ mật khẩu, token, API key, dữ liệu kỹ thuật nội bộ hoặc cách hệ thống chọn AI.
- Không tự nhận là con người.`;

function needsWebSearch(question) {
  const q = String(question || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Prefer live search for questions whose answer can change over time or
  // requires a current ranking/fact, while keeping static parking questions local.
  return /(thoi tiet|weather|hom nay|hom qua|ngay mai|hien nay|hien tai|moi nhat|moi day|tin tuc|tin moi|quy dinh|luat|gia xang|gia vang|ty gia|ti gia|giao thong|dia diem|nha hang|san pham|gia thi truong|cap nhat|latest|today|news|gia dien|gia bitcoin|gia tri|gia tri tai san|giau nhat|giau nhat the gioi|nguoi giau|top\s*\d+|xep hang|ranking|rank|ai la|ai dang|nam nay|2026|2025|luc nay|bao nhieu tien|bao nhieu usd|bao nhieu ty|von hoa|thi truong|ket qua|vo dich|thang|thua)/i.test(q);
}

function searchQuery(question) {
  const q = String(question || "").replace(/\s+/g, " ").trim();
  const n = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let extra = "";
  if (/giau nhat|nguoi giau|richest|ty phu/.test(n)) extra = " 2026 Forbes Bloomberg richest person";
  else if (/thoi tiet|weather/.test(n)) extra = " weather today forecast";
  else if (/gia vang|gold price/.test(n)) extra = " gold price today Vietnam";
  else if (/ty gia|ti gia|usd|dollar/.test(n)) extra = " exchange rate today Vietnam";
  else if (/tin tuc|tin moi|latest|news/.test(n)) extra = " latest news 2026";
  else if (/xep hang|ranking|top\\s*\\d+/.test(n)) extra = " current ranking 2026";
  else if (/nam nay|hien tai|moi nhat|today|latest/.test(n)) extra = " current 2026";
  return (q + extra).slice(0, 450);
}

async function searchWeb(query) {
  if (!WEB_SEARCH_ENABLED || !XKIRO_API_KEY) return [];
  const q = String(query || "").slice(0, 500);
  const n = q.toLowerCase();
  const body = {
    model: "xkiro/web-search",
    query: q,
    max_results: 8,
    search_recency_filter: /thoi tiet|weather|tin tuc|tin moi|latest|today|hien tai|moi nhat|2026/.test(n) ? "week" : "noLimit"
  };
  // Do not bias global questions toward Vietnam. For Vietnam-specific topics,
  // the country hint improves local results substantially.
  if (/viet nam|vietn am|vietnam|ha noi|ho chi minh|tphcm|thai nguyen|hn|hcm/.test(n)) body.country = "VN";
  if (/giau nhat|nguoi giau|richest|ty phu/.test(n)) {
    body.search_domain_filter = ["forbes.com", "bloomberg.com", "reuters.com"];
  } else if (/gia vang|gold price/.test(n)) {
    body.search_domain_filter = ["sbv.gov.vn", "sjc.com.vn", "vnexpress.net", "reuters.com"];
  }
  const response = await fetch(`${XKIRO_BASE_URL}/search`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${XKIRO_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
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
    published_at: r.publishedDate || null
  })).filter(r => r.title && r.url).slice(0, 8);
}

async function callXKiro({ history, prompt }, useWeb = false) {
  const messages = [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: prompt }];
  const payload = {
    model: XKIRO_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 900
  };
  // Search results are supplied separately below, so do not enable a second
  // xKiro search here. This keeps each live question to one search request.
  // The prompt already contains the ranked WEB_RESULTS.

  const response = await fetch(`${XKIRO_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${XKIRO_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `xKiro HTTP ${response.status}`);
  const answer = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error("xKiro trả về phản hồi rỗng");
  const search = data?.web_search || null;
  const sources = Array.isArray(search?.results) ? search.results.map(r => ({
    url: String(r.url || ""),
    title: String(r.title || ""),
    source: String(r.source || "")
  })).filter(r => r.url && r.title).slice(0, 6) : [];
  return { answer, sources, webSearchStatus: search?.status || null, remainingToday: search?.remaining_today ?? null };
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
    try { webResults = await searchWeb(searchQuery(question)); }
    catch (e) { console.error("[Web Search]", e.message); }
  }
  const built = buildPrompt({ ...req.body, question }, webResults);

  if (XKIRO_API_KEY) {
    try {
      const result = await callXKiro(built, useWeb);
      return res.json({
        answer: result.answer,
        sources: webResults.map(x => ({ url: x.url, title: x.title, source: x.source })),
        web_search: Boolean(useWeb && webResults.length),
        web_search_status: useWeb ? (webResults.length ? "ok" : "no_results") : null,
        provider: "xKiro"
      });
    } catch (e) {
      console.error("[xKiro]", e.message);
      return res.status(502).json({ error: `xKiro không phản hồi: ${e.message}`, code: "XKIRO_UPSTREAM_ERROR" });
    }
  }

  return res.status(503).json({ error: "XKIRO_API_KEY chưa được cấu hình trên Render.", code: "XKIRO_KEY_MISSING" });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Parking AI Node.js listening on ${PORT}`));
