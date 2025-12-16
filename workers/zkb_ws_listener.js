import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// __dirname для ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Пути
const configPath = join(__dirname, "../config/ws_config.json");
const systemMapPath = join(__dirname, "../cache/json/zkb_systems.json");
const feedOutputPath = join(__dirname, "../cache/json/kill_feed_test.json");

// Загружаем конфиг
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const regionFilter = Array.isArray(config.regions) ? config.regions : null;

// Загружаем systemID → regionID mapping
const systemToRegionMap = JSON.parse(fs.readFileSync(systemMapPath, "utf8"));

// Создаём файл kill_feed_test.json, если нет
if (!fs.existsSync(feedOutputPath)) fs.writeFileSync(feedOutputPath, "");

// Основной цикл RedisQ
async function pollRedisQ() {
    while (true) {
        try {
            const res = await fetch("https://redisq.zkillboard.com/listen.php");
            const data = await res.json();

            if (!data.package) continue;

            const pkg = data.package;
            const solarSystemID = pkg.zkb.locationID;
            const regionID = systemToRegionMap[solarSystemID];

            // Если нет фильтра — выводим всё
            if (!regionFilter || regionFilter.length === 0) {
                console.log("[ALL]", "sys:", solarSystemID, "region:", regionID, "kill:", pkg.killID);

                fs.appendFileSync(feedOutputPath, JSON.stringify(pkg) + "\n");
                continue;
            }

            // Фильтрация по регионам
            if (regionFilter.includes(regionID)) {
                console.log("[FILTERED]", "region:", regionID, "kill:", pkg.killID);

                fs.appendFileSync(feedOutputPath, JSON.stringify(pkg) + "\n");
            }

        } catch (err) {
            console.error("RedisQ poll error:", err);
            await new Promise(r => setTimeout(r, 2000)); // подождать и продолжить
        }
    }
}

console.log("[RedisQ] Listener started. Waiting for kills...");
pollRedisQ();
