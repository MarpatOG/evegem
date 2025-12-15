import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGIONS_FILE = path.join(__dirname, "..", "cache", "json", "regions.json");
const OUT_FILE = path.join(__dirname, "..", "cache", "json", "zkb_regions.json");

const CACHE_DIR = path.join(__dirname, "..", "cache", "zkb_regions");
await mkdir(CACHE_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function exists(f) {
    try { await access(f); return true; }
    catch { return false; }
}

async function fetchWithTimeout(url, timeout = 8000) {
    return Promise.race([
        fetch(url, {
            headers: {
                "User-Agent": "EveLocalMarket/1.0 (zkb region stats loader)"
            }
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeout)
        )
    ]);
}

async function loadZKBRegion(id) {
    const cacheFile = path.join(CACHE_DIR, `${id}.json`);
    if (await exists(cacheFile)) {
        return JSON.parse(await readFile(cacheFile, "utf8"));
    }

    const url = `https://zkillboard.com/api/stats/regionID/${id}/`;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await fetchWithTimeout(url);

            if (res.status === 429) {
                console.log(`⚠️ 429 rate limit on region ${id}, slowing...`);
                await sleep(3000);
                continue;
            }

            if (!res.ok) {
                console.log(`❌ ZKB region ${id}: HTTP ${res.status}`);
                return null;
            }

            const json = await res.json();
            await writeFile(cacheFile, JSON.stringify(json, null, 2));
            return json;

        } catch (err) {
            console.log(`⚠️ region ${id} error (${attempt}/5): ${err.message}`);
            await sleep(1500);
        }
    }

    return null;
}

async function parallelLoad(ids, loader, concurrency = 2) {
    let index = 0;
    const out = {};

    async function worker() {
        while (index < ids.length) {
            const id = ids[index++];

            const done = index;
            const total = ids.length;
            const pct = ((done / total) * 100).toFixed(1);
            process.stdout.write(`\r🟣 regions: ${done}/${total} (${pct}%)`);

            const data = await loader(id);
            if (data) out[id] = data;

            await sleep(1200);
        }
    }

    await Promise.all(Array(concurrency).fill().map(worker));
    return out;
}

export default async function runZKBRegions() {
    console.log("📘 Loading regions.json...");
    const regions = JSON.parse(await readFile(REGIONS_FILE, "utf8"));

    const ids = Object.keys(regions).map(Number);

    console.log(`🔍 Regions to scan: ${ids.length}`);

    console.log("🚀 Loading zKB region statistics...");
    const result = await parallelLoad(ids, loadZKBRegion);

    console.log("\n💾 Saving zkb_regions.json...");
    await writeFile(OUT_FILE, JSON.stringify(result, null, 2));

    console.log("🎉 zKB regions complete!");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runZKBRegions();
