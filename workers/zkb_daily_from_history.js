import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const DAILY_DIR = path.join(ROOT, "cache", "zkb_daily");
const REQUEST_TIMEOUT_MS = 10000;
let CONCURRENCY = 4;
let MAX_KILLS = 0; // 0 = без лимита
// временно жёстко используем дату 2025-12-10
const DATE_ARG = "2025-12-10";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function formatDateIso(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function yyyymmdd(iso) {
  return iso.replace(/-/g, "");
}

async function fetchJSON(url, retries = 6) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { "User-Agent": "EveLocalMarket/1.0" },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.status === 429) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(800 * attempt);
    }
  }
  return null;
}

async function fetchHistory(dateIso) {
  const url = `https://zkillboard.com/api/history/${yyyymmdd(dateIso)}.json`;
  let data = null;
  try {
    data = await fetchJSON(url, 6);
  } catch (err) {
    throw new Error(`history fetch failed: ${err.message || err}`);
  }
  if (!data) return [];
  if (Array.isArray(data)) return data; // (старый формат)
  if (typeof data === "object") {
    // формат: { "killId": "hash" }
    return Object.keys(data).map((k) => `${k}:${data[k]}`);
  }
  return [];
}

async function fetchKill(killId) {
  const url = `https://zkillboard.com/api/killID/${killId}/`;
  const data = await fetchJSON(url, 3);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

async function processDay(dateIso) {
  await mkdir(DAILY_DIR, { recursive: true });
  const outFile = path.join(DAILY_DIR, `${dateIso}.json`);
  if (await fileExists(outFile)) {
    console.log(`[${dateIso}] уже есть, пропускаю.`);
    return;
  }

  console.log(`[${dateIso}] загружаю history...`);
  let history;
  try {
    history = await fetchHistory(dateIso);
  } catch (err) {
    console.error(`[${dateIso}] ошибка загрузки history: ${err.message || err}`);
    return;
  }
  if (!history.length) {
    console.log(`[${dateIso}] history пустая, пишу пустой файл.`);
    await writeFile(outFile, "{}");
    return;
  }

  const killEntries = history
    .map((s) => {
      const [idStr] = String(s).split(":");
      const id = parseInt(idStr, 10);
      return Number.isFinite(id) ? id : null;
    })
    .filter(Boolean);

  const totalKills = MAX_KILLS > 0 ? Math.min(killEntries.length, MAX_KILLS) : killEntries.length;
  console.log(`[${dateIso}] killID в истории: ${killEntries.length}, обрабатываю: ${totalKills}, concurrency: ${CONCURRENCY}`);

  let processed = 0;
  const agg = new Map(); // systemID -> {ships, isk}

  let index = 0;
  async function worker() {
    while (index < totalKills) {
      const current = index++;
      const killId = killEntries[current];
      try {
        const km = await fetchKill(killId);
        const sys = km?.victim?.solarSystemID;
        if (sys) {
          const value = km?.zkb?.totalValue || 0;
          const prev = agg.get(sys) || { ships: 0, isk: 0 };
          prev.ships += 1;
          prev.isk += value;
          agg.set(sys, prev);
        }
      } catch (err) {
        process.stdout.write(`\n[${dateIso}] error on kill ${killId}: ${err.message || err}\n`);
      }
      processed++;
      if (processed % 50 === 0 || processed === totalKills) {
        const pct = ((processed / totalKills) * 100).toFixed(1);
        process.stdout.write(`\r[${dateIso}] processed ${processed}/${totalKills} (${pct}%), systems ${agg.size}`);
      }
      await sleep(200); // щадим zKB
    }
  }

  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker());
  await Promise.all(workers);

  const obj = Object.fromEntries(agg.entries());
  await writeFile(outFile, JSON.stringify(obj));
  process.stdout.write(`\n[${dateIso}] done: kills ${processed}, systems ${agg.size}\n`);
}

async function run() {
  if (!DATE_ARG) {
    console.error("Укажите дату: --date=YYYY-MM-DD (или ZKB_DATE). Пример: node workers/zkb_daily_from_history.js --date=2025-12-10");
    process.exit(1);
  }

  // нормализуем дату
  const d = new Date(DATE_ARG);
  if (Number.isNaN(d.getTime())) {
    console.error("Неверная дата в ZKB_DATE, нужен формат YYYY-MM-DD.");
    process.exit(1);
  }
  d.setUTCHours(0, 0, 0, 0);
  const iso = formatDateIso(d);

  await processDay(iso);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
