import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../app/prisma.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const APPLY = process.argv.includes("--apply");

const CORE_APP_DIRS = new Set([
  "auth",
  "config",
  "generate",
  "media",
  "middleware",
  "user",
  "utils",
  "_empty",
]);

const KEEP_SCHEMA_MODELS = new Set(["User", "Config"]);
const KEEP_COLLECTIONS = new Set(["User", "configs"]);

const appDir = path.join(rootDir, "app");
const serverPath = path.join(rootDir, "server.js");
const schemaPath = path.join(rootDir, "prisma", "schema.prisma");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractModelBlocks(schemaContent) {
  const blocks = [];
  const modelRegex = /model\s+(\w+)\s*\{/g;
  let match;

  while ((match = modelRegex.exec(schemaContent)) !== null) {
    const name = match[1];
    const start = match.index;
    let i = modelRegex.lastIndex;
    let depth = 1;

    for (; i < schemaContent.length && depth > 0; i++) {
      if (schemaContent[i] === "{") depth++;
      if (schemaContent[i] === "}") depth--;
    }

    if (depth !== 0) continue;
    let end = i;
    while (end < schemaContent.length && (schemaContent[end] === "\r" || schemaContent[end] === "\n")) {
      end++;
    }

    blocks.push({ name, start, end });
  }

  return blocks;
}

function cleanExtraBlankLines(content) {
  return content.replace(/\n{3,}/g, "\n\n");
}

async function getGeneratedAppDirs() {
  const entries = await fs.readdir(appDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !CORE_APP_DIRS.has(name));
}

async function updateServer(generatedDirs) {
  let content = await fs.readFile(serverPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const nextLines = lines.filter((line) => {
    return !generatedDirs.some((dir) => {
      const escaped = escapeRegExp(dir);
      const importRe = new RegExp(`^\\s*import\\s+\\w+\\s+from\\s+["']\\.\\/app\\/${escaped}\\/.+["']\\s*$`);
      const useRe = new RegExp(`^\\s*app\\.use\\(["']\\/api\\/${escaped}(Structure)?["']\\s*,\\s*\\w+\\)\\s*$`);
      return importRe.test(line) || useRe.test(line);
    });
  });

  const nextContent = cleanExtraBlankLines(nextLines.join("\n"));
  if (nextContent !== content && APPLY) {
    await fs.writeFile(serverPath, nextContent, "utf-8");
  }
  return nextContent !== content;
}

async function updateSchema() {
  let content = await fs.readFile(schemaPath, "utf-8");
  const blocks = extractModelBlocks(content);
  const toRemove = blocks.filter((block) => !KEEP_SCHEMA_MODELS.has(block.name));

  if (toRemove.length > 0) {
    const sorted = [...toRemove].sort((a, b) => b.start - a.start);
    for (const block of sorted) {
      content = content.slice(0, block.start) + content.slice(block.end);
    }
    content = cleanExtraBlankLines(content).trimEnd() + "\n";
    if (APPLY) {
      await fs.writeFile(schemaPath, content, "utf-8");
    }
  }

  return toRemove.map((b) => b.name);
}

async function processCollections() {
  try {
    const list = await prisma.$runCommandRaw({ listCollections: 1 });
    const names = (list?.cursor?.firstBatch || []).map((c) => c.name).filter(Boolean);
    const toDrop = names.filter((name) => !KEEP_COLLECTIONS.has(name));

    if (APPLY) {
      for (const name of toDrop) {
        await prisma.$runCommandRaw({ drop: name });
      }
    }

    return { names, toDrop };
  } catch (error) {
    return { error };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  console.log(APPLY ? "Applying generated cleanup..." : "Preview generated cleanup (dry-run)...");

  const generatedDirs = await getGeneratedAppDirs();
  console.log("Generated app dirs:", generatedDirs.join(", ") || "(none)");

  if (APPLY) {
    for (const dir of generatedDirs) {
      await fs.rm(path.join(appDir, dir), { recursive: true, force: true });
    }
  }

  const serverChanged = await updateServer(generatedDirs);
  console.log("server.js update:", serverChanged ? "yes" : "no");

  const removedModels = await updateSchema();
  console.log("Schema models to remove:", removedModels.join(", ") || "(none)");

  const collections = await processCollections();
  if (collections.error) {
    console.warn("Collections scan failed:", collections.error.message);
  } else {
    console.log("Mongo collections:", collections.names.join(", ") || "(none)");
    console.log("Collections to drop:", collections.toDrop.join(", ") || "(none)");
  }

  if (!APPLY) {
    console.log("Dry-run finished. Run with --apply to execute.");
  } else {
    console.log("Cleanup completed.");
  }
}

main().catch((error) => {
  console.error("reset-generated failed:", error);
  process.exitCode = 1;
});
