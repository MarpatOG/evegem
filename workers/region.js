import { writeFile } from "node:fs/promises";

export default async function runRegions() {
    const list = await fetch("https://esi.evetech.net/latest/universe/regions/").then(r => r.json());

    const out = {};

    for (const id of list) {
        const r = await fetch(`https://esi.evetech.net/latest/universe/regions/${id}/`).then(r => r.json());
        out[id] = r;
    }

    await writeFile("./cache/json/regions.json", JSON.stringify(out, null, 2));
    console.log("regions.json готов");
}
