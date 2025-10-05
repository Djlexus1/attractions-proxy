// Dynamic /qt/parks: fetch from Queue-Times and return resorts with real park IDs
app.get('/qt/parks', async (req, res) => {
  try {
    const resp = await fetch('https://queue-times.com/parks.json', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'attractions-proxy/1.0 (+https://example.com)'
      }
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Upstream failed ${resp.status}: ${text || resp.statusText}`);
    }
    const data = await resp.json();

    // Upstream shape: [{ id, name, parks: [{ id, name }] }, ...]
    const resorts = (Array.isArray(data) ? data : []).map(r => ({
      id: Number(r.id),
      name: r.name || 'Resort',
      parks: (Array.isArray(r.parks) ? r.parks : []).map(p => ({
        id: Number(p.id),
        name: p.name || 'Park'
      }))
    }));

    res.json(resorts);
  } catch (err) {
    console.error('/qt/parks error:', err);
    // Prefer failing fast over returning stubs (stubs cause wrong rides downstream)
    res.status(502).json({ error: { message: 'Failed to load parks from Queue-Times' } });
  }
});
