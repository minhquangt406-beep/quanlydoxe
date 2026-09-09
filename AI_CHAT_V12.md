# AI Chat V12

- OpenAI GPT-5.4 mini now uses the Responses API for multi-turn reasoning and custom function calling.
- Live parking data is fetched through server-side tools with role-based privacy.
- OpenAI failures fall back to DeepSeek (if configured), then to a useful local parking assistant.
- The chat header now reflects the provider that actually answered the latest message.
- Do not expose OPENAI_API_KEY in frontend or GitHub; configure it in Render Environment Variables.
