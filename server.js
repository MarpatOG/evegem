import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// frontend как корень сайта
app.use(express.static(path.join(__dirname, "frontend")));

// JSON и конфиги
app.use("/config", express.static(path.join(__dirname, "config")));
app.use("/json", express.static(path.join(__dirname, "json")));
app.use("/api", express.static(path.join(__dirname, "api")));

const UA = "EveGem/LP-Index";
const INDEX_CACHE_DIR = path.join(__dirname, "cache", "lp_index");
const HISTORY_CACHE_DIR = path.join(__dirname, "cache", "esi_history");
const LP_ITEMS_CONFIG = path.join(__dirname, "config", "lp_items_config.json");

const BUY_ORDERS_TTL_MS = 5 * 60 * 1000;
const buyOrdersCache = new Map(); // key -> { ts, payload }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

let itemHideCache = { mtimeMs: 0, hideSet: new Set() };
async function loadHiddenItemIds() {
  try {
    const s = await stat(LP_ITEMS_CONFIG);
    if (s.mtimeMs === itemHideCache.mtimeMs) return itemHideCache.hideSet;
    const raw = await readFile(LP_ITEMS_CONFIG, "utf8");
    const parsed = JSON.parse(raw);
    const hideSet = new Set();
    for (const [id, cfg] of Object.entries(parsed?.items || {})) {
      if (cfg?.hide) hideSet.add(Number(id));
    }
    itemHideCache = { mtimeMs: s.mtimeMs, hideSet };
    return hideSet;
  } catch {
    itemHideCache = { mtimeMs: 0, hideSet: new Set() };
    return itemHideCache.hideSet;
  }
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function lastDaysList(days) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1); // last completed day
  const list = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(end);
    dt.setUTCDate(end.getUTCDate() - i);
    list.push(isoDay(dt));
  }
  return list;
}

async function fetchJsonWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 400 || res.status === 404) return null;
      if (res.status === 420 || res.status === 429 || res.status >= 500) {
        await sleep(600 * i);
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(600 * i);
        continue;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(600 * i);
    }
  }
  throw lastErr || new Error("fetch failed");
}

async function fetchJsonResponseWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 400 || res.status === 404) return { res, json: null };
      if (res.status === 420 || res.status === 429 || res.status >= 500) {
        await sleep(600 * i);
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(600 * i);
        continue;
      }
      const json = await res.json();
      return { res, json };
    } catch (e) {
      lastErr = e;
      await sleep(600 * i);
    }
  }
  throw lastErr || new Error("fetch failed");
}

async function loadBuyOrdersSnapshot(regionId, typeId) {
  const baseUrl = `https://esi.evetech.net/latest/markets/${regionId}/orders/?order_type=buy&type_id=${typeId}`;
  const first = await fetchJsonResponseWithRetry(`${baseUrl}&page=1`);
  if (!first?.res || !first.res.ok || !Array.isArray(first.json)) {
    return { updated: new Date().toISOString(), orders: [], error: "no_data" };
  }

  const pages = Number(first.res.headers.get("x-pages") || first.res.headers.get("X-Pages") || 1) || 1;
  const orders = first.json.slice();

  for (let p = 2; p <= pages; p++) {
    const next = await fetchJsonResponseWithRetry(`${baseUrl}&page=${p}`);
    if (!next?.res?.ok || !Array.isArray(next.json)) continue;
    orders.push(...next.json);
  }

  return { updated: new Date().toISOString(), orders, error: null };
}

