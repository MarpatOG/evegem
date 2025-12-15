import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const ESI_RAW = path.join(ROOT, "cache", "lp_esi_offers.json");
const NPC_CORPS = path.join(ROOT, "SDE", "npcCorporations.jsonl");
const FACTIONS = path.join(ROOT, "SDE", "factions.jsonl");
const TYPES = path.join(ROOT, "SDE", "types.jsonl");
const GROUPS = path.join(ROOT, "SDE", "groups.jsonl");
const CATS = path.join(ROOT, "SDE", "categories.jsonl");
const MARKET = path.join(ROOT, "cache", "lp_market_10000002.json"); // Jita by default

const OUT_CORPS = path.join(ROOT, "json", "lp_corps.json");
const OUT_OFFERS = path.join(ROOT, "json", "lp_offers.json");

const ISK_PER_LP_REFERENCE = Number(process.env.LP_ISK_PER_LP_REF || 1000);
const CORP_CONFIG = path.join(ROOT, "config", "lp_corps_config.json");
const ITEM_CONFIG = path.join(ROOT, "config", "lp_items_config.json");

async function loadJsonMaybe(file, fallback) {
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function loadJSONL(file) {
  const raw = await readFile(file, "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function loadMarket() {
  const raw = await readFile(MARKET, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.types || null;
  } catch {
    return null;
  }
}

function calcRisk(spread, volumePerDay) {
  if (spread == null) return "⚪";
  if (spread > 0.4 || (volumePerDay != null && volumePerDay < 1)) return "🔴";
  if (spread > 0.2) return "🟡";
  return "🟢";
}

function calcRiskEmoji(spread, volumePerDay) {
  if (spread == null) return "⚪";
  if (spread > 0.4 || (volumePerDay != null && volumePerDay < 1)) return "🔴";
  if (spread > 0.2) return "🟡";
  return "🟢";
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) return (s[mid - 1] + s[mid]) / 2;
  return s[mid];
}

function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    return v.en || v.ru || v.de || v.fr || v.ja || v.zh || "";
  }
  return String(v);
}

