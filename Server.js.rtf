{\rtf1\ansi\ansicpg1252\cocoartf2865
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 import express from "express";\
import fetch from "node-fetch";\
\
const app = express();\
app.use(express.json());\
\
// optional app token so only your app can call this proxy\
const APP_TOKEN = process.env.APP_TOKEN;\
\
app.post("/chat", async (req, res) => \{\
  try \{\
    if (APP_TOKEN && req.headers.authorization !== `Bearer $\{APP_TOKEN\}`) \{\
      return res.status(401).json(\{ error: "Unauthorized" \});\
    \}\
\
    const \{ messages \} = req.body;\
    if (!messages || !Array.isArray(messages)) \{\
      return res.status(400).json(\{ error: "messages[] required" \});\
    \}\
\
    const r = await fetch("https://api.openai.com/v1/chat/completions", \{\
      method: "POST",\
      headers: \{\
        "Authorization": `Bearer $\{process.env.OPENAI_API_KEY\}`,\
        "Content-Type": "application/json"\
      \},\
      body: JSON.stringify(\{\
        model: "gpt-4o-mini",\
        messages: [\
          \{ role: "system", content: "You are Attractions Answers: an expert on Orlando parks, rides, shows, and tourism. Be concise and helpful." \},\
          ...messages\
        ]\
      \})\
    \});\
\
    const data = await r.json();\
    return res.status(r.ok ? 200 : r.status).json(data);\
  \} catch (e) \{\
    console.error(e);\
    res.status(500).json(\{ error: "Proxy error" \});\
  \}\
\});\
\
const PORT = process.env.PORT || 3000;\
app.listen(PORT, () => console.log(`Proxy running on $\{PORT\}`));}