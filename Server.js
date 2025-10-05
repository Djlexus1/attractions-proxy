// server.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch'; // or use global fetch on Node 18+

const app = express();
app.use(cors());

const QT_BASE = 'https://queue-times.com';

// GET /qt/parks -> mirror resorts + parks (id + name only)
app.get('/qt/parks', async (req, res) => {
  try {
    const r = await fetch(`${QT_BASE}/resorts.json`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return res.status(502).json({ error: 'Upstream /resorts.json failed' });
    const resorts = await r.json();

    // Return only the fields the app needs
    const out = resorts.map(r => ({
      id: r.id,
      name: r.name,
      parks: (r.parks || []).map(p => ({ id: p.id, name: p.name }))
    }));

    res.set('Cache-Control', 'public, s-maxage=300, max-age=60');
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

// GET /qt/rides?parkId=NN -> flatten lands -> rides
app.get('/qt/rides', async (req, res) => {
  const parkId = req.query.parkId;
  if (!parkId) return res.status(400).json({ error: 'Missing parkId' });

  try {
    // IMPORTANT: Use the EXACT park id from /resorts.json here
    const r = await fetch(`${QT_BASE}/parks/${parkId}/queue_times.json`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return res.status(502).json({ error: `Upstream /parks/${parkId}/queue_times.json failed` });
    const data = await r.json();

    const rides = (data.lands || [])
      .flatMap(l => l.rides || [])
      .map(ride => ({
        id: ride.id,
        name: ride.name,
        wait_time: ride.wait_time ?? null,
        is_open: ride.is_open ?? null
      }));

    res.set('Cache-Control', 'public, s-maxage=30, max-age=15');
    res.json({ rides });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Proxy listening on', port);
});
