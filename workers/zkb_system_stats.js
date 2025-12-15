import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEMS_FILE = path.join(__dirname, "..", "cache", "json", "systems_staticdata.json");
const OUT_FILE     = path.join(__dirname, "..", "cache", "json", "zkb_systems.json");

const CACHE_DIR = path.join(__dirname, "..", "cache", "zkb_systems");
await mkdir(CACHE_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function exists(f) {
    try { await access(f); return true; }
    catch { return false; }
}

// -------- load from cache or zKB API --------
async function loadZKB(id) {
    const cacheFile = path.join(CACHE_DIR, `${id}.json`);

    // read cache first
    if (await exists(cacheFile)) {
        try {
            return JSON.parse(await readFile(cacheFile, "utf8"));
        } catch {
            return {};
        }
    }

    const url = `https://zkillboard.com/api/stats/solarSystemID/${id}/`;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { "User-Agent": "EveLocalMarket/1.0" }
            });

            // safe retry
            if (res.status === 429) {
                console.log(`⚠️ Rate limit 429 on system ${id}, waiting...`);
                await sleep(3000);
                continue;
            }

            if (!res.ok) {
                console.log(`❌ system ${id} HTTP ${res.status}`);
                await writeFile(cacheFile, "{}");
                return {};
            }

            const json = await res.json();

            await writeFile(cacheFile, JSON.stringify(json, null, 2));
            return json || {};

        } catch (err) {
            console.log(`⚠️ zKB error on ${id} (${attempt}/5): ${err.message}`);
            await sleep(2000);
        }
    }

    await writeFile(cacheFile, "{}");
    return {};
}

// -------- MAIN ----------
export default async function runZKBSystems() {
    console.log("📘 Loading systems_staticdata.json...");
    const systems = JSON.parse(await readFile(SYSTEMS_FILE, "utf8"));

    const ids = Object.keys(systems).map(Number);
    console.log(`🔍 Systems to scan: ${ids.length}`);

    const result = {};

    let i = 0;
    for (const id of ids) {
        i++;
        const pct = ((i / ids.length) * 100).toFixed(1);

        process.stdout.write(`\r🔵 ${i}/${ids.length} (${pct}%)`);

        const data = await loadZKB(id);

        // ⭐ ВСЕГДА сохраняем запись, даже пустую
        result[id] = data;

        await sleep(1200); // zKB-safe rate
    }

    console.log("\n💾 Saving json/zkb_systems.json...");
    await writeFile(OUT_FILE, JSON.stringify(result, null, 2));

    console.log("🎉 zKB systems complete!");
}

// standalone run
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runZKBSystems();
}
