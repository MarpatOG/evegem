import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const WORKERS_DIR = path.join(ROOT, "workers");

function runNodeScript(scriptPath, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script failed (${code}): ${scriptPath}`));
    });
    child.on("error", reject);
  });
}

async function runModuleWorker(workerName) {
  const workerFile = path.join(WORKERS_DIR, `${workerName}.js`);
  const workerURL = pathToFileURL(workerFile).href;
  const mod = await import(workerURL);
  if (typeof mod.default !== "function") {
    throw new Error(`${workerName}.js does not export default()`);
  }
  await mod.default();
}

export default async function runAllEsi() {
  await mkdir(path.join(ROOT, "cache", "json"), { recursive: true });

  const steps = [
    { kind: "module", name: "systems_staticdata", title: "Universe: systems" },
    { kind: "module", name: "region", title: "Universe: regions" },
    { kind: "module", name: "constellations", title: "Universe: constellations" },
    { kind: "module", name: "stargates", title: "Universe: stargates" },
    { kind: "module", name: "planets_moons", title: "Universe: planets & moons" },
    { kind: "module", name: "stars_effects", title: "Universe: stars & types" },
    { kind: "module", name: "asteroid_belts", title: "Universe: asteroid belts" },
    { kind: "script", file: "lp_fetch_esi.js", title: "LP: ESI offers (loyalty stores)" },
    { kind: "script", file: "lp_fetch_market.js", title: "Market: ESI orders & history" },
  ];

  console.log(`\n📦 ESI run-all: ${steps.length} steps`);

  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    console.log(`\n[${i + 1}/${steps.length}] ${s.title}`);
    if (s.kind === "module") {
      await runModuleWorker(s.name);
    } else {
      await runNodeScript(path.join(WORKERS_DIR, s.file));
    }
  }

  console.log("\n✅ ESI run-all complete.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAllEsi().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

