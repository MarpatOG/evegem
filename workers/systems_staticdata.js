import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

const OUT = "./cache/json/systems.json";
const CACHE_DIR = "./cache/systems";
const CONCURRENCY = 8;

async function ensureDir() { await mkdir(CACHE_DIR, { recursive: true }); }

async function isCached(id) {
    try { await access(path.join(CACHE_DIR, `${id}.json`)); return true; }
    catch { return false; }
}

async function loadCache(id) {
    return JSON.parse(await readFile(path.join(CACHE_DIR, `${id}.json`), "utf8"));
}

async function saveCache(id, data) {
    await writeFile(path.join(CACHE_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}

async function loadSystem(id) {
    if (await isCached(id)) return await loadCache(id);

    const url = `https://esi.evetech.net/latest/universe/systems/${id}/`;
    const res = await fetch(url);

    if (res.status === 420) {
        console.log(`420: ждем 2 сек`);
        await new Promise(r => setTimeout(r, 2000));
        return await loadSystem(id);
    }
    if (!res.ok) return null;

    const json = await res.json();
    await saveCache(id, json);
    return json;
}

async function parallel(ids) {
    const results = {};
    let i = 0;

    async function worker() {
        while (i < ids.length) {
            const id = ids[i++];
            const data = await loadSystem(id);
            if (data) results[id] = data;
        }
    }

    const workers = Array(CONCURRENCY).fill().map(worker);
    await Promise.all(workers);
    return results;
}

export default async function runSystems() {
    await ensureDir();

    const ids = JSON.parse(await readFile("./systems_ids.json", "utf8"));
    const data = await parallel(ids);

    await writeFile(OUT, JSON.stringify(data, null, 2));
    console.log("systems.json готов");
}
