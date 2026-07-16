import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEV_WORKSPACE_SURFACES_SCHEMA_VERSION = 1;
export const DEV_WORKSPACE_SURFACES_STAMP = path.join(
  '.nimi', 'local', 'dev-workspace-surfaces.v1.json',
);

export const DEV_WORKSPACE_SURFACES = Object.freeze({
  sdk: Object.freeze({ root: path.join('sdks', 'typescript'), dist: path.join('sdks', 'typescript', 'dist') }),
  kit: Object.freeze({ root: 'kit', dist: path.join('kit', 'dist') }),
});

const IGNORED_DIRECTORY_NAMES = new Set([
  '.cache', '.git', '.turbo', '.vite', 'coverage', 'dist', 'node_modules',
]);

export function classifyWorkspaceSurfacePath(repoRoot, filePath) {
  const relativePath = path.relative(path.resolve(repoRoot), path.resolve(filePath));
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) return null;
  if (segments[0] === 'sdks' && segments[1] === 'typescript') return 'sdk';
  if (segments[0] === 'kit') return 'kit';
  return null;
}

export function resolveCanonicalSurfaceBuildPlan(changedSurfaces) {
  const changed = new Set(changedSurfaces);
  if (changed.has('sdk')) return ['sdk', 'kit'];
  if (changed.has('kit')) return ['kit'];
  return [];
}

export function canonicalSurfaceBuildCommand(surface) {
  if (surface === 'sdk') return ['build:sdk'];
  if (surface === 'kit') return ['build:kit'];
  throw new Error(`unknown workspace surface: ${surface}`);
}

export async function captureWorkspaceSurfaceSnapshot(repoRoot, surface) {
  const definition = DEV_WORKSPACE_SURFACES[surface];
  if (!definition) throw new Error(`unknown workspace surface: ${surface}`);
  const sourceRoot = path.resolve(repoRoot, definition.root);
  const distRoot = path.resolve(repoRoot, definition.dist);
  return {
    sourceLatestMtimeUnixMs: await latestFileMtime(sourceRoot, { ignoreDist: true }),
    distLatestMtimeUnixMs: await latestFileMtime(distRoot),
  };
}

export async function readWorkspaceSurfaceStamp(repoRoot) {
  try {
    const value = JSON.parse(await readFile(path.resolve(repoRoot, DEV_WORKSPACE_SURFACES_STAMP), 'utf8'));
    if (!value || value.schemaVersion !== DEV_WORKSPACE_SURFACES_SCHEMA_VERSION || !value.surfaces) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function writeWorkspaceSurfaceStamp(repoRoot, completedSurfaces, durationMs) {
  const existing = await readWorkspaceSurfaceStamp(repoRoot);
  const surfaces = { ...(existing?.surfaces ?? {}) };
  const completedAtUnixMs = Date.now();
  for (const surface of completedSurfaces) {
    surfaces[surface] = {
      completedAtUnixMs,
      durationMs: Math.max(0, Math.round(durationMs)),
      ...await captureWorkspaceSurfaceSnapshot(repoRoot, surface),
    };
  }
  const output = {
    schemaVersion: DEV_WORKSPACE_SURFACES_SCHEMA_VERSION,
    generatedBy: 'pnpm dev:prepare:watch',
    surfaces,
  };
  const target = path.resolve(repoRoot, DEV_WORKSPACE_SURFACES_STAMP);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
  return output;
}

export function assessWorkspaceSurfaceFreshness(stamp, surface, snapshot) {
  const row = stamp?.schemaVersion === DEV_WORKSPACE_SURFACES_SCHEMA_VERSION
    ? stamp.surfaces?.[surface]
    : undefined;
  if (!row || !Number.isFinite(row.completedAtUnixMs)) {
    return { state: 'missing', reason: 'dev-workspace-surface-stamp-missing' };
  }
  if (!Number.isFinite(snapshot.distLatestMtimeUnixMs) || snapshot.distLatestMtimeUnixMs <= 0) {
    return { state: 'stale', reason: 'dev-workspace-surface-dist-missing' };
  }
  if (snapshot.sourceLatestMtimeUnixMs > row.completedAtUnixMs) {
    return { state: 'stale', reason: 'dev-workspace-surface-source-newer-than-build' };
  }
  return { state: 'fresh', reason: 'dev-workspace-surface-fresh' };
}

export function workspaceSurfaceBuildDiagnostic(surface, stamped, snapshot) {
  const filesystemStale = snapshot.distLatestMtimeUnixMs <= 0
    || snapshot.sourceLatestMtimeUnixMs > snapshot.distLatestMtimeUnixMs;
  if (stamped.state === 'fresh' && !filesystemStale) return null;
  return `${surface}:${filesystemStale ? 'dist-stale' : stamped.reason}`;
}

async function latestFileMtime(root, options = {}) {
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    return 0;
  }
  if (!rootStat.isDirectory()) return rootStat.mtimeMs;
  let latest = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()
      && (IGNORED_DIRECTORY_NAMES.has(entry.name) || (options.ignoreDist && entry.name === 'dist'))) {
      continue;
    }
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, await latestFileMtime(entryPath, options));
    } else if (entry.isFile()) {
      latest = Math.max(latest, (await stat(entryPath)).mtimeMs);
    }
  }
  return latest;
}
