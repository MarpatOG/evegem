import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const REGION_ID = Number(process.env.REGION_ID || 10000002);
const DAYS = Math.max(3, Math.min(90, Number(process.env.DAYS || 90)));
const BASKET_LIMIT = Math.max(5, Math.min(40, Number(process.env.BASKET_LIMIT || 25)));

const CORPS_FILE = path.join(ROOT, "json", "lp_corps.json");
const OFFERS_FILE = path.join(ROOT, "json", "lp_offers.json");
const ITEMS_CFG_FILE = path.join(ROOT, "config", "lp_items_config.json");
const HISTORY_DIR = path.join(ROOT, "cache", "esi_history", String(REGION_ID));

const OUT_DIR = path.join(ROOT, "json", "lp_corp_index", String(REGION_ID));

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function lastDaysList(days) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function loadHiddenItemIds() {
  try {
    const raw = await readFile(ITEMS_CFG_FILE, "utf8");
    const cfg = JSON.parse(raw);
    const out = new Set();
    for (const [id, v] of Object.entries(cfg?.items || {})) {
      if (v?.hide) out.add(Number(id));
    }
    return out;
  } catch {
    return new Set();
  }
}

async function loadHistoryFromDisk(typeId) {
  const file = path.join(HISTORY_DIR, `${typeId}.json`);
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw);
}

async function existsFresh(file, ttlHours) {
  try {
    const s = await stat(file);
    const ageHours = (Date.now() - s.mtimeMs) / (1000 * 60 * 60);
    return ageHours < ttlHours;
  } catch {
    return false;
  }
}

