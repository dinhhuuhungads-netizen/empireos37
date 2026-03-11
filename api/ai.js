// api/ai.js — Vercel Serverless Function
// Proxies POST /api/ai → Anthropic API
// Env var required: ANTHROPIC_API_KEY (set in Vercel dashboard → Settings → Environment Variables)

export const config = {
  maxDuration: 60, // seconds — Vercel Pro max 300s, Hobby max 60s
};

export default async function handler(req, res) {

  // ── 1. Method guard ──────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  // ── 2. API key guard ─────────────────────────────────────────────────────
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: ANTHROPIC_API_KEY env var is not set.' });
  }

  // ── 3. Parse body safely ─────────────────────────────────────────────────
  // Vercel automatically parses JSON bodies when Content-Type is application/json
  let body = req.body;

  // Fallback: if body is a string (raw), parse it manually
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body is missing or not an object.' });
  }

  const { prompt, maxTokens, stage, model } = body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing required field: prompt (non-empty string).' });
  }

  // ── 4. Resolve model + token limits ─────────────────────────────────────
  const resolvedModel  = (typeof model === 'string' && model.trim()) ? model.trim() : 'claude-sonnet-4-5';
  const resolvedTokens = (typeof maxTokens === 'number' && maxTokens > 0 && maxTokens <= 8192)
    ? maxTokens
    : 4000;

  // ── 5. Call Anthropic API ────────────────────────────────────────────────
  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      resolvedModel,
        max_tokens: resolvedTokens,
        messages: [
          { role: 'user', content: prompt.trim() }
        ],
      }),
    });
  } catch (networkErr) {
    return res.status(502).json({
      error: 'Network error reaching Anthropic API: ' + networkErr.message,
    });
  }

  // ── 6. Handle non-OK response from Anthropic ────────────────────────────
  if (!anthropicRes.ok) {
    let errMsg = 'Anthropic API error: HTTP ' + anthropicRes.status;
    try {
      const errJson = await anthropicRes.json();
      if (errJson && errJson.error && errJson.error.message) {
        errMsg = errJson.error.message;
      }
    } catch (_) { /* keep default errMsg */ }
    return res.status(502).json({ error: errMsg });
  }

  // ── 7. Parse Anthropic response ──────────────────────────────────────────
  let data;
  try {
    data = await anthropicRes.json();
  } catch (parseErr) {
    return res.status(502).json({ error: 'Failed to parse response from Anthropic API.' });
  }

  // ── 8. Extract text content ──────────────────────────────────────────────
  const text =
    (data &&
     Array.isArray(data.content) &&
     data.content[0] &&
     data.content[0].type === 'text' &&
     data.content[0].text)
      ? data.content[0].text
      : '';

  // ── 9. Return JSON to frontend ───────────────────────────────────────────
  // Shape: { text, stage } — matches what _callAI_proxy expects
  return res.status(200).json({
    text,
    stage: stage || null,
  });
}
