import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const POLICY_PATH = fileURLToPath(new URL("./seed-policy.yaml", import.meta.url));

const SUPPORTED_OWNERSHIP = new Set(["package_canonical", "host_state_seed"]);

let cachedPolicy = null;

function toPortableRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function loadPolicy() {
  if (cachedPolicy) {
    return cachedPolicy;
  }

  const text = await readFile(POLICY_PATH, "utf8");
  const parsed = YAML.parse(text);

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`seed policy at ${POLICY_PATH} is not a valid YAML object`);
  }

  if (!Array.isArray(parsed.projections) || parsed.projections.length === 0) {
    throw new Error("seed policy is missing required `projections` list");
  }

  const projections = parsed.projections.map((projection) => {
    if (!projection || typeof projection.source_dir !== "string" || typeof projection.output_dir !== "string") {
      throw new Error("seed policy projection entries must declare source_dir and output_dir strings");
    }
    return { sourceDir: projection.source_dir, outputDir: projection.output_dir };
  });

  const defaultOwnership = parsed.default_ownership ?? "package_canonical";
  if (!SUPPORTED_OWNERSHIP.has(defaultOwnership)) {
    throw new Error(`seed policy declares unsupported default_ownership: ${defaultOwnership}`);
  }

  const excludedRaw = Array.isArray(parsed.excluded_projection) ? parsed.excluded_projection : [];
  const excludedSourceRelativePaths = new Set(excludedRaw.map((entry) => String(entry)));

  const overrideEntries = Array.isArray(parsed.ownership_overrides) ? parsed.ownership_overrides : [];
  const ownershipByOutputPath = new Map();
  for (const entry of overrideEntries) {
    if (!entry || typeof entry.path !== "string" || typeof entry.ownership !== "string") {
      throw new Error("seed policy ownership_overrides entries must declare path and ownership strings");
    }
    if (!SUPPORTED_OWNERSHIP.has(entry.ownership)) {
      throw new Error(`seed policy ownership override at ${entry.path} declares unsupported ownership: ${entry.ownership}`);
    }
    ownershipByOutputPath.set(entry.path, entry.ownership);
  }

  cachedPolicy = {
    policyId: parsed.policy_id ?? null,
    projections,
    defaultOwnership,
    excludedSourceRelativePaths,
    ownershipByOutputPath,
  };
  return cachedPolicy;
}

async function collectProjectedEntries(policy, projection, rootPath, currentPath, entries) {
  const directoryEntries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of directoryEntries) {
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await collectProjectedEntries(policy, projection, rootPath, absolutePath, entries);
      continue;
    }

    const relativeFromSourceRoot = toPortableRelativePath(path.relative(rootPath, absolutePath));
    const sourceRelativePath = `${projection.sourceDir}/${relativeFromSourceRoot}`;
    if (policy.excludedSourceRelativePaths.has(sourceRelativePath)) {
      continue;
    }

    const outputRelativePath = `${projection.outputDir}/${relativeFromSourceRoot}`;
    const ownership = policy.ownershipByOutputPath.get(outputRelativePath) ?? policy.defaultOwnership;
    const content = await readFile(absolutePath, "utf8");
    entries.push({
      outputRelativePath,
      sourceRelativePath,
      sourceAbsolutePath: absolutePath,
      content,
      ownership,
    });
  }
}

export async function loadSeedPolicy() {
  return loadPolicy();
}

export async function getBootstrapSeedEntries() {
  const policy = await loadPolicy();
  const entries = [];

  for (const projection of policy.projections) {
    const sourceRoot = path.join(PACKAGE_ROOT, projection.sourceDir);
    await collectProjectedEntries(policy, projection, sourceRoot, sourceRoot, entries);
  }

  entries.sort((a, b) => a.outputRelativePath.localeCompare(b.outputRelativePath));
  return entries;
}

export async function createBootstrapSeedFileMap() {
  const entries = await getBootstrapSeedEntries();
  const seedMap = new Map();
  for (const entry of entries) {
    seedMap.set(entry.outputRelativePath, entry.content);
  }
  return seedMap;
}
