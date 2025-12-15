import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const LP_ESI_FILE = path.join(ROOT, "cache", "lp_esi_offers.json");
const TYPES_FILE = path.join(ROOT, "SDE", "types.jsonl");
const OUT_DIR = path.join(ROOT, "cache");
const DEFAULT_REGIONS = [10000002]; // The Forge (Jita)
const UA = "EveGem/LP-Market";
const DELAY_MS = parseInt(process.env.LP_MARKET_DELAY || "250", 10);
const CONCURRENCY = parseInt(process.env.LP_MARKET_CONC || "5", 10);
const MAX_PAGES = 10; // safety guard per type/orderType

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadOffers() {
  const raw = await readFile(LP_ESI_FILE, "utf8").catch(() => null);
  if (!raw) {
    throw new Error(`Нет исходных офферов: ${LP_ESI_FILE}. Сначала запусти npm run lp-esi`);
  }
  return JSON.parse(raw);
}

async function loadMarketableTypes() {
  const raw = await readFile(TYPES_FILE, "utf8").catch(() => null);
  if (!raw) return null;
  const ids = new Set();
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const obj = JSON.parse(line);
    if (obj.marketGroupID) ids.add(obj._key || obj.typeID);
  }
  return ids;
}

function collectTypeIds(esiData) {
  const ids = new Set();
  for (const entry of esiData) {
    if (!entry?.offers) continue;
    for (const o of entry.offers) {
      ids.add(o.type_id);
      (o.required_items || []).forEach((ri) => ids.add(ri.type_id));
    }
  }
  return Array.from(ids);
}

async function fetchPaged(url, opts = {}) {
  const results = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}page=${page}`, {
      headers: { "User-Agent": UA, ...(opts.headers || {}) },
    });
    if (res.status === 400) {
      // not tradable or invalid type for this endpoint
      return [];
    }
    if (res.status === 404) return [];
    if (res.status === 420 || res.status === 429 || res.status >= 500) {
      await sleep(1000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    const data = await res.json();
    results.push(...data);
    const pages = Number(res.headers.get("x-pages") || "1");
    if (page >= pages || page >= MAX_PAGES) break;
    page += 1;
    await sleep(DELAY_MS);
  }
  return results;
}

async function fetchOrders(regionId, typeId, orderType) {
  const url = `https://esi.evetech.net/latest/markets/${regionId}/orders/?order_type=${orderType}&type_id=${typeId}`;
  const orders = await fetchPaged(url);
  if (!orders.length) {
    return { min: null, max: null, count: 0 };
  }
  let min = null;
  let max = null;
  for (const o of orders) {
    if (min === null || o.price < min) min = o.price;
    if (max === null || o.price > max) max = o.price;
  }
  return { min, max, count: orders.length };
}

async function fetchHistory(regionId, typeId) {
  const url = `https://esi.evetech.net/latest/markets/${regionId}/history/?type_id=${typeId}`;
  const days = await fetchPaged(url);
  return days;
}

function summarizeHistory(days, window) {
  const slice = days.slice(-window);
  if (!slice.length) return { avg: null, volumePerDay: null };
  let volumeSum = 0;
  let weightedSum = 0;
  for (const d of slice) {
    volumeSum += d.volume || 0;
    weightedSum += (d.average || 0) * (d.volume || 0);
  }
  const avg = volumeSum ? weightedSum / volumeSum : null;
  const volumePerDay = volumeSum / slice.length;
  return { avg, volumePerDay };
}

async function buildRegion(regionId, typeIds) {
  console.log(`Собираю рынок для региона ${regionId}, типов: ${typeIds.length}, concurrency=${CONCURRENCY}`);
  const types = {};
  let idx = 0;

  async function handle(typeId) {
    idx += 1;
    if (idx % 10 === 0 || idx === typeIds.length) {
      process.stdout.write(`\r${idx}/${typeIds.length} processed`);
    }
    let sells = { min: null, max: null, count: 0 };
    let buys = { min: null, max: null, count: 0 };
    let history = [];
    try {
      [sells, buys, history] = await Promise.all([
        fetchOrders(regionId, typeId, "sell"),
        fetchOrders(regionId, typeId, "buy"),
        fetchHistory(regionId, typeId),
      ]);
    } catch {
      return;
    }
    const h14 = summarizeHistory(history, 14);
    const h7 = summarizeHistory(history, 7);
    const h1 = summarizeHistory(history, 1);
    const h30 = summarizeHistory(history, 30);
    const spread = sells.min && buys.max ? (sells.min - buys.max) / sells.min : null;
    types[typeId] = {
      sellMin: sells.min,
      sellCount: sells.count,
      buyMax: buys.max,
      buyCount: buys.count,
      spread,
      avg1: h1.avg,
      vol1: h1.volumePerDay,
      avg7: h7.avg,
      vol7: h7.volumePerDay,
      avg14: h14.avg,
      vol14: h14.volumePerDay,
      avg30: h30.avg,
      vol30: h30.volumePerDay,
    };
    await sleep(DELAY_MS);
  }

  const queue = [...typeIds];
  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.pop();
      await handle(next);
    }
  });
  await Promise.all(runners);
  process.stdout.write("\n");
  const out = {
    regionId,
    updated: new Date().toISOString(),
    types,
  };
  const outFile = path.join(OUT_DIR, `lp_market_${regionId}.json`);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(outFile, JSON.stringify(out, null, 2));
  console.log(`Готово: ${outFile}`);
}

async function run() {
  const regions = (process.env.LP_MARKET_REGIONS || "")
    .split(/[,; ]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);
  const regionIds = regions.length ? regions : DEFAULT_REGIONS;

  const esiData = await loadOffers();
  let typeIds = collectTypeIds(esiData);
  const marketable = await loadMarketableTypes();
  if (marketable) {
    typeIds = typeIds.filter((id) => marketable.has(id));
    console.log(`Отфильтровано по marketGroupID: осталось ${typeIds.length} типов`);
  }

  for (const r of regionIds) {
    await buildRegion(r, typeIds);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
