import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, "..");
const SYSTEM_TABLE_FILE = path.join(ROOT, "json", "system_table.json");
const GATES_FILE = path.join(ROOT, "json", "stargates_graph.json");
const OUT_FILE = path.join(ROOT, "json", "map_data.json");

function uniqueEdges(nodes, graph) {
  const nodeSet = new Set(nodes.map(n => String(n.id)));
  const edges = [];
  for (const [id, links] of Object.entries(graph)) {
    if (!nodeSet.has(id)) continue;
    const from = Number(id);
    for (const to of links) {
      if (!nodeSet.has(String(to))) continue;
      if (from < to) edges.push([from, to]);
    }
  }
  return edges;
}

export default async function buildMapData() {
  console.log("Reading sources for map...");
  const [systemsRaw, gatesRaw] = await Promise.all([
    readFile(SYSTEM_TABLE_FILE, "utf8"),
    readFile(GATES_FILE, "utf8")
  ]);

  const systems = JSON.parse(systemsRaw).systems || [];
  const graph = JSON.parse(gatesRaw);

  const nodes = systems
    .filter(s => s.position && (s.classTag === "HS" || s.classTag === "LS" || s.classTag === "NS"))
    .map(s => ({
      id: s.id,
      name: s.name,
      region: s.region,
      classTag: s.classTag,
      position: s.position,
      topCorpName: s.topCorpName || null,
      topAllianceTicker: s.topAllianceTicker || null,
      topAllianceId: s.topAllianceId || null
    }));

  const edges = uniqueEdges(nodes, graph);

  // center and scale positions on backend to speed up frontend, and keep raw x/z for 2d layout
  const xs = nodes.map(n => n.position.x);
  const ys = nodes.map(n => n.position.y);
  const zs = nodes.map(n => n.position.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = span > 0 ? 800 / span : 1;

  const scaledNodes = nodes.map(n => ({
    id: n.id,
    name: n.name,
    region: n.region,
    classTag: n.classTag,
    topCorpName: n.topCorpName,
    topAllianceTicker: n.topAllianceTicker,
    topAllianceId: n.topAllianceId,
    x: (n.position.x - cx) * scale,
    y: (n.position.y - cy) * scale,
    z: (n.position.z - cz) * scale,
    rawX: n.position.x,
    rawZ: n.position.z
  }));

  console.log(`Writing map data: nodes=${scaledNodes.length}, edges=${edges.length}`);
  await writeFile(OUT_FILE, JSON.stringify({ nodes: scaledNodes, edges }, null, 2));
  console.log("Map data complete.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildMapData();
}
