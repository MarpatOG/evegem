import { readFile, writeFile, access, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, "..");
const SYSTEMS_FILE = path.join(ROOT, "cache", "json", "systems_staticdata.json");
const CONSTELLATIONS_FILE = path.join(ROOT, "cache", "json", "constellations.json");
const REGIONS_FILE = path.join(ROOT, "cache", "json", "regions.json");
const ZKB_SUMMARY_FILE = path.join(ROOT, "cache", "json", "zkb_systems_summary.json");
const ZKB_STATS_DIR = path.join(ROOT, "cache", "zkb_stats"); // all-time stats cache
const DAILY_DIR = path.join(ROOT, "cache", "zkb_daily");      // daily kills cache
const SNAPSHOT_DIR = path.join(ROOT, "cache", "zkb_stats_daily"); // per-day all-time snapshots
const DELTA_FILE = path.join(ROOT, "cache", "zkb_stats_delta.json"); // precomputed d7/d30
const TRUESEC_FILE = path.join(ROOT, "SDE", "mapSolarSystems.jsonl");
const TRUESEC_CSV = path.join(ROOT, "SDE", "mapSolarSystems.csv");
const CORP_CACHE_FILE = path.join(ROOT, "cache", "esi_corporations.json");
const ALLI_CACHE_FILE = path.join(ROOT, "cache", "esi_alliances.json");
const OUT_FILE = path.join(ROOT, "json", "system_table.json");

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function loadCache(file) {
  if (!(await fileExists(file))) return {};
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveCache(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}

async function fetchJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "EveLocalMarket/1.0" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  return null;
}

async function getCorp(corpId, cache) {
  if (!corpId) return null;
  if (cache[corpId]) return cache[corpId];
  try {
    const data = await fetchJSON(`https://esi.evetech.net/latest/corporations/${corpId}/`);
    cache[corpId] = {
      name: data?.name || null,
      ticker: data?.ticker || null,
      alliance_id: data?.alliance_id || null
    };
    return cache[corpId];
  } catch {
    cache[corpId] = {};
    return null;
  }
}

async function getAlliance(allianceId, cache) {
  if (!allianceId) return null;
  if (cache[allianceId]) return cache[allianceId];
  try {
    const data = await fetchJSON(`https://esi.evetech.net/latest/alliances/${allianceId}/`);
    cache[allianceId] = {
      name: data?.name || null,
      ticker: data?.ticker || null
    };
    return cache[allianceId];
  } catch {
    cache[allianceId] = {};
    return null;
  }
}

function classifySpace(regionName, regionId, sec) {
  if (regionId >= 11000000 && regionId < 12000000) {
    const map = { A: "C1", B: "C2", C: "C3", D: "C4", E: "C5", F: "C6" };
    const first = (regionName || "").charAt(0);
    return map[first] || "NS";
  }
  if (sec >= 0.45) return "HS";
  if (sec > 0) return "LS";
  return "NS";
}

async function loadStatAll(systemId) {
  await mkdir(ZKB_STATS_DIR, { recursive: true });
  const cacheFile = path.join(ZKB_STATS_DIR, `${systemId}.json`);
  let data = {};
  if (await fileExists(cacheFile)) {
    try { data = JSON.parse(await readFile(cacheFile, "utf8")); } catch {}
  } else {
    const url = `https://zkillboard.com/api/stats/solarSystemID/${systemId}/`;
    try {
      data = await fetchJSON(url) || {};
      await writeFile(cacheFile, JSON.stringify(data, null, 2));
      await new Promise(r => setTimeout(r, 1200));
    } catch {
      data = {};
      await writeFile(cacheFile, "{}");
    }
  }
  return {
    shipsDestroyed: data.shipsDestroyed ?? 0,
    iskDestroyed: data.iskDestroyed ?? 0,
    topAllTime: data.topAllTime || []
  };
}

function dateStrings(daysBack) {
  const today = new Date();
  const list = [];
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    list.push(iso);
  }
  return list;
}

function isoDaysBack(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

let snapshotDatesCache = null;
const snapshotCache = new Map();
let deltaCache = null;

async function loadDeltaCache() {
  if (deltaCache !== null) return deltaCache;
  try {
    const raw = await readFile(DELTA_FILE, "utf8");
    deltaCache = JSON.parse(raw);
  } catch {
    deltaCache = null;
  }
  return deltaCache;
}

async function listSnapshotDates() {
  if (snapshotDatesCache) return snapshotDatesCache;
  try {
    const files = await readdir(SNAPSHOT_DIR);
    snapshotDatesCache = files
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(".json", ""))
      .sort();
    return snapshotDatesCache;
  } catch {
    snapshotDatesCache = [];
    return snapshotDatesCache;
  }
}

