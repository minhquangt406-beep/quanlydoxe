# SmartPark V9 — AI reliability patch

- Tool-level permission checks prevent guest access to vehicle-identifying data.
- AI status no longer exposes the internal Node service URL.
- Follow-up questions about another parking area can reuse the previous availability topic.
- AI Center now labels occupancy as a current metric, not a future prediction.
- The AI Center recommendation and caveat are HTML-escaped.

## Validation
Run `python -m compileall -q app` and `node --check app/static/app.js`.
Live database and external AI integration still require deployment testing.
