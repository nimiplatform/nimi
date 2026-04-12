import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOST_BOOTSTRAP_EXCLUDED_PATHS = new Set([
  "methodology/spec-target-truth-profile.yaml",
]);
const SOURCE_PROJECTIONS = [
  { sourceDir: "config", outputDir: ".nimi/config" },
  { sourceDir: "contracts", outputDir: ".nimi/contracts" },
  { sourceDir: "methodology", outputDir: ".nimi/methodology" },
  { sourceDir: "spec", outputDir: ".nimi/spec" },
];

function toPortableRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function collectProjectedFiles(rootPath, currentPath, outputDir, seedMap) {
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await collectProjectedFiles(rootPath, absolutePath, outputDir, seedMap);
      continue;
    }

    const relativePath = toPortableRelativePath(path.relative(rootPath, absolutePath));
    if (HOST_BOOTSTRAP_EXCLUDED_PATHS.has(`${path.basename(rootPath)}/${relativePath}`)) {
      continue;
    }
    seedMap.set(`${outputDir}/${relativePath}`, await readFile(absolutePath, "utf8"));
  }
}

export async function createBootstrapSeedFileMap() {
  const seedMap = new Map();

  for (const projection of SOURCE_PROJECTIONS) {
    const sourceRoot = path.join(PACKAGE_ROOT, projection.sourceDir);
    await collectProjectedFiles(sourceRoot, sourceRoot, projection.outputDir, seedMap);
  }

  return seedMap;
}
