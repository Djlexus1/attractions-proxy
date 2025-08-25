// server.js (ESM)
// Requires: "type": "module" in package.json
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// -------- Env --------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const APP_TOKEN       = process.env.APP_TOKEN || "";
const TAVILY_API_KEY  = process.env.TAVILY_API_KEY || ""; // optional but recommended

if (!OPENAI_API_KEY) {
  console.warn("[WARN] OPENAI_API_KEY is not set — /chat will fail.");
}

// -------- Health --------
app.get("/health", (req, res) => res.json({ ok: true }));

// -------- Helpers: search intent --------
const wantsSearch = (txt = "") => {
  const t = txt.toLowerCase();
  return (
    t.startsWith("search:") ||
    t.includes("latest") || t.includes("news") ||
    t.includes("today")  || t.includes("tonight") ||
    t.includes("this week") || t.includes("update") ||
    t.includes("hours") || t.includes("look up") || t.includes("find")
  );
};
const cleanQuery = (txt = "") =>
  txt.toLowerCase().startsWith("search:") ? txt.slice(7).trim() : txt.trim();
const capitalize = (s = "") => (s ? s[0].toUpperCase() + s.slice(1) : s);

// -------- Tavily (with DDG fallback) --------
async function getLiveContext(query) {
  if (!query) return null;

  // 1) Tavily (best)
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

  // 2) DuckDuckGo HTML fallback (no key)
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

// -------- Queue-Times integration --------
// WDW parks (expand as needed)
const PARK_IDS = {
  "magic kingdom": 16,
  "epcot": 17,
  "hollywood studios": 18,
  "animal kingdom": 19
};

// tiny 60s cache
const cache = {
  get(key) {
    const hit = this[key];
    if (!hit) return null;
    if (Date.now() - hit.at > 60_000) { delete this[key]; return null; }
    return hit.json;
  },
  set(key, json) { this[key] = { at: Date.now(), json }; }
};

function guessParkId(text = "") {
  const t = text.toLowerCase();
  for (const [name, id] of Object.entries(PARK_IDS)) {
    if (t.includes(name)) return id;
  }
  if (t.includes("mk")) return PARK_IDS["magic kingdom"];
  if (t.includes("dhs") || t.includes("hollywood")) return PARK_IDS["hollywood studios"];
  if (t.includes("dak") || t.includes("animal")) return PARK_IDS["animal kingdom"];
  if (t.includes("epcot")) return PARK_IDS["epcot"];
  return null;
}

async function fetchParkTimes(parkId) {
  const key = `park:${parkId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `https://queue-times.com/en-US/parks/${parkId}/queue_times.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`QueueTimes ${parkId} HTTP ${r.status}`);
  const json = await r.json();
  cache.set(key, json);
  return json;
}

// fuzzy ride search across one or all parks
async function findRideWaits(query) {
  const want = (query || "").toLowerCase();
  const parkHint = guessParkId(want);
  const parksToCheck = parkHint ? [parkHint] : Object.values(PARK_IDS);

  const hits = [];
  for (const id of parksToCheck) {
    try {
      const data = await fetchParkTimes(id);
      const lands = Array.isArray(data.lands) ? data.lands : [];
      for (const land of lands) {
        for (const ride of land.rides || []) {
          const rn = (ride.name || "").toLowerCase();
          const match =
            rn.includes(want) ||
            (want.length >= 4 && rn.split(/[^\w]+/).some(w => want.includes(w)));
          if (match) {
            hits.push({
              parkId: id,
              parkName:
                Object.entries(PARK_IDS).find(([, v]) => v === id)?.[0] ?? `Park ${id}`,
              ride: ride.name || "Unknown",
              wait: Number.isFinite(ride.wait_time) ? ride.wait_time : null,
              open: ride.is_open ?? null,
              updated: ride.last_updated || null
            });
          }
        }
      }
    } catch {
      // ignore per-park failures
    }
  }
  return hits;
}

// -------- Chat endpoint --------
app.post("/chat", async (req, res) => {
  try {
    // App token (so only your app can call it)
    if (APP_TOKEN && req.headers.authorization !== `Bearer ${APP_TOKEN}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body || {};
    let { messages, forceSearch } = body;
    messages = Array.isArray(messages) ? messages : [];

    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const query = cleanQuery(lastUser);

    // Decide if we want web search and/or queue times
    const wantsQueues = /wait|queue|line|how busy|standby|mins?/i.test(query);
    const shouldSearch = !!forceSearch || wantsSearch(lastUser);

    let webContext = null;
    let queueSnippets = null;

    if (wantsQueues) {
      const rides = await findRideWaits(query);
      if (rides.length) {
        queueSnippets = rides.slice(0, 8).map(r => {
          const w = r.wait == null ? "n/a" : `${r.wait} min`;
          const o = r.open === false ? " (closed)" : "";
          return `• ${capitalize(r.parkName)} — ${r.ride}: ${w}${o}${r.updated ? ` (updated ${r.updated})` : ""}`;
        }).join("\n");
      }
    }

    if (shouldSearch) {
      webContext = await getLiveContext(query);
    }

    console.log("[/chat]",
      "forceSearch:", !!forceSearch,
      "autoSearch:", wantsSearch(lastUser),
      "queues:", !!queueSnippets,
      "webSources:", webContext?.sources?.length || 0,
      "q:", query
    );

    // Build system message with any pre-fetched context
    const systemParts = [];
    systemParts.push(
      "You are Attractions Answers: an expert on Orlando parks, rides, shows, and tourism. " +
      "When live context is provided below, it has ALREADY been fetched for you — use it. " +
      "Do NOT say you cannot browse."
    );

    if (queueSnippets) {
      systemParts.push(
        "Live ride waits (these numbers change frequently; present as current estimates):\n" +
        queueSnippets
      );
    }

    if (webContext) {
      systemParts.push(
        `Web context for "${query}":\n` +
        `SUMMARY:\n${webContext.summary}\n` +
        `SOURCES:\n${webContext.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n")}`
      );
    }

    // Encourage citing links when web context exists
    systemParts.push(
      (webContext || queueSnippets)
        ? "If web context was provided, end with a brief 'Sources:' list of 1–3 links when applicable."
        : "If no live context is provided, answer from general knowledge and note any uncertainty."
    );

    const systemMsg = { role: "system", content: systemParts.join("\n\n") };

    // Call OpenAI
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [systemMsg, ...messages]
      })
    });

    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Proxy error" });
  }
});

// -------- Listen (Render will use npm start) --------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Proxy listening on", PORT));
