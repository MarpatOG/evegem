import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const CORPS_FILE = path.join(ROOT, "json", "lp_corps.json");
const OFFERS_FILE = path.join(ROOT, "json", "lp_offers.json");

const OUT_ITEMS = path.join(ROOT, "json", "lp_items.json");
const OUT_ITEM_OFFERS = path.join(ROOT, "json", "lp_item_offers.json");
const CORP_CONFIG = path.join(ROOT, "config", "lp_corps_config.json");
const ITEM_CONFIG = path.join(ROOT, "config", "lp_items_config.json");

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) return (s[mid - 1] + s[mid]) / 2;
  return s[mid];
}

function bestMin(arr) {
  if (!arr.length) return null;
  return Math.min(...arr);
}

function simplifyCategory(category) {
  const c = String(category || "").toLowerCase();
  if (c.includes("module")) return "Modules";
  if (c.includes("ship")) return "Ships";
  if (c.includes("implant")) return "Implants";
  if (c.includes("charge") || c.includes("ammo")) return "Ammo";
  if (c.includes("drone")) return "Drones";
  return category || "";
}

async function loadJsonMaybe(file, fallback) {
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function build() {
  const corpsRaw = await readFile(CORPS_FILE, "utf8").catch(() => null);
  const offersRaw = await readFile(OFFERS_FILE, "utf8").catch(() => null);
  if (!corpsRaw || !offersRaw) {
    console.error("Нет входных файлов. Нужны json/lp_corps.json и json/lp_offers.json (запусти node workers/lp_build_from_esi.js).");
    return;
  }

  const corps = JSON.parse(corpsRaw).corps || [];
  const corpMap = new Map(corps.map((c) => [Number(c.corpId), c]));
  const offersByCorp = JSON.parse(offersRaw);

  const corpCfg = await loadJsonMaybe(CORP_CONFIG, { corps: {} });
  const itemCfg = await loadJsonMaybe(ITEM_CONFIG, { items: {} });
  const hiddenCorps = new Set(
    Object.entries(corpCfg?.corps || {})
      .filter(([_, v]) => v?.hide)
      .map(([id]) => Number(id))
      .filter((v) => Number.isFinite(v))
  );
  const hiddenItems = new Set(
    Object.entries(itemCfg?.items || {})
      .filter(([_, v]) => v?.hide)
      .map(([id]) => Number(id))
      .filter((v) => Number.isFinite(v))
  );

  const itemIndex = new Map(); // itemId -> {itemId, itemName, category, group, offers:[]}
  for (const [corpIdStr, list] of Object.entries(offersByCorp)) {
    const corpId = Number(corpIdStr);
    if (hiddenCorps.has(corpId)) continue;
    const corp = corpMap.get(corpId);
    for (const o of list || []) {
      const itemId = Number(o.itemId);
      if (hiddenItems.has(itemId)) continue;
      const key = itemId;
      if (!itemIndex.has(key)) {
        itemIndex.set(key, {
          itemId,
          itemName: o.itemName || `Type ${itemId}`,
          category: simplifyCategory(o.category),
          group: o.group || "",
          offers: [],
          corpIds: new Set(),
          factions: new Set(),
        });
      }
      const entry = itemIndex.get(key);
      entry.corpIds.add(corpId);
      if (corp?.type) entry.factions.add(corp.type);
      entry.offers.push({
        ...o,
        corpId,
        corpName: corp?.name || `Corp ${corpId}`,
        corpFaction: corp?.type || corp?.faction || "",
      });
    }
  }

  const items = [];
  const itemOffersOut = {};

  for (const entry of itemIndex.values()) {
    const storeCount = entry.corpIds.size;
    const factionList = Array.from(entry.factions).filter(Boolean).sort();
    const concordOnly = factionList.length === 1 && factionList[0].toLowerCase().includes("concord");
    const uniqueCorpId = storeCount === 1 ? Array.from(entry.corpIds)[0] : null;

    const iskPerLpArr = entry.offers.map((o) => o.iskPerLp).filter((v) => typeof v === "number" && Number.isFinite(v));
    const tts14Arr = entry.offers.map((o) => o.timeToSell14).filter((v) => typeof v === "number" && Number.isFinite(v));
    const tts30Arr = entry.offers.map((o) => o.timeToSell30).filter((v) => typeof v === "number" && Number.isFinite(v));

    const sellPrice = entry.offers.find((o) => o.sellPrice != null)?.sellPrice ?? null;
    const vol1 = entry.offers.find((o) => o.volumePerDay1 != null)?.volumePerDay1 ?? null;
    const vol7 = entry.offers.find((o) => o.volumePerDay7 != null)?.volumePerDay7 ?? null;
    const vol14 = entry.offers.find((o) => o.volumePerDay14 != null)?.volumePerDay14 ?? null;
    const vol30 = entry.offers.find((o) => o.volumePerDay30 != null)?.volumePerDay30 ?? null;
    const risk14 = entry.offers.find((o) => o.risk14)?.risk14 ?? "⚪";
    const risk30 = entry.offers.find((o) => o.risk30)?.risk30 ?? "⚪";

    const bestIskPerLp = iskPerLpArr.length ? Math.max(...iskPerLpArr) : null;
    const medianIskPerLp = median(iskPerLpArr);

    const bestTTS14 = bestMin(tts14Arr);
    const bestTTS30 = bestMin(tts30Arr);

    const bestOffer = entry.offers
      .filter((o) => typeof o.iskPerLp === "number" && Number.isFinite(o.iskPerLp))
      .sort((a, b) => (b.iskPerLp ?? -Infinity) - (a.iskPerLp ?? -Infinity))[0] || null;

    items.push({
      itemId: entry.itemId,
      itemName: entry.itemName,
      category: entry.category,
      group: entry.group,
      lpStores: storeCount,
      factions: factionList,
      concordOnly,
      unique: storeCount === 1,
      uniqueCorpId,
      sellPrice,
      bestIskPerLp,
      medianIskPerLp,
      bestQty: bestOffer?.qty ?? 1,
      bestIskCost: bestOffer?.iskCost ?? null,
      bestOtherCost: bestOffer?.requiredCost ?? null,
      bestOtherRequirements: Array.isArray(bestOffer?.requiredItems)
        ? bestOffer.requiredItems.map((ri) => ({
            typeId: ri.typeId,
            name: ri.name,
            qty: ri.qty,
          }))
        : [],
      lpCapacity1: bestOffer?.lpCapacity1 ?? null,
      lpCapacity7: bestOffer?.lpCapacity7 ?? null,
      lpCapacity30: bestOffer?.lpCapacity30 ?? null,
      lpWeightPct: bestOffer?.lpWeightPct ?? null,
      volumePerDay1: vol1,
      volumePerDay7: vol7,
      volumePerDay14: vol14,
      volumePerDay30: vol30,
      bestTTS14,
      bestTTS30,
      risk14,
      risk30,
    });

    itemOffersOut[String(entry.itemId)] = entry.offers;
  }

  items.sort((a, b) => (b.medianIskPerLp ?? -Infinity) - (a.medianIskPerLp ?? -Infinity));

  await writeFile(OUT_ITEMS, JSON.stringify({ items }, null, 2));
  await writeFile(OUT_ITEM_OFFERS, JSON.stringify(itemOffersOut));
  console.log(`LP items: ${items.length} -> ${OUT_ITEMS}`);
  console.log(`LP item offers -> ${OUT_ITEM_OFFERS}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
