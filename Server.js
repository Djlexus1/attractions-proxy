// Dynamic /qt/parks: fetch from Queue-Times and return resorts with real park IDs
app.get('/qt/parks', async (req, res) => {
  try {
    // Queue-Times top-level listing
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

    // Expected upstream shape: [{ id, name, parks: [{ id, name }] }, ...]
    // Map to your app’s expected DTOs: QTResort { id, name, parks: [QTListedPark] }
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
    // Fall back to your static stub if upstream fails (so UI won’t break)
    res.json([
      {
        id: 1,
        name: 'Walt Disney World',
        parks: [
          { id: 11, name: 'Magic Kingdom' },
          { id: 12, name: 'EPCOT' },
          { id: 13, name: "Disney's Hollywood Studios" },
          { id: 14, name: "Disney's Animal Kingdom" }
        ]
      },
      {
        id: 2,
        name: 'Universal Orlando',
        parks: [
          { id: 21, name: 'Universal Studios Florida' },
          { id: 22, name: "Universal's Islands of Adventure" },
          { id: 23, name: 'Universal Epic Universe' }
        ]
      },
      {
        id: 3,
        name: 'SeaWorld',
        parks: [{ id: 31, name: 'SeaWorld Orlando' }]
      }
    ]);
  }
});