async function build() {
  const rawExists = await readFile(ESI_RAW, "utf8").catch(() => null);
  if (!rawExists) {
    console.error(`Нет ESI офферов: ${ESI_RAW}. Сначала запусти npm run lp-esi.`);
    return;
  }

  console.log("Гружу SDE (npcCorporations, factions, types, groups, categories)...");
  const [npcCorps, factions, types, groups, cats] = await Promise.all([
    loadJSONL(NPC_CORPS),
    loadJSONL(FACTIONS),
    loadJSONL(TYPES),
    loadJSONL(GROUPS),
    loadJSONL(CATS),
  ]);
  const market = await loadMarket();
  if (!market) {
    console.warn("⚠️  Нет файла рынка (cache/lp_market_10000002.json). Цены и метрики будут пустые.");
  }

  const corpMap = new Map(npcCorps.map((c) => [c._key, c]));
  const factionMap = new Map(factions.map((f) => [Number(f._key), f]));
  const typeMap = new Map(types.map((t) => [t._key, t]));
  const groupMap = new Map(groups.map((g) => [g._key, g]));
  const catMap = new Map(cats.map((c) => [c._key, c]));

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

  const esiData = JSON.parse(rawExists);
  const offersByCorp = new Map();
  const itemOwners = new Map();

  for (const entry of esiData) {
    const { corpId, offers } = entry;
    if (!offers || !Array.isArray(offers)) continue;
    if (hiddenCorps.has(Number(corpId))) continue;
    for (const o of offers) {
      const itemId = o.type_id;
      if (hiddenItems.has(Number(itemId))) continue;
      const type = typeMap.get(itemId);
      const group = groupMap.get(type?.groupID);
      const cat = catMap.get(group?.categoryID);
      const requiredItems = (o.required_items || []).map((r) => {
        const rt = typeMap.get(r.type_id);
        return {
          typeId: r.type_id,
          name: asText(rt?.name) || `Type ${r.type_id}`,
          qty: r.quantity,
          volume: rt?.volume ?? null,
        };
      });
      const mType = market ? market[itemId] : null;
      const sellPrice = mType?.sellMin ?? null;
      const qty = o.quantity ?? 1;
      const reqCost = requiredItems.reduce((acc, ri) => {
        const price = market?.[ri.typeId]?.sellMin ?? null;
        if (price == null) return acc;
        return acc + price * ri.qty;
      }, 0);
      const capital = (o.isk_cost || 0) + (reqCost || 0);
      const netIsk = sellPrice != null ? (sellPrice * qty) - capital : null;
      const lpCost = o.lp_cost || 0;
      const iskPerLp = netIsk != null && lpCost > 0 ? netIsk / lpCost : null;
      const vol1 = mType?.vol1 ?? null;
      const vol7 = mType?.vol7 ?? null;
      const vol14 = mType?.vol14 ?? null;
      const vol30 = mType?.vol30 ?? null;
      const timeToSell14 = vol14 && vol14 > 0 ? qty / vol14 : null;
      const timeToSell30 = vol30 && vol30 > 0 ? qty / vol30 : null;
      const iskPerDay14 = netIsk != null && timeToSell14 ? netIsk / timeToSell14 : null;
      const iskPerDay30 = netIsk != null && timeToSell30 ? netIsk / timeToSell30 : null;
      const volumePerDay = vol14 ?? vol30 ?? null;
      const timeToSell = timeToSell14 ?? timeToSell30 ?? null;
      const iskPerDay = iskPerDay14 ?? iskPerDay30 ?? null;
      const spread = mType?.spread ?? null;
      const risk14 = calcRiskEmoji(spread, vol14);
      const risk30 = calcRiskEmoji(spread, vol30);
      const risk = vol14 != null ? risk14 : risk30;

      const marketValue = sellPrice != null ? sellPrice * qty : null;
      const iskCostStore = o.isk_cost || 0;
      const lpWeightPct =
        marketValue != null && marketValue > 0
          ? ((marketValue - iskCostStore) / marketValue) * 100
          : null;

      function lpCapacity(volumePerDay) {
        if (volumePerDay == null || !Number.isFinite(volumePerDay)) return null;
        if (!sellPrice || !ISK_PER_LP_REFERENCE) return null;
        const lpPerItem = (o.lp_cost || 0) / Math.max(1, qty);
        const lpEqPerItem = (sellPrice * qty) / ISK_PER_LP_REFERENCE;
        const cap = volumePerDay * Math.min(lpPerItem, lpEqPerItem);
        return Number.isFinite(cap) ? cap : null;
      }
      const lpCapacity1 = lpCapacity(vol1);
      const lpCapacity7 = lpCapacity(vol7);
      const lpCapacity14 = lpCapacity(vol14);
      const lpCapacity30 = lpCapacity(vol30);

      const offer = {
        id: o.offer_id,
        corpId,
        itemId,
        itemName: asText(type?.name) || `Type ${itemId}`,
        group: asText(group?.name) || "",
        category: asText(cat?.name) || "",
        lpCost: o.lp_cost,
        iskCost: o.isk_cost,
        qty,
        requiredItems: requiredItems.map(ri => {
          const price = market?.[ri.typeId]?.sellMin ?? null;
          return {
            ...ri,
            jitaSell: price,
            cost: price != null ? price * ri.qty : null
          };
        }),
        sellPrice,
        requiredCost: reqCost || 0,
        capital,
        netIsk,
        iskPerLp,
        volumePerDay,
        volumePerDay1: vol1,
        volumePerDay7: vol7,
        volumePerDay14: vol14,
        volumePerDay30: vol30,
        lpCapacity1,
        lpCapacity7,
        lpCapacity14,
        lpCapacity30,
        lpWeightPct,
        timeToSell,
        timeToSell14,
        timeToSell30,
        iskPerDay,
        iskPerDay14,
        iskPerDay30,
        spread,
        risk,
        risk14,
        risk30
      };
      if (!offersByCorp.has(corpId)) offersByCorp.set(corpId, []);
      offersByCorp.get(corpId).push(offer);
      if (!itemOwners.has(itemId)) itemOwners.set(itemId, new Set());
      itemOwners.get(itemId).add(corpId);
    }
  }

  const corpsOut = [];
  for (const [corpId, list] of offersByCorp.entries()) {
    const corp = corpMap.get(corpId);
    const name = asText(corp?.name) || `Corp ${corpId}`;
    const factionId = corp?.factionID || null;
    const factionName = factionId ? (asText(factionMap.get(Number(factionId))?.name) || "") : "";
    const logoId = corpId;
    let uniqueCount = 0;
    const iskPerLpArr = [];
    const ttsArr = [];
    const capitalArr = [];
    for (const offer of list) {
      const owners = itemOwners.get(offer.itemId);
      if (owners && owners.size === 1) uniqueCount++;
      if (offer.iskPerLp != null) iskPerLpArr.push(offer.iskPerLp);
      if (offer.timeToSell14 != null) ttsArr.push(offer.timeToSell14);
      else if (offer.timeToSell30 != null) ttsArr.push(offer.timeToSell30);
      if (offer.capital != null) capitalArr.push(offer.capital);
    }
    const bestIskPerLp = iskPerLpArr.length ? Math.max(...iskPerLpArr) : null;
    const medianIskPerLp = median(iskPerLpArr);
    const medianTTS = median(ttsArr);
    const medianCapital = median(capitalArr);
    const capitalBand =
      medianCapital == null
        ? "unknown"
        : medianCapital < 25_000_000
        ? "low"
        : medianCapital < 60_000_000
        ? "medium"
        : "high";
    corpsOut.push({
      corpId,
      name,
      factionId,
      type: factionName || "Independent",
      faction: factionName || "",
      logoId,
      lpStoreCount: list.length,
      uniqueCount,
      bestIskPerLp,
      medianIskPerLp,
      medianTTS,
      capitalBand,
    });
  }

  // mark global uniqueness per offered item (appears in exactly 1 corp LP store)
  for (const list of offersByCorp.values()) {
    for (const offer of list) {
      const owners = itemOwners.get(offer.itemId);
      offer.isUnique = owners ? owners.size === 1 : false;
    }
  }

  corpsOut.sort((a, b) => asText(a.name).localeCompare(asText(b.name)));
  const offersOut = {};
  for (const [corpId, list] of offersByCorp.entries()) {
    offersOut[corpId] = list;
  }

  console.log(`Пишу корпорации: ${corpsOut.length} -> ${OUT_CORPS}`);
  await writeFile(OUT_CORPS, JSON.stringify({ corps: corpsOut }, null, 2));
  console.log(`Пишу офферы -> ${OUT_OFFERS}`);
  await writeFile(OUT_OFFERS, JSON.stringify(offersOut));
  console.log("Done.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
