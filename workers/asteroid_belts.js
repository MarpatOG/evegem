import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEMS_FILE = path.join(__dirname, "..", "cache", "json", "systems_staticdata.json");
const OUT_FILE = path.join(__dirname, "..", "cache", "json", "asteroid_belts.json");

const CACHE_DIR = path.join(__dirname, "..", "cache", "belts");
await mkdir(CACHE_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileExists(f) {
    try { await access(f); return true; }
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

async function loadBelt(id) {
    const p = path.join(CACHE_DIR, `${id}.json`);

    if (await fileExists(p)) {
        return JSON.parse(await readFile(p, "utf8"));
    }

    const url = `https://esi.evetech.net/latest/universe/asteroid_belts/${id}/`;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await fetchWithTimeout(url);

            if (res.status === 404) {
                // нормальная ситуация — некоторые пояса не существуют
                await writeFile(p, "{}");
                return null;
            }

            if (res.status === 420) {
                console.log(`⚠️ 420 on belt ${id}, slowing...`);
                await sleep(1500);
                continue;
            }

            if (!res.ok) {
                console.log(`❌ Belt ${id}: HTTP ${res.status}`);
                return null;
            }

            const json = await res.json();
            await writeFile(p, JSON.stringify(json, null, 2));
            return json;

        } catch (err) {
            console.log(`⚠️ Belt ${id} error (${attempt}/5) → ${err.message}`);
            await sleep(1000);
        }
    }

    console.log(`❌ Belt ${id} failed 5 times`);
    return null;
}

async function runAsteroidBelts() {
    console.log("📘 Loading systems_staticdata.json...");
    const systems = JSON.parse(await readFile(SYSTEMS_FILE, "utf8"));

    // ⭐ Правильный способ: пройтись по планетам
    const beltIds = [];

    for (const sys of Object.values(systems)) {
        for (const planet of sys.planets ?? []) {
            for (const belt of planet.asteroid_belts ?? []) {
                beltIds.push(belt);
            }
        }
    }

    console.log(`🔍 Total belts found: ${beltIds.length}`);

    if (beltIds.length === 0) {
        console.log("⚠️ Belt count is zero. Check systems_staticdata.json");
        return;
    }

    const results = {};
    let i = 0;

    for (const id of beltIds) {
        i++;
        const pct = ((i / beltIds.length) * 100).toFixed(1);
        process.stdout.write(`\r⛏ ${i}/${beltIds.length} (${pct}%)`);

        const data = await loadBelt(id);
        if (data) results[id] = data;

        await sleep(60);
    }

    console.log("\n💾 Saving asteroid_belts.json...");
    await writeFile(OUT_FILE, JSON.stringify(results, null, 2));

    console.log("🎉 Belts ETL complete!");
}

export default runAsteroidBelts;

if (process.argv[1] === fileURLToPath(import.meta.url)) runAsteroidBelts();
