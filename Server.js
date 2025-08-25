// server.js
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APP_TOKEN = process.env.APP_TOKEN || "";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ""; // optional but recommended

// --- simple health check
app.get("/health", (req, res) => res.json({ ok: true }));

// --- tiny helpers ---
const wantsSearch = (txt = "") => {
  const t = txt.toLowerCase();
  return (
    t.startsWith("search:") ||
    t.includes("latest") || t.includes("today") || t.includes("tonight") ||
    t.includes("this week") || t.includes("news") ||
    t.includes("look up") || t.includes("find") || t.includes("hours")
  );
};

const cleanQuery = (txt = "") => {
  const t = txt.trim();
  return t.toLowerCase().startsWith("search:") ? t.slice(7).trim() : t;
};

// --- getLiveContext: Tavily first, free fallback second ---
async function getLiveContext(query) {
  if (!query) return null;

  // 1) Tavily (best quality)
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
          sources: data.results.map(x => ({
            title: x.title || "",
            url: x.url || ""
          }))
        };
      }
    } catch (e) {
      console.error("Tavily error:", e.message);
    }
  }

  // 2) Free fallback: DuckDuckGo Lite (no key)
  try {
    const u = new URL("https://duckduckgo.com/html/");
    u.searchParams.set("q", query);
    const r = await fetch(u.toString(), { method: "GET" });
    const html = await r.text();
    // Extremely light parse: pull first 3 results
    // (This is intentionally simple; it still gives titles/links.)
    const results = [];
    const regex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let m;
    while ((m = regex.exec(html)) && results.length < 3) {
      const url = m[1].replace(/^\/l\/\?kh=-1&uddg=/, "");
      const title = m[2].replace(/<[^>]+>/g, "");
      results.push({ title, url: decodeURIComponent(url) });
    }
    if (results.length) {
      return {
        summary: `Top results for: ${query}`,
        sources: results
      };
    }
  } catch (e) {
    console.error("DDG fallback error:", e.message);
  }

  return null;
}

app.post("/chat", async (req, res) => {
  try {
    // Auth (so only your app can call this)
    if (APP_TOKEN && req.headers.authorization !== `Bearer ${APP_TOKEN}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body || {};
    let { messages, forceSearch } = body;
    messages = Array.isArray(messages) ? messages : [];

    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const shouldSearch = !!forceSearch || wantsSearch(lastUser);
    const query = cleanQuery(lastUser);
    console.log("[/chat] forceSearch:", !!forceSearch, "auto:", wantsSearch(lastUser), "query:", query);

    let webContext = null;
    if (shouldSearch) {
      webContext = await getLiveContext(query);
      console.log("[/chat] webContext sources:", webContext?.sources?.length || 0);
    }

    // Important: tell the model we’ve ALREADY fetched info (don’t “refuse to browse”)
    const systemPrefix =
      "You are Attractions Answers: an expert on Orlando parks, rides, shows, and tourism. " +
      "When web context is provided, treat it as pre-fetched research and cite what it says in natural language. " +
      "Do NOT say you cannot browse; you are being handed the relevant excerpts already.";

    const webNote = webContext
      ? `\n\nWeb context for the user query "${query}":\n` +
        `SUMMARY:\n${webContext.summary}\n` +
        `SOURCES:\n${webContext.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n")}\n`
      : "";

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // or "gpt-4o-mini-2024-07-18" if you prefer pinned
        messages: [
          { role: "system", content: systemPrefix + webNote },
          ...messages
        ]
      })
    });

    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Proxy error" });
  }
});

// --- start server (Render will use npm start)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Proxy listening on", PORT));
