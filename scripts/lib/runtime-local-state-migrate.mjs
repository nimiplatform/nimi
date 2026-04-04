import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const LOCAL_STATE_SCHEMA_VERSION = 2;

function defaultLocalStatePath() {
  return path.join(os.homedir(), '.nimi', 'runtime', 'local-state.json');
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function cloneObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function inferAssetKindFromCapabilities(capabilities) {
  for (const capability of normalizeStringArray(capabilities)) {
    switch (capability.toLowerCase()) {
      case 'chat':
      case 'embedding':
      case 'text.generate':
      case 'text.embed':
        return 1;
      case 'image':
      case 'image.generate':
        return 2;
      case 'video':
      case 'video.generate':
        return 3;
      case 'tts':
      case 'audio.synthesize':
      case 'voice_workflow.tts_v2v':
      case 'voice_workflow.tts_t2v':
        return 4;
      case 'stt':
      case 'audio.transcribe':
        return 5;
      default:
        break;
    }
  }
  return 1;
}

function normalizeFiles(entry, files) {
  const normalizedFiles = normalizeStringArray(files);
  if (normalizedFiles.length > 0) {
    return normalizedFiles;
  }
  const normalizedEntry = normalizeString(entry);
  return normalizedEntry ? [normalizedEntry] : [];
}

function migrateModel(model) {
  const capabilities = normalizeStringArray(model.capabilities);
  return {
    localAssetId: normalizeString(model.localModelId),
    assetId: normalizeString(model.modelId),
    kind: Number.isInteger(model.kind) ? model.kind : inferAssetKindFromCapabilities(capabilities),
    engine: normalizeString(model.engine),
    entry: normalizeString(model.entry),
    files: normalizeFiles(model.entry, model.files),
    license: normalizeString(model.license),
    sourceRepo: normalizeString(model.sourceRepo),
    sourceRevision: normalizeString(model.sourceRevision),
    hashes: cloneObject(model.hashes),
    status: Number.isInteger(model.status) ? model.status : 0,
    installedAt: normalizeString(model.installedAt),
    updatedAt: normalizeString(model.updatedAt),
    healthDetail: normalizeString(model.healthDetail),
    engineRuntimeMode: Number.isInteger(model.engineRuntimeMode) ? model.engineRuntimeMode : 0,
    endpoint: normalizeString(model.endpoint),
    capabilities,
    logicalModelId: normalizeString(model.logicalModelId),
    family: normalizeString(model.family),
    artifactRoles: normalizeStringArray(model.artifactRoles),
    preferredEngine: normalizeString(model.preferredEngine),
    fallbackEngines: normalizeStringArray(model.fallbackEngines),
    bundleState: Number.isInteger(model.bundleState) ? model.bundleState : 0,
    warmState: Number.isInteger(model.warmState) ? model.warmState : 0,
    hostRequirements: cloneObject(model.hostRequirements),
    localInvokeProfileId: normalizeString(model.localInvokeProfileId),
    engineConfig: cloneObject(model.engineConfig),
    metadata: cloneObject(model.metadata),
  };
}

function migrateArtifact(artifact) {
  return {
    localAssetId: normalizeString(artifact.localArtifactId),
    assetId: normalizeString(artifact.artifactId),
    kind: Number.isInteger(artifact.kind) ? artifact.kind : 0,
    engine: normalizeString(artifact.engine),
    entry: normalizeString(artifact.entry),
    files: normalizeFiles(artifact.entry, artifact.files),
    license: normalizeString(artifact.license),
    sourceRepo: normalizeString(artifact.sourceRepo),
    sourceRevision: normalizeString(artifact.sourceRevision),
    hashes: cloneObject(artifact.hashes),
    status: Number.isInteger(artifact.status) ? artifact.status : 0,
    installedAt: normalizeString(artifact.installedAt),
    updatedAt: normalizeString(artifact.updatedAt),
    healthDetail: normalizeString(artifact.healthDetail),
    engineRuntimeMode: Number.isInteger(artifact.engineRuntimeMode) ? artifact.engineRuntimeMode : 0,
    endpoint: normalizeString(artifact.endpoint),
    capabilities: normalizeStringArray(artifact.capabilities),
    logicalModelId: normalizeString(artifact.logicalModelId),
    family: normalizeString(artifact.family),
    artifactRoles: normalizeStringArray(artifact.artifactRoles),
    preferredEngine: normalizeString(artifact.preferredEngine),
    fallbackEngines: normalizeStringArray(artifact.fallbackEngines),
    bundleState: Number.isInteger(artifact.bundleState) ? artifact.bundleState : 0,
    warmState: Number.isInteger(artifact.warmState) ? artifact.warmState : 0,
    hostRequirements: cloneObject(artifact.hostRequirements),
    localInvokeProfileId: normalizeString(artifact.localInvokeProfileId),
    engineConfig: cloneObject(artifact.engineConfig),
    metadata: cloneObject(artifact.metadata),
  };
}

function migrateTransfer(transfer) {
  return {
    installSessionId: normalizeString(transfer.installSessionId),
    assetId: normalizeString(transfer.assetId || transfer.artifactId || transfer.modelId),
    localAssetId: normalizeString(transfer.localAssetId || transfer.localArtifactId || transfer.localModelId),
    sessionKind: normalizeString(transfer.sessionKind),
    phase: normalizeString(transfer.phase),
    state: normalizeString(transfer.state),
    bytesReceived: Number.isFinite(transfer.bytesReceived) ? transfer.bytesReceived : 0,
    bytesTotal: Number.isFinite(transfer.bytesTotal) ? transfer.bytesTotal : 0,
    speedBytesPerSec: Number.isFinite(transfer.speedBytesPerSec) ? transfer.speedBytesPerSec : 0,
    etaSeconds: Number.isFinite(transfer.etaSeconds) ? transfer.etaSeconds : 0,
    message: normalizeString(transfer.message),
    reasonCode: normalizeString(transfer.reasonCode),
    retryable: Boolean(transfer.retryable),
    createdAt: normalizeString(transfer.createdAt),
    updatedAt: normalizeString(transfer.updatedAt),
  };
}

function migrateSnapshot(snapshot) {
  const models = Array.isArray(snapshot.models) ? snapshot.models : [];
  const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
  const services = Array.isArray(snapshot.services) ? snapshot.services.map((item) => ({ ...item })) : [];
  const transfers = Array.isArray(snapshot.transfers) ? snapshot.transfers.map(migrateTransfer) : [];
  const audits = Array.isArray(snapshot.audits) ? snapshot.audits.map((item) => ({ ...item })) : [];

  return {
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    savedAt: normalizeString(snapshot.savedAt) || new Date().toISOString(),
    assets: [...models.map(migrateModel), ...artifacts.map(migrateArtifact)],
    services,
    transfers,
    audits,
  };
}

export async function migrateRuntimeLocalState({ targetPath = defaultLocalStatePath(), write = true } = {}) {
  const resolvedPath = path.resolve(targetPath);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  const snapshot = JSON.parse(raw);
  const schemaVersion = Number(snapshot?.schemaVersion || 0);

  if (schemaVersion === LOCAL_STATE_SCHEMA_VERSION) {
    return {
      migrated: false,
      path: resolvedPath,
      backupPath: null,
      snapshot,
    };
  }

  if (schemaVersion !== 1) {
    throw new Error(`unsupported local-state schemaVersion=${schemaVersion}; expected 1 or ${LOCAL_STATE_SCHEMA_VERSION}`);
  }

  const migratedSnapshot = migrateSnapshot(snapshot);
  let backupPath = null;
  if (write) {
    backupPath = `${resolvedPath}.v1.bak`;
    await fs.copyFile(resolvedPath, backupPath);
    await fs.writeFile(resolvedPath, `${JSON.stringify(migratedSnapshot, null, 2)}\n`, 'utf8');
  }

  return {
    migrated: true,
    path: resolvedPath,
    backupPath,
    snapshot: migratedSnapshot,
  };
}
