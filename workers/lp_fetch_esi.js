import { readFile, writeFile, mkdir, access, readdir } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const SDE_YAML_DIR = path.join(ROOT, "SDE", "yaml");
const NPC_CORPS_JSONL = path.join(ROOT, "SDE", "npcCorporations.jsonl");
const CORP_CSV = path.join(ROOT, "corpid.csv"); // fallback
const OUT_FILE = path.join(ROOT, "cache", "lp_esi_offers.json");
const UA = "EveGem/LP-ETL";
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.LP_CONCURRENCY || 2)));
const DELAY_MS = Math.max(0, Number(process.env.LP_DELAY_MS || 250));

async function fileExists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function findSdeYamlFile(filename) {
  const direct = path.join(SDE_YAML_DIR, filename);
  if (await fileExists(direct)) return direct;
  const entries = await readdir(SDE_YAML_DIR, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(SDE_YAML_DIR, e.name, filename);
    if (await fileExists(p)) return p;
  }
  return null;
}

async function readCorpIdsFromSdeYaml() {
  const lpFile = await findSdeYamlFile("loyaltyPoints.yaml");
  if (!lpFile) return null;
  const raw = await readFile(lpFile, "utf8");
  const lp = YAML.parse(raw);
  if (!Array.isArray(lp)) return null;
  const ids = new Set();
  for (const o of lp) {
    const corpId = Number(o?.corporationID);
    if (Number.isFinite(corpId) && corpId > 0) ids.add(corpId);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

async function readCorpIdsFromCsv() {
  const raw = await readFile(CORP_CSV, "utf8");
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines.filter((l) => /^\d+$/.test(l)).map(Number);
}

function uniqSorted(ids) {
  const out = Array.from(new Set(ids.filter((x) => Number.isFinite(x) && x > 0)));
  out.sort((a, b) => a - b);
  return out;
}

async function readCorpIdsFromNpcCorpsJsonl() {
  if (!(await fileExists(NPC_CORPS_JSONL))) return null;
  const ids = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(NPC_CORPS_JSONL) });
  for await (const line of rl) {
    if (!line) continue;
    const c = JSON.parse(line);
    const corpId = Number(c?._key);
    if (!Number.isFinite(corpId) || corpId <= 0) continue;
    const tables = c?.lpOfferTables;
    if (Array.isArray(tables) && tables.length > 0) ids.add(corpId);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

async function readCorpIds() {
  const sources = [];
  const ids = [];

  const sdeIds = await readCorpIdsFromSdeYaml().catch(() => null);
  if (sdeIds && sdeIds.length) {
    sources.push("SDE loyaltyPoints.yaml");
    ids.push(...sdeIds);
  }

  const npcIds = await readCorpIdsFromNpcCorpsJsonl().catch(() => null);
  if (npcIds && npcIds.length) {
    sources.push("SDE npcCorporations.jsonl (lpOfferTables)");
    ids.push(...npcIds);
  }

  if (await fileExists(CORP_CSV)) {
    const csvIds = await readCorpIdsFromCsv().catch(() => []);
    if (csvIds.length) {
      sources.push("corpid.csv");
      ids.push(...csvIds);
    }
  }

  return { ids: uniqSorted(ids), source: sources.length ? sources.join(" + ") : "none" };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

async function fetchOffers(corpId) {
  const url = `https://esi.evetech.net/latest/loyalty/stores/${corpId}/offers/`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 404) return { corpId, offers: [] };
      if (res.status === 420 || res.status === 429 || res.status >= 500) {
        await sleep(1000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { corpId, offers: data };
    } catch (err) {
      if (attempt === 3) return { corpId, error: err.message || String(err) };
      await sleep(1000 * attempt);
    }
  }
  return { corpId, offers: [] };
}

async function run() {
  if (false) {
    console.error(`Не найден список корп: ${CORP_CSV}`);
    return;
  }
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const { ids: corpIds, source } = await readCorpIds();
  if (!corpIds.length) {
    console.error(`No corporation IDs found (source: ${source}).`);
    return;
  }
  console.log(`Корпораций в списке: ${corpIds.length}`);
  console.log(`Sources: ${source}. Concurrency: ${CONCURRENCY}. Delay: ${DELAY_MS}ms`);
  const results = [];
  let done = 0;
  await asyncPool(CONCURRENCY, corpIds, async (id) => {
    const r = await fetchOffers(id);
    results.push(r);
    done += 1;
    if (done % 10 === 0 || done === corpIds.length) {
      process.stdout.write(`\r${done}/${corpIds.length} corp ${id}...`);
    }
    if (DELAY_MS) await sleep(DELAY_MS);
  });
  process.stdout.write("\n");
  await writeFile(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Saved: ${OUT_FILE}`);
  console.log(`Сохранено в ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
