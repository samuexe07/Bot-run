require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));

const { GITHUB_TOKEN } = process.env;
const MAHMUD_TOKEN = process.env.MAHMUD_TOKEN || GITHUB_TOKEN;
const PORT = process.env.PORT || 3000;

if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN set korte hobe.");
  process.exit(1);
}

const TARGETS = {
  fb: { owner: "samuexe07", repo: "Messenger-pro", path: "account.txt", token: GITHUB_TOKEN, msg: "Update Facebook cookie from web" },
  wp: { owner: "samuexe07", repo: "WhatsApp-bot-v2", path: "account.txt", token: GITHUB_TOKEN, msg: "Update WhatsApp session from web" },
  api: { owner: "mahmud-aura", repo: "HINATA", path: "baseApiUrl.json", token: MAHMUD_TOKEN, msg: "Update API URL via web" },
};

const ghUrl = (t) => `https://api.github.com/repos/${t.owner}/${t.repo}/contents/${t.path}`;
const ghHeaders = (t) => ({ Authorization: `token ${t.token}`, Accept: "application/vnd.github.v3+json" });
const errMsg = (e) => e.response?.data?.message || e.message;

app.get("/keys", async (req, res) => {
  const t = TARGETS.api;
  try {
    const { data: cur } = await axios.get(ghUrl(t), { headers: ghHeaders(t) });
    res.json(JSON.parse(Buffer.from(cur.content, "base64").toString("utf-8")));
  } catch (e) {
    res.status(500).json({ error: errMsg(e) });
  }
});

app.post("/push", async (req, res) => {
  const { platform, data } = req.body;
  const key = req.body.key || "mahmud";
  const t = TARGETS[platform];
  if (!t) return res.status(400).json({ error: "Platform vul." });
  if (!data || !String(data).trim()) return res.status(400).json({ error: "Data dite hobe." });

  try {
    const { data: cur } = await axios.get(ghUrl(t), { headers: ghHeaders(t) });
    let content;
    if (platform === "api") {
      const json = JSON.parse(Buffer.from(cur.content, "base64").toString("utf-8"));
      if (!(key in json)) return res.status(400).json({ error: `"${key}" key file-e nai.` });
      const url = data.trim();
      if (Array.isArray(json[key])) {
        json[key] = key === "mahmud" ? [url] : [...new Set([...json[key], url])];
      } else {
        json[key] = url;
      }
      content = Buffer.from(JSON.stringify(json, null, 2)).toString("base64");
    } else {
      content = Buffer.from(data).toString("base64");
    }
    await axios.put(ghUrl(t), { message: t.msg, content, sha: cur.sha }, { headers: ghHeaders(t) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: errMsg(e) });
  }
});

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(PORT, () => console.log("Push Panel running on port " + PORT));
