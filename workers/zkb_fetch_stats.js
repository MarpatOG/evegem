import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const SYSTEMS_FILE = path.join(ROOT, "cache", "json", "systems_staticdata.json");
const OUT_DIR = path.join(ROOT, "cache", "zkb_stats");
const REQUEST_TIMEOUT_MS = 10000;
const SLEEP_MS = 1200;
const SYS_LIMIT = process.env.ZKB_SYS_LIMIT ? parseInt(process.env.ZKB_SYS_LIMIT, 10) : null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadSystems() {
  const raw = await readFile(SYSTEMS_FILE, "utf8");
  const all = Object.keys(JSON.parse(raw)).map(Number);
  return SYS_LIMIT ? all.slice(0, SYS_LIMIT) : all;
}

async function fetchJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url, { headers: { "User-Agent": "EveLocalMarket/1.0" }, signal: controller.signal });
      clearTimeout(timeout);
      if (res.status === 429) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { return {}; }
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(1000 * attempt);
    }
  }
  return null;
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const systems = await loadSystems();
  console.log(`Fetching all-time stats for ${systems.length} systems`);
  let idx = 0;
  let lastGc = Date.now();

  for (const id of systems) {
    idx++;
    const url = `https://zkillboard.com/api/stats/solarSystemID/${id}/`;
    try {
      const data = await fetchJSON(url);
      await writeFile(path.join(OUT_DIR, `${id}.json`), JSON.stringify(data || {}));
    } catch (err) {
      await writeFile(path.join(OUT_DIR, `${id}.json`), "{}");
      process.stdout.write(`\nError on ${id}: ${err.message || err}\n`);
    }
    if (idx % 10 === 0 || idx === systems.length) {
      const pct = ((idx / systems.length) * 100).toFixed(1);
      process.stdout.write(`\r${idx}/${systems.length} (${pct}%)`);
    }
    if (global.gc && Date.now() - lastGc > 10000) {
      global.gc();
      lastGc = Date.now();
    }
    await sleep(SLEEP_MS);
  }
  console.log("\nDone.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
