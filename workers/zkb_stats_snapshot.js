import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const SYSTEMS_FILE = path.join(ROOT, "cache", "json", "systems_staticdata.json");
const STATS_DIR = path.join(ROOT, "cache", "zkb_stats");
const SNAPSHOT_DIR = path.join(ROOT, "cache", "zkb_stats_daily");
const SYS_LIMIT = process.env.ZKB_SYS_LIMIT ? parseInt(process.env.ZKB_SYS_LIMIT, 10) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function loadSystems() {
  const raw = await readFile(SYSTEMS_FILE, "utf8");
  const all = Object.keys(JSON.parse(raw)).map(Number);
  return SYS_LIMIT ? all.slice(0, SYS_LIMIT) : all;
}

function todayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function loadStatCached(id) {
  const file = path.join(STATS_DIR, `${id}.json`);
  if (!(await fileExists(file))) return null;
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function run() {
  const systems = await loadSystems();
  const outDate = todayIso();
  const outFile = path.join(SNAPSHOT_DIR, `${outDate}.json`);

  await mkdir(SNAPSHOT_DIR, { recursive: true });

  const snapshot = {};
  console.log(`Building daily snapshot for ${systems.length} systems -> ${outFile}`);

  let idx = 0;
  for (const id of systems) {
    idx++;
    const data = await loadStatCached(id);
    const shipsDestroyed = data?.shipsDestroyed ?? 0;
    const iskDestroyed = data?.iskDestroyed ?? 0;
    snapshot[id] = { ships: shipsDestroyed, isk: iskDestroyed };

    if (idx % 500 === 0 || idx === systems.length) {
      const pct = ((idx / systems.length) * 100).toFixed(1);
      process.stdout.write(`\r${idx}/${systems.length} (${pct}%)`);
    }

    // tiny pause to avoid hammering disk aggressively
    if (idx % 2000 === 0) {
      await sleep(50);
    }
  }

  await writeFile(outFile, JSON.stringify(snapshot));
  console.log(`\nSnapshot written: ${Object.keys(snapshot).length} systems`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
