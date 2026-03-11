// /api/ai.js — Vercel Serverless Function
// Proxies requests from HungAI EmpireOS frontend to Anthropic API.
// Deploy: place this file at /api/ai.js in your Vercel project root.
// Env var required: ANTHROPIC_KEY (set in Vercel dashboard → Settings → Environment Variables)

export const config = {
  maxDuration: 60, // seconds — Vercel Pro allows up to 300s, Hobby max 60s
};

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY env var not set' });
  }

  // Parse body — Vercel automatically parses JSON bodies
  const { prompt, maxTokens, stage, model } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing or empty prompt' });
  }

  const resolvedModel   = (typeof model === 'string' && model.trim()) ? model.trim() : 'claude-sonnet-4-20250514';
  const resolvedTokens  = (typeof maxTokens === 'number' && maxTokens > 0 && maxTokens <= 8192) ? maxTokens : 4000;

  // Build Anthropic request — no AbortController, no signal
  const anthropicPayload = {
    model:      resolvedModel,
    max_tokens: resolvedTokens,
    messages: [
      { role: 'user', content: prompt.trim() }
    ],
  };

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicPayload),
    });
  } catch (networkErr) {
    return res.status(502).json({ error: 'Network error reaching Anthropic: ' + networkErr.message });
  }

  if (!anthropicRes.ok) {
    let errMsg = 'Anthropic HTTP ' + anthropicRes.status;
    try {
      const errJson = await anthropicRes.json();
      errMsg = (errJson && errJson.error && errJson.error.message) ? errJson.error.message : errMsg;
    } catch (_) {}
    return res.status(502).json({ error: errMsg });
  }

  let data;
  try {
    data = await anthropicRes.json();
  } catch (parseErr) {
    return res.status(502).json({ error: 'Failed to parse Anthropic response' });
  }

  // Extract text from Anthropic response
  const text =
    (data && data.content && Array.isArray(data.content) && data.content[0] && data.content[0].text)
      ? data.content[0].text
      : '';

  // Return JSON only — shape matches what _callAI_proxy expects: { text }
  return res.status(200).json({ text, stage: stage || null });
}
