require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "2mb" }));

const { GITHUB_TOKEN, ADMIN_PASSWORD } = process.env;
const MAHMUD_TOKEN = process.env.MAHMUD_TOKEN || GITHUB_TOKEN;
const PORT = process.env.PORT || 3000;

if (!GITHUB_TOKEN || !ADMIN_PASSWORD) {
  console.error("GITHUB_TOKEN ar ADMIN_PASSWORD set korte hobe.");
  process.exit(1);
}

const TARGETS = {
  fb: { owner: "samuexe07", repo: "Messenger-pro", path: "account.txt", token: GITHUB_TOKEN, msg: "Update Facebook cookie from web" },
  wp: { owner: "samuexe07", repo: "WhatsApp-bot-v2", path: "account.txt", token: GITHUB_TOKEN, msg: "Update WhatsApp session from web" },
  api: { owner: "mahmud-aura", repo: "HINATA", path: "baseApiUrl.json", token: MAHMUD_TOKEN, msg: "Update API URLs via web" },
};

const sessions = new Set();
const fails = new Map();

function safeEq(a, b) {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

app.post("/login", (req, res) => {
  const ip = req.ip;
  const f = fails.get(ip) || { n: 0, t: Date.now() };
  if (f.n >= 5 && Date.now() - f.t < 10 * 60 * 1000) {
    return res.status(429).json({ error: "Onek bar vul. 10 minute pore chesta korun." });
  }
  if (!safeEq(String(req.body.password || ""), ADMIN_PASSWORD)) {
    fails.set(ip, { n: f.n + 1, t: Date.now() });
    return res.status(401).json({ error: "Password vul." });
  }
  fails.delete(ip);
  const s = crypto.randomBytes(24).toString("hex");
  sessions.add(s);
  res.json({ session: s });
});

function auth(req, res, next) {
  if (!sessions.has(req.headers["x-session"])) return res.status(401).json({ error: "Login korun." });
  next();
}

app.post("/push", auth, async (req, res) => {
  const { platform, data } = req.body;
  const t = TARGETS[platform];
  if (!t) return res.status(400).json({ error: "Platform vul." });
  if (!data || !String(data).trim()) return res.status(400).json({ error: "Data dite hobe." });

  const url = `https://api.github.com/repos/${t.owner}/${t.repo}/contents/${t.path}`;
  const headers = { Authorization: `token ${t.token}`, Accept: "application/vnd.github.v3+json" };

  try {
    const { data: cur } = await axios.get(url, { headers });
    let content;
    if (platform === "api") {
      const json = JSON.parse(Buffer.from(cur.content, "base64").toString("utf-8"));
      json.mahmud = [data.trim()];
      json.mahmudexe = data.trim();
      content = Buffer.from(JSON.stringify(json, null, 2)).toString("base64");
    } else {
      content = Buffer.from(data).toString("base64");
    }
    await axios.put(url, { message: t.msg, content, sha: cur.sha }, { headers });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.get("/", (_, res) => res.type("html").send(PAGE));
app.listen(PORT, () => console.log("Push Panel running on port " + PORT));

const PAGE = `<!doctype html>
<html lang="bn"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Push Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
:root{--bg:#0f1420;--card:#171e2e;--line:#2a3550;--tx:#e8ecf5;--mut:#8b97b3;--fb:#4f8cff;--wp:#2fd27a;--api:#ffb02e;--ac:var(--fb)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--tx);font-family:'Space Grotesk',system-ui,sans-serif;display:flex;justify-content:center;padding:20px}
.wrap{width:100%;max-width:560px}
h1{font-size:28px;margin:12px 0 4px;letter-spacing:-.5px}
p.sub{color:var(--mut);margin:0 0 22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}
.tabs{display:flex;gap:8px;margin-bottom:16px}
.tab{flex:1;padding:12px 6px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--mut);font-weight:600;font-size:15px;font-family:inherit;cursor:pointer}
.tab.on{color:#0b0f19;border-color:transparent}
.tab[data-p=fb].on{background:var(--fb)}.tab[data-p=wp].on{background:var(--wp)}.tab[data-p=api].on{background:var(--api)}
label{display:block;font-size:14px;color:var(--mut);margin-bottom:8px}
textarea,input{width:100%;background:#0c111c;border:1px solid var(--line);border-radius:12px;color:var(--tx);padding:12px;font-family:'JetBrains Mono',monospace;font-size:13px}
textarea{min-height:200px;resize:vertical}
textarea:focus,input:focus{outline:2px solid var(--ac);outline-offset:1px}
button.go{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:var(--ac);color:#0b0f19;font:700 16px 'Space Grotesk',sans-serif;cursor:pointer}
button.go:disabled{opacity:.5}
.msg{margin-top:14px;padding:12px;border-radius:12px;font-size:14px;display:none}
.msg.ok{display:block;background:#12301f;color:#7df0b0}
.msg.err{display:block;background:#3a1620;color:#ff9aae}
.out{background:none;border:0;color:var(--mut);cursor:pointer;float:right;font-family:inherit}
</style></head><body>
<div class="wrap">
<h1>Push Panel</h1>
<p class="sub">Bot off thakleo cookie, session ba API URL update korun.</p>

<div class="card" id="login">
<label for="pw">Admin password</label>
<input id="pw" type="password" autocomplete="current-password">
<button class="go" id="loginBtn">Login</button>
<div class="msg" id="lmsg"></div>
</div>

<div class="card" id="panel" style="display:none">
<button class="out" id="logout">Logout</button>
<div class="tabs">
<button class="tab on" data-p="fb">Facebook</button>
<button class="tab" data-p="wp">WhatsApp</button>
<button class="tab" data-p="api">API URL</button>
</div>
<label for="data" id="lbl">Facebook JSON cookie</label>
<textarea id="data" spellcheck="false"></textarea>
<button class="go" id="push">Push to GitHub</button>
<div class="msg" id="msg"></div>
</div>
</div>
<script>
const $=id=>document.getElementById(id);
let session=sessionStorage.getItem("s")||"", platform="fb";
const labels={fb:"Facebook JSON cookie",wp:"WhatsApp session",api:"Notun API URL"};
const colors={fb:"--fb",wp:"--wp",api:"--api"};
function show(el,cls,t){el.className="msg "+cls;el.textContent=t}
function view(){ $("login").style.display=session?"none":"block"; $("panel").style.display=session?"block":"none" }
view();
$("loginBtn").onclick=async()=>{
  const r=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:$("pw").value})});
  const j=await r.json();
  if(!r.ok) return show($("lmsg"),"err",j.error);
  session=j.session; sessionStorage.setItem("s",session); view();
};
$("pw").onkeydown=e=>{if(e.key==="Enter")$("loginBtn").click()};
$("logout").onclick=()=>{session="";sessionStorage.removeItem("s");view()};
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("on"));
  b.classList.add("on"); platform=b.dataset.p;
  $("lbl").textContent=labels[platform];
  document.documentElement.style.setProperty("--ac","var("+colors[platform]+")");
  $("msg").className="msg";
});
$("push").onclick=async()=>{
  const btn=$("push"); btn.disabled=true; btn.textContent="Pushing...";
  try{
    const r=await fetch("/push",{method:"POST",headers:{"Content-Type":"application/json","x-session":session},body:JSON.stringify({platform,data:$("data").value})});
    const j=await r.json();
    if(r.status===401){session="";sessionStorage.removeItem("s");view();return}
    if(!r.ok) show($("msg"),"err","Update hoyni: "+j.error);
    else {show($("msg"),"ok","Update hoyeche. Bot cholte kichu minute lagte pare."); $("data").value="";}
  }catch(e){show($("msg"),"err","Network error: "+e.message)}
  btn.disabled=false; btn.textContent="Push to GitHub";
};
</script></body></html>`;
