// server.js
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1) Canonical park list with IDs (from your document)
// Keep this list authoritative. You can move this to a JSON file if you prefer.
const parks = [
  // Walt Disney Attractions (id: 2 in your document)
  { id: 6,  name: "Disney Magic Kingdom", country: "United States" },
  { id: 16, name: "Disneyland", country: "United States" },
  { id: 17, name: "Disney California Adventure", country: "United States" },
  { id: 5,  name: "Epcot", country: "United States" },
  { id: 7,  name: "Disney Hollywood Studios", country: "United States" },
  { id: 8,  name: "Animal Kingdom", country: "United States" },
  { id: 4,  name: "Disneyland Park Paris", country: "France" },
  { id: 28, name: "Walt Disney Studios Paris", country: "France" },
  { id: 31, name: "Disneyland Hong Kong", country: "Hong Kong" },
  { id: 30, name: "Shanghai Disney Resort", country: "China" },
  { id: 274, name: "Tokyo Disneyland", country: "Japan" },
  { id: 275, name: "Tokyo DisneySea", country: "Japan" },

  // Universal (subset)
  { id: 64, name: "Islands Of Adventure At Universal Orlando", country: "United States" },
  { id: 65, name: "Universal Studios At Universal Orlando", country: "United States" },
  { id: 66, name: "Universal Studios Hollywood", country: "United States" },
  { id: 67, name: "Universal Volcano Bay", country: "United States" },

  // Six Flags (subset)
  { id: 32, name: "Six Flags Magic Mountain", country: "United States" },
  { id: 37, name: "Six Flags Great Adventure", country: "United States" },
  { id: 38, name: "Six Flags Great America", country: "United States" },

  // Cedar Fair (subset)
  { id: 50, name: "Cedar Point", country: "United States" },
  { id: 61, name: "Knott's Berry Farm", country: "United States" },
  { id: 60, name: "Kings Island", country: "United States" },

  // Add the rest as needed from your document…
];

// 2) Normalization helper (keep in sync with the app’s normalization)
function normalizeName(s) {
  return s
    .replace(/’/g, "'")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// 3) Name → canonical ID map (to help match legacy/external names)
const nameToCanonicalId = (() => {
  const map = {};
  for (const p of parks) {
    map[normalizeName(p.name)] = p.id;
  }

  // Add aliases if your upstream data uses slightly different names
  const aliases = [
    // [alias, canonicalName]
    ["magic kingdom", "Disney Magic Kingdom"],
    ["disney's hollywood studios", "Disney Hollywood Studios"],
    ["disney california adventure", "Disney California Adventure"],
    ["universal studios orlando", "Universal Studios At Universal Orlando"],
    ["ioa", "Islands Of Adventure At Universal Orlando"],
    ["knotts berry farm", "Knott's Berry Farm"],
  ];
  for (const [alias, canonicalName] of aliases) {
    const key = normalizeName(alias);
    const canonicalKey = normalizeName(canonicalName);
    if (map[canonicalKey]) {
      map[key] = map[canonicalKey];
    }
  }
  return map;
})();

// 4) Expose canonical parks
app.get('/api/parks', (req, res) => {
  res.json(parks);
});

// 5) Expose name→id map (optional but helpful for the app to match)
app.get('/api/park-id-map', (req, res) => {
  res.json(nameToCanonicalId);
});

// 6) Wait times keyed by canonical parkId
// In production, you’d fetch from your real source(s) and translate to canonical.
// Here we return mocked data to illustrate the shape.
app.get('/api/wait-times', async (req, res) => {
  const parkId = parseInt(req.query.parkId, 10);
  if (!parkId || !parks.find(p => p.id === parkId)) {
    return res.status(400).json({ error: 'Invalid or missing parkId' });
  }

  // Example mocked attractions. Replace with real data lookups.
  const sample = [
    { id: "space-mountain", name: "Space Mountain", waitMinutes: 45, status: "OPERATING" },
    { id: "pirates", name: "Pirates of the Caribbean", waitMinutes: 25, status: "OPERATING" },
    { id: "big-thunder", name: "Big Thunder Mountain", waitMinutes: 35, status: "OPERATING" },
  ];

  res.json({
    parkId,
    updatedAt: new Date().toISOString(),
    attractions: sample
  });
});

// 7) Optional: endpoint to resolve a name to canonical id
app.get('/api/resolve-park', (req, res) => {
  const q = req.query.q;
  if (typeof q !== 'string' || !q.trim()) {
    return res.status(400).json({ error: 'Missing q' });
  }
  const key = normalizeName(q);
  const id = nameToCanonicalId[key];
  if (!id) return res.status(404).json({ error: 'Not found' });
  res.json({ id });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`server listening on port ${PORT}`);
});
