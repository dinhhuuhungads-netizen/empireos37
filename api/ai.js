export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  // CORS headers — allow Vercel preview URLs and custom domains
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Read API key
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in environment variables' });
  }

  // Read prompt from body
  // Vercel parses JSON body automatically — no bodyParser needed
  let prompt = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    prompt = (body && typeof body.prompt === 'string') ? body.prompt.trim() : '';
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse request body: ' + e.message });
  }

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt in request body' });
  }

  // Call Anthropic
  let raw;
  try {
    raw = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-3-5-sonnet-20240620',
        max_tokens: 1000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to reach Anthropic API: ' + e.message });
  }

  // Forward non-OK errors from Anthropic
  if (!raw.ok) {
    let detail = 'HTTP ' + raw.status;
    try {
      const j = await raw.json();
      detail = (j && j.error && j.error.message) ? j.error.message : detail;
    } catch (_) {}
    return res.status(502).json({ error: 'Anthropic error: ' + detail });
  }

  // Parse response
  let data;
  try {
    data = await raw.json();
  } catch (e) {
    return res.status(502).json({ error: 'Failed to parse Anthropic response: ' + e.message });
  }

  // Extract text
  const text =
    data &&
    Array.isArray(data.content) &&
    data.content[0] &&
    data.content[0].type === 'text'
      ? data.content[0].text
      : '';

  return res.status(200).json({ text });
}
