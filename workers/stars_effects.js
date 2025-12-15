import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------- PATHS ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEMS_FILE = path.join(__dirname, "..", "cache", "json", "systems.json");
const OUT_FILE = path.join(__dirname, "..", "cache", "json", "stars_effects.json");

const CACHE_STARS = path.join(__dirname, "..", "cache", "stars");
const CACHE_TYPES = path.join(__dirname, "..", "cache", "types");

await mkdir(CACHE_STARS, { recursive: true });
await mkdir(CACHE_TYPES, { recursive: true });

// ---------------- HELPERS ----------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fileExists(file) {
    try { await access(file); return true; }
    catch { return false; }
}

async function fetchWithTimeout(url, ms = 8000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), ms)
        )
    ]);
}

async function loadFromCache(dir, id) {
    const p = path.join(dir, `${id}.json`);
    if (await fileExists(p)) {
        return JSON.parse(await readFile(p, "utf8"));
    }
    return null;
}

async function saveToCache(dir, id, data) {
    const p = path.join(dir, `${id}.json`);
    await writeFile(p, JSON.stringify(data, null, 2));
}

// ---------------- STAR LOADING ----------------
async function loadStar(starId) {
    const cached = await loadFromCache(CACHE_STARS, starId);
    if (cached) return cached;

    const url = `https://esi.evetech.net/latest/universe/stars/${starId}/`;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await fetchWithTimeout(url);

            if (res.status === 420) {
                console.log(`⚠️ 420 on star ${starId}, slowing...`);
                await sleep(1500);
                continue;
            }

            if (!res.ok) {
                console.log(`❌ Star ${starId} HTTP ${res.status}`);
                return null;
            }

            const json = await res.json();
            await saveToCache(CACHE_STARS, starId, json);
            return json;

        } catch (err) {
            console.log(`⚠️ Star ${starId} error attempt ${attempt}: ${err.message}`);
            await sleep(1000);
        }
    }

    console.log(`❌ Star ${starId} completely failed`);
    return null;
}

// ---------------- TYPE LOADING ----------------
async function loadType(typeId) {
    const cached = await loadFromCache(CACHE_TYPES, typeId);
    if (cached) return cached;

    const url = `https://esi.evetech.net/latest/universe/types/${typeId}/`;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await fetchWithTimeout(url);

            if (res.status === 420) {
                console.log(`⚠️ 420 on type ${typeId}, slowing...`);
                await sleep(1500);
                continue;
            }

            if (!res.ok) {
                console.log(`❌ Type ${typeId} HTTP ${res.status}`);
                return null;
            }

            const json = await res.json();
            await saveToCache(CACHE_TYPES, typeId, json);
            return json;

        } catch (err) {
            console.log(`⚠️ Type ${typeId} error attempt ${attempt}: ${err.message}`);
            await sleep(1000);
        }
    }

    console.log(`❌ Type ${typeId} completely failed`);
    return null;
}

// ---------------- PARALLEL ENGINE ----------------
async function parallelLoad(items, loaderFn, concurrency = 6) {
    let index = 0;
    const results = {};

    async function worker() {
        while (index < items.length) {
            const id = items[index++];
            const done = index;
            const total = items.length;
            const pct = ((done / total) * 100).toFixed(1);

            process.stdout.write(`\r🚀 ${done}/${total} (${pct}%)`);

            const data = await loaderFn(id);
            if (data) results[id] = data;

            await sleep(80);
        }
    }

    const tasks = Array(concurrency).fill().map(worker);
    await Promise.all(tasks);

    return results;
}

// ---------------- MAIN ----------------
export default async function runStarsEffects() {
    console.log("📘 Loading systems.json...");
    const systems = JSON.parse(await readFile(SYSTEMS_FILE, "utf8"));

    const starIds = Object.values(systems)
        .map(s => s.star_id)
        .filter(Boolean);

    console.log(`🔍 Unique stars: ${starIds.length}`);

    // 1) Load stars
    console.log("\n🌟 Loading star data...");
    const stars = await parallelLoad(starIds, loadStar);

    // Gather type IDs
    const typeIds = [
        ...new Set(
            Object.values(stars)
                .map(s => s.type_id)
                .filter(Boolean)
        )
    ];

    console.log(`\n🔮 Unique type_ids: ${typeIds.length}`);

    // 2) Load type effects
    console.log("\n✨ Loading type effect data...");
    const effects = await parallelLoad(typeIds, loadType);

    console.log("\n💾 Saving stars_effects.json...");
    await writeFile(
        OUT_FILE,
        JSON.stringify({ stars, effects }, null, 2)
    );

    console.log("🎉 Stars + Effects ETL complete!");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runStarsEffects();
}
