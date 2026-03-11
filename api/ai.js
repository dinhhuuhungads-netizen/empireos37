// ╔══════════════════════════════════════════════════════════════════════╗
// ║  /api/ai.js  —  Universal AI Proxy for Vercel                      ║
// ║  Providers: Gemini · OpenAI · Claude · OpenRouter · Groq           ║
// ║  POST { prompt, provider } → { text }                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const config = {
  maxDuration: 60, // seconds — increase to 300 on Vercel Pro if needed
};

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER DEFINITIONS
// Each entry: envKey, buildRequest(prompt, key), extractText(data)
// To add a new provider: append one object here — nothing else to change.
// ─────────────────────────────────────────────────────────────────────────────
const PROVIDERS = {

  // ── Google Gemini ─────────────────────────────────────────────────────────
  gemini: {
    envKey: 'GEMINI_API_KEY',
    buildRequest(prompt, key) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      };
    },
    extractText(data) {
      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    },
  },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  openai: {
    envKey: 'OPENAI_API_KEY',
    buildRequest(prompt, key) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model:      'gpt-4o-mini',
          max_tokens: 4096,
          messages:   [{ role: 'user', content: prompt }],
        }),
      };
    },
    extractText(data) {
      return data?.choices?.[0]?.message?.content ?? '';
    },
  },

  // ── Anthropic Claude ──────────────────────────────────────────────────────
  claude: {
    envKey: 'ANTHROPIC_API_KEY',
    buildRequest(prompt, key) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-3-5-sonnet-20240620',
          max_tokens: 4096,
          messages:   [{ role: 'user', content: prompt }],
        }),
      };
    },
    extractText(data) {
      if (!Array.isArray(data?.content)) return '';
      const block = data.content.find(b => b.type === 'text');
      return block?.text ?? '';
    },
  },

  // ── OpenRouter ────────────────────────────────────────────────────────────
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    buildRequest(prompt, key) {
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer':  'https://vercel.app',
          'X-Title':       'AI Proxy',
        },
        body: JSON.stringify({
          model:    'google/gemini-2.0-flash-exp:free',
          messages: [{ role: 'user', content: prompt }],
        }),
      };
    },
    extractText(data) {
      return data?.choices?.[0]?.message?.content ?? '';
    },
  },

  // ── Groq ──────────────────────────────────────────────────────────────────
  groq: {
    envKey: 'GROQ_API_KEY',
    buildRequest(prompt, key) {
      return {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model:      'llama-3.3-70b-versatile',
          max_tokens: 4096,
          messages:   [{ role: 'user', content: prompt }],
        }),
      };
    },
    extractText(data) {
      return data?.choices?.[0]?.message?.content ?? '';
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {

  // CORS — tighten to your domain in production if needed
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed — use POST' });

  // ── 1. Parse body ──────────────────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body: ' + e.message });
  }

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  // ── 2. Validate inputs ────────────────────────────────────────────────────
  const prompt   = typeof body.prompt   === 'string' ? body.prompt.trim()            : '';
  const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : 'claude';

  if (!prompt) {
    return res.status(400).json({ error: 'Missing required field: prompt (non-empty string)' });
  }

  // ── 3. Resolve provider ───────────────────────────────────────────────────
  const def = PROVIDERS[provider];
  if (!def) {
    return res.status(400).json({
      error: `Unknown provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}`,
    });
  }

  // ── 4. Resolve API key ────────────────────────────────────────────────────
  const key = process.env[def.envKey];
  if (!key) {
    return res.status(500).json({
      error: `Server misconfiguration: env var "${def.envKey}" is not set in Vercel Environment Variables`,
    });
  }

  // ── 5. Build + fire request ───────────────────────────────────────────────
  let cfg, rawRes;
  try {
    cfg    = def.buildRequest(prompt, key);
    rawRes = await fetch(cfg.url, { method: 'POST', headers: cfg.headers, body: cfg.body });
  } catch (e) {
    return res.status(502).json({ error: `Network error calling ${provider}: ${e.message}` });
  }

  // ── 6. Handle upstream errors ─────────────────────────────────────────────
  if (!rawRes.ok) {
    let detail = `HTTP ${rawRes.status}`;
    try {
      const j = await rawRes.json();
      // Normalise across different provider error shapes
      detail =
        j?.error?.message    ??   // OpenAI / Claude / Groq
        j?.error?.status     ??   // OpenRouter
        j?.message           ??   // generic REST
        j?.status_message    ??   // some providers
        JSON.stringify(j).slice(0, 200);
    } catch (_) { /* keep HTTP status string */ }
    return res.status(502).json({ error: `${provider} API error: ${detail}` });
  }

  // ── 7. Parse response ─────────────────────────────────────────────────────
  let data;
  try {
    data = await rawRes.json();
  } catch (e) {
    return res.status(502).json({ error: `Failed to parse ${provider} response: ${e.message}` });
  }

  // ── 8. Extract text ───────────────────────────────────────────────────────
  let text = '';
  try {
    text = def.extractText(data) ?? '';
  } catch (e) {
    return res.status(502).json({ error: `Failed to read text from ${provider} response: ${e.message}` });
  }

  if (!text.trim()) {
    return res.status(502).json({
      error: `${provider} returned empty content. Raw: ${JSON.stringify(data).slice(0, 300)}`,
    });
  }

  // ── 9. Return ─────────────────────────────────────────────────────────────
  return res.status(200).json({ text });
}
