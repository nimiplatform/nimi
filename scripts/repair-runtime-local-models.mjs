import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const LOCAL_STATE_SCHEMA_VERSION = 2;
const KNOWN_KIND_TOKENS = new Map([
  [1, 'chat'],
  [2, 'image'],
  [3, 'video'],
  [4, 'tts'],
  [5, 'stt'],
  [10, 'vae'],
  [11, 'clip'],
  [12, 'lora'],
  [13, 'controlnet'],
  [14, 'auxiliary'],
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function defaultConfigPath() {
  return path.join(os.homedir(), '.nimi', 'config.json');
}

function defaultLocalStatePath() {
  return path.join(os.homedir(), '.nimi', 'runtime', 'local-state.json');
}

function expandHome(value) {
  const text = normalizeString(value);
  if (!text.startsWith('~/')) {
    return text;
  }
  return path.join(os.homedir(), text.slice(2));
}

function toFileURLString(filePath) {
  return `file://${filePath.replace(/\\/g, '/')}`;
}

function slugify(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function runtimeManagedResolvedDir(modelsRoot, logicalModelId) {
  return path.join(modelsRoot, 'resolved', ...normalizeString(logicalModelId).split('/').filter(Boolean));
}

function runtimeManagedPassiveDir(modelsRoot, assetId) {
  return path.join(modelsRoot, 'resolved', slugify(assetId));
}

function manifestPathForAsset(modelsRoot, asset) {
  const logicalModelId = normalizeString(asset.logicalModelId);
  const baseDir = logicalModelId
    ? runtimeManagedResolvedDir(modelsRoot, logicalModelId)
    : runtimeManagedPassiveDir(modelsRoot, asset.assetId);
  return path.join(baseDir, 'asset.manifest.json');
}

function entryPathForAsset(modelsRoot, asset) {
  return path.join(path.dirname(manifestPathForAsset(modelsRoot, asset)), normalizeString(asset.entry));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function inferKind(asset) {
  const explicit = Number(asset.kind || 0);
  if (KNOWN_KIND_TOKENS.has(explicit) && explicit !== 1) {
    return explicit;
  }
  const capabilities = normalizeArray(asset.capabilities).map((item) => item.toLowerCase());
  if (capabilities.includes('image') || capabilities.includes('image.generate')) {
    return 2;
  }
  if (capabilities.includes('video') || capabilities.includes('video.generate')) {
    return 3;
  }
  if (capabilities.includes('tts') || capabilities.includes('audio.synthesize')) {
    return 4;
  }
  if (capabilities.includes('stt') || capabilities.includes('audio.transcribe')) {
    return 5;
  }
  const entry = normalizeString(asset.entry).toLowerCase();
  const assetId = normalizeString(asset.assetId).toLowerCase();
  if (entry === 'ae.safetensors' || entry === 'vae.safetensors' || assetId.endsWith('/ae') || assetId.endsWith('/vae')) {
    return 10;
  }
  return 1;
}

function manifestKindToken(kind) {
  return KNOWN_KIND_TOKENS.get(Number(kind || 0)) || 'chat';
}

function chooseRestoredStatus(asset, backupAsset, kind) {
  if (Number(kind) >= 10) {
    return 1;
  }
  const backupStatus = Number(backupAsset?.status || 0);
  if (backupStatus === 3) {
    return 3;
  }
  return 1;
}

function restoredHealthDetail(asset, backupAsset, status) {
  if (status === 3) {
    return normalizeString(backupAsset?.healthDetail) || normalizeString(asset.healthDetail);
  }
  return '';
}

function buildBackupIndex(snapshot) {
  const byLocalId = new Map();
  if (!snapshot || typeof snapshot !== 'object') {
    return byLocalId;
  }
  for (const item of Array.isArray(snapshot.models) ? snapshot.models : []) {
    const localId = normalizeString(item.localModelId);
    if (localId) {
      byLocalId.set(localId, item);
    }
  }
  for (const item of Array.isArray(snapshot.artifacts) ? snapshot.artifacts : []) {
    const localId = normalizeString(item.localArtifactId);
    if (localId) {
      byLocalId.set(localId, item);
    }
  }
  return byLocalId;
}

function runtimeManifestFromAsset(asset, manifestRepo) {
  const kind = inferKind(asset);
  const manifest = {
    schemaVersion: '1.0.0',
    asset_id: normalizeString(asset.assetId),
    kind: manifestKindToken(kind),
    engine: normalizeString(asset.engine),
    entry: normalizeString(asset.entry),
    files: normalizeArray(asset.files).length > 0 ? normalizeArray(asset.files) : [normalizeString(asset.entry)].filter(Boolean),
    license: normalizeString(asset.license) || 'unknown',
    source: {
      repo: manifestRepo,
      revision: normalizeString(asset.sourceRevision) || 'local',
    },
    integrity_mode: 'local_unverified',
    hashes: normalizeObject(asset.hashes),
  };
  const logicalModelId = normalizeString(asset.logicalModelId);
  if (logicalModelId) {
    manifest.logical_model_id = logicalModelId;
  }
  const capabilities = normalizeArray(asset.capabilities);
  if (capabilities.length > 0) {
    manifest.capabilities = capabilities;
  }
  const endpoint = normalizeString(asset.endpoint);
  if (endpoint) {
    manifest.endpoint = endpoint;
  }
  const family = normalizeString(asset.family);
  if (family) {
    manifest.family = family;
  }
  const preferredEngine = normalizeString(asset.preferredEngine);
  if (preferredEngine) {
    manifest.preferred_engine = preferredEngine;
  }
  const fallbackEngines = normalizeArray(asset.fallbackEngines);
  if (fallbackEngines.length > 0) {
    manifest.fallback_engines = fallbackEngines;
  }
  const artifactRoles = normalizeArray(asset.artifactRoles);
  if (artifactRoles.length > 0) {
    manifest.artifact_roles = artifactRoles;
  }
  const engineConfig = normalizeObject(asset.engineConfig);
  if (Object.keys(engineConfig).length > 0) {
    manifest.engine_config = engineConfig;
  }
  const localInvokeProfileId = normalizeString(asset.localInvokeProfileId);
  if (localInvokeProfileId) {
    manifest.local_invoke_profile_id = localInvokeProfileId;
  }
  return manifest;
}

function parseSourceRepoPath(sourceRepo) {
  const repo = normalizeString(sourceRepo);
  if (!repo.toLowerCase().startsWith('file://')) {
    return '';
  }
  return path.normalize(repo.slice('file://'.length));
}

async function findCandidateEntryPath(modelsRoot, asset) {
  const candidates = [];
  const expectedEntry = entryPathForAsset(modelsRoot, asset);
  candidates.push(expectedEntry);

  const sourceRepoPath = parseSourceRepoPath(asset.sourceRepo);
  if (sourceRepoPath) {
    candidates.push(path.join(path.dirname(sourceRepoPath), normalizeString(asset.entry)));
  }

  candidates.push(path.join(modelsRoot, normalizeString(asset.entry)));
  candidates.push(path.join(path.dirname(modelsRoot), 'backup', normalizeString(asset.entry)));

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return '';
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeJson(filePath, value) {
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function repairAsset(modelsRoot, asset, backupAsset, write) {
  const normalized = {
    ...asset,
    assetId: normalizeString(asset.assetId),
    entry: normalizeString(asset.entry),
    engine: normalizeString(asset.engine),
    sourceRepo: normalizeString(asset.sourceRepo),
    sourceRevision: normalizeString(asset.sourceRevision),
    logicalModelId: normalizeString(asset.logicalModelId),
    files: normalizeArray(asset.files),
    capabilities: normalizeArray(asset.capabilities),
    artifactRoles: normalizeArray(asset.artifactRoles),
    fallbackEngines: normalizeArray(asset.fallbackEngines),
    hashes: normalizeObject(asset.hashes),
    engineConfig: normalizeObject(asset.engineConfig),
  };
  const kind = inferKind({ ...normalized, kind: backupAsset?.kind ?? normalized.kind });
  const manifestPath = manifestPathForAsset(modelsRoot, normalized);
  const entryPath = entryPathForAsset(modelsRoot, normalized);
  const legacyManifestPath = path.join(path.dirname(manifestPath), 'manifest.json');
  const sourceRepoPath = parseSourceRepoPath(normalized.sourceRepo);
  const candidateEntryPath = await findCandidateEntryPath(modelsRoot, normalized);
  const manifestRepo = normalized.logicalModelId
    ? toFileURLString(manifestPath)
    : `local-import/${slugify(normalized.assetId)}`;

  let repaired = false;
  let restored = false;

  if (candidateEntryPath && path.normalize(candidateEntryPath) !== path.normalize(entryPath)) {
    if (write) {
      await ensureParentDir(entryPath);
      await fs.copyFile(candidateEntryPath, entryPath);
    }
    repaired = true;
  }

  if (!(await fileExists(entryPath)) && candidateEntryPath) {
    if (write) {
      await ensureParentDir(entryPath);
      await fs.copyFile(candidateEntryPath, entryPath);
    }
    repaired = true;
  }

  let existingManifest = null;
  for (const candidate of [manifestPath, legacyManifestPath, sourceRepoPath]) {
    if (!candidate) {
      continue;
    }
    try {
      existingManifest = await readJsonIfExists(candidate);
      if (existingManifest) {
        break;
      }
    } catch {
      // Ignore invalid legacy manifests and rewrite from state.
    }
  }

  if (await fileExists(entryPath)) {
    const manifest = {
      ...normalizeObject(existingManifest),
      ...runtimeManifestFromAsset({ ...normalized, kind }, manifestRepo),
    };
    if (write) {
      await writeJson(manifestPath, manifest);
    }
    if (sourceRepoPath && path.normalize(sourceRepoPath) !== path.normalize(manifestPath) && await fileExists(sourceRepoPath)) {
      // Leave the legacy file in place, but prefer the canonical manifest path from now on.
      repaired = true;
    } else if (await fileExists(legacyManifestPath) && !(await fileExists(manifestPath))) {
      repaired = true;
    } else {
      repaired = true;
    }

    const nextStatus = chooseRestoredStatus(normalized, backupAsset, kind);
    if (Number(normalized.status || 0) === 4 || normalizeString(normalized.healthDetail).toLowerCase() === 'model removed') {
      restored = true;
    }
    normalized.status = nextStatus;
    normalized.healthDetail = restoredHealthDetail(normalized, backupAsset, nextStatus);
    normalized.kind = kind;
    normalized.sourceRepo = manifestRepo;
    normalized.sourceRevision = normalizeString(backupAsset?.sourceRevision) || normalizeString(normalized.sourceRevision) || 'local';
    normalized.files = normalizeArray(normalized.files).length > 0 ? normalizeArray(normalized.files) : [normalized.entry];
  }

  return {
    asset: normalized,
    repaired,
    restored,
    manifestPath: write
      ? (await fileExists(manifestPath) ? manifestPath : '')
      : manifestPath,
    entryPath: write
      ? (await fileExists(entryPath) ? entryPath : '')
      : entryPath,
  };
}

async function resolveModelsRoot(configPath, explicitModelsRoot) {
  if (normalizeString(explicitModelsRoot)) {
    return path.resolve(expandHome(explicitModelsRoot));
  }
  const config = await readJsonIfExists(configPath);
  const configured = expandHome(config?.localModelsPath);
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(path.join(os.homedir(), '.nimi', 'data', 'models'));
}

function parseArgs(argv) {
  const result = {
    write: false,
    localStatePath: '',
    configPath: '',
    modelsRoot: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      result.write = true;
      continue;
    }
    if (arg === '--local-state-path') {
      result.localStatePath = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--config-path') {
      result.configPath = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--models-root') {
      result.modelsRoot = argv[index + 1] || '';
      index += 1;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(expandHome(args.configPath || defaultConfigPath()));
  const localStatePath = path.resolve(expandHome(args.localStatePath || defaultLocalStatePath()));
  const modelsRoot = await resolveModelsRoot(configPath, args.modelsRoot);
  const snapshot = await readJsonIfExists(localStatePath);
  if (!snapshot) {
    throw new Error(`local state not found: ${localStatePath}`);
  }
  if (Number(snapshot.schemaVersion || 0) !== LOCAL_STATE_SCHEMA_VERSION) {
    throw new Error(`unsupported local-state schemaVersion=${snapshot.schemaVersion}; expected ${LOCAL_STATE_SCHEMA_VERSION}`);
  }

  const backupSnapshot = await readJsonIfExists(`${localStatePath}.v1.bak`);
  const backupIndex = buildBackupIndex(backupSnapshot);
  const assets = Array.isArray(snapshot.assets) ? snapshot.assets : [];
  const repairedAssets = [];
  const repairedSummaries = [];

  for (const asset of assets) {
    const localAssetId = normalizeString(asset.localAssetId);
    const backupAsset = backupIndex.get(localAssetId) || null;
    const repaired = await repairAsset(modelsRoot, asset, backupAsset, args.write);
    repairedAssets.push(repaired.asset);
    if (repaired.repaired || repaired.restored) {
      repairedSummaries.push({
        localAssetId,
        assetId: normalizeString(asset.assetId),
        restored: repaired.restored,
        manifestPath: repaired.manifestPath,
        entryPath: repaired.entryPath,
      });
    }
  }

  const nextSnapshot = {
    ...snapshot,
    savedAt: new Date().toISOString(),
    assets: repairedAssets,
  };

  if (args.write) {
    const repairBackupPath = `${localStatePath}.pre-local-model-repair.bak`;
    if (!(await fileExists(repairBackupPath))) {
      await fs.copyFile(localStatePath, repairBackupPath);
    }
    await writeJson(localStatePath, nextSnapshot);
  }

  const lines = [
    `mode=${args.write ? 'write' : 'dry-run'}`,
    `config=${configPath}`,
    `local_state=${localStatePath}`,
    `models_root=${modelsRoot}`,
    `assets_examined=${assets.length}`,
    `assets_repaired=${repairedSummaries.length}`,
  ];
  for (const item of repairedSummaries) {
    lines.push(`asset=${item.assetId} local_asset_id=${item.localAssetId} restored=${item.restored} manifest=${item.manifestPath || '-'} entry=${item.entryPath || '-'}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
