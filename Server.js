// server.js
// Environment vars you should set on Render:
//   OPENAI_API_KEY=sk-...      (required for /chat)
//   APP_TOKEN=your-secret       (optional; protects /chat if you want)
// No key needed for /qt/* endpoints.

import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const APP_TOKEN = process.env.APP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---- helpers
function requireAppToken(req, res, next) {
  if (!APP_TOKEN) return next();
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${APP_TOKEN}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ---- health
app.get("/health", (req, res) => res.json({ ok: true }));

// ---- OpenAI chat proxy
app.post("/chat", requireAppToken, async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { messages, model } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages[] required" });
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are Attractions Answers: an expert on Orlando parks, rides, shows, and tourism. Be concise and helpful.",
          },
          ...messages,
        ],
      }),
    });

    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error("chat error:", e);
    res.status(500).json({ error: "Proxy error" });
  }
});

// ---- Queue-Times proxy (no auth required so iOS ATS won’t block your app)
// List all resorts + parks
app.get("/qt/parks", async (req, res) => {
  try {
    const r = await fetch("https://queue-times.com/en-US/parks.json", {
      headers: { Accept: "application/json" },
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error("qt/parks error:", e);
    res.status(500).json({ error: "Proxy error" });
  }
});

// Rides / wait times for a given parkId (Queue-Times numeric id)
app.get("/qt/rides", async (req, res) => {
  try {
    const parkId = req.query.parkId;
    if (!parkId) {
      return res.status(400).json({ error: "parkId required" });
    }
    const url = `https://queue-times.com/en-US/parks/${encodeURIComponent(
      parkId
    )}/queue_times.json`;

    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error("qt/rides error:", e);
    res.status(500).json({ error: "Proxy error" });
  }
});

// ---- start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Attractions proxy listening on port ${PORT}`);
});
