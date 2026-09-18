const express = require("express");
const OpenAI = require("openai");

const app = express();
app.use(express.json({limit: "64kb"}));

// This Node process runs as an internal sidecar inside the same Render service.
// Do not use Render's public PORT here because FastAPI owns that port.
const PORT = Number(process.env.NODE_INTERNAL_PORT || 3100);
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || "").trim();
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const WEB_SEARCH_ENABLED = /^(1|true|yes|on)$/i.test(process.env.WEB_SEARCH_ENABLED || "true");
const WEB_SEARCH_CONTEXT_SIZE = process.env.WEB_SEARCH_CONTEXT_SIZE || "medium";

function needsWebSearch(question) {
  const q = String(question || "").toLowerCase();
  return /(thời tiết|weather|hôm nay|hôm qua|ngày mai|hiện nay|hiện tại|mới nhất|mới đây|tin tức|tin mới|quy định|luật|giá xăng|giá vàng|tỷ giá|tỉ giá|giao thông|địa điểm|nhà hàng|sản phẩm|giá thị trường|cập nhật|latest|today|news)/i.test(q);
}
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use((req,res,next)=>{res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");if(req.method === "OPTIONS") return res.sendStatus(204);next();});

const SYSTEM = `Bạn là trợ lý hỗ trợ khách hàng của hệ thống quản lý bãi đỗ xe Parking AI Pro.
- Trả lời bằng tiếng Việt tự nhiên, lịch sự, ngắn gọn và đúng trọng tâm.
- Chỉ sử dụng dữ liệu thực tế được truyền trong PARKING_CONTEXT; không bịa số liệu.
- Nếu người dùng hỏi chỗ trống, khu vực, giá, xe đang gửi hoặc thông tin liên hệ, dùng đúng dữ liệu trong context.
- Không tiết lộ mật khẩu, token, API key, dữ liệu kỹ thuật nội bộ hoặc cách hệ thống chọn AI.
- Guest không được xem biển số/danh sách xe của người khác, doanh thu hay dữ liệu quản trị. Với guest, không tiết lộ active_vehicle_details.
- Nếu thiếu dữ liệu, nói rõ là hệ thống chưa có dữ liệu thay vì đoán.
- Khi câu hỏi cần thông tin hiện tại hoặc thông tin bên ngoài hệ thống (ví dụ tin tức, thời tiết, giá thị trường, quy định mới, sản phẩm, địa điểm), hãy sử dụng tìm kiếm web nếu công cụ được bật.
- Nếu dùng thông tin từ web, ưu tiên nguồn chính thức/uy tín, nêu rõ thời điểm khi cần và không biến kết quả tìm kiếm thành dữ liệu của bãi xe.
- Ưu tiên 1-3 câu; dùng gạch đầu dòng khi câu hỏi cần nhiều bước.
- Không tự nhận là con người.`;

function buildPrompt(body) {
  const role = body.role || "guest";
  const context = {...(body.context || {}), role};
  if (role === "guest") delete context.active_vehicle_details;
  const history = Array.isArray(body.history) ? body.history.slice(-10).map(x => ({role: x.role === "assistant" ? "assistant" : "user", content: String(x.content || "").slice(0,1000)})) : [];
  return {history, context, question: String(body.question || "").trim()};
}

function extractWebSources(response) {
  const sources = [];
  for (const item of (response?.output || [])) {
    if (item?.type !== "web_search_call") continue;
    const list = item?.action?.sources || [];
    for (const source of list) {
      if (source?.type === "url" && source.url) sources.push({url: source.url});
    }
  }
  return [...new Map(sources.map(x => [x.url, x])).values()].slice(0, 8);
}

async function callOpenAI({history, context, question}) {
  const client = new OpenAI({apiKey: OPENAI_API_KEY, timeout: 50000, maxRetries: 1});
  const input = [...history, {role: "user", content: `PARKING_CONTEXT:\n${JSON.stringify(context)}\n\nCÂU HỎI:\n${question}`}];
  const forceWeb = WEB_SEARCH_ENABLED && needsWebSearch(question);
  const response = await client.responses.create({
    model: OPENAI_MODEL,
    instructions: SYSTEM,
    input,
    store: false,
    reasoning: {effort: "none"},
    text: {verbosity: "low"},
    ...(WEB_SEARCH_ENABLED ? {tools: [{type: "web_search", search_context_size: WEB_SEARCH_CONTEXT_SIZE}], tool_choice: forceWeb ? "required" : "auto"} : {}),
    max_output_tokens: 700
  });
  const answer = String(response.output_text || "").trim();
  if (!answer) throw new Error("OpenAI trả về phản hồi rỗng");
  return {answer, sources: extractWebSources(response), web_search: forceWeb};
}

async function callDeepSeek({history, context, question}) {
  const client = new OpenAI({apiKey: DEEPSEEK_API_KEY, baseURL: DEEPSEEK_BASE_URL, timeout: 50000, maxRetries: 1});
  const messages = [
    {role: "system", content: SYSTEM},
    ...history,
    {role: "user", content: `PARKING_CONTEXT:\n${JSON.stringify(context)}\n\nCÂU HỎI:\n${question}`}
  ];
  const response = await client.chat.completions.create({model: DEEPSEEK_MODEL, messages, temperature: 0.2, max_tokens: 700});
  const answer = String(response.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error("DeepSeek trả về phản hồi rỗng");
  return answer;
}

app.get("/health", (req, res) => res.json({status: "ok", service: "quanlydoxe-node-chat", openai: !!OPENAI_API_KEY, deepseek: !!DEEPSEEK_API_KEY, web_search: WEB_SEARCH_ENABLED && !!OPENAI_API_KEY, model: OPENAI_MODEL}));

app.post("/chat", async (req, res) => {
  const data = buildPrompt(req.body || {});
  if (!data.question) return res.status(400).json({error: "Vui lòng nhập câu hỏi"});
  if (data.question.length > 500) return res.status(400).json({error: "Câu hỏi tối đa 500 ký tự"});
  try {
    if (OPENAI_API_KEY) {
      try { const result = await callOpenAI(data); return res.json({answer: result.answer, sources: result.sources, web_search: result.web_search || result.sources.length > 0, provider: "OpenAI via Node.js"}); }
      catch (e) { console.error("[Node AI] OpenAI:", e.message); }
    }
    if (DEEPSEEK_API_KEY) {
      try { return res.json({answer: await callDeepSeek(data), provider: "DeepSeek via Node.js"}); }
      catch (e) { console.error("[Node AI] DeepSeek:", e.message); }
    }
    return res.status(503).json({error: "Chatbot chưa được cấu hình API key. Hãy thêm OPENAI_API_KEY vào Environment Variables của service quanlydoxe trên Render, rồi Redeploy."});
  } catch (e) {
    console.error("[Node AI]", e);
    return res.status(500).json({error: "AI service error"});
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Parking AI Node.js listening on ${PORT}`));
