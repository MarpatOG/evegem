import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const REGION_ID = Number(process.env.REGION_ID || 10000002); // The Forge
const DAYS = Math.max(3, Math.min(90, Number(process.env.DAYS || 90)));

const ITEMS_FILE = path.join(ROOT, "json", "lp_items.json");
const HISTORY_DIR = path.join(ROOT, "cache", "esi_history", String(REGION_ID));

const OUT_FILE = path.join(ROOT, "json", `market_history_${REGION_ID}_${DAYS}d.json`);

async function fileAgeHours(p) {
  try {
    const s = await stat(p);
    return (Date.now() - s.mtimeMs) / (1000 * 60 * 60);
  } catch {
    return null;
  }
}

function tailSeries(historyData, days) {
  const sorted = (historyData || [])
    .filter((d) => d && typeof d.date === "string")
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const tail = sorted.slice(-days);
  return tail.map((d) => ({
    date: d.date,
    average: typeof d.average === "number" ? d.average : null,
    volume: typeof d.volume === "number" ? d.volume : null,
  }));
}

async function run() {
  console.log(`[pages_export_market_history] region=${REGION_ID} days=${DAYS}`);

  const itemsRaw = await readFile(ITEMS_FILE, "utf8");
  const items = (JSON.parse(itemsRaw).items || []).map((x) => Number(x.itemId)).filter((x) => Number.isFinite(x));
  const uniqueTypeIds = Array.from(new Set(items)).sort((a, b) => a - b);
  console.log(`[pages_export_market_history] types: ${uniqueTypeIds.length}`);

  const seriesByType = {};
  let ok = 0;
  let missing = 0;

  for (let i = 0; i < uniqueTypeIds.length; i++) {
    const typeId = uniqueTypeIds[i];
    const file = path.join(HISTORY_DIR, `${typeId}.json`);
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed?.data) { missing++; continue; }
      seriesByType[String(typeId)] = tailSeries(parsed.data, DAYS);
      ok++;
    } catch {
      missing++;
    }
    if ((i + 1) % 250 === 0 || i === uniqueTypeIds.length - 1) {
      process.stdout.write(`\r[pages_export_market_history] ${i + 1}/${uniqueTypeIds.length} ok=${ok} missing=${missing}`);
    }
  }
  process.stdout.write("\n");

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const out = {
    regionId: REGION_ID,
    days: DAYS,
    updated: new Date().toISOString(),
    source: "cache/esi_history",
    seriesByType,
  };
  await writeFile(OUT_FILE, JSON.stringify(out));

  const age = await fileAgeHours(OUT_FILE);
  console.log(`[pages_export_market_history] wrote ${path.relative(ROOT, OUT_FILE)} (ageHours=${age?.toFixed(2) ?? "?"})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

