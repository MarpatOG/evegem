import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SDE = path.join(__dirname, "..", "SDE");

// INPUT FILES
const regionsFile = path.join(SDE, "mapRegions.jsonl");
const factionsFile = path.join(SDE, "factions.jsonl");

// OUTPUT
const OUTPUT = path.join(__dirname, "..", "cache", "json", "regions_factions.json");


// ----------- Load JSONL files -------------
function loadJSONL(filePath) {
    const lines = fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .filter(l => l.trim().length > 0);

    return lines.map(l => JSON.parse(l));
}

const regions = loadJSONL(regionsFile);
const factions = loadJSONL(factionsFile);


// ----------- Build faction lookup map -------------
const factionById = {};
for (const f of factions) {
    factionById[f._key] = f;
}


// -------- normalize pirate groups ----------
function normalizeRat(name) {
    if (!name) return "Unknown";
    const n = name.toLowerCase();

    if (n.includes("guristas")) return "Guristas";
    if (n.includes("serpentis")) return "Serpentis";
    if (n.includes("angel")) return "Angels";
    if (n.includes("sansha")) return "Sansha";
    if (n.includes("blood")) return "Blood Raiders";
    if (n.includes("drone")) return "Rogue Drones";

    // empire space → no rats
    if (
        n.includes("amarr") ||
        n.includes("caldari") ||
        n.includes("gallente") ||
        n.includes("minmatar")
    ) return "None";

    return "Unknown";
}


// ----------- Build final regions_factions -------------
const result = {};

for (const r of regions) {
    const regionID = r._key;
    const name = r.name.en || r.name;

    let factionName = "Unknown";
    let rats = "Unknown";

    if (r.factionID) {
        const f = factionById[r.factionID];
        factionName = f?.name?.en ?? "Unknown";
        rats = normalizeRat(factionName);
    }

    result[regionID] = {
        name,
        faction: factionName,
        rats
    };
}


// ----------- Save file -------------
fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
console.log("✔ regions_factions.json generated successfully!");
