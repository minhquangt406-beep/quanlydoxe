AI Chat V13 - OpenAI Responses API stabilization

Changes:
- GPT-5.4 mini via Responses API remains primary.
- Reasoning effort set to none for lower latency; model supports none/low/medium/high/xhigh.
- SDK retries disabled to avoid doubling timeout latency.
- Backend timeout default 20s; frontend request timeout 35s.
- Context-aware local fallback for time questions such as “tầm 12h trưa thì sao”.
- Fallback receives recent conversation context.
- OpenAI/DeepSeek errors are logged server-side instead of being silently swallowed.
