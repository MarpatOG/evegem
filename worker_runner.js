import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, "config", "workers.config.json");
const WORKERS_DIR = path.join(__dirname, "workers");

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.log("❌ Не удалось прочитать config/workers.config.json");
    console.log("Ошибка:", err?.message ?? String(err));
    process.exit(1);
  }
}

async function runWorker(name) {
  const workerFile = path.join(WORKERS_DIR, `${name}.js`);
  const workerURL = pathToFileURL(workerFile).href;

  console.log(`\n▶ Запускаю воркер: ${name}.js`);
  console.log(`   URL: ${workerURL}`);

  try {
    const module = await import(workerURL);

    if (typeof module.default !== "function") {
      console.log(`⚠️ ${name}.js не экспортирует default()`);
      return;
    }

    await module.default();
    console.log(`✅ Готово: ${name}`);
  } catch (err) {
    console.log(`❌ Ошибка в воркере ${name}.js`);
    console.log(err?.stack || err?.message || String(err));
  }
}

async function main() {
  console.log("📘 Чтение config/workers.config.json...");
  const config = await loadConfig();

  const enabledWorkers = Object.entries(config)
    .filter(([_, enabled]) => enabled)
    .map(([name]) => name);

  console.log(`🧩 Включенные воркеры: ${enabledWorkers.join(", ")}`);

  for (const worker of enabledWorkers) {
    await runWorker(worker);
  }

  console.log("\n✅ Все воркеры завершены!");
}

main();
