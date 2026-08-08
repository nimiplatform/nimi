import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEV_WORKSPACE_SURFACES_SCHEMA_VERSION = 1;
export const DEV_WORKSPACE_SURFACES_STAMP = path.join(
  '.nimi', 'local', 'dev-workspace-surfaces.v1.json',
);

export const DEV_WORKSPACE_SURFACES = Object.freeze({
  sdk: Object.freeze({
    root: path.join('sdks', 'typescript'),
    dist: path.join('sdks', 'typescript', 'dist'),
    packageManifest: path.join('sdks', 'typescript', 'package.json'),
    additionalInputFiles: Object.freeze(['tsconfig.json']),
  }),
  kit: Object.freeze({ root: 'kit', dist: path.join('kit', 'dist'), packageManifest: path.join('kit', 'package.json') }),
});

function watchTarget(root, recursive) {
  return Object.freeze({ root, recursive });
}

// On Windows, a recursive fs.watch rooted above an atomically renamed directory can
// report descendant events without the renamed directory prefix. Never recursively
// watch a package root that also owns dist; watch only canonical input subtrees.
export const DEV_WORKSPACE_SURFACE_WATCH_TARGETS = Object.freeze({
  sdk: Object.freeze([
    watchTarget('.', false),
    watchTarget(path.join('sdks', 'typescript'), false),
    ...[
      'contracts',
      'core',
      'core-client',
      'core-generated',
      'features',
      'realm',
      'runtime',
      'types',
    ].map((inputRoot) => watchTarget(path.join('sdks', 'typescript', inputRoot), true)),
  ]),
  kit: Object.freeze([
    watchTarget('kit', false),
    ...[
      path.join('auth', 'src'),
      path.join('core', 'src'),
      'features',
      'scripts',
      path.join('shell', 'capabilities', 'src'),
      path.join('shell', 'electron', 'src'),
      path.join('shell', 'renderer', 'src'),
      path.join('telemetry', 'src'),
      path.join('ui', 'src'),
    ].map((inputRoot) => watchTarget(path.join('kit', inputRoot), true)),
  ]),
});

const IGNORED_DIRECTORY_NAMES = new Set([
  '.cache', '.git', '.turbo', '.vite', 'coverage', 'dist', 'node_modules', 'target',
]);
const BUILD_OUTPUT_TEMPORARY_DIRECTORY = /^\.dist\.(?:previous|staging)-/u;
const TYPESCRIPT_NON_BUILD_INPUT = /\.(?:example|test|test-helper|typecheck)\.[cm]?[jt]sx?$/u;

function isSdkCanonicalBuildInput(segments) {
  if (segments.length === 1 && segments[0] === 'tsconfig.json') return true;
  if (segments[0] !== 'sdks' || segments[1] !== 'typescript') return false;
  if (segments.length === 3) {
    return ['index.ts', 'package.json', 'root-client.ts', 'tsconfig.build.json', 'tsconfig.json'].includes(segments[2]);
  }
  if (segments.length < 4) return false;
  if (segments.includes('test') || TYPESCRIPT_NON_BUILD_INPUT.test(segments.at(-1))) return false;
  return [
    'contracts',
    'core',
    'core-client',
    'core-generated',
    'features',
    'realm',
    'runtime',
    'types',
  ].includes(segments[2]);
}

function isKitCanonicalBuildInput(segments) {
  if (segments[0] !== 'kit') return false;
  if (segments.length === 2) {
    return segments[1] === 'package.json'
      || segments[1] === 'tsconfig.json'
      || segments[1] === 'tsconfig.build.json';
  }
  if (segments[1] === 'scripts') return path.extname(segments.at(-1)).toLowerCase() === '.mjs';
  if (segments.includes('test') || TYPESCRIPT_NON_BUILD_INPUT.test(segments.at(-1))) return false;
  if (segments[2] === 'src' && ['auth', 'core', 'telemetry', 'ui'].includes(segments[1])) return true;
  if (segments[1] === 'features' && segments[3] === 'src') return true;
  return segments[1] === 'shell'
    && ['capabilities', 'electron', 'renderer'].includes(segments[2])
    && segments[3] === 'src';
}

