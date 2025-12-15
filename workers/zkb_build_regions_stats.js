import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ---------------------------------------------------------
// PATHS
// ---------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH  = join(__dirname, "../Config/ws_config.json");
const OUTPUT_FILE  = join(__dirname, "../cache/json/regions_stats.json");
const SYSTEMS      = JSON.parse(fs.readFileSync(join(__dirname, "../cache/json/systems.json")));
const CONSTELLATIONS = JSON.parse(fs.readFileSync(join(__dirname, "../cache/json/constellations.json")));
const REGIONS        = JSON.parse(fs.readFileSync(join(__dirname, "../cache/json/regions.json")));

// ---------------------------------------------------------
// LOAD CONFIG
// ---------------------------------------------------------
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const TARGET_REGIONS = config.regions || [];

if (!Array.isArray(TARGET_REGIONS) || TARGET_REGIONS.length === 0) {
    console.error("❌ ERROR: No 'regions' in ws_config.json");
    process.exit(1);
}

console.log("📌 Target regions:", TARGET_REGIONS.join(", "));

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

function systemToRegion(systemID) {
    const sys = SYSTEMS[systemID];
    if (!sys) return null;
    const constID = sys.constellation_id;
    return CONSTELLATIONS[constID]?.region_id || null;
}

function typeToClass(typeID) {
    return "Unknown"; // TODO: SDE mapping
}

function pickTop(obj) {
    let best = null, max = -1;
    for (const k in obj) {
        if (obj[k] > max) {
            best = k;
            max = obj[k];
        }
    }
    return { id: best, count: max };
}

// ---------------------------------------------------------
// REQUEST WITH DATE RANGE
// ---------------------------------------------------------
async function loadKillsForRegion(regionID, days = 7) {

    const kills = [];

    // set time window
    const start = new Date(Date.now() - days * 86400 * 1000)
        .toISOString().split('.')[0];

    const end = new Date().toISOString().split('.')[0];

    let page = 1;

    while (true) {
        const url =
            `https://zkillboard.com/api/kills/regionID/${regionID}/` +
            `?startTime=${start}&endTime=${end}&zkbOnly=true&page=${page}`;

        console.log("  → Fetch:", url);

        const res = await fetch(url, {
            headers: { "User-Agent": "EveLocalMarket-V3" }
        });

        if (!res.ok) {
            console.log("  ❌ Error status:", res.status);
            break;
        }

        const data = await res.json();
        if (data.length === 0) break;

        kills.push(...data);

        page++;
        await sleep(500);
    }

    return kills;
}

// ---------------------------------------------------------
// BUILD STATS
// ---------------------------------------------------------
function buildRegionStats(regionID, kms, regionNamesMap) {

    const totalKills = kms.length;
    const iskTotal = kms.reduce((s, km) => s + (km.zkb?.totalValue || 0), 0);

    const corpCount = {};
    const allianceCount = {};
    const systemUsed = {};
    const hourCount = {};
    const shipCount = {};
    const attackerRegionCount = {};
    const victimRegionCount = {};

    for (const k of kms) {
        if (k.attackers) {
            for (const a of k.attackers) {
                if (a.corporation_id)
                    corpCount[a.corporation_id] = (corpCount[a.corporation_id] || 0) + 1;

                if (a.alliance_id)
                    allianceCount[a.alliance_id] = (allianceCount[a.alliance_id] || 0) + 1;

                if (a.solar_system_id) {
                    const rid = systemToRegion(a.solar_system_id);
                    if (rid)
                        attackerRegionCount[rid] = (attackerRegionCount[rid] || 0) + 1;
                }

                if (a.ship_type_id) {
                    const cls = typeToClass(a.ship_type_id);
                    shipCount[cls] = (shipCount[cls] || 0) + 1;
                }
            }
        }

        const victimSys = k.victim?.solar_system_id;
        if (victimSys) {
            const rid = systemToRegion(victimSys);
            if (rid)
                victimRegionCount[rid] = (victimRegionCount[rid] || 0) + 1;

            systemUsed[victimSys] = true;
        }

        const h = new Date(k.killmail_time).getUTCHours();
        hourCount[h] = (hourCount[h] || 0) + 1;
    }

    const topCorp = pickTop(corpCount);
    const topAlliance = pickTop(allianceCount);
    const topShip = pickTop(shipCount);
    const topAtk = pickTop(attackerRegionCount);
    const topVic = pickTop(victimRegionCount);
    const peakHour = pickTop(hourCount);

    return {
        regionName: regionNamesMap[regionID] || `Region ${regionID}`,
        kills_7d: totalKills,
        delta_7d_percent: 0,
        isk_7d: iskTotal,
        top_corp_id: topCorp.id,
        top_corp_name: topCorp.id || "—",
        top_alliance_id: topAlliance.id,
        top_alliance_name: topAlliance.id || "—",
        corp_kill_share: totalKills ? topCorp.count / totalKills : 0,
        top_attacker_region: regionNamesMap[topAtk.id] || "—",
        top_victim_region: regionNamesMap[topVic.id] || "—",
        top_ship_class: topShip.id || "—",
        active_systems_7d: Object.keys(systemUsed).length,
        peak_hour_utc: peakHour.id
    };
}

// ---------------------------------------------------------
// MAIN
// ---------------------------------------------------------
async function main() {
    console.log("📊 Building region kill stats…");

    const regionNamesMap = Object.fromEntries(
        Object.entries(REGIONS).map(([id, r]) => [id, r.name])
    );

    const output = {};

    for (const regionID of TARGET_REGIONS) {
        console.log(`\n➡ Region ${regionID} (${regionNamesMap[regionID]})`);

        const kms = await loadKillsForRegion(regionID);

        console.log(`   ✓ Loaded ${kms.length} killmails in range`);

        output[regionID] = buildRegionStats(regionID, kms, regionNamesMap);

        await sleep(1000);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log("\n✔ Saved to", OUTPUT_FILE);
}

main();
