// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  /api/ai.js — Universal AI Proxy · Vercel Serverless                   ║
// ║  Providers : gemini · openai · claude · openrouter · groq              ║
// ║  Fallback  : auto-tries next provider if primary fails                 ║
// ║  Returns   : { text }  — never throws 500 to client                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const config = { maxDuration: 60 };

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER DEFINITIONS
// Each entry: envKey · buildRequest(prompt, key) · extractText(data)
// ─────────────────────────────────────────────────────────────────────────────
const PROVIDERS = {

  gemini: {
    envKey: 'GEMINI_API_KEY',
    buildRequest(prompt, key) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
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
          model:    'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
        }),
      };
    },
    extractText(data) {
      return data?.choices?.[0]?.message?.content ?? '';
    },
  },

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
          model:      'llama3-8b-8192',
          max_tokens: 4096,
          messages:   [{ role: 'user', content: prompt }],
        }),
      };
    },
    extractText(data) {
      return data?.choices?.[0]?.message?.content ?? '';
    },
  },

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
          model:      'claude-3-haiku-20240307',
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
};

// Fallback order when primary provider fails
const FALLBACK_ORDER = ['gemini', 'openrouter', 'groq', 'openai', 'claude'];

// ─────────────────────────────────────────────────────────────────────────────
// callProvider — attempt one provider, return { text } or throw
// ─────────────────────────────────────────────────────────────────────────────
async function callProvider(providerName, prompt) {
  const def = PROVIDERS[providerName];
  if (!def) throw new Error(`Unknown provider: ${providerName}`);

  const key = process.env[def.envKey];
  if (!key) throw new Error(`${def.envKey} not set`);

  const cfg = def.buildRequest(prompt, key);

  const rawRes = await fetch(cfg.url, {
    method:  'POST',
    headers: cfg.headers,
    body:    cfg.body,
  });

  if (!rawRes.ok) {
    let detail = `HTTP ${rawRes.status}`;
    try {
      const j = await rawRes.json();
      detail =
        j?.error?.message  ??
        j?.error?.status   ??
        j?.message         ??
        JSON.stringify(j).slice(0, 120);
    } catch (_) {}
    throw new Error(`${providerName} API error: ${detail}`);
  }

  const data = await rawRes.json();
  const text = def.extractText(data) ?? '';

  if (!text.trim()) {
    throw new Error(`${providerName} returned empty content`);
  }

  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {

  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed — use POST' });

  // Parse body
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body: ' + e.message });
  }

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ error: 'Missing required field: prompt' });
  }

  // Build the attempt order: requested provider first, then fallbacks
  const requested = typeof body.provider === 'string'
    ? body.provider.trim().toLowerCase()
    : 'gemini';

  const attemptOrder = [
    requested,
    ...FALLBACK_ORDER.filter(p => p !== requested),
  ];

  // Try each provider in order — never throw to client
  const errors = [];

  for (const providerName of attemptOrder) {
    if (!PROVIDERS[providerName]) continue;

    try {
      const text = await callProvider(providerName, prompt);
      // Success — return which provider was used for debugging
      return res.status(200).json({ text, provider: providerName });
    } catch (e) {
      errors.push(`[${providerName}] ${e.message}`);
      // Continue to next provider
    }
  }

  // All providers failed — return last-resort fallback text, never a raw 500
  return res.status(200).json({
    text: `All AI providers failed. Errors: ${errors.join(' | ')}`,
    provider: 'none',
    errors,
  });
}
