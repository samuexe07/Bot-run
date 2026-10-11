/**
 * accounts-route.js
 * Adds GET /accounts -> status of every account file (valid / expired / empty / unknown)
 *
 * Usage in your server file (Express):
 *   const registerAccounts = require("./accounts-route.js");
 *   registerAccounts(app);                 // uses env vars below
 *   // or plug in your own GitHub reader:
 *   registerAccounts(app, { getFile: async (name) => "file text or null" });
 *
 * Env vars used by the default GitHub reader (change names if yours differ):
 *   GITHUB_TOKEN   - token with repo read access
 *   GITHUB_REPO    - "owner/repo"
 *   GITHUB_BRANCH  - branch name (default "main")
 *   GITHUB_PATH    - optional folder inside the repo (default "" = repo root)
 *
 * Needs Node 18+ (built-in fetch). No extra packages.
 */

const ACCOUNT_FILES = ["account.txt", "account2.txt", "account3.txt"]; // keep same as index.html
const CACHE_TTL = 2 * 60 * 1000; // real Facebook checks are cached for 2 minutes

const cache = new Map(); // file -> { result, time }

// Default reader: raw file from the GitHub repo. Returns null if the file does not exist.
async function githubGetFile(name) {
	const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = "main", GITHUB_PATH = "" } = process.env;
	if (!GITHUB_TOKEN || !GITHUB_REPO)
		throw new Error("GITHUB_TOKEN / GITHUB_REPO env vars are not set");
	const filePath = [GITHUB_PATH.replace(/^\/|\/$/g, ""), name].filter(Boolean).join("/");
	const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
		headers: {
			Authorization: `Bearer ${GITHUB_TOKEN}`,
			Accept: "application/vnd.github.raw+json",
			"User-Agent": "hinata-account-status"
		}
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`GitHub ${res.status}`);
	return await res.text();
}

// Cookie file (JSON array/appstate or "k=v; k=v" text) -> cookie string
function toCookieString(raw) {
	raw = (raw || "").trim();
	try {
		const json = JSON.parse(raw);
		const arr = Array.isArray(json) ? json : (json.cookies || []);
		return arr.map(c => `${c.key || c.name}=${c.value}`).join("; ");
	}
	catch (e) {
		return raw.replace(/\n/g, "; ");
	}
}

async function checkFile(file, getFile, force) {
	const old = cache.get(file);
	if (!force && old && Date.now() - old.time < CACHE_TTL)
		return old.result;

	let result;
	try {
		const raw = await getFile(file);
		if (!raw || !raw.trim())
			result = { file, state: "empty" };
		else {
			const cookie = toCookieString(raw);
			const uid = (cookie.match(/c_user=(\d+)/) || [])[1];

			// Basic check: c_user and xs must exist
			if (!uid || !/xs=/.test(cookie))
				result = { file, state: "expired", detail: "c_user or xs missing" };
			else {
				// Real check: ask Facebook if this cookie is still logged in
				let state = "unknown", name = null, detail = "";
				try {
					const res = await fetch("https://www.facebook.com/", {
						headers: {
							cookie,
							"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
							"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
							"accept-language": "en-US,en;q=0.9",
							"upgrade-insecure-requests": "1",
							"sec-fetch-dest": "document",
							"sec-fetch-mode": "navigate",
							"sec-fetch-site": "none",
							"sec-fetch-user": "?1"
						},
						redirect: "follow",
						signal: AbortSignal.timeout(20000)
					});
					const html = await res.text();
					const finalUrl = res.url || "";

					const loggedIn = html.includes(`"USER_ID":"${uid}"`)
						|| html.includes(`"actorID":"${uid}"`)
						|| /"DTSGInitialData",\[\],\{"token":"[^"]+"/.test(html);
					const loggedOut = /checkpoint|\/login/i.test(finalUrl)
						|| /"USER_ID"\s*:\s*"0"/.test(html)
						|| html.includes('id="login_form"')
						|| html.includes('name="login"');

					state = loggedIn ? "valid" : loggedOut ? "expired" : "unknown";
					const m = html.match(/"NAME":"([^"]+)"/); // best effort, may not exist
					if (m) {
						try { name = JSON.parse(`"${m[1]}"`); } catch (e) { name = m[1]; }
					}
					detail = `status=${res.status}`;
				}
				catch (e) {
					detail = `request error: ${e.name === "TimeoutError" ? "timeout" : e.message}`;
				}
				result = { file, state, name: name || `UID ${uid}`, detail };
			}
		}
	}
	catch (e) {
		result = { file, state: "unknown", detail: e.message };
	}

	cache.set(file, { result, time: Date.now() });
	return result;
}

module.exports = function registerAccounts(app, options = {}) {
	const getFile = options.getFile || githubGetFile;
	const files = options.files || ACCOUNT_FILES;

	app.get("/accounts", async (req, res) => {
		try {
			const force = req.query.force === "1";
			const list = await Promise.all(files.map(f => checkFile(f, getFile, force)));
			res.json(list);
		}
		catch (e) {
			res.status(500).json({ error: e.message });
		}
	});

	// Optional: whitelist helper for your /push route
	// const file = registerAccounts.safeFile(req.body.file);  // -> "account2.txt" or "account.txt"
};

module.exports.safeFile = function (name) {
	return ACCOUNT_FILES.includes(name) ? name : ACCOUNT_FILES[0];
};