async function loadHistory(regionId, typeId) {
  const dir = path.join(HISTORY_CACHE_DIR, String(regionId));
  const file = path.join(dir, `${typeId}.json`);

  // cache TTL 12h
  try {
    const s = await stat(file);
    const ageMs = Date.now() - s.mtimeMs;
    if (ageMs < 12 * 60 * 60 * 1000) {
      const raw = await readFile(file, "utf8");
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }

  await mkdir(dir, { recursive: true });
  const url = `https://esi.evetech.net/latest/markets/${regionId}/history/?type_id=${typeId}`;
  const data = await fetchJsonWithRetry(url);
  const updated = new Date().toISOString();
  if (!data) {
    const out = { updated, data: null, error: "not_tradable_or_not_found" };
    await writeFile(file, JSON.stringify(out));
    return out;
  }
  const out = { updated, data };
  await writeFile(file, JSON.stringify(out));
  return out;
}

async function asyncPool(limit, items, fn) {
  const ret = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    ret.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.all(ret);
}

function avg(arr) {
  if (!arr.length) return null;
  const s = arr.reduce((a, b) => a + b, 0);
  return s / arr.length;
}

app.get("/api/lp_corp_index", async (req, res) => {
  const corpId = Number(req.query.corp);
  const regionId = Number(req.query.region || 10000002);
  const days = Math.max(3, Math.min(90, Number(req.query.days || 30)));
  const basketLimit = Math.max(5, Math.min(40, Number(req.query.limit || 25)));

  if (!corpId || Number.isNaN(corpId)) return res.status(400).json({ error: "corp is required" });
  if (!regionId || Number.isNaN(regionId)) return res.status(400).json({ error: "region is invalid" });

  const cacheDir = path.join(INDEX_CACHE_DIR, String(regionId));
  const cacheFile = path.join(cacheDir, `${corpId}_${days}_${basketLimit}.json`);

  // cache TTL 6h
  try {
    const s = await stat(cacheFile);
    const ageMs = Date.now() - s.mtimeMs;
    if (ageMs < 6 * 60 * 60 * 1000) {
      const raw = await readFile(cacheFile, "utf8");
      return res.json(JSON.parse(raw));
    }
  } catch {
    // ignore
  }

  const offersRaw = await readFile(path.join(__dirname, "json", "lp_offers.json"), "utf8");
  const offersByCorp = JSON.parse(offersRaw);
  const hiddenItems = await loadHiddenItemIds();
  const offers = (offersByCorp[String(corpId)] || []).filter((o) => !hiddenItems.has(Number(o.itemId)));
  if (!offers.length) return res.json({ corpId, regionId, days, series: [], meta: { basket: [] } });

  // initial scoring from current snapshot to pick a small basket
  const scored = offers
    .filter((o) => o.lpCost > 0 && o.qty > 0)
    .map((o) => {
      const vol = days <= 14 ? (o.volumePerDay14 ?? o.volumePerDay ?? 0) : (o.volumePerDay30 ?? o.volumePerDay ?? 0);
      const score = (o.iskPerLp ?? 0) * vol;
      return { o, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, basketLimit)
    .map((x) => x.o);

  const typeIds = new Set();
  for (const o of scored) {
    typeIds.add(Number(o.itemId));
    for (const r of o.requiredItems || []) typeIds.add(Number(r.typeId));
  }

  const typeList = Array.from(typeIds);
  const histories = new Map();

  await mkdir(cacheDir, { recursive: true });

  await asyncPool(6, typeList, async (typeId) => {
    const h = await loadHistory(regionId, typeId);
    if (!h?.data) return;
    const map = new Map(h.data.map((d) => [d.date, d]));
    histories.set(typeId, map);
  });

  const dates = lastDaysList(days);

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
    basket.push({ offer: o, weight, base, avgVol });
  }

  basket.sort((a, b) => b.weight - a.weight);
  const fixedBasket = basket.slice(0, basketLimit);
  const weightSum = fixedBasket.reduce((acc, b) => acc + b.weight, 0) || 1;

  const series = [];
  for (const date of dates) {
    let wUsed = 0;
    let sum = 0;
    for (const b of fixedBasket) {
      const o = b.offer;
      const hItem = histories.get(Number(o.itemId));
      const day = hItem?.get(date);
      if (!day || typeof day.average !== "number") continue;
      const sell = day.average;
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
      sum += v * b.weight;
      wUsed += b.weight;
    }
    const value = wUsed ? (sum / wUsed) : null;
    series.push({ date, value, coverage: wUsed / weightSum });
  }

  const out = {
    corpId,
    regionId,
    days,
    series,
    meta: {
      basketSize: fixedBasket.length,
      basketLimit,
      generated: new Date().toISOString(),
    },
  };

  await writeFile(cacheFile, JSON.stringify(out));
  res.json(out);
});

app.get("/api/market_history", async (req, res) => {
  const regionId = Number(req.query.region || 10000002);
  const typeId = Number(req.query.type);
  const days = Math.max(3, Math.min(90, Number(req.query.days || 30)));

  if (!regionId || Number.isNaN(regionId)) return res.status(400).json({ error: "region is invalid" });
  if (!typeId || Number.isNaN(typeId)) return res.status(400).json({ error: "type is required" });

  const history = await loadHistory(regionId, typeId);
  if (!history?.data) {
    return res.json({
      regionId,
      typeId,
      days,
      updated: history?.updated || null,
      error: history?.error || "no_data",
      series: [],
    });
  }

  // ESI history isn't guaranteed to have entries for every calendar day (if no trades).
  // For charts, return the last N available points instead of last N calendar days.
  const sorted = history.data
    .filter((d) => d && typeof d.date === "string")
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const tail = sorted.slice(-days);
  const series = tail.map((d) => ({
    date: d.date,
    average: typeof d.average === "number" ? d.average : null,
    volume: typeof d.volume === "number" ? d.volume : null,
  }));

  res.json({
    regionId,
    typeId,
    days,
    updated: history.updated || null,
    error: null,
    series,
  });
});

app.get("/api/buy_orders", async (req, res) => {
  const regionId = Number(req.query.region || 10000002);
  const typeId = Number(req.query.type);

  if (!regionId || Number.isNaN(regionId)) return res.status(400).json({ error: "region is invalid" });
  if (!typeId || Number.isNaN(typeId)) return res.status(400).json({ error: "type is required" });

  const key = `${regionId}:${typeId}`;
  const cached = buyOrdersCache.get(key);
  if (cached && (Date.now() - cached.ts) < BUY_ORDERS_TTL_MS) {
    return res.json({ ...cached.payload, cached: true });
  }

  const snap = await loadBuyOrdersSnapshot(regionId, typeId);
  const buyOrders = (snap.orders || []).filter((o) => o && o.is_buy_order === true);
  const bestBuy = buyOrders.reduce((m, o) => Math.max(m, Number(o.price || 0)), 0) || null;

  const payload = {
    regionId,
    typeId,
    updated: snap.updated,
    ttlSeconds: Math.floor(BUY_ORDERS_TTL_MS / 1000),
    cached: false,
    bestBuyPrice: bestBuy,
    orderCount: buyOrders.length,
    orders: buyOrders.map((o) => ({
      order_id: o.order_id,
      price: o.price,
      volume_remain: o.volume_remain,
      region_id: regionId,
      is_buy_order: true,
    })),
    error: snap.error,
  };

  buyOrdersCache.set(key, { ts: Date.now(), payload });
  res.json(payload);
});

const PORT = 8090;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
