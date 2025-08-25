// server.js (ESM)
// package.json must have: { "type": "module", "scripts": { "start": "node server.js" } }
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ---------- Env ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const APP_TOKEN      = process.env.APP_TOKEN || "";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ""; // optional

if (!OPENAI_API_KEY) {
  console.warn("[WARN] OPENAI_API_KEY is not set — /chat will fail.");
}

// ---------- Health ----------
app.get("/health", (req, res) => res.json({ ok: true }));

// ---------- Helpers ----------
const UA_HEADERS = { "User-Agent": "AttractionsAnswers/1.0 (+https://example.app)" };

const wantsSearch = (txt = "") => {
  const t = txt.toLowerCase();
  return (
    t.startsWith("search:") ||
    /\b(latest|news|today|tonight|this week|update|hours|look up|find)\b/i.test(t)
  );
};
const cleanQuery = (txt = "") =>
  txt.toLowerCase().startsWith("search:") ? txt.slice(7).trim() : txt.trim();

const cap = (s = "") => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const norm = (s = "") =>
  s.toLowerCase().replace(/’|‘/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// ---------- Tavily (with DDG fallback) ----------
async function getLiveContext(query) {
  if (!query) return null;

  // 1) Tavily
  if (TAVILY_API_KEY) {
    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: "advanced",
          max_results: 5,
          include_answer: true,
          include_images: false
        })
      });
      const data = await r.json();
      if (data?.results?.length) {
        return {
          summary: data.answer || "",
          sources: data.results.map(x => ({ title: x.title || "", url: x.url || "" }))
        };
      }
    } catch (e) {
      console.error("[Tavily] error:", e.message);
    }
  }

  // 2) DuckDuckGo HTML fallback
  try {
    const u = new URL("https://duckduckgo.com/html/");
    u.searchParams.set("q", query);
    const r = await fetch(u.toString(), { method: "GET" });
    const html = await r.text();

    const results = [];
    const rx = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let m;
    while ((m = rx.exec(html)) && results.length < 3) {
      const url = decodeURIComponent(m[1].replace(/^\/l\/\?kh=-1&uddg=/, ""));
      const title = m[2].replace(/<[^>]+>/g, "");
      results.push({ title, url });
    }
    if (results.length) {
      return { summary: `Top results for: ${query}`, sources: results };
    }
  } catch (e) {
    console.error("[DDG] error:", e.message);
  }

  return null;
}

// ---------- Queue-Times integration ----------
const PARK_IDS = {
  "magic kingdom": 6,
  "epcot": 5,
  "hollywood studios": 7,
  "animal kingdom": 8,
  "universal studios": 14,
  "islands of adventure": 15,
  "epic universe": 21,
  "seaworld": 22
};

const cache = {
  get(key) {
    const hit = this[key];
    if (!hit) return null;
    if (Date.now() - hit.at > 60_000) { delete this[key]; return null; } // 60s TTL
    return hit.json;
  },
  set(key, json) { this[key] = { at: Date.now(), json }; }
};

function guessParkId(text = "") {
  const t = norm(text);
  for (const [name, id] of Object.entries(PARK_IDS)) if (t.includes(name)) return id;
  if (/\bmk\b/.test(t)) return PARK_IDS["magic kingdom"];
  if (/\bdhs\b/.test(t) || t.includes("hollywood")) return PARK_IDS["hollywood studios"];
  if (/\bdak\b/.test(t) || t.includes("animal")) return PARK_IDS["animal kingdom"];
  if (t.includes("epcot")) return PARK_IDS["epcot"];
  return null;
}

function rideAliases() {
  return new Map([
    ["tron", "tron lightcycle run"],
    ["gotg", "guardians of the galaxy: cosmic rewind"],
    ["7dmt", "seven dwarfs mine train"],
    ["slinky", "slinky dog dash"],
    ["flight of passage", "avatar flight of passage"],
    ["rise", "star wars: rise of the resistance"]
  ]);
}

function nameMatches(rideName, query) {
  const rn = norm(rideName);
  const qn = norm(query);
  if (rn.includes(qn) || qn.includes(rn)) return true;
  for (const [key, full] of rideAliases()) {
    if (qn === key || qn.includes(key)) {
      if (rn.includes(full)) return true;
    }
  }
  const toks = qn.split(/\W+/).filter(Boolean);
  return toks.length >= 2 && toks.every(t => rn.includes(t));
}

async function parkUrl(parkId) {
  // Locale path works reliably; keep simple.
  return `https://queue-times.com/en-US/parks/${parkId}/queue_times.json`;
}

