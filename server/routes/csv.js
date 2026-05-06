import { Router } from 'express';
import { Agent, request as undiciRequest } from 'undici';

export const csvRouter = Router();

// Some CSV mirrors ship behind self-signed / private-CA TLS — same
// rationale as the PMD upstream in lib/pmd.js. The dispatcher is scoped
// to this router so we don't extend the cert bypass globally.
const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// GET /api/csv/fetch?url=<encoded URL>
//
// Streams a remote CSV through the backend so the browser can sidestep
// CORS. Any non-2xx upstream becomes a 502; >50 MB payloads are rejected
// with a 413 so a runaway URL can't OOM the dev server.
csvRouter.get('/fetch', async (req, res) => {
  const raw = req.query.url;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'Missing ?url query parameter' });
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res
      .status(400)
      .json({ error: 'Only http(s) URLs are supported' });
  }

  try {
    const upstream = await undiciRequest(parsed.toString(), {
      dispatcher: insecureDispatcher,
      method: 'GET',
      headers: {
        Accept: 'text/csv, text/plain, application/octet-stream;q=0.8, */*;q=0.5',
        'User-Agent': 'NationalGlofWatch/csv-fetch',
      },
      maxRedirections: 5,
    });
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      return res
        .status(502)
        .json({ error: `Upstream HTTP ${upstream.statusCode}` });
    }
    const text = await upstream.body.text();
    if (text.length > MAX_BYTES) {
      return res
        .status(413)
        .json({ error: 'CSV exceeds 50 MB limit' });
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Fetch failed' });
  }
});
