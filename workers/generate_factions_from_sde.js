import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- PATHS ----
const SDE_DIR = path.join(__dirname, "..", "SDE");

const solarSystemsFile = path.join(SDE_DIR, "mapSolarSystems.jsonl");
const factionsFile     = path.join(SDE_DIR, "factions.jsonl");
const regionsFile      = path.join(SDE_DIR, "mapRegions.jsonl");

const OUTPUT = path.join(__dirname, "..", "cache", "json", "regions_factions.json");

// ---- LOAD JSONL helper ----
function loadJsonl(file) {
    return fs.readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim().length)
        .map((l) => JSON.parse(l));
}

// ---- LOAD ----
console.log("📘 Loading SDE JSONL...");

const solarSystems = loadJsonl(solarSystemsFile);
const factions     = loadJsonl(factionsFile);
const regions      = loadJsonl(regionsFile);

// ---- Build factions map ----
// IMPORTANT: factionID in SDE = "_key"
const factionsById = {};
for (const f of factions) {
    if (f._key) factionsById[f._key] = f;
}

// ---- Count factions per region ----
const regionFactions = {}; // regionID → { factionID → count }

for (const sys of solarSystems) {
    const regionID = sys.regionID;
    const factionID = sys.factionID; // from mapSolarSystems

    if (!regionID || !factionID) continue;

    if (!regionFactions[regionID]) regionFactions[regionID] = {};

    regionFactions[regionID][factionID] =
        (regionFactions[regionID][factionID] || 0) + 1;
}

// ---- Convert faction name → pirate rat ----
function normalizeRat(name) {
    const n = name.toLowerCase();
    if (n.includes("guristas")) return "Guristas";
    if (n.includes("serpentis")) return "Serpentis";
    if (n.includes("angel"))     return "Angels";
    if (n.includes("sansha"))    return "Sansha";
    if (n.includes("blood"))     return "Blood Raiders";
    if (n.includes("drone"))     return "Rogue Drones";
    return "Unknown";
}

// ---- Build output ----
const result = {};

for (const region of regions) {
    const regionID = region._key;         // TRUE ID
    const regionName = region.name.en;    // readable name

    const factionsInRegion = regionFactions[regionID];

    if (!factionsInRegion) {
        result[regionID] = {
            name: regionName,
            faction: "Unknown",
            rats: "Unknown"
        };
        continue;
    }

    // choose faction with max systems
    const mainFactionID = Object.entries(factionsInRegion)
        .sort((a, b) => b[1] - a[1])[0][0];

    const faction = factionsById[mainFactionID];
    const factionName = faction?.name?.en ?? "Unknown";
    const rats = normalizeRat(factionName);

    result[regionID] = {
        name: regionName,
        faction: factionName,
        rats
    };
}

fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
console.log("✔ Generated regions_factions.json from SDE");
