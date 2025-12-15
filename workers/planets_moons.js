import { writeFile, readFile } from "node:fs/promises";

export default async function runPlanetsMoons() {
    const systems = JSON.parse(await readFile("./cache/json/systems.json", "utf8"));
    const planets = {};
    const moons = {};

    for (const sys of Object.values(systems)) {
        for (const p of sys.planets ?? []) {
            planets[p.planet_id] = { system_id: sys.system_id };

            if (p.moons) {
                for (const m of p.moons) {
                    moons[m] = { planet_id: p.planet_id, system_id: sys.system_id };
                }
            }
        }
    }

    await writeFile("./cache/json/planets_moons.json", JSON.stringify({ planets, moons }, null, 2));
    console.log("planets_moons.json готов");
}
