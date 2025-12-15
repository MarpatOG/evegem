import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

//
// --- PATHS --------------------------------------------------------
//
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEMS_FILE = path.join(__dirname, "..", "cache", "json", "systems.json");
const OUT_GATES = path.join(__dirname, "..", "cache", "json", "stargates.json");
const OUT_GRAPH = path.join(__dirname, "..", "cache", "json", "stargates_graph.json");

const CACHE_DIR = path.join(__dirname, "..", "cache", "gates");

await mkdir(CACHE_DIR, { recursive: true });

//
// --- UTILS --------------------------------------------------------
//
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isCached(id) {
    try {
        await access(path.join(CACHE_DIR, `${id}.json`));
        return true;
    } catch {
        return false;
    }
}

async function loadCache(id) {
    return JSON.parse(
        await readFile(path.join(CACHE_DIR, `${id}.json`), "utf8")
    );
}

async function saveCache(id, data) {
    await writeFile(
        path.join(CACHE_DIR, `${id}.json`),
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

async function fetchWithTimeout(url, timeoutMs = 10000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeoutMs)
        ),
    ]);
}

//
// --- LOAD SINGLE GATE --------------------------------------------
//
async function loadGate(id) {
    if (await isCached(id)) {
        return await loadCache(id);
    }

    const url = `https://esi.evetech.net/latest/universe/stargates/${id}/?datasource=tranquility`;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await fetchWithTimeout(url, 10000);

            if (res.status === 420) {
                console.log(`⚠️ 420 limit (gate ${id}) → waiting...`);
                await sleep(1500);
                continue;
            }

            if (!res.ok) {
                console.log(`❌ Gate ${id}: HTTP ${res.status}`);
                return null;
            }

            const json = await res.json();
            await saveCache(id, json);
            return json;
        } catch (err) {
            console.log(
                `⚠️ Error loading gate ${id}, attempt ${attempt}/5: ${err.message}`
            );
            await sleep(1000);
        }
    }

    console.log(`❌ Gate ${id} failed after 5 attempts`);
    return null;
}

//
// --- DYNAMIC CONCURRENCY LOADER -----------------------------------
//
async function loadAllGates(gateIds) {
    let concurrency = 6; // стартовые потоки
    let index = 0;
    const results = {};

    async function worker() {
        while (index < gateIds.length) {
            const id = gateIds[index++];
            const done = index;
            const total = gateIds.length;
            const pct = ((done / total) * 100).toFixed(1);

            process.stdout.write(
                `\r🚀 ${done}/${total} (${pct}%) threads=${concurrency}`
            );

            const data = await loadGate(id);
            if (data) results[id] = data;

            await sleep(80);

            if (done % 300 === 0 && concurrency > 2) concurrency--;
        }
    }

    const workers = Array(concurrency).fill().map(worker);
    await Promise.all(workers);

    return results;
}

//
// --- BUILD GRAPH --------------------------------------------------
//
function buildGraph(stargatesData) {
    const graph = {};

    for (const gateId in stargatesData) {
        const g = stargatesData[gateId];
        const from = g.system_id;
        const to = g.destination.system_id;

        if (!graph[from]) graph[from] = [];
        if (!graph[to]) graph[to] = [];

        graph[from].push(to);
        graph[to].push(from);
    }

    return graph;
}

//
// --- MAIN ---------------------------------------------------------
//
export default async function runStargates() {
    console.log("📘 Loading systems.json...");
    const systems = JSON.parse(await readFile(SYSTEMS_FILE, "utf8"));

    const gateIds = Object.values(systems)
        .flatMap((s) => s.stargates ?? [])
        .filter(Boolean);

    console.log(`🔍 Total stargates found: ${gateIds.length}`);
    console.log("🚀 Downloading stargates data...");

    const gatesData = await loadAllGates(gateIds);

    console.log("\n💾 Saving stargates.json...");
    await writeFile(OUT_GATES, JSON.stringify(gatesData, null, 2));

    console.log("📡 Building graph...");
    const graph = buildGraph(gatesData);

    await writeFile(OUT_GRAPH, JSON.stringify(graph, null, 2));

    console.log("🎉 Stargates ETL complete!");
}

if (process.argv[1] === __filename) {
    runStargates();
}