export function classifyWorkspaceSurfacePath(repoRoot, filePath) {
  const relativePath = path.relative(path.resolve(repoRoot), path.resolve(filePath));
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) return null;
  if (segments.some((segment) => BUILD_OUTPUT_TEMPORARY_DIRECTORY.test(segment))) return null;
  if (path.extname(relativePath).toLowerCase() === '.node') return null;
  if (isSdkCanonicalBuildInput(segments)) return 'sdk';
  if (isKitCanonicalBuildInput(segments)) return 'kit';
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
  const missingOutputPaths = await missingPackageOutputPaths(repoRoot, definition);
  let sourceLatestMtimeUnixMs = await latestFileMtime(sourceRoot, {
    ignoreDist: true,
    includeFile: (filePath) => classifyWorkspaceSurfacePath(repoRoot, filePath) === surface,
  });
  for (const relativePath of definition.additionalInputFiles ?? []) {
    const inputPath = path.resolve(repoRoot, relativePath);
    if (classifyWorkspaceSurfacePath(repoRoot, inputPath) !== surface) continue;
    sourceLatestMtimeUnixMs = Math.max(sourceLatestMtimeUnixMs, await latestFileMtime(inputPath));
  }
  return {
    sourceLatestMtimeUnixMs,
    distLatestMtimeUnixMs: await latestFileMtime(distRoot),
    outputComplete: missingOutputPaths.length === 0,
    missingOutputPaths,
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
  if (snapshot.outputComplete === false) {
    return { state: 'stale', reason: 'dev-workspace-surface-dist-incomplete' };
  }
  if (snapshot.sourceLatestMtimeUnixMs > row.completedAtUnixMs) {
    return { state: 'stale', reason: 'dev-workspace-surface-source-newer-than-build' };
  }
  return { state: 'fresh', reason: 'dev-workspace-surface-fresh' };
}

export function workspaceSurfaceBuildDiagnostic(surface, stamped, snapshot) {
  if (snapshot.outputComplete === false) return `${surface}:dist-incomplete`;
  const filesystemStale = snapshot.distLatestMtimeUnixMs <= 0
    || snapshot.sourceLatestMtimeUnixMs > snapshot.distLatestMtimeUnixMs;
  if (stamped.state === 'fresh' && !filesystemStale) return null;
  return `${surface}:${filesystemStale ? 'dist-stale' : stamped.reason}`;
}

async function missingPackageOutputPaths(repoRoot, definition) {
  const manifestPath = path.resolve(repoRoot, definition.packageManifest);
  const packageRoot = path.dirname(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return [path.relative(repoRoot, manifestPath)];
  }

  const targets = new Set();
  collectPackageOutputTargets(manifest.exports, targets);
  for (const field of ['main', 'module', 'types']) collectPackageOutputTargets(manifest[field], targets);
  const missing = [];
  for (const target of targets) {
    if (!target.startsWith('./dist/')) continue;
    const absolute = path.resolve(packageRoot, target);
    if (!absolute.startsWith(`${path.resolve(packageRoot)}${path.sep}`)) continue;
    try {
      const metadata = await stat(absolute);
      if (!metadata.isFile()) missing.push(path.relative(repoRoot, absolute));
    } catch {
      missing.push(path.relative(repoRoot, absolute));
    }
  }
  return missing.sort();
}

function collectPackageOutputTargets(value, targets) {
  if (typeof value === 'string') {
    targets.add(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const nested of Object.values(value)) collectPackageOutputTargets(nested, targets);
}

export async function inspectWorkspaceSurfaceFreshness(
  repoRoot,
  surfaces = Object.keys(DEV_WORKSPACE_SURFACES),
) {
  const stamp = await readWorkspaceSurfaceStamp(repoRoot);
  const states = {};
  const diagnostics = [];
  for (const surface of surfaces) {
    const snapshot = await captureWorkspaceSurfaceSnapshot(repoRoot, surface);
    const stamped = assessWorkspaceSurfaceFreshness(stamp, surface, snapshot);
    const diagnostic = workspaceSurfaceBuildDiagnostic(surface, stamped, snapshot);
    states[surface] = { ...stamped, snapshot, diagnostic };
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return {
    fresh: diagnostics.length === 0,
    states,
    diagnostics,
  };
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
      if (options.includeFile && !options.includeFile(entryPath)) continue;
      latest = Math.max(latest, (await stat(entryPath)).mtimeMs);
    }
  }
  return latest;
}
