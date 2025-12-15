import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, "..");
const SDE_DIR = path.join(ROOT, "SDE", "yaml", "eve-online-static-data-3137986-yaml");

const LP_FILE = path.join(SDE_DIR, "loyaltyPoints.yaml");
const LP_REQ_FILE = path.join(SDE_DIR, "loyaltyPointsRequiredItems.yaml");
const TYPES_FILE = path.join(SDE_DIR, "types.yaml");
const GROUPS_FILE = path.join(SDE_DIR, "groups.yaml");
const CATS_FILE = path.join(SDE_DIR, "categories.yaml");
const CORPS_FILE = path.join(SDE_DIR, "npcCorporations.yaml");

const OUT_CORPS = path.join(ROOT, "json", "lp_corps.json");
const OUT_OFFERS = path.join(ROOT, "json", "lp_offers.json");

async function loadYaml(file) {
  const raw = await readFile(file, "utf8");
  return YAML.parse(raw);
}

async function build() {
  console.log("Loading SDE YAML...");
  const [lp, lpReq, types, groups, cats, corps] = await Promise.all([
    loadYaml(LP_FILE),
    loadYaml(LP_REQ_FILE),
    loadYaml(TYPES_FILE),
    loadYaml(GROUPS_FILE),
    loadYaml(CATS_FILE),
    loadYaml(CORPS_FILE)
  ]);

  const typeMap = new Map();
  for (const t of types) typeMap.set(t.typeID, t);
  const groupMap = new Map();
  for (const g of groups) groupMap.set(g.groupID, g);
  const catMap = new Map();
  for (const c of cats) catMap.set(c.categoryID, c);
  const corpMap = new Map();
  for (const c of corps) corpMap.set(c.corporationID, c);

  const reqMap = new Map();
  for (const r of lpReq) {
    const key = `${r.corporationID}:${r.typeID}`;
    const list = reqMap.get(key) || [];
    list.push(r);
    reqMap.set(key, list);
  }

  const offersByCorp = new Map();
  const itemOwners = new Map();

  for (const o of lp) {
    const corpId = o.corporationID;
    const itemId = o.typeID;
    const type = typeMap.get(itemId);
    const group = groupMap.get(type?.groupID);
    const cat = catMap.get(group?.categoryID);
    const key = `${corpId}:${itemId}`;
    const req = reqMap.get(key) || [];
    const requiredItems = req.map(r => {
      const rt = typeMap.get(r.requiredTypeID);
      return {
        typeId: r.requiredTypeID,
        name: rt?.typeName?.en || rt?.typeName || `Type ${r.requiredTypeID}`,
        qty: r.quantity,
        volume: rt?.volume ?? null
      };
    });
    const offer = {
      id: o.offerID || key,
      corpId,
      itemId,
      itemName: type?.typeName?.en || type?.typeName || `Type ${itemId}`,
      group: group?.groupName?.en || group?.groupName || "",
      category: cat?.categoryName?.en || cat?.categoryName || "",
      lpCost: o.lpCost,
      iskCost: o.iskCost,
      qty: o.quantity ?? 1,
      requiredItems
    };
    if (!offersByCorp.has(corpId)) offersByCorp.set(corpId, []);
    offersByCorp.get(corpId).push(offer);
    if (!itemOwners.has(itemId)) itemOwners.set(itemId, new Set());
    itemOwners.get(itemId).add(corpId);
  }

  const corpsOut = [];
  for (const [corpId, list] of offersByCorp.entries()) {
    const corp = corpMap.get(corpId);
    const name = corp?.corporationName?.en || corp?.corporationName || `Corp ${corpId}`;
    const factionId = corp?.factionID || null;
    const logoId = corpId;
    let uniqueCount = 0;
    for (const offer of list) {
      const owners = itemOwners.get(offer.itemId);
      if (owners && owners.size === 1) uniqueCount++;
    }
    corpsOut.push({
      corpId,
      name,
      factionId,
      type: "",
      logoId,
      lpStoreCount: list.length,
      uniqueCount
    });
  }

  corpsOut.sort((a,b)=>a.name.localeCompare(b.name));
  const offersOut = {};
  for (const [corpId, list] of offersByCorp.entries()) {
    offersOut[corpId] = list;
  }

  console.log(`Writing ${corpsOut.length} corps to ${OUT_CORPS}`);
  await writeFile(OUT_CORPS, JSON.stringify({ corps: corpsOut }, null, 2));
  console.log(`Writing offers to ${OUT_OFFERS}`);
  await writeFile(OUT_OFFERS, JSON.stringify(offersOut));
  console.log("Done.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
