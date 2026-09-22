const express = require("express");

const app = express();
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.NODE_INTERNAL_PORT || 3100);
const XKIRO_API_KEY = (process.env.XKIRO_API_KEY || "").trim();
const XKIRO_MODEL = process.env.XKIRO_MODEL || "deepseek/deepseek-v4-pro:free";
const XKIRO_BASE_URL = (process.env.XKIRO_BASE_URL || "https://api.xkiro.com/v1").replace(/\/$/, "");
const WEB_SEARCH_ENABLED = /^(1|true|yes|on)$/i.test(process.env.WEB_SEARCH_ENABLED || "true");
const WEB_SEARCH_URL = process.env.WEB_SEARCH_URL || "https://html.duckduckgo.com/html/";
const WEB_FETCH_ENABLED = /^(1|true|yes|on)$/i.test(process.env.WEB_FETCH_ENABLED || "true");
const WEB_FETCH_TOP = Math.max(0, Math.min(3, Number(process.env.WEB_FETCH_TOP || 2)));
const WEB_SEARCH_DEFAULT_LOCATION = process.env.WEB_SEARCH_DEFAULT_LOCATION || "Thái Nguyên, Việt Nam";
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
- Nếu có WEB_RESULTS, bắt buộc ưu tiên các nguồn đó cho câu hỏi không thuộc dữ liệu bãi xe của SmartPark. Không dùng trí nhớ để thay thế kết quả tìm kiếm khi đã có nguồn web.
- Khi trả lời từ WEB_RESULTS/WEB_PAGE_CONTENT, phải trả lời trực tiếp câu hỏi trước, sau đó mới giải thích và nêu nguồn. Không trả lời vòng vo kiểu "hãy kiểm tra ứng dụng khác" nếu nguồn web đã có dữ liệu.
- Đối chiếu ít nhất 2 nguồn nếu có thể; ưu tiên nguồn chính thống, báo chí uy tín hoặc nguồn chuyên ngành. Nếu các nguồn khác nhau, nêu rõ sự khác biệt.
- Với thời tiết, giá thị trường, tỷ giá, tin tức, xếp hạng và dữ liệu hiện tại, phải dùng dữ liệu web mới nhất có sẵn; nêu rõ địa điểm và thời điểm nếu có. Nếu nguồn web có số liệu thì phải đưa số liệu đó vào câu trả lời thay vì chỉ nói rằng "đang tìm kiếm".
- Với câu hỏi xếp hạng/giá trị/người nổi tiếng/sự kiện mới, phải nói rõ mốc thời gian và không biến một nguồn thành sự thật tuyệt đối nếu chưa đủ căn cứ. Với câu hỏi "ai giàu nhất" hoặc xếp hạng, phải dùng nguồn tìm kiếm cụ thể; nếu chưa tìm thấy nguồn phù hợp thì nói "chưa xác minh được" và không kết luận rằng dữ liệu không tồn tại.
- Có thể dẫn nguồn bằng [1], [2] tương ứng với WEB_RESULTS.
- Nếu thiếu dữ liệu, nói rõ là chưa có dữ liệu thay vì đoán.
- Không tiết lộ mật khẩu, token, API key, dữ liệu kỹ thuật nội bộ hoặc cách hệ thống chọn AI.
- Không tự nhận là con người.`;

function buildPrompt(body, webResults = [], fetchedPages = []) {
  const role = body.role || "guest";
  const context = { ...(body.context || {}), role };
  if (role === "guest") delete context.active_vehicle_details;

  const history = Array.isArray(body.history)
    ? body.history.slice(-10).map(x => ({
        role: x.role === "assistant" ? "assistant" : "user",
        content: String(x.content || "").slice(0, 1500)
      }))
    : [];

  const webBlock = webResults.length
    ? `\n\nWEB_RESULTS (nguồn tìm kiếm bên ngoài):\n${webResults.map((r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}\nNguồn: ${r.source || ""}\n${r.snippet || ""}${r.published_at ? `\nNgày: ${r.published_at}` : ""}`
      ).join("\n\n")}`
    : "";
  const fetchBlock = fetchedPages.length
    ? `\n\nWEB_PAGE_CONTENT (nội dung đã đọc từ các trang web):\n${fetchedPages.map((r, i) =>
        `[TRANG ${i + 1}] ${r.title || r.url}\nURL: ${r.url}\n${r.content || ""}`
      ).join("\n\n")}`
    : "";

  return {
    history,
    prompt: `PARKING_CONTEXT:\n${JSON.stringify(context)}${webBlock}${fetchBlock}\n\nCÂU HỎI:\n${String(body.question || "").trim()}\n\nQUY TẮC TÌM KIẾM: Nếu câu hỏi không hỏi dữ liệu riêng của bãi xe SmartPark, hãy ưu tiên WEB_RESULTS/WEB_PAGE_CONTENT. Nếu câu hỏi yêu cầu thông tin hiện tại, xếp hạng, người giàu nhất, giá thị trường hoặc tin mới, chỉ kết luận dựa trên WEB_RESULTS/WEB_PAGE_CONTENT. Nếu nguồn chưa đủ hoặc mâu thuẫn, nói rõ mức độ chưa xác minh thay vì khẳng định hoặc suy đoán.`
  };
}

function isParkingDataQuestion(question) {
  const q = String(question || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Only questions that clearly ask for SmartPark's own live/database data
  // should stay local. Generic words such as "gia", "bao nhieu", "hien tai"
  // are deliberately NOT enough on their own.
  const parkingContext = [
    "bai xe", "bai do", "bai dau", "gui xe", "do xe", "dau xe",
    "cho trong", "vi tri do", "vi tri trong", "khu a", "khu b",
    "xe may", "o to", "xe dap", "ve thang", "phi gui", "gia gui",
    "bang gia gui", "tien gui xe", "trong bai", "dang gui", "dang do",
    "xe dang gui", "xe dang do", "so xe", "con bao nhieu cho",
    "con bao nhieu vi tri", "doanh thu bai xe", "lich su gui xe",
    "thanh toan gui xe", "ma QR bai xe", "lien he bai xe",
    "smartpark", "quan ly do xe", "quanlydoxe"
  ];
  return parkingContext.some(term => q.includes(term));
}

function needsWebSearch(question) {
  const q = String(question || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Policy for this chatbot: if a substantive question is NOT about
  // SmartPark's own parking/database data, search the live web.
  // Current/fresh parking-adjacent questions also search when they need
  // external information.
  const meta = /^(xin chao|chao|hello|hi|alo|cam on|ok|oke|ban la ai|ban la gi|ban co the lam gi|gioi thieu ban|help)$/i.test(q.trim());
  if (meta) return false;
  if (!isParkingDataQuestion(question)) return true;
  return /(hom nay|ngay mai|hien nay|hien tai|moi nhat|tin tuc|tin moi|quy dinh|luat|gia xang|gia vang|ty gia|ti gia|giao thong|cap nhat|latest|today|news|gia thi truong|gia dien|gia bitcoin|giau nhat|nguoi giau|xep hang|ranking|ket qua|2026|2025)/i.test(q);
}

function searchQuery(question) {
  const q = String(question || "").replace(/\s+/g, " ").trim();
  const n = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let extra = "";
  if (/giau nhat|nguoi giau|richest|ty phu/.test(n)) extra = " 2026 Forbes Bloomberg richest person";
  else if (/thoi tiet|weather/.test(n)) extra = ` weather today forecast ${WEB_SEARCH_DEFAULT_LOCATION}`;
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
    search_recency_filter: /thoi tiet|weather|tin tuc|tin moi|latest|today|hien tai|moi nhat|2026|gia vang|ty gia/.test(n) ? "day" : "noLimit"
  };
  // Do not bias global questions toward Vietnam. For Vietnam-specific topics,
  // the country hint improves local results substantially.
  if (/viet nam|vietn am|vietnam|ha noi|ho chi minh|tphcm|thai nguyen|hn|hcm/.test(n)) body.country = "VN";
  if (/giau nhat|nguoi giau|richest|ty phu/.test(n)) {
    if (/viet nam|vietnam/.test(n)) {
      body.search_domain_filter = ["forbes.com", "forbes.com.vn", "vnexpress.net", "cafef.vn", "tuoitre.vn", "reuters.com"];
    } else {
      body.search_domain_filter = ["forbes.com", "bloomberg.com", "reuters.com"];
    }
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

async function fetchWebPages(urls) {
  const clean = [...new Set((urls || []).filter(u => /^https?:\/\//i.test(String(u))).map(String))].slice(0, 10);
  if (!clean.length) return [];
  const response = await fetch(`${XKIRO_BASE_URL}/fetch`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${XKIRO_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: "xkiro/web-fetch", urls: clean, max_content_tokens: 6000 }),
    signal: AbortSignal.timeout(25000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `xKiro Fetch HTTP ${response.status}`);
  return Array.isArray(data?.results) ? data.results.map(r => ({
    url: String(r.url || ""), title: String(r.title || ""), content: String(r.content || ""),
    error: r.error || null
  })) : [];
}

async function callXKiro({ history, prompt }, useWeb = false, searchOptions = {}) {
  const messages = [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: prompt }];
  const payload = {
    model: XKIRO_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 1000
  };
  if (useWeb) {
    payload.web_search = {
      enable: true,
      count: Math.max(1, Math.min(10, Number(searchOptions.count || 8)))
    };
    if (searchOptions.country) payload.web_search.country = searchOptions.country;
    if (searchOptions.recency) payload.web_search.search_recency_filter = searchOptions.recency;
    if (Array.isArray(searchOptions.domains) && searchOptions.domains.length) {
      payload.web_search.search_domain_filter = searchOptions.domains.slice(0, 20);
    }
  }

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

  const useWeb = WEB_SEARCH_ENABLED && needsWebSearch(question);
  let webResults = [];
  let fetchedPages = [];
  let webStatus = null;
  let remainingToday = null;
  const query = searchQuery(question);
  const nq = question.toLowerCase();
  const urlMatches = question.match(/https?:\/\/[^\s<>"]+/gi) || [];
  const explicitUrls = [...new Set(urlMatches.map(u => u.replace(/[),.;!?]+$/, "")))].slice(0, 3);
  const rankingFetchRequested = /(ai\s+(l[aà]u|dang)?\s*gi[aà]u|ai\s*gi[aà]u|người\s+gi[aà]u|nguoi\s+giau|gi[aà]u\s+nh[aấ]t|giau\s+nhat|richest|ty\s*ph[uú]|t[oố]p\s*\d+\s+ng[uư][oờ]i\s+gi[aà]u|x[eế]p\s+h[aà]ng)/i.test(nq);
  const fetchRequested = WEB_FETCH_ENABLED && (explicitUrls.length > 0 || rankingFetchRequested || /(đọc|doc|nội dung|noi dung|chi tiết|chi tiet|phân tích trang|phan tich trang|trang web|link này|link nay|nguồn này|nguon nay)/i.test(nq));

  // Use one explicit search for every non-parking question so we can inspect
  // the actual search results and fetch the most relevant pages. This gives
  // much better answers for weather, prices, news and rankings than relying
  // on a model-only search summary.
  if (useWeb && XKIRO_API_KEY && !explicitUrls.length) {
    try {
      webResults = await searchWeb(query);
      webStatus = webResults.length ? "ok" : "no_results";
    } catch (e) {
      webStatus = "search_error";
      console.error("[Web Search]", e.message);
    }
  }

  // Read the most relevant pages when the question asks for details, or when
  // an explicit URL was supplied. Keep the default at 2 pages to conserve the
  // free xKiro fetch allowance.
  if (WEB_FETCH_ENABLED && XKIRO_API_KEY && (fetchRequested || (useWeb && WEB_FETCH_TOP > 0))) {
    const urls = explicitUrls.length ? explicitUrls : webResults.slice(0, WEB_FETCH_TOP).map(x => x.url);
    if (urls.length) {
      try {
        const fetched = await fetchWebPages(urls.slice(0, 3));
        fetchedPages = fetched.filter(x => x.content).map(x => ({
          url: x.url, title: x.title, content: String(x.content).slice(0, 14000), error: x.error || null
        }));
      } catch (e) {
        console.error("[Web Fetch]", e.message);
      }
    }
  }

  const built = buildPrompt({ ...req.body, question }, webResults, fetchedPages);

  if (XKIRO_API_KEY) {
    try {
      const domainInfo = (() => {
        const n = query.toLowerCase();
        if (/viet nam|vietnam|hà nội|ha noi|hồ chí minh|ho chi minh|thái nguyên|thai nguyen/.test(n)) return "VN";
        return undefined;
      })();
      const domains = /giau nhat|nguoi giau|richest|ty phu/i.test(query)
        ? (/viet nam|vietnam/i.test(query)
            ? ["forbes.com", "forbes.com.vn", "vnexpress.net", "cafef.vn", "tuoitre.vn", "reuters.com"]
            : ["forbes.com", "bloomberg.com", "reuters.com"])
        : undefined;
      const recency = /(hom nay|hien tai|moi nhat|tin tuc|latest|today|thoi tiet|weather|2026|gia vang|ty gia)/i.test(query) ? "day" : "noLimit";
      // We already performed the standalone search above. Do not trigger a
      // second search inside chat/completions; this preserves the free quota.
      const chatSearch = false;
      const result = await callXKiro(built, chatSearch, {count: 8, country: domainInfo, domains, recency});
      const apiSearch = result.search || {};
      remainingToday = apiSearch.remaining_today ?? null;
      const sources = webResults.map(x => ({ url: x.url, title: x.title, source: x.source }));
      const apiSources = Array.isArray(apiSearch.results) ? apiSearch.results.map(r => ({url:String(r.url||""),title:String(r.title||""),source:String(r.source||"")})).filter(x=>x.url&&x.title) : [];
      const merged = [...sources, ...apiSources].filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i).slice(0,8);
      return res.json({
        answer: result.answer,
        sources: merged,
        web_search: Boolean(useWeb),
        web_search_status: useWeb ? (apiSearch.status || webStatus || (webResults.length ? "ok" : "no_results")) : null,
        web_search_remaining_today: remainingToday,
        web_fetched: fetchedPages.length > 0,
        fetched_pages: fetchedPages.map(x => ({url:x.url,title:x.title,error:x.error||null})),
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
