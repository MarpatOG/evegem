import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const SNAPSHOT_DIR = path.join(ROOT, "cache", "zkb_stats_daily");
const OUT_FILE = path.join(ROOT, "cache", "zkb_stats_delta.json");

function isoDaysBack(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function listSnapshotDates() {
  try {
    const files = await readdir(SNAPSHOT_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort();
  } catch {
    return [];
  }
}

async function loadSnapshot(dateStr) {
  const file = path.join(SNAPSHOT_DIR, `${dateStr}.json`);
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw);
}

function nearest(dateIso, dates) {
  let chosen = null;
  for (const d of dates) {
    if (d <= dateIso) chosen = d;
    else break;
  }
  return chosen;
}

function previousBefore(dateIso, dates) {
  let prev = null;
  for (const d of dates) {
    if (d < dateIso) prev = d;
    else break;
  }
  return prev;
}

async function run() {
  const dates = await listSnapshotDates();
  if (!dates.length) {
    console.error("Нет снапшотов в cache/zkb_stats_daily");
    return;
  }

  const todayIso = isoDaysBack(0);
  const d7Iso = isoDaysBack(7);
  const d30Iso = isoDaysBack(30);

  const todayKey = nearest(todayIso, dates);
  const d7Key = nearest(d7Iso, dates) || previousBefore(todayIso, dates) || todayKey;
  const d30Key = nearest(d30Iso, dates) || previousBefore(todayIso, dates) || d7Key || todayKey;

  if (!todayKey) {
    console.error("Не найден актуальный (today) снапшот.");
    return;
  }

  console.log(`Использую снапшоты: today=${todayKey}, d7=${d7Key}, d30=${d30Key}`);
  const [snapToday, snap7, snap30] = await Promise.all([
    loadSnapshot(todayKey),
    loadSnapshot(d7Key),
    loadSnapshot(d30Key)
  ]);

  const delta = {};
  const ids = new Set([
    ...Object.keys(snapToday),
    ...Object.keys(snap7),
    ...Object.keys(snap30)
  ]);

  let processed = 0;
  for (const id of ids) {
    const cur = snapToday[id] || { ships: 0, isk: 0 };
    const past7 = snap7[id] || { ships: 0, isk: 0 };
    const past30 = snap30[id] || { ships: 0, isk: 0 };
    delta[id] = {
      ships7: Math.max(0, cur.ships - past7.ships),
      isk7: Math.max(0, cur.isk - past7.isk),
      ships30: Math.max(0, cur.ships - past30.ships),
      isk30: Math.max(0, cur.isk - past30.isk)
    };
    processed++;
    if (processed % 2000 === 0) {
      const pct = ((processed / ids.size) * 100).toFixed(1);
      process.stdout.write(`\r${processed}/${ids.size} (${pct}%)`);
    }
  }
  console.log(`\nГотово, записываю ${Object.keys(delta).length} систем в ${OUT_FILE}`);
  await writeFile(OUT_FILE, JSON.stringify(delta));
  console.log("Done.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