async function fetchParkTimes(parkId) {
  const key = `park:${parkId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = await parkUrl(parkId);
  const r = await fetch(url, {
    headers: {
      ...UA_HEADERS,
      "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8"
    }
  });
  if (!r.ok) throw new Error(`QueueTimes ${parkId} HTTP ${r.status}`);
  const json = await r.json();
  cache.set(key, json);
  return json;
}

async function findRideWaits(query) {
  const qn = norm(query);
  const parkHint = guessParkId(qn);
  const parks = parkHint ? [parkHint] : Object.values(PARK_IDS);

  const hits = [];
  for (const id of parks) {
    try {
      const data = await fetchParkTimes(id);
      const lands = Array.isArray(data.lands) ? data.lands : [];
      for (const land of lands) {
        for (const ride of land.rides || []) {
          const rideName = ride.name || "";
          if (nameMatches(rideName, qn)) {
            hits.push({
              parkId: id,
              parkName: Object.entries(PARK_IDS).find(([, v]) => v === id)?.[0] ?? `Park ${id}`,
              ride: rideName,
              wait: Number.isFinite(ride.wait_time) ? ride.wait_time : null,
              open: ride.is_open ?? null,
              updated: ride.last_updated || null
            });
          }
        }
      }
    } catch (e) {
      console.error(`[QueueTimes] fetch failed for park ${id}:`, e.message);
    }
  }
  return hits;
}

async function parkSnapshot(parkId) {
  try {
    const data = await fetchParkTimes(parkId);
    const items = [];
    for (const land of data.lands || []) {
      for (const ride of land.rides || []) {
        items.push({
          ride: ride.name || "Unknown",
          wait: Number.isFinite(ride.wait_time) ? ride.wait_time : null,
          open: ride.is_open ?? null,
          updated: ride.last_updated || null
        });
      }
    }
    // sort: open first, longest waits first
    items.sort((a, b) => {
      const ao = (a.open ?? true) ? 0 : 1, bo = (b.open ?? true) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (b.wait ?? -1) - (a.wait ?? -1);
    });
    return items.slice(0, 8);
  } catch (e) {
    console.error(`[QueueTimes] parkSnapshot ${parkId} failed:`, e.message);
    return [];
  }
}

// ---------- Chat ----------
app.post("/chat", async (req, res) => {
  try {
    // Token auth (only your app can call it)
    if (APP_TOKEN && req.headers.authorization !== `Bearer ${APP_TOKEN}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body || {};
    let { messages, forceSearch } = body;
    messages = Array.isArray(messages) ? messages : [];

    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const query = cleanQuery(lastUser);

    // Detect wait-time intent
    const wantsQueues = /\b(wait|waits|wait ?time|queue|queues|queue ?times|line|lines|how busy|standby|mins?)\b/i.test(query);

    // 🔥 Auto-run web search for wait-time questions (no "search:" needed)
    const shouldSearch = !!forceSearch || wantsSearch(lastUser) || wantsQueues;

    let queueSnippets = null;
    let rideHitsCount = 0;
    const parkGuess = guessParkId(query);

    if (wantsQueues) {
      const rides = await findRideWaits(query);
      rideHitsCount = rides.length;
      if (rides.length) {
        queueSnippets = rides.slice(0, 8).map(r => {
          const w = r.wait == null ? "n/a" : `${r.wait} min`;
          const o = r.open === false ? " (closed)" : "";
          return `• ${cap(r.parkName)} — ${r.ride}: ${w}${o}${r.updated ? ` (updated ${r.updated})` : ""}`;
        }).join("\n");
      } else if (parkGuess) {
        // Fallback: top rides for that park
        const snap = await parkSnapshot(parkGuess);
        if (snap.length) {
          const parkName = Object.entries(PARK_IDS).find(([, v]) => v === parkGuess)?.[0] ?? `Park ${parkGuess}`;
          queueSnippets = [`Top waits in ${cap(parkName)}:`]
            .concat(snap.map(s => `• ${s.ride}: ${s.wait == null ? "n/a" : s.wait + " min"}${s.open === false ? " (closed)" : ""}`))
            .join("\n");
        }
      }
    }

    let webContext = null;
    if (shouldSearch) {
      webContext = await getLiveContext(query);
    }

    console.log("[/chat]",
      "force:", !!forceSearch,
      "auto:", wantsSearch(lastUser),
      "queues:", !!queueSnippets,
      "parkGuess:", parkGuess || "none",
      "rideHits:", rideHitsCount,
      "webSources:", webContext?.sources?.length || 0,
      "q:", query
    );

    // Build system message
    const sys = [];
    sys.push(
      "You are Attractions Answers: an expert on Orlando parks, rides, shows, and tourism. " +
      "When live context is provided below, it has ALREADY been fetched — use it. " +
      "Do NOT say you cannot browse."
    );
    if (queueSnippets) {
      sys.push("Live ride waits (these numbers change frequently; present as current estimates):\n" + queueSnippets);
    }
    if (webContext) {
      sys.push(
        `Web context for "${query}":\n` +
        `SUMMARY:\n${webContext.summary}\n` +
        `SOURCES:\n${webContext.sources.map((s,i)=>`${i+1}. ${s.title} — ${s.url}`).join("\n")}`
      );
    }
    sys.push((webContext || queueSnippets)
      ? "If live context was provided, end with a short 'Sources:' list of 1–3 links when applicable."
      : "If no live context is provided, answer from general knowledge and note uncertainty where relevant."
    );

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: sys.join("\n\n") }, ...messages]
      })
    });

    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Proxy error" });
  }
});

// ---------- Listen ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Proxy listening on", PORT));
