import express from 'express';
import cors from 'cors';

const app = express();

// --- Config ---
const PORT = process.env.PORT || 3000;
const APP_TOKEN = process.env.APP_TOKEN || "";        // optional: require Authorization header if set
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ""; // required for web browsing via Tavily

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Optional auth for /chat
function requireAppToken(req, res, next) {
  if (!APP_TOKEN) return next(); // no token set → no auth required
  const auth = req.get('Authorization') || '';
  if (auth === `Bearer ${APP_TOKEN}`) return next();
  return res.status(401).json({ error: { message: 'Unauthorized – provide a valid Bearer token.' } });
}

// --- Health ---
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'attractions-proxy', time: new Date().toISOString() });
});

// --- Stub data for parks/rides (keep your app working even without upstream) ---
const resorts = [
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
    parks: [
      { id: 31, name: 'SeaWorld Orlando' }
    ]
  }
];

const ridesByPark = {
  11: [
    { id: 1001, name: 'Space Mountain', wait_time: 35, is_open: true },
    { id: 1002, name: 'Pirates of the Caribbean', wait_time: 25, is_open: true },
    { id: 1003, name: 'Big Thunder Mountain Railroad', wait_time: 40, is_open: true },
    { id: 1004, name: 'Haunted Mansion', wait_time: 15, is_open: true }
  ],
  12: [
    { id: 2001, name: 'Test Track', wait_time: 65, is_open: true },
    { id: 2002, name: 'Soarin’ Around the World', wait_time: 45, is_open: true },
    { id: 2003, name: 'Spaceship Earth', wait_time: 10, is_open: true }
  ],
  13: [
    { id: 3001, name: 'Rise of the Resistance', wait_time: 85, is_open: true },
    { id: 3002, name: 'Slinky Dog Dash', wait_time: 70, is_open: true },
    { id: 3003, name: 'Tower of Terror', wait_time: 55, is_open: true }
  ],
  14: [
    { id: 4001, name: "Avatar Flight of Passage", wait_time: 90, is_open: true },
    { id: 4002, name: "Na’vi River Journey", wait_time: 30, is_open: true },
    { id: 4003, name: "Expedition Everest", wait_time: 25, is_open: true }
  ],
  21: [
    { id: 5001, name: "Harry Potter and the Escape from Gringotts", wait_time: 60, is_open: true },
    { id: 5002, name: "Despicable Me Minion Mayhem", wait_time: 35, is_open: true }
  ],
  22: [
    { id: 6001, name: "Hagrid’s Magical Creatures Motorbike Adventure", wait_time: 75, is_open: true },
    { id: 6002, name: "The Incredible Hulk Coaster", wait_time: 45, is_open: true }
  ],
  23: [
    { id: 7001, name: "Starfall Racers", wait_time: 80, is_open: true },
    { id: 7002, name: "Constellation Carousel", wait_time: 15, is_open: true }
  ],
  31: [
    { id: 8001, name: "Manta", wait_time: 20, is_open: true },
    { id: 8002, name: "Mako", wait_time: 25, is_open: true }
  ]
};

// --- Parks/Rides endpoints (match your iOS app) ---
app.get('/qt/parks', (req, res) => {
  res.json(resorts);
});

app.get('/qt/rides', (req, res) => {
  const idParam = req.query.parkId;
  const parkId = Number(idParam);
  if (!idParam || Number.isNaN(parkId)) {
    return res.status(400).json({ error: { message: 'Missing or invalid parkId' } });
  }
  const rides = ridesByPark[parkId] || [];
  res.json({ rides });
});

// --- Tavily integration ---
async function tavilySearch(query, {
  maxResults = 5,
  searchDepth = "advanced",   // "basic" or "advanced"
  topic = "news",             // "news" or "general"
  includeAnswer = true
} = {}) {
  if (!TAVILY_API_KEY) {
    throw new Error("Tavily not configured (missing TAVILY_API_KEY).");
  }

  const body = {
    api_key: TAVILY_API_KEY,
    query,
    search_depth: searchDepth,
    topic,
    max_results: maxResults,
    include_answer: includeAnswer,
    include_images: false,
    include_raw_content: false
  };

  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Tavily failed ${resp.status}: ${text || resp.statusText}`);
  }

  return resp.json();
}

// --- Chat endpoint (what your iOS app calls) ---
app.post('/chat', requireAppToken, async (req, res) => {
  try {
    const { messages = [], forceSearch = false } = req.body || {};
    const lastUser = messages.filter(m => m && m.role === 'user').slice(-1)[0];
    const userText = lastUser?.content || "";

    console.log("[/chat] forceSearch:", forceSearch, "query:", userText);

    if (forceSearch) {
      const q = userText.replace(/^search:\\s*/i, "").trim();
      console.log("[tavily] searching for:", q);

      const t = await tavilySearch(q, {
        maxResults: 5,
        searchDepth: "advanced",
        topic: "news",
        includeAnswer: true
      });

      const answer = typeof t.answer === "string" && t.answer.trim().length > 0
        ? t.answer.trim()
        : null;

      const results = Array.isArray(t.results) ? t.results : [];
      console.log("[tavily] results:", results.length);

      const bullets = results.map((r, idx) => {
        const title = r.title || "Result";
        const url = r.url || "";
        const snippet = r.content || "";
        return `${idx + 1}. ${title}\\n   ${snippet}\\n   ${url}`;
      }).join("\\n\\n");

      const content = [
        answer ? `Summary: ${answer}` : `Here are some recent results for “${q}”:`,
        bullets,
        "Tip: Arrive early for the shortest waits; check times around meals; watch for evening drops."
      ].filter(Boolean).join("\\n\\n");

      return res.json({ choices: [{ message: { content } }] });
    }

    // Non-search fallback
    const content = `Thanks! You said: “${userText}”. Add “search:” to fetch web updates via Tavily.`;
    return res.json({ choices: [{ message: { content } }] });

  } catch (err) {
    console.error("Chat error:", err);
    const msg = (err && err.message) || "Internal error";
    return res.status(500).json({ error: { message: msg } });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`✅ attractions-proxy listening on port ${PORT}`);
});