async function buildCorpIndex(corpId, offersByCorp, hiddenItems) {
  const offers = (offersByCorp[String(corpId)] || []).filter((o) => !hiddenItems.has(Number(o.itemId)));
  if (!offers.length) return null;

  const scored = offers
    .filter((o) => o.lpCost > 0 && o.qty > 0)
    .map((o) => {
      const vol = DAYS <= 14 ? (o.volumePerDay14 ?? o.volumePerDay ?? 0) : (o.volumePerDay30 ?? o.volumePerDay ?? 0);
      const score = (o.iskPerLp ?? 0) * vol;
      return { o, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, BASKET_LIMIT)
    .map((x) => x.o);

  if (!scored.length) return { corpId, regionId: REGION_ID, days: DAYS, series: [], meta: { basketSize: 0, basketLimit: BASKET_LIMIT, generated: new Date().toISOString() } };

  const typeIds = new Set();
  for (const o of scored) {
    typeIds.add(Number(o.itemId));
    for (const r of o.requiredItems || []) typeIds.add(Number(r.typeId));
  }

  const histories = new Map();
  const typeList = Array.from(typeIds).filter((x) => Number.isFinite(x));
  for (const typeId of typeList) {
    try {
      const h = await loadHistoryFromDisk(typeId);
      if (!h?.data) continue;
      histories.set(typeId, new Map(h.data.map((d) => [d.date, d])));
    } catch {
      // missing history for this type
    }
  }

  const dates = lastDaysList(DAYS);

  // compute weights (fixed on period)
  const basket = [];
  for (const o of scored) {
    const hItem = histories.get(Number(o.itemId));
    if (!hItem) continue;
    const values = [];
    const vols = [];
    for (const date of dates) {
      const day = hItem.get(date);
      if (!day) continue;
      const sell = day.average;
      const vol = day.volume;
      if (typeof sell !== "number") continue;
      const reqs = o.requiredItems || [];
      let reqCost = 0;
      let ok = true;
      for (const r of reqs) {
        const hReq = histories.get(Number(r.typeId));
        const dReq = hReq?.get(date);
        if (!dReq || typeof dReq.average !== "number") { ok = false; break; }
        reqCost += dReq.average * Number(r.qty || 0);
      }
      if (!ok) continue;
      const revenue = sell * Number(o.qty || 1);
      const net = revenue - Number(o.iskCost || 0) - reqCost;
      const v = net / Number(o.lpCost || 1);
      if (!Number.isFinite(v)) continue;
      values.push(v);
      vols.push(typeof vol === "number" ? vol : 0);
    }
    const base = avg(values);
    const avgVol = avg(vols);
    if (base == null || avgVol == null) continue;
    const weight = Math.max(0, base) * Math.max(0, avgVol);
    if (!weight || !Number.isFinite(weight)) continue;
    basket.push({ itemId: Number(o.itemId), weight });
  }

  const weightSum = basket.reduce((s, b) => s + b.weight, 0);
  if (!weightSum) {
    return { corpId, regionId: REGION_ID, days: DAYS, series: [], meta: { basketSize: 0, basketLimit: BASKET_LIMIT, generated: new Date().toISOString() } };
  }

  const series = [];
  for (const date of dates) {
    let sum = 0;
    let wUsed = 0;
    for (const b of basket) {
      const hItem = histories.get(Number(b.itemId));
      const day = hItem?.get(date);
      if (!day || typeof day.average !== "number") continue;
      const offer = scored.find((x) => Number(x.itemId) === Number(b.itemId));
      if (!offer) continue;
      const reqs = offer.requiredItems || [];
      let reqCost = 0;
      let ok = true;
      for (const r of reqs) {
        const hReq = histories.get(Number(r.typeId));
        const dReq = hReq?.get(date);
        if (!dReq || typeof dReq.average !== "number") { ok = false; break; }
        reqCost += dReq.average * Number(r.qty || 0);
      }
      if (!ok) continue;
      const revenue = day.average * Number(offer.qty || 1);
      const net = revenue - Number(offer.iskCost || 0) - reqCost;
      const v = net / Number(offer.lpCost || 1);
      if (!Number.isFinite(v)) continue;
      sum += v * b.weight;
      wUsed += b.weight;
    }
    const value = wUsed ? (sum / wUsed) : null;
    series.push({ date, value, coverage: wUsed / weightSum });
  }

  return {
    corpId,
    regionId: REGION_ID,
    days: DAYS,
    series,
    meta: {
      basketSize: basket.length,
      basketLimit: BASKET_LIMIT,
      generated: new Date().toISOString(),
    },
  };
}

async function run() {
  console.log(`[pages_build_lp_corp_index] region=${REGION_ID} days=${DAYS} basketLimit=${BASKET_LIMIT}`);
  const hiddenItems = await loadHiddenItemIds();

  const corpsRaw = await readFile(CORPS_FILE, "utf8");
  const corpIds = (JSON.parse(corpsRaw).corps || []).map((c) => Number(c.corpId)).filter((x) => Number.isFinite(x));

  const offersRaw = await readFile(OFFERS_FILE, "utf8");
  const offersByCorp = JSON.parse(offersRaw);

  await mkdir(OUT_DIR, { recursive: true });

  let built = 0;
  let skipped = 0;

  for (let i = 0; i < corpIds.length; i++) {
    const corpId = corpIds[i];
    const outFile = path.join(OUT_DIR, `${corpId}_${DAYS}_${BASKET_LIMIT}.json`);
    const fresh = await existsFresh(outFile, 12);
    if (fresh) {
      skipped++;
      continue;
    }

    const out = await buildCorpIndex(corpId, offersByCorp, hiddenItems);
    if (!out) {
      skipped++;
      continue;
    }
    await writeFile(outFile, JSON.stringify(out));
    built++;

    if ((built + skipped) % 25 === 0 || i === corpIds.length - 1) {
      process.stdout.write(`\r[pages_build_lp_corp_index] ${i + 1}/${corpIds.length} built=${built} skipped=${skipped}`);
    }
  }
  process.stdout.write("\n");
  console.log(`[pages_build_lp_corp_index] output dir: ${path.relative(ROOT, OUT_DIR)}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

