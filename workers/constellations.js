import { writeFile } from "node:fs/promises";

export default async function runConstellations() {
    const list = await fetch("https://esi.evetech.net/latest/universe/constellations/").then(r => r.json());

    const out = {};

    for (const id of list) {
        const r = await fetch(`https://esi.evetech.net/latest/universe/constellations/${id}/`).then(r => r.json());
        out[id] = r;
    }

    await writeFile("./cache/json/constellations.json", JSON.stringify(out, null, 2));
    console.log("constellations.json готов");
}
