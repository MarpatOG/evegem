import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const LP_CORPS = path.join(ROOT, "json", "lp_corps.json");
const NPC_CHARS = path.join(ROOT, "SDE", "npcCharacters.jsonl");
const NPC_STATIONS = path.join(ROOT, "SDE", "npcStations.jsonl");
const SOLAR_SYSTEMS = path.join(ROOT, "SDE", "mapSolarSystems.jsonl");
const NPC_DIVS = path.join(ROOT, "SDE", "npcCorporationDivisions.jsonl");

const OUT = path.join(ROOT, "json", "lp_corp_agents.json");

// From `SDE/yaml/agentTypes.yaml`:
// 2=BasicAgent, 4=ResearchAgent, 5=CONCORDAgent, 6=GenericStorylineMissionAgent, 7=StorylineMissionAgent,
// 9=FactionalWarfareAgent, 10=EpicArcAgent
// Excluding: 1=NonAgent, 3=TutorialAgent, 8=EventMissionAgent, 11=AuraAgent, 12=CareerAgent, 13=HeraldryAgent
const ALLOWED_AGENT_TYPE_IDS = new Set([2, 4, 5, 6, 7, 9, 10]);

async function loadJSONL(file) {
  const raw = await readFile(file, "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return v.en || v.ru || v.de || v.fr || v.ja || v.zh || "";
  return String(v);
}

function zoneFromSec(sec) {
  if (sec == null || Number.isNaN(sec)) return "unknown";
  if (sec >= 0.5) return "hs";
  if (sec > 0) return "ls";
  return "ns";
}

function agentTypeFromDivision(divisionName, isLocator) {
  if (isLocator) return "Locator";
  const n = String(divisionName || "").toLowerCase();
  if (n.includes("security")) return "Security";
  if (n.includes("distribution")) return "Distribution";
  if (n.includes("mining")) return "Mining";
  if (n.includes("r&d") || n.includes("research")) return "R&D";
  return "Other";
}

function initMatrix() {
  const t = {
    Security: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 },
    Distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 },
    Mining: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 },
    "R&D": { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 },
    Locator: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 },
    Other: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 },
  };
  return t;
}

function bumpCell(matrix, type, level) {
  if (!matrix[type]) matrix[type] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 };
  const lv = [1, 2, 3, 4, 5].includes(level) ? level : null;
  if (lv) matrix[type][lv] += 1;
  matrix[type].total += 1;
}

function finalizeMatrix(matrix) {
  const totals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 };
  for (const row of Object.values(matrix)) {
    totals[1] += row[1] || 0;
    totals[2] += row[2] || 0;
    totals[3] += row[3] || 0;
    totals[4] += row[4] || 0;
    totals[5] += row[5] || 0;
    totals.total += row.total || 0;
  }
  matrix.Total = totals;
  return matrix;
}

function computeDifficulty(l4PlusSecurity, totalAgents) {
  if (totalAgents === 0) return "None";
  if (l4PlusSecurity >= 10) return "Easy";
  if (l4PlusSecurity >= 5) return "Medium";
  return "Hard";
}

async function build() {
  const lpCorpsRaw = await readFile(LP_CORPS, "utf8").catch(() => null);
  if (!lpCorpsRaw) {
    console.error(`Нет входного файла: ${LP_CORPS}. Сначала собери LP данные.`);
    return;
  }
  const corpIds = new Set((JSON.parse(lpCorpsRaw).corps || []).map((c) => Number(c.corpId)));

  console.log("Loading SDE maps (stations, solar systems, corporation divisions)...");
  const [stations, systems, divs] = await Promise.all([
    loadJSONL(NPC_STATIONS),
    loadJSONL(SOLAR_SYSTEMS),
    loadJSONL(NPC_DIVS),
  ]);

  const stationToSystem = new Map(stations.map((s) => [Number(s._key), Number(s.solarSystemID)]));
  const systemSec = new Map(systems.map((s) => [Number(s._key), Number(s.securityStatus)]));
  const divName = new Map(divs.map((d) => [Number(d._key), asText(d.name) || d.internalName || String(d._key)]));

  console.log("Aggregating agents from SDE npcCharacters...");
  const corps = {};
  let processed = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(NPC_CHARS) });
  for await (const line of rl) {
    if (!line) continue;
    const c = JSON.parse(line);
    if (!c.agent) continue;
    const corpId = Number(c.corporationID);
    if (!corpIds.has(corpId)) continue;

    const agentTypeId = Number(c.agent.agentTypeID);
    if (Number.isFinite(agentTypeId) && !ALLOWED_AGENT_TYPE_IDS.has(agentTypeId)) continue;

    const level = Number(c.agent.level);
    const divisionID = Number(c.agent.divisionID);
    const isLocator = Boolean(c.agent.isLocator);
    const divisionName = divName.get(divisionID) || "";
    const typeName = agentTypeFromDivision(divisionName, isLocator);

    const locationId = Number(c.locationID);
    const systemId = stationToSystem.get(locationId) || Number(c.agent.solarSystemID) || null;
    const sec = systemId ? systemSec.get(systemId) : null;
    const zone = zoneFromSec(sec);

    if (!corps[corpId]) {
      corps[corpId] = {
        summary: {
          totalAgents: 0,
          l4PlusSecurityAgents: 0,
          zones: { hs: 0, ls: 0, ns: 0, unknown: 0 },
        },
        byZone: {
          hs: initMatrix(),
          ls: initMatrix(),
          ns: initMatrix(),
          unknown: initMatrix(),
        },
        all: initMatrix(),
      };
    }

    const bucket = corps[corpId];
    bucket.summary.totalAgents += 1;
    bucket.summary.zones[zone] = (bucket.summary.zones[zone] || 0) + 1;
    bumpCell(bucket.all, typeName, level);
    bumpCell(bucket.byZone[zone] || bucket.byZone.unknown, typeName, level);

    if (typeName === "Security" && level >= 4) bucket.summary.l4PlusSecurityAgents += 1;

    processed += 1;
    if (processed % 10000 === 0) process.stdout.write(`\rProcessed ${processed} agents...`);
  }
  if (processed >= 10000) process.stdout.write("\n");

  // finalize totals and compute difficulty/potential
  for (const [corpId, data] of Object.entries(corps)) {
    data.all = finalizeMatrix(data.all);
    for (const z of Object.keys(data.byZone)) data.byZone[z] = finalizeMatrix(data.byZone[z]);
    data.summary.lpFarmingDifficulty = computeDifficulty(
      data.summary.l4PlusSecurityAgents,
      data.summary.totalAgents
    );
    data.summary.updated = new Date().toISOString();
    corps[corpId] = data;
  }

  await writeFile(OUT, JSON.stringify({ corps }, null, 2));
  console.log(`\nCorp agent stats written: ${OUT} (corps: ${Object.keys(corps).length})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