async function loadSnapshot(dateStr) {
  if (snapshotCache.has(dateStr)) return snapshotCache.get(dateStr);
  try {
    const raw = await readFile(path.join(SNAPSHOT_DIR, `${dateStr}.json`), "utf8");
    const data = JSON.parse(raw);
    snapshotCache.set(dateStr, data);
    return data;
  } catch {
    snapshotCache.set(dateStr, null);
    return null;
  }
}

async function nearestSnapshot(targetIso) {
  const dates = await listSnapshotDates();
  let chosen = null;
  for (const d of dates) {
    if (d <= targetIso) chosen = d;
    else break;
  }
  return chosen ? loadSnapshot(chosen) : null;
}

let trueSecMap = null;
async function loadTrueSec() {
  if (trueSecMap) return trueSecMap;
  trueSecMap = {};
  // Try CSV true sec first (fuzzwork dump format)
  if (await fileExists(TRUESEC_CSV)) {
    try {
      const raw = await readFile(TRUESEC_CSV, "utf8");
      const [headerLine, ...lines] = raw.split(/\r?\n/);
      const headers = headerLine.split(",");
      const idIdx = headers.indexOf("solarSystemID");
      const secIdx = headers.indexOf("security");
      if (idIdx >= 0 && secIdx >= 0) {
        for (const line of lines) {
          if (!line) continue;
          const cols = line.split(",");
          const id = cols[idIdx];
          const sec = parseFloat(cols[secIdx]);
          if (!Number.isNaN(sec) && id) {
            trueSecMap[id] = sec;
          }
        }
      }
    } catch {
      trueSecMap = {};
    }
  } else {
    // attempt download from fuzzwork
    try {
      const res = await fetch("https://www.fuzzwork.co.uk/dump/latest/mapSolarSystems.csv");
      if (res.ok) {
        const csvText = await res.text();
        await writeFile(TRUESEC_CSV, csvText);
        const [headerLine, ...lines] = csvText.split(/\r?\n/);
        const headers = headerLine.split(",");
        const idIdx = headers.indexOf("solarSystemID");
        const secIdx = headers.indexOf("security");
        if (idIdx >= 0 && secIdx >= 0) {
          for (const line of lines) {
            if (!line) continue;
            const cols = line.split(",");
            const id = cols[idIdx];
            const sec = parseFloat(cols[secIdx]);
            if (!Number.isNaN(sec) && id) {
              trueSecMap[id] = sec;
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  // Fallback to JSONL securityStatus
  if (Object.keys(trueSecMap).length === 0) {
    try {
      const raw = await readFile(TRUESEC_FILE, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const id = obj._key;
          if (id) trueSecMap[id] = obj.securityStatus;
        } catch {
          /* ignore bad lines */
        }
      }
    } catch {
      trueSecMap = {};
    }
  }
  return trueSecMap;
}

async function aggregateDaily(systemId) {
  const deltas = await loadDeltaCache();
  if (deltas && deltas[systemId]) {
    const d = deltas[systemId];
    return {
      d7: { ships: d.ships7 || 0, isk: d.isk7 || 0 },
      d30: { ships: d.ships30 || 0, isk: d.isk30 || 0 }
    };
  }

  // Prefer snapshot diffs if we have them
  const todayIso = isoDaysBack(0);
  const snapToday = await nearestSnapshot(todayIso);
  const snap7 = await nearestSnapshot(isoDaysBack(7));
  const snap30 = await nearestSnapshot(isoDaysBack(30));

  if (snapToday && snap7 && snap30) {
    const cur = snapToday?.[systemId] || { ships: 0, isk: 0 };
    const past7 = snap7?.[systemId] || { ships: 0, isk: 0 };
    const past30 = snap30?.[systemId] || { ships: 0, isk: 0 };
    const d7Ships = Math.max(0, cur.ships - past7.ships);
    const d30Ships = Math.max(0, cur.ships - past30.ships);
    const d7Isk = Math.max(0, cur.isk - past7.isk);
    const d30Isk = Math.max(0, cur.isk - past30.isk);
    return {
      d7: { ships: d7Ships, isk: d7Isk },
      d30: { ships: d30Ships, isk: d30Isk }
    };
  }

  // Fallback to legacy daily kill aggregation
  let ships7 = 0, ships30 = 0, isk7 = 0, isk30 = 0;
  const dates7 = dateStrings(7);
  const dates30 = dateStrings(30);

  // 30d aggregation (also covers 7d)
  for (const date of dates30) {
    const dailyFile = path.join(DAILY_DIR, `${date}.json`);
    const perSystemFile = path.join(DAILY_DIR, date, `${systemId}.json`);

    // new aggregated daily file
    if (await fileExists(dailyFile)) {
      try {
        const map = JSON.parse(await readFile(dailyFile, "utf8"));
        const rec = map?.[systemId];
        const count = rec?.ships || 0;
        const isk = rec?.isk || 0;
        ships30 += count;
        isk30 += isk;
        if (dates7.includes(date)) {
          ships7 += count;
          isk7 += isk;
        }
        continue;
      } catch { /* fallback below */ }
    }

    // legacy per-system daily file
    if (await fileExists(perSystemFile)) {
      try {
        const data = JSON.parse(await readFile(perSystemFile, "utf8"));
        let count = 0, isk = 0;
        if (Array.isArray(data)) {
          count = data.length;
          isk = data.reduce((s, km) => s + (km.zkb?.totalValue || 0), 0);
        } else if (data && typeof data === "object") {
          count = data.ships || 0;
          isk = data.isk || 0;
        }
        ships30 += count;
        isk30 += isk;
        if (dates7.includes(date)) {
          ships7 += count;
          isk7 += isk;
        }
      } catch { /* ignore */ }
    }
  }

  return {
    d7: { ships: ships7, isk: isk7 },
    d30: { ships: ships30, isk: isk30 }
  };
}

export default async function buildSystemTable() {
  console.log("Reading source JSON...");
  const [systemsRaw, constsRaw, regionsRaw, zkbRaw] = await Promise.all([
    readFile(SYSTEMS_FILE, "utf8"),
    readFile(CONSTELLATIONS_FILE, "utf8"),
    readFile(REGIONS_FILE, "utf8"),
    readFile(ZKB_SUMMARY_FILE, "utf8")
  ]);
  const trueSec = await loadTrueSec();

  const systems = JSON.parse(systemsRaw);
  const consts = JSON.parse(constsRaw);
  const regions = JSON.parse(regionsRaw);
  const stats = JSON.parse(zkbRaw);
  const corpCache = await loadCache(CORP_CACHE_FILE);
  const alliCache = await loadCache(ALLI_CACHE_FILE);

  const rows = [];
  const ids = Object.entries(systems);
  const total = ids.length;
  let index = 0;

  for (const [id, sys] of ids) {
    index++;
    const constellationId = sys.constellation_id;
    const regionId = consts[constellationId]?.region_id;
    const regionName = regions[regionId]?.name || "n/a";

    // skip ADR regions
    if (String(regionId).startsWith("120000") || regionName.startsWith("ADR")) continue;

    const statAll = await loadStatAll(id);
    const dailyAgg = await aggregateDaily(id);
    const topCorpId = statAll.topAllTime?.find(t => t.type === "corporation")?.data?.[0]?.corporationID;
    const corpInfo = await getCorp(topCorpId, corpCache);
    const allianceId = corpInfo?.alliance_id || null;
    const allianceInfo = allianceId ? await getAlliance(allianceId, alliCache) : null;

    const secVal = trueSec[id] !== undefined ? trueSec[id] : sys.security_status;
    const classTag = classifySpace(regionName, regionId, secVal);

    rows.push({
      id: Number(id),
      name: sys.name,
      region: regionName,
      regionId,
      security: secVal,
      kills: {
        all: statAll.shipsDestroyed ?? stats[id]?.shipsDestroyed ?? 0,
        d30: dailyAgg.d30.ships,
        d7: dailyAgg.d7.ships
      },
      isk: {
        all: statAll.iskDestroyed ?? stats[id]?.iskDestroyed ?? 0,
        d30: dailyAgg.d30.isk,
        d7: dailyAgg.d7.isk
      },
      classTag,
      topCorpName: corpInfo?.name || null,
      topAllianceTicker: allianceInfo?.ticker || null,
      topAllianceId: allianceId || null,
      position: sys.position ? { x: sys.position.x, y: sys.position.y, z: sys.position.z } : null
    });

    if (index % 10 === 0 || index === total) {
      const pct = ((index / total) * 100).toFixed(1);
      process.stdout.write(`\rProcessed ${index}/${total} (${pct}%)`);
    }
  }

  console.log(`Writing ${rows.length} systems to ${OUT_FILE}...`);
  await writeFile(OUT_FILE, JSON.stringify({ systems: rows }, null, 2));
  await saveCache(CORP_CACHE_FILE, corpCache);
  await saveCache(ALLI_CACHE_FILE, alliCache);
  console.log("Done.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildSystemTable();
}
