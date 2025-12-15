import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const DAILY_DIR = path.join(ROOT, "cache", "zkb_daily");
const DAYS_BACK = parseInt(process.env.ZKB_DAYS || "30", 10); // сколько дней проверяем/догружаем
const REQUEST_TIMEOUT_MS = 10000;
const LOG_HIT_STEP = 10; // как часто писать прогресс даже при кеш-хитах

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function dayRange(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  return {
    start: start.toISOString().slice(0, 19).replace("T", " "),
    end: end.toISOString().slice(0, 19).replace("T", " "),
    dir: dateStr
  };
}

function pastDates(daysBack) {
  const res = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    res.push(d.toISOString().slice(0, 10));
  }
  return res;
}

async function fetchDayAggregated(dateStr) {
  // page through /api/kills/date/YYYYMMDD/?zkbOnly=true
  const yyyymmdd = dateStr.replace(/-/g, "");
  const totals = new Map(); // systemId -> {ships, isk}
  let page = 1;
  let totalKills = 0;
  while (true) {
    const url = `https://zkillboard.com/api/kills/date/${yyyymmdd}/?zkbOnly=true&page=${page}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url, { headers: { "User-Agent": "EveLocalMarket/1.0" }, signal: controller.signal });
      clearTimeout(timeout);
      if (res.status === 429) { await sleep(2000); continue; }
      if (!res.ok) break;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      for (const km of data) {
        const sys = km?.victim?.solar_system_id;
        if (!sys) continue;
        const val = km?.zkb?.totalValue || 0;
        const prev = totals.get(sys) || { ships: 0, isk: 0 };
        prev.ships += 1;
        prev.isk += val;
        totals.set(sys, prev);
      }
      totalKills += data.length;
      if (page % 5 === 0) process.stdout.write(`\r[${dateStr}] page ${page}, kills ${totalKills}, systems ${totals.size}`);
      if (data.length < 200) break;
      page++;
      await sleep(500);
    } catch (err) {
      process.stdout.write(`\n[${dateStr}] error on page ${page}: ${err.message || err}\n`);
      break;
    }
  }
  const obj = Object.fromEntries(totals.entries());
  process.stdout.write(`\r[${dateStr}] done: kills ${totalKills}, systems ${totals.size}          \n`);
  return obj;
}

async function run() {
  const dates = pastDates(DAYS_BACK);
  console.log(`Проверяю/дозагружаю ${dates.length} дней (агрегация по дням)`);

  for (const dateStr of dates) {
    const outFile = path.join(DAILY_DIR, `${dateStr}.json`);
    if (await fileExists(outFile)) {
      console.log(`[${dateStr}] уже есть, пропускаю`);
      continue;
    }
    console.log(`\n[${dateStr}] загружаю суточные киллы...`);
    await mkdir(DAILY_DIR, { recursive: true });
    const agg = await fetchDayAggregated(dateStr);
    await writeFile(outFile, JSON.stringify(agg));
  }
  console.log("Daily kills fetch complete.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
