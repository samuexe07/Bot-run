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

// Facebook account files in the Messenger-pro repo (keep same as index.html)
const ACCOUNT_FILES = ["account.txt", "account2.txt", "account3.txt"];

const ghUrl = (t) => `https://api.github.com/repos/${t.owner}/${t.repo}/contents/${t.path}`;
const ghHeaders = (t) => ({ Authorization: `token ${t.token}`, Accept: "application/vnd.github.v3+json" });
const errMsg = (e) => e.response?.data?.message || e.message;

// ———————————————— ACCOUNT STATUS (valid / expired / empty) ———————————————— //
const CACHE_TTL = 2 * 60 * 1000; // real Facebook checks are cached for 2 minutes
const statusCache = new Map(); // file -> { result, time }

// Read an account file from the Messenger-pro repo. Returns null if the file does not exist.
async function getAccountFile(file) {
  const t = { ...TARGETS.fb, path: file };
  try {
    const { data } = await axios.get(ghUrl(t), { headers: ghHeaders(t) });
    return Buffer.from(data.content || "", "base64").toString("utf-8");
  } catch (e) {
    if (e.response?.status === 404) return null;
    throw e;
  }
}

// Cookie file (JSON array/appstate or "k=v; k=v" text) -> cookie string
function toCookieString(raw) {
  raw = (raw || "").trim();
  try {
    const json = JSON.parse(raw);
    const arr = Array.isArray(json) ? json : (json.cookies || []);
    return arr.map((c) => `${c.key || c.name}=${c.value}`).join("; ");
  } catch (e) {
    return raw.replace(/\n/g, "; ");
  }
}

async function checkAccountFile(file, force) {
  const old = statusCache.get(file);
  if (!force && old && Date.now() - old.time < CACHE_TTL) return old.result;

  let result;
  try {
    const raw = await getAccountFile(file);
    if (!raw || !raw.trim()) {
      result = { file, state: "empty" };
    } else {
      const cookie = toCookieString(raw);
      const uid = (cookie.match(/c_user=(\d+)/) || [])[1];

      // Basic check: c_user and xs must exist
      if (!uid || !/xs=/.test(cookie)) {
        result = { file, state: "expired", detail: "c_user or xs missing" };
      } else {
        // Real check: ask Facebook if this cookie is still logged in
        let state = "unknown", name = null, detail = "";
        try {
          const res = await axios.get("https://www.facebook.com/", {
            headers: {
              cookie,
              "user-agent": "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
              "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
              "accept-language": "en-US,en;q=0.9",
              "upgrade-insecure-requests": "1",
              "sec-fetch-dest": "document",
              "sec-fetch-mode": "navigate",
              "sec-fetch-site": "none",
              "sec-fetch-user": "?1",
            },
            timeout: 20000,
            maxRedirects: 5,
            validateStatus: () => true,
          });
          const html = String(res.data || "");
          const finalUrl = res.request?.res?.responseUrl || "";

          // Explicit "logged out" signals first, these take priority over everything else
          const loggedOut = /checkpoint|\/login/i.test(finalUrl)
            || /"USER_ID"\s*:\s*"0"/.test(html)
            || html.includes('id="login_form"')
            || html.includes('name="login"')
            || html.includes('m_login_email')
            || /"require_login"\s*:\s*true/.test(html);

          // Known "logged in" signals (these change over time, so we keep several)
          const loggedInPatterns = [
            `"USER_ID":"${uid}"`,
            `"actorID":"${uid}"`,
            `"ACCOUNT_ID":"${uid}"`,
            `"IG_USER_EOI":"${uid}"`,
            new RegExp(`"USER_ID"\\s*:\\s*"${uid}"`),
            /"DTSGInitialData",\[\],\{"token":"[^"]+"/,
          ];
          const loggedInExplicit = loggedInPatterns.some((p) =>
            p instanceof RegExp ? p.test(html) : html.includes(p)
          );

          const sizeFallback = !loggedOut && !loggedInExplicit && html.length > 80000;
          const loggedIn = loggedInExplicit || sizeFallback;
          state = loggedOut ? "expired" : loggedIn ? "valid" : "unknown";

          // Improved Name extraction matching multiple patterns used by Facebook SSR data
          const namePatterns = [
            /"NAME":"([^"]+)"/,
            /"name":"([^"]+)"/,
            /"USER_NAME":"([^"]+)"/,
            /\\?"name\\?":\\?"([^"\\]+)\\?"/
          ];
          
          for (const pattern of namePatterns) {
            const m = html.match(pattern);
            if (m && m[1]) {
              try { 
                name = JSON.parse(`"${m[1]}"`); 
                break;
              } catch (e) { 
                name = m[1]; 
                break;
              }
            }
          }

          detail = `status=${res.status} len=${html.length} final=${finalUrl.slice(0, 60)}${sizeFallback ? " (size-fallback)" : ""}`;
        } catch (e) {
          detail = `request error: ${e.code || e.message}`;
        }
        result = { file, state, name: name || `UID ${uid}`, detail };
      }
    }
  } catch (e) {
    result = { file, state: "unknown", detail: errMsg(e) };
  }

  statusCache.set(file, { result, time: Date.now() });
  return result;
}

