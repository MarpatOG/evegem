import { readdir, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, "..", "cache", "zkb_systems");
const OUT_FILE  = path.join(__dirname, "..", "cache", "json", "zkb_systems.json");

export default async function mergeZKBCache() {
    console.log("📦 Читаю кэш:", CACHE_DIR);

    const files = await readdir(CACHE_DIR);

    console.log(`🔍 Найдено файлов: ${files.length}`);

    const stream = createWriteStream(OUT_FILE, { encoding: "utf8" });
    stream.write("{\n");

    let index = 0;

    for (const file of files) {
        index++;

        const pct = ((index / files.length) * 100).toFixed(1);
        process.stdout.write(`\r🔵 ${index}/${files.length} (${pct}%)`);

        const id = file.replace(".json", "");

        let jsonText = "{}";
        try {
            jsonText = await readFile(path.join(CACHE_DIR, file), "utf8");
        } catch {
            jsonText = "{}";
        }

        const line = `  "${id}": ${jsonText}`;
        stream.write(line);

        if (index < files.length) stream.write(",\n");
        else stream.write("\n");
    }

    stream.write("}\n");
    stream.end();

    console.log("\n💾 Итоговый файл записан:", OUT_FILE);
    console.log("🎉 merge complete!");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    mergeZKBCache();
}
