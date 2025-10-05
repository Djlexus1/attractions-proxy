// Pseudocode for server.js

app.get('/qt/parks', async (req, res) => {
  const resorts = await fetch('https://queue-times.com/resorts.json').then(r => r.json());
  const parks = await fetch('https://queue-times.com/parks.json').then(r => r.json());

  // Index parks by resort_id
  const byResort = new Map();
  for (const p of parks) {
    if (!byResort.has(p.resort_id)) byResort.set(p.resort_id, []);
    byResort.get(p.resort_id).push({ id: p.id, name: p.name });
  }

  // Return the resorts you care about with nested parks
  const out = resorts
    .filter(r => [1, 5 /* add others if needed */].includes(r.id))
    .map(r => ({
      id: r.id,
      name: r.name,
      parks: byResort.get(r.id) || []
    }));

  res.json(out);
});

app.get('/qt/rides', async (req, res) => {
  const parkId = req.query.parkId;
  if (!parkId) return res.status(400).json({ error: 'Missing parkId' });

  try {
    const r = await fetch(`https://queue-times.com/parks/${parkId}/queue_times.json`, {
      headers: { Accept: 'application/json' }
    });
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
