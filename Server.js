import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// -------- ENV --------
const APP_TOKEN = process.env.APP_TOKEN;                // your app-side secret (sent in Authorization header)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;      // your OpenAI API key (sk-...)
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;      // optional; if not set, we use free fallback

// -------- Helpers --------
function wantsSearch(text) {
  const t = (text || "").toLowerCase();
  return (
    /^search[:\s]/i.test(t) ||
    /\b(look up|web ?search|what('|’)s new|latest|today|news|breaking)\b/i.test(t)
  );
}
function cleanQuery(text) {
  return (text || "").replace(/^search[:\s]*/i, "").trim();
}
function clamp(str, n = 1200) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n) + "…" : str;
}

// -------- Tavily (preferred if key present) --------
async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return null;
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: "basic",      // 1 credit
      max_results: 5,
      include_answer: true,
      include_raw_content: true
    })
  });
  if (!r.ok) throw new Error(`Tavily error ${r.status}`);
  const data = await r.json();

  const items = (data.results || []).map((it, i) =>
    `#${i + 1} ${it.title}\n${clamp(it.content || it.snippet || "")}\nSource: ${it.url}`
  );
  const answer = data.answer ? `\nSummary: ${data.answer}` : "";
  return `Live web results for: "${query}"\n\n${items.join("\n\n")}${answer}`;
}

// -------- Free fallback (DuckDuckGo + Wikipedia) --------
async function freeFallbackSearch(query) {
  // DuckDuckGo Instant Answer
  const ddg = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  ).then(r => r.json());

  const chunks = [];
  if (ddg.AbstractText) {
    chunks.push(
      `DuckDuckGo Abstract:\n${clamp(ddg.AbstractText)}\nSource: ${ddg.AbstractURL || "https://duckduckgo.com/"}`
    );
  }

  const rt = Array.isArray(ddg.RelatedTopics) ? ddg.RelatedTopics : [];
  const firstLink =
    rt.find(x => x && x.Text && x.FirstURL) ||
    (rt[0] && rt[0].Topics ? rt[0].Topics.find(t => t.Text && t.FirstURL) : null);
  if (firstLink) {
    chunks.push(`Related:\n${clamp(firstLink.Text)}\nSource: ${firstLink.FirstURL}`);
  }

  // Wikipedia summary
  let wikiTitle = null;
  if (ddg.AbstractURL && ddg.AbstractURL.includes("wikipedia.org/wiki/")) {
    wikiTitle = decodeURIComponent(ddg.AbstractURL.split("/wiki/")[1] || "");
  } else if (query.length < 120) {
    wikiTitle = query.trim().replace(/\s+/g, "_");
  }
  if (wikiTitle) {
    const wiki = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
    ).then(r => (r.ok ? r.json() : null));
    if (wiki && wiki.extract) {
      chunks.push(
        `Wikipedia:\n${clamp(wiki.extract)}\nSource: ${wiki.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${wikiTitle}`}`
      );
    }
  }

  if (!chunks.length) chunks.push("No free search snippets found.");
  return `Live web (free fallback) for: "${query}"\n\n${chunks.join("\n\n")}`;
}

// -------- Wrapper to choose Tavily or fallback --------
async function getLiveContext(query) {
  try {
    const t = await tavilySearch(query);
    if (t) return t;
  } catch (e) {
    console.error("Tavily failed:", e.message);
  }
  try {
    return await freeFallbackSearch(query);
  } catch (e) {
    console.error("Free fallback failed:", e.message);
    return null;
  }
}

// -------- Route --------
app.post("/chat", async (req, res) => {
  try {
    // Simple auth so only your app can use this proxy
    if (APP_TOKEN && req.headers.authorization !== `Bearer ${APP_TOKEN}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let { messages } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages[] required" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing on server" });
    }

    // Detect search intent on the latest user message
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    let webContext = null;
    if (wantsSearch(lastUser)) {
      const q = cleanQuery(lastUser);
      webContext = await getLiveContext(q);
    }

    // Build final message list for OpenAI
    const finalMessages = [
      {
        role: "system",
        content:
          "You are Attractions Answers: an expert on Orlando theme parks, rides, shows, crowd strategy, and local tourism. " +
          "If 'Live web' context is provided below, use it and cite the sources explicitly."
      },
      ...(webContext ? [{ role: "system", content: webContext }] : []),
      ...messages
    ];

    // Call OpenAI Chat Completions
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: finalMessages
      })
    });

    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Proxy error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on ${PORT}`));