app.get("/accounts", async (req, res) => {
  try {
    const force = req.query.force === "1";
    const list = await Promise.all(ACCOUNT_FILES.map((f) => checkAccountFile(f, force)));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: errMsg(e) });
  }
});

// ———————————————————————————— KEYS ———————————————————————————— //
app.get("/keys", async (req, res) => {
  const t = TARGETS.api;
  try {
    const { data: cur } = await axios.get(ghUrl(t), { headers: ghHeaders(t) });
    res.json(JSON.parse(Buffer.from(cur.content, "base64").toString("utf-8")));
  } catch (e) {
    res.status(500).json({ error: errMsg(e) });
  }
});

// ———————————————————————————— PUSH ———————————————————————————— //
app.post("/push", async (req, res) => {
  const { platform, data } = req.body;
  const key = req.body.key || "mahmud";
  const baseTarget = TARGETS[platform];
  if (!baseTarget) return res.status(400).json({ error: "Platform vul." });
  if (!data || !String(data).trim()) return res.status(400).json({ error: "Data dite hobe." });

  let t = baseTarget;
  if (platform === "fb") {
    const file = req.body.file || "account.txt";
    if (!ACCOUNT_FILES.includes(file)) return res.status(400).json({ error: `"${file}" allowed na.` });
    t = { ...baseTarget, path: file };
  }

  try {
    let cur = null;
    try {
      cur = (await axios.get(ghUrl(t), { headers: ghHeaders(t) })).data;
    } catch (e) {
      if (!(platform === "fb" && e.response?.status === 404)) throw e;
    }

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

    const body = { message: platform === "fb" ? `Update Facebook cookie (${t.path}) from web` : t.msg, content };
    if (cur?.sha) body.sha = cur.sha;
    await axios.put(ghUrl(t), body, { headers: ghHeaders(t) });

    if (platform === "fb") statusCache.delete(t.path);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: errMsg(e) });
  }
});

// ————————————————— AUTO SWITCH ————————————————— //
const AUTO_ENABLED = process.env.AUTO_SWITCH !== "0";
const AUTO_INTERVAL = 2 * 60 * 1000;
const BACKUP_RETRY = 5 * 60 * 1000;
const MAIN_FILE = "account.txt";
const BACKUP_FILES = ["account2.txt", "account3.txt"];

let autoBusy = false;
let backupsFailedAt = 0;
const autoLog = [];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  autoLog.unshift(line);
  if (autoLog.length > 50) autoLog.length = 50;
}

async function putAccountFile(file, content, message) {
  const t = { ...TARGETS.fb, path: file };
  let sha;
  try {
    sha = (await axios.get(ghUrl(t), { headers: ghHeaders(t) })).data.sha;
  } catch (e) {
    if (e.response?.status !== 404) throw e;
  }
  const body = { message, content: Buffer.from(content).toString("base64") };
  if (sha) body.sha = sha;
  await axios.put(ghUrl(t), body, { headers: ghHeaders(t) });
  statusCache.delete(file);
}

async function autoSwitch() {
  if (autoBusy) return;
  autoBusy = true;
  try {
    const main = await checkAccountFile(MAIN_FILE, true);

    if (main.state !== "expired" && main.state !== "empty") {
      backupsFailedAt = 0;
      return;
    }
    if (Date.now() - backupsFailedAt < BACKUP_RETRY) return;

    log(`${MAIN_FILE} is ${main.state}, backup khujchi...`);
    for (const f of BACKUP_FILES) {
      const r = await checkAccountFile(f, true);
      if (r.state === "valid") {
        const raw = await getAccountFile(f);
        await putAccountFile(MAIN_FILE, raw, `Auto switch: ${f} -> ${MAIN_FILE}`);
        await putAccountFile(f, "", `Clear ${f} after move to ${MAIN_FILE}`);
        log(`✅ ${f} (${r.name}) ${MAIN_FILE} e move kora hoise, ${f} khali kora hoise`);
        backupsFailedAt = 0;
        return;
      }
      log(`${f} is ${r.state}, skip`);
    }
    backupsFailedAt = Date.now();
    log("❌ kono backup valid na. Notun cookie push koro.");
  } catch (e) {
    log("auto switch error: " + errMsg(e));
  } finally {
    autoBusy = false;
  }
}

app.get("/autolog", (_, res) => res.json(autoLog));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log("Push Panel running on port " + PORT);
  if (AUTO_ENABLED) {
    setInterval(autoSwitch, AUTO_INTERVAL);
    autoSwitch();
  }
});
