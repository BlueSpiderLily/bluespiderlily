// Builds dashboard.svg from live GitHub data. Run locally or from the scheduled Action.
// Only positive, verifiable numbers are shown: languages, SVMCheck size, recent work.
// Output is deterministic (no timestamps), so the file only changes when the data does.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "profile.config.json"), "utf8"));
const headers = { "User-Agent": "profile-dashboard", Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const api = async (path) => {
  const r = await fetch(path.startsWith("http") ? path : `https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const wrap = (text, max) => {
  const out = []; let line = "";
  for (const w of text.split(/\s+/)) {
    if ((line + " " + w).trim().length > max) { out.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
};

// ---------- data ----------
let languages = [];
try {
  const repos = (await api(`/users/${cfg.user}/repos?per_page=100`)).filter((r) => !r.fork && !cfg.excludeRepos.includes(r.name));
  const totals = {};
  for (const r of repos) for (const [k, v] of Object.entries(await api(r.languages_url))) totals[k] = (totals[k] || 0) + v;
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  languages = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, cfg.topLanguages).map(([name, v]) => ({ name, pct: (v / sum) * 100 }));
} catch (e) { console.warn("languages: using fallback", e.message); }
if (!languages.length) languages = [{ name: "C++", pct: 95 }, { name: "C", pct: 3 }, { name: "Assembly", pct: 2 }];

let svm = { ...cfg.svmcheckFallback };
try {
  const dir = mkdtempSync(join(tmpdir(), "svm-"));
  // Anonymous clone (no stored credentials, no prompt): a private repo fails here on purpose,
  // so a local run and the scheduled Action both fall back to the saved numbers in the config.
  execFileSync("git", ["-c", "credential.helper=", "clone", "--depth", "1", "--quiet", `https://github.com/${cfg.user}/${cfg.featuredRepo}.git`, dir], {
    stdio: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const files = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" }).split("\n").filter((f) => /\.(cpp|h|hpp|asm)$/.test(f));
  let lines = 0;
  for (const f of files) lines += readFileSync(join(dir, f), "utf8").split("\n").length;
  svm = { lines, files: files.length, testSuites: files.filter((f) => /Tests\.cpp$/.test(f)).length };
  rmSync(dir, { recursive: true, force: true });
} catch (e) { console.warn("svmcheck stats: using fallback", e.message); }

let commits = [];
try {
  const hide = (cfg.hideCommits || []).map((p) => new RegExp(p, "i"));
  commits = (await api(`/repos/${cfg.user}/${cfg.featuredRepo}/commits?per_page=20`))
    .map((c) => ({ date: c.commit.author.date.slice(0, 10), msg: c.commit.message.split("\n")[0] }))
    .filter((c) => !hide.some((re) => re.test(c.msg)))
    .slice(0, 3);
} catch (e) { console.warn("commits: skipped", e.message); }

// ---------- drawing helpers ----------
const W = 1280, PAD = 24, COL = 400, GAP = 24;
const colX = (i) => PAD + i * (COL + GAP);
const SANS = "'Segoe UI',Inter,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace";
let defs = "", body = "", delay = 0.2;

const card = (x, y, w, h, title) => {
  const d = (delay += 0.12).toFixed(2);
  return `<g opacity="0"><animate attributeName="opacity" from="0" to="1" begin="${d}s" dur="0.5s" fill="freeze"/>
<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="10" fill="#0a0c10" stroke="#1c242d"/>
<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="2" rx="1" fill="url(#accent)" opacity="0.85"/>
<text x="${x + 22}" y="${y + 34}" fill="#7d8794" font-family="${MONO}" font-size="12" letter-spacing="2.2">${esc(title.toUpperCase())}</text>`;
};
const end = () => "</g>\n";

// ---------- layout ----------
const ROW1 = 24, GRID_Y = 24;
let y;

// Column 1: languages, toolbox
const langH = 70 + languages.length * 44;
body += card(colX(0), GRID_Y, COL, langH, "Languages · code I write");
languages.forEach((l, i) => {
  const by = GRID_Y + 66 + i * 44, bw = 352, fill = Math.max(6, (l.pct / 100) * (bw - 70));
  body += `<text x="${colX(0) + 22}" y="${by}" fill="#eceff3" font-family="${SANS}" font-size="15" font-weight="600">${esc(l.name)}</text>
<text x="${colX(0) + 22 + bw}" y="${by}" fill="#9fb2c8" font-family="${MONO}" font-size="13" text-anchor="end">${l.pct.toFixed(1)}%</text>
<rect x="${colX(0) + 22}" y="${by + 9}" width="${bw}" height="6" rx="3" fill="#161b23"/>
<rect x="${colX(0) + 22}" y="${by + 9}" width="0" height="6" rx="3" fill="url(#accent)"><animate attributeName="width" from="0" to="${(l.pct / 100) * bw}" begin="${(0.5 + i * 0.2).toFixed(2)}s" dur="1.1s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1"/></rect>`;
});
body += end();

y = GRID_Y + langH + GAP;
// toolbox chips
{
  const x0 = colX(0) + 22, maxX = colX(0) + COL - 22;
  let cx = x0, cy = y + 56, rows = 1, chips = "";
  for (const t of cfg.toolbox) {
    const w = Math.round(t.length * 7.4 + 22);
    if (cx + w > maxX) { cx = x0; cy += 34; rows++; }
    chips += `<rect x="${cx}" y="${cy - 17}" width="${w}" height="26" rx="4" fill="#0e1218" stroke="#1c242d"/><text x="${cx + 11}" y="${cy}" fill="#c9d1db" font-family="${MONO}" font-size="12">${esc(t)}</text>`;
    cx += w + 8;
  }
  const h = 56 + rows * 34 + 10;
  body += card(colX(0), y, COL, h, "Toolbox") + chips + end();
  y += h;
}
const col1End = y;

// Column 2: SVMCheck at a glance, recent activity
{
  const h = 205;
  body += card(colX(1), GRID_Y, COL, h, `${cfg.featuredRepo}${cfg.featuredStatus ? ` · ${cfg.featuredStatus}` : " · AMD SVM hypervisor"}`);
  const nums = [
    [svm.lines.toLocaleString("en-US"), "lines of code"],
    [String(svm.files), "source files"],
    [String(svm.testSuites), "test suites"],
    [cfg.svmcheckChecks, "host-side checks"],
  ];
  nums.forEach(([n, label], i) => {
    const nx = colX(1) + 22 + (i % 2) * 188, ny = GRID_Y + 92 + Math.floor(i / 2) * 58;
    body += `<text x="${nx}" y="${ny}" fill="url(#name)" font-family="${SANS}" font-size="34" font-weight="800" letter-spacing="-1">${esc(n)}</text>
<text x="${nx}" y="${ny + 18}" fill="#7d8794" font-family="${MONO}" font-size="11" letter-spacing="1.4">${esc(label.toUpperCase())}</text>`;
  });
  body += end();

  y = GRID_Y + h;
  // "Recent work" reads the featured repo's public commits. A private repo has none to read,
  // so the card is simply left out instead of showing an empty box.
  if (commits.length) {
    const ay = y + GAP;
    const rowsData = commits.map((c) => ({ ...c, lines: wrap(c.msg, 50).slice(0, 2) }));
    const ah = 56 + rowsData.reduce((a, r) => a + 24 + r.lines.length * 19, 0) + 8;
    body += card(colX(1), ay, COL, Math.max(ah, 120), "Recent work");
    let ry = ay + 66;
    for (const r of rowsData) {
      body += `<circle cx="${colX(1) + 28}" cy="${ry - 5}" r="3.5" fill="#4d8dff"/><text x="${colX(1) + 42}" y="${ry}" fill="#7d8794" font-family="${MONO}" font-size="11">${esc(r.date)}</text>`;
      r.lines.forEach((ln, k) => { body += `<text x="${colX(1) + 42}" y="${ry + 20 + k * 19}" fill="#dfe5ec" font-family="${SANS}" font-size="14">${esc(ln + (k === 1 && wrap(r.msg, 50).length > 2 ? "…" : ""))}</text>`; });
      ry += 24 + r.lines.length * 19;
    }
    body += end();
    y = ay + Math.max(ah, 120);
  }
  // Design notes: short, fixed highlights from the project's design write-up.
  if (cfg.designNotes && cfg.designNotes.length) {
    const ny = y + GAP, nh = 56 + cfg.designNotes.length * 30 + 10;
    body += card(colX(1), ny, COL, nh, "Design notes");
    cfg.designNotes.forEach((t, i) => {
      body += `<text x="${colX(1) + 22}" y="${ny + 66 + i * 30}" fill="#c9d1db" font-family="${SANS}" font-size="14.5"><tspan fill="#ff2bd6">›</tspan> ${esc(t)}</text>`;
    });
    body += end();
    y = ny + nh;
  }
}
const col2End = y;

// Column 3: talk, write-ups, education
{
  let cy = GRID_Y;
  const t = cfg.talks[0];
  const tl = wrap(t.title, 40);
  const th = 62 + tl.length * 22 + 52;
  body += card(colX(2), cy, COL, th, "Talk");
  tl.forEach((ln, i) => { body += `<text x="${colX(2) + 22}" y="${cy + 66 + i * 22}" fill="#eceff3" font-family="${SANS}" font-size="16" font-weight="600">${esc(ln)}</text>`; });
  body += `<text x="${colX(2) + 22}" y="${cy + 66 + tl.length * 22 + 14}" fill="#7d8794" font-family="${MONO}" font-size="12">${esc(t.where)} · ${esc(t.when)}</text>` + end();
  cy += th + GAP;

  const wh = 56 + cfg.writeups.length * 30 + 10;
  body += card(colX(2), cy, COL, wh, "Write-ups · GuidedHacking");
  cfg.writeups.forEach((w, i) => { body += `<text x="${colX(2) + 22}" y="${cy + 66 + i * 30}" fill="#c9d1db" font-family="${SANS}" font-size="14.5"><tspan fill="#ff2bd6">›</tspan> ${esc(w)}</text>`; });
  body += end();
  cy += wh + GAP;

  const eh = 112;
  body += card(colX(2), cy, COL, eh, "Education");
  body += `<text x="${colX(2) + 22}" y="${cy + 68}" fill="#eceff3" font-family="${SANS}" font-size="17" font-weight="600">${esc(cfg.education.school)}</text>
<text x="${colX(2) + 22}" y="${cy + 90}" fill="#9fb2c8" font-family="${SANS}" font-size="14">${esc(cfg.education.program)} · ${esc(cfg.education.when)}</text>` + end();
  cy += eh;
  var col3End = cy;
}

const H = Math.max(col1End, col2End, col3End) + PAD;
// even out: stretch nothing; just size the canvas to the tallest column
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Dashboard. Languages: ${languages.map((l) => `${l.name} ${l.pct.toFixed(0)} percent`).join(", ")}. ${cfg.featuredRepo}: ${svm.lines} lines of code across ${svm.files} source files and ${svm.testSuites} test suites. Talk at ${cfg.talks[0].where}. Toolbox: ${cfg.toolbox.join(", ")}.">
<defs>
<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4d8dff"/><stop offset="1" stop-color="#ff2bd6"/></linearGradient>
<linearGradient id="name" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7aa8ff"/><stop offset="1" stop-color="#ff5be0"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="#050505"/>
<g stroke="#4d8dff" stroke-opacity="0.04">${Array.from({ length: Math.ceil(W / 64) + 1 }, (_, i) => `<path d="M${i * 64} 0V${H}"/>`).join("")}${Array.from({ length: Math.ceil(H / 64) + 1 }, (_, i) => `<path d="M0 ${i * 64}H${W}"/>`).join("")}</g>
${body}</svg>`;

writeFileSync(join(root, "dashboard.svg"), svg);
console.log(`dashboard.svg ${svg.length} bytes | langs: ${languages.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", ")} | svm: ${JSON.stringify(svm)} | commits: ${commits.length}`);
