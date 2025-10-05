// server.js (Node 18+ / ESM)
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());

// If you’re behind a proxy (Render), this is generally safe:
app.set('trust proxy', true);

const PORT = process.env.PORT || 3000;
const QT_BASE = 'https://queue-times.com';

// Allow list of resort IDs you want to expose.
// Defaults to WDW(1), Universal Orlando(5), SeaWorld(3).
// You can override with env: ALLOWED_RESORT_IDS="1,5,3"
const ALLOWED_RESORT_IDS = (process.env.ALLOWED_RESORT_IDS || '1,5,3')
  .split(',')
  .map(s => parseInt(s.trim(), 10))
  .filter(n => Number.isFinite(n));

// Helper: fetch JSON with stable headers + simple diagnostics
async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; MMProxy/1.0; +https://example.com)'
    }
  });
  const text = await r.text();
  if (!r.ok) {
    console.error('[fetchJSON] Non-2xx', { url, status: r.status, body: text.slice(0, 300) });
    const err = new Error(`Upstream error ${r.status}`);
    err.status = r.status;
    err.body = text.slice(0, 300);
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[fetchJSON] Non-JSON upstream', { url, status: r.status, snippet: text.slice(0, 300) });
    const err = new Error('Upstream returned non-JSON');
    err.status = r.status;
    err.body = text.slice(0, 300);
    throw err;
  }
}

// Health check
app.get('/qt/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Parks: group canonical parks by resort and return only allowed resorts
app.get('/qt/parks', async (req, res) => {
  try {
    console.log('[qt/parks] Fetching resorts.json + parks.json');
    const [resorts, parks] = await Promise.all([
      fetchJSON(`${QT_BASE}/resorts.json`),
      fetchJSON(`${QT_BASE}/parks.json`)
    ]);

    // Group parks by resort_id with id + name only
    const byResort = new Map();
    for (const p of parks) {
      const rid = p.resort_id;
      if (!byResort.has(rid)) byResort.set(rid, []);
      byResort.get(rid).push({ id: p.id, name: p.name });
    }

    // Keep only the resorts we care about
    const out = resorts
      .filter(r => ALLOWED_RESORT_IDS.includes(r.id))
      .map(r => ({
        id: r.id,
        name: r.name,
        parks: byResort.get(r.id) || []
      }));

    res.set('Cache-Control', 'public, s-maxage=300, max-age=60');
    res.json(out);
  } catch (e) {
    console.error('[qt/parks] failed:', e);
    res.status(e.status || 500).json({ error: e.message || 'Unknown error' });
  }
});

// Rides: pass through to canonical endpoint and flatten lands -> rides
app.get('/qt/rides', async (req, res) => {
  const parkId = req.query.parkId;
  if (!parkId) return res.status(400).json({ error: 'Missing parkId' });

  // Bust caches defensively (optional)
  const url = `${QT_BASE}/parks/${encodeURIComponent(parkId)}/queue_times.json?ts=${Date.now()}`;
  console.log('[qt/rides] Upstream URL:', url);

  try {
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; MMProxy/1.0; +https://example.com)'
      }
    });

    const status = r.status;
    const text = await r.text();
    if (status < 200 || status >= 300) {
      console.error('[qt/rides] Non-2xx upstream', { status, body: text.slice(0, 300) });
      return res.status(502).json({ error: 'Upstream error', status });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error('[qt/rides] Non-JSON upstream', { snippet: text.slice(0, 300) });
      return res.status(502).json({ error: 'Upstream returned non-JSON' });
    }

    // Prefer lands[].rides; some mirrors include top-level rides as well.
    let rides = [];
    if (Array.isArray(data.lands)) {
      rides = data.lands.flatMap(l => Array.isArray(l.rides) ? l.rides : []);
    }
    if (rides.length === 0 && Array.isArray(data.rides)) {
      // Fallback if upstream provided a flat rides array
      rides = data.rides;
    }

    const out = rides.map(ride => ({
      id: ride.id,
      name: ride.name,
      wait_time: ride.wait_time ?? null,
      is_open: ride.is_open ?? null
    }));

    if (out.length === 0) {
      console.warn('[qt/rides] Zero rides after flatten. Upstream keys:', Object.keys(data));
    } else {
      console.log('[qt/rides] parkId', parkId, 'rides:', out.length, 'first:', out[0]?.name);
    }

    res.set('Cache-Control', 'public, s-maxage=30, max-age=15');
    res.json({ rides: out });
  } catch (e) {
    console.error('[qt/rides] failed:', e);
    res.status(e.status || 500).json({ error: e.message || 'Unknown error' });
  }
});

// Root landing (optional)
app.get('/', (req, res) => {
  res.type('text/plain').send('Attractions proxy is running. Try /qt/parks or /qt/rides?parkId=12');
});

app.listen(PORT, () => {
  console.log('Proxy listening on', PORT, 'Allowed resorts:', ALLOWED_RESORT_IDS.join(','));
});
