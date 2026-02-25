/* global process */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModsRoot as resolveModsRootFromEnv } from './mod-paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const resourceRoot = path.join(projectRoot, 'src-tauri', 'resources', 'default-mods');

async function exists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function resolveManifestPath(modDir) {
  const candidates = ['mod.manifest.yaml', 'mod.manifest.yml', 'mod.manifest.json'];
  for (const filename of candidates) {
    const candidate = path.join(modDir, filename);
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function resolveModsRoot() {
  const modsRoot = resolveModsRootFromEnv({ required: true, mustExist: true });
  if (!(await exists(modsRoot))) {
    throw new Error(`NIMI_MODS_ROOT does not exist: ${modsRoot}`);
  }
  return modsRoot;
}

async function main() {
  const modsRoot = await resolveModsRoot();
  await fs.rm(resourceRoot, { recursive: true, force: true });
  await fs.mkdir(resourceRoot, { recursive: true });

  const modEntries = await fs.readdir(modsRoot, { withFileTypes: true });
  const copied = [];
  const skippedWithoutDist = [];

  for (const entry of modEntries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const modDir = path.join(modsRoot, entry.name);
    const manifestPath = await resolveManifestPath(modDir);
    if (!manifestPath) continue;

    const distDir = path.join(modDir, 'dist');
    if (!(await exists(distDir))) {
      skippedWithoutDist.push(entry.name);
      continue;
    }

    const targetModDir = path.join(resourceRoot, entry.name);
    await fs.mkdir(targetModDir, { recursive: true });
    await fs.copyFile(manifestPath, path.join(targetModDir, path.basename(manifestPath)));
    await copyDir(distDir, path.join(targetModDir, 'dist'));
    copied.push(entry.name);
  }

  if (skippedWithoutDist.length > 0) {
    process.stdout.write(
      `[prepare-default-mods] skipped (missing dist): ${skippedWithoutDist.join(', ')}\n`,
    );
  }

  if (copied.length === 0) {
    throw new Error(
      `No built mod artifacts found under ${modsRoot}. Build at least one mod first (e.g. "pnpm --filter @nimiplatform/desktop run build:mods").`,
    );
  }

  process.stdout.write(`[prepare-default-mods] copied: ${copied.join(', ')}\n`);
}

main().catch((error) => {
  process.stderr.write(`[prepare-default-mods] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
