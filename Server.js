// Server.js (ESM)
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const setCacheHeaders = (res, secondsPublic = 60, secondsCDN = 300) => {
  res.set('Cache-Control', `public, s-maxage=${secondsCDN}, max-age=${secondsPublic}`);
};

const parks = [
  { id: 6,   name: "Disney Magic Kingdom", country: "United States", resortId: 1, resortName: "Walt Disney World" },
  { id: 5,   name: "Epcot", country: "United States", resortId: 1, resortName: "Walt Disney World" },
  { id: 7,   name: "Disney Hollywood Studios", country: "United States", resortId: 1, resortName: "Walt Disney World" },
  { id: 8,   name: "Animal Kingdom", country: "United States", resortId: 1, resortName: "Walt Disney World" },
  { id: 16,  name: "Disneyland", country: "United States", resortId: 2, resortName: "Disneyland Resort" },
  { id: 17,  name: "Disney California Adventure", country: "United States", resortId: 2, resortName: "Disneyland Resort" },
  { id: 4,   name: "Disneyland Park Paris", country: "France", resortId: 3, resortName: "Disneyland Paris" },
  { id: 28,  name: "Walt Disney Studios Paris", country: "France", resortId: 3, resortName: "Disneyland Paris" },
  { id: 31,  name: "Disneyland Hong Kong", country: "Hong Kong", resortId: 4, resortName: "Hong Kong Disneyland" },
  { id: 30,  name: "Shanghai Disney Resort", country: "China", resortId: 5, resortName: "Shanghai Disney Resort" },
  { id: 274, name: "Tokyo Disneyland", country: "Japan", resortId: 6, resortName: "Tokyo Disney Resort" },
  { id: 275, name: "Tokyo DisneySea", country: "Japan", resortId: 6, resortName: "Tokyo Disney Resort" },
  { id: 64,  name: "Islands Of Adventure At Universal Orlando", country: "United States", resortId: 10, resortName: "Universal Orlando Resort" },
  { id: 65,  name: "Universal Studios At Universal Orlando", country: "United States", resortId: 10, resortName: "Universal Orlando Resort" },
  { id: 67,  name: "Universal Volcano Bay", country: "United States", resortId: 10, resortName: "Universal Orlando Resort" },
  { id: 66,  name: "Universal Studios Hollywood", country: "United States", resortId: 11, resortName: "Universal Studios Hollywood" },
  { id: 32,  name: "Six Flags Magic Mountain", country: "United States", resortId: 20, resortName: "Six Flags" },
  { id: 37,  name: "Six Flags Great Adventure", country: "United States", resortId: 20, resortName: "Six Flags" },
  { id: 38,  name: "Six Flags Great America", country: "United States", resortId: 20, resortName: "Six Flags" },
  { id: 50,  name: "Cedar Point", country: "United States", resortId: 30, resortName: "Cedar Fair" },
  { id: 61,  name: "Knott's Berry Farm", country: "United States", resortId: 30, resortName: "Cedar Fair" },
  { id: 60,  name: "Kings Island", country: "United States", resortId: 30, resortName: "Cedar Fair" },
];

function normalizeName(s) {
  return String(s || '')
    .replace(/’/g, "'")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const nameToCanonicalId = (() => {
  const map = {};
  for (const p of parks) map[normalizeName(p.name)] = p.id;
  const aliases = [
    ["magic kingdom", "Disney Magic Kingdom"],
    ["disney's hollywood studios", "Disney Hollywood Studios"],
    ["hollywood studios", "Disney Hollywood Studios"],
    ["animal kingdom", "Animal Kingdom"],
    ["mk", "Disney Magic Kingdom"],
    ["dhs", "Disney Hollywood Studios"],
    ["dca", "Disney California Adventure"],
    ["universal studios orlando", "Universal Studios At Universal Orlando"],
    ["ioa", "Islands Of Adventure At Universal Orlando"],
    ["knotts berry farm", "Knott's Berry Farm"],
  ];
  for (const [alias, canonicalName] of aliases) {
    const key = normalizeName(alias);
    const canonicalKey = normalizeName(canonicalName);
    if (map[canonicalKey]) map[key] = map[canonicalKey];
  }
  return map;
})();

app.get('/qt/parks', (req, res) => {
  try {
    setCacheHeaders(res);
    res.type('application/json').json(parks);
  } catch (e) {
    console.error('Error /qt/parks:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/qt/park-id-map', (req, res) => {
  try {
    setCacheHeaders(res);
    res.type('application/json').json(nameToCanonicalId);
  } catch (e) {
    console.error('Error /qt/park-id-map:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/qt/resolve-park', (req, res) => {
  try {
    const q = req.query.q;
    if (typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({ error: 'missing_query' });
    }
    const id = nameToCanonicalId[normalizeName(q)];
    if (!id) return res.status(404).json({ error: 'not_found' });
    res.json({ id });
  } catch (e) {
    console.error('Error /qt/resolve-park:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/qt/wait-times', async (req, res) => {
  try {
    const parkId = parseInt(req.query.parkId, 10);
    if (!parkId || !parks.find(p => p.id === parkId)) {
      return res.status(400).json({ error: 'invalid_parkId' });
    }
    const demoAttractions = [
      { id: "space-mountain", name: "Space Mountain", waitMinutes: 45, status: "OPERATING" },
      { id: "pirates", name: "Pirates of the Caribbean", waitMinutes: 25, status: "OPERATING" },
      { id: "big-thunder", name: "Big Thunder Mountain", waitMinutes: 35, status: "OPERATING" },
    ];
    setCacheHeaders(res, 15, 60);
    res.json({ parkId, updatedAt: new Date().toISOString(), attractions: demoAttractions });
  } catch (e) {
    console.error('Error /qt/wait-times:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/qt/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
