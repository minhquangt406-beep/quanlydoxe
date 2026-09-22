# SmartPark AI Web Intelligence V7

- xKiro is the AI provider.
- Current/live questions automatically enable xKiro Web Search.
- Search results are returned as sources and cited as [1], [2], etc. by the assistant.
- For better answers, the server fetches the top 2 relevant pages by default and gives readable page content to the model.
- If the user supplies a URL or asks to read/analyze a page, the server fetches that URL directly.
- `WEB_FETCH_TOP=2` can be lowered to `1` to conserve the free fetch allowance.
- `WEB_SEARCH_ENABLED=true` and `WEB_FETCH_ENABLED=true` are required for live web intelligence.

xKiro's current documentation states that Web Search can be enabled on chat completions and that Web Fetch accepts up to 10 URLs per request. Free allowances are limited, so this version avoids duplicate searches and batches page reads.
