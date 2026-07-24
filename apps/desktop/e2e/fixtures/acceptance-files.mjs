import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export function seedAdmittedProductControlFromUserHome({ homeDir, stateRoot }) {
  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  if (!userHome) {
    return { seeded: false, reason: 'user_home_unavailable' };
  }
  const sourceProductControlPath = path.join(userHome, '.nimi', 'nimi.json');
  const sourceLocalStatePath = path.join(userHome, '.nimi', 'runtime', 'local-state.json');
  if (!fs.existsSync(sourceProductControlPath) || !fs.existsSync(sourceLocalStatePath)) {
    return { seeded: false, reason: 'admitted_product_control_source_missing' };
  }
  const productControl = readJsonFile(sourceProductControlPath);
  if (productControl?.state !== 'ready_for_use') {
    return { seeded: false, reason: `source_product_control_not_ready:${String(productControl?.state || '')}` };
  }
  const targetProductControlPath = path.join(homeDir, '.nimi', 'nimi.json');
  const targetLocalStatePath = path.join(stateRoot, 'local-state.json');
  fs.mkdirSync(path.dirname(targetProductControlPath), { recursive: true });
  fs.mkdirSync(path.dirname(targetLocalStatePath), { recursive: true });
  fs.copyFileSync(sourceProductControlPath, targetProductControlPath);
  fs.copyFileSync(sourceLocalStatePath, targetLocalStatePath);
  return {
    seeded: true,
    productControlState: productControl.state,
    sourceDataRoot: String(productControl?.dataRoot?.path || ''),
    targetProductControlPath,
    targetLocalStatePath,
  };
}

export function retargetAdmittedProductControlSeed({ seed, targetDataRoot }) {
  if (!seed?.seeded || !targetDataRoot) return seed;
  const sourceRoot = normalizeOptionalPath(seed.sourceDataRoot);
  if (!sourceRoot) throw new Error('admitted product-control seed has no source data root');
  const replaceRoot = (value) => {
    if (typeof value === 'string') return value.split(sourceRoot).join(targetDataRoot);
    if (Array.isArray(value)) return value.map(replaceRoot);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceRoot(item)]));
    return value;
  };
  const originalLocalState = readJsonFile(seed.targetLocalStatePath);
  const dependencyRoots = collectExistingDataRootDependencies({
    value: {
      assets: originalLocalState.assets,
      localEnvironmentSelectedSourceRecords: originalLocalState.localEnvironmentSelectedSourceRecords,
      runtimeBaselineReadinessRecords: originalLocalState.runtimeBaselineReadinessRecords,
      firstRunExecutionEvidenceRecords: originalLocalState.firstRunExecutionEvidenceRecords,
    },
    sourceRoot,
  });
  const materialization = createDependencyMaterializationStats();
  for (const source of dependencyRoots) {
    const target = path.join(targetDataRoot, path.relative(sourceRoot, source));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    cloneDataRootDependency(source, target, materialization);
  }
  const productControl = replaceRoot(readJsonFile(seed.targetProductControlPath));
  const localState = replaceRoot(originalLocalState);
  localState.audits = [];
  localState.transfers = [];
  localState.savedAt = new Date().toISOString();
  writeJsonFile(seed.targetProductControlPath, productControl);
  writeJsonFile(seed.targetLocalStatePath, localState);
  return { ...seed, targetDataRoot, retargeted: true, dependencyMaterialization: materialization };
}

// Immutable model/dependency artifacts at or above this size are hardlinked into the
// trial data root instead of byte-copied. Small files (manifests, registry JSON) stay
// real copies because the runtime may rewrite them in place, and an in-place write
// through a hardlink would corrupt the admitted source data root.
export const DEPENDENCY_LINK_THRESHOLD_BYTES = 4 * 1024 * 1024;

function createDependencyMaterializationStats() {
  return { linkedFiles: 0, linkedBytes: 0, copiedFiles: 0, copiedBytes: 0, linkFallbackCode: null };
}

export function cloneDataRootDependency(source, target, stats, linkThresholdBytes = DEPENDENCY_LINK_THRESHOLD_BYTES) {
  const info = fs.lstatSync(source);
  if (info.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      cloneDataRootDependency(path.join(source, entry), path.join(target, entry), stats, linkThresholdBytes);
    }
    return stats;
  }
  if (info.isSymbolicLink()) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { force: true, verbatimSymlinks: true });
    return stats;
  }
  if (!info.isFile()) {
    throw new Error(`data-root dependency ${source} is neither a regular file, directory, nor symlink`);
  }
  fs.rmSync(target, { force: true });
  if (info.size >= linkThresholdBytes) {
    try {
      fs.linkSync(source, target);
      stats.linkedFiles += 1;
      stats.linkedBytes += info.size;
      return stats;
    } catch (error) {
      if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EMLINK'].includes(error?.code)) throw error;
      if (!stats.linkFallbackCode) stats.linkFallbackCode = error.code;
    }
  }
  fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
  stats.copiedFiles += 1;
  stats.copiedBytes += info.size;
  return stats;
}

export function seedDeterministicAttachedLocalRoutes({ seed, stateRoot, providerBaseUrl }) {
  if (!seed?.seeded) return { ...seed, deterministicRoutesSeeded: false };
  const localState = readJsonFile(seed.targetLocalStatePath);
  const now = new Date().toISOString();
  const asset = ({ id, modelId, kind, capabilities, metadata = {} }) => ({
    localAssetId: id,
    assetId: `local/${modelId}`,
    kind,
    capabilities,
    engine: 'llama',
    entry: `${modelId}.gguf`,
    files: [`${modelId}.gguf`],
    license: 'test-fixture',
    sourceRepo: 'desktop-local-agent-product-acceptance',
    sourceRevision: 'fixture',
    hashes: {},
    status: 2,
    installedAt: now,
    updatedAt: now,
    healthDetail: 'deterministic attached acceptance route active',
    engineRuntimeMode: 2,
    endpoint: providerBaseUrl,
    logicalModelId: `local/${modelId}`,
    family: 'local-agent-product-acceptance',
    artifactRoles: [],
    preferredEngine: 'llama',
    fallbackEngines: [],
    bundleState: 2,
    warmState: 3,
    hostRequirements: {},
    engineConfig: {},
    metadata: { fixture: 'local-agent-product-acceptance', ...metadata },
  });
  localState.assets = [
    asset({
      id: 'local-asset-runtime-agent-live-e2e-chat',
      modelId: 'runtime-agent-live-e2e',
      kind: 1,
      capabilities: ['chat', 'text.generate'],
    }),
    asset({
      id: 'local-asset-runtime-agent-live-e2e-embedding',
      modelId: 'runtime-agent-live-e2e-embedding',
      kind: 6,
      capabilities: ['text.embed'],
      metadata: { 'embedding.dimension': 4 },
    }),
  ];
  localState.savedAt = now;
  writeJsonFile(seed.targetLocalStatePath, localState);
  const catalogDir = path.join(stateRoot, 'model-catalog-custom');
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(path.join(catalogDir, 'local.yaml'), `version: 1
provider: local
catalog_version: local-agent-product-acceptance
models:
  - model_id: runtime-agent-live-e2e
    provider: local
    model_type: chat
    updated_at: "2026-07-11"
    capabilities:
      - text.generate
    pricing:
      unit: request
      input: "0"
      output: "0"
      currency: none
      as_of: "2026-07-11"
      notes: Deterministic local-agent product acceptance route.
    source_ref:
      url: http://127.0.0.1/local-agent-product-acceptance/catalog
      retrieved_at: "2026-07-11"
      note: Deterministic local-agent product acceptance route.
    fitness:
      param_count: 1
      context_length: 32768
    aliases:
      - local/runtime-agent-live-e2e
`);
  fs.writeFileSync(path.join(catalogDir, 'openai.yaml'), `version: 1
provider: openai
catalog_version: local-agent-product-openai-media
models:
  - model_id: gpt-image-1.5
    provider: openai
    model_type: image
    updated_at: "2026-07-12"
    capabilities: [image.generate]
    pricing: {unit: request, input: "0", output: "0", currency: USD, as_of: "2026-07-12", notes: Deterministic product Journey image route.}
    source_ref: {url: http://127.0.0.1/local-agent-product/image-catalog, retrieved_at: "2026-07-12", note: Deterministic product Journey image route.}
    image_request_options:
      response_formats: [b64_json, url]
      max_images_per_request: 1
      supports_negative_prompt: true
      supports_reference_images: true
      supports_mask: true
      supports_seed: true
      supports_size: true
      supports_aspect_ratio: true
      supports_quality: true
      supports_style: true
  - model_id: gpt-4o-mini-transcribe-runtime-live
    provider: openai
    model_type: stt
    updated_at: "2026-07-12"
    capabilities: [audio.transcribe]
    pricing: {unit: request, input: "0", output: "0", currency: USD, as_of: "2026-07-12", notes: Deterministic product Journey transcription route.}
    source_ref: {url: http://127.0.0.1/local-agent-product/transcription-catalog, retrieved_at: "2026-07-12", note: Deterministic product Journey transcription route.}
    transcription:
      tiers: [core_transcript]
      response_formats: [json]
      supports_language: true
      supports_prompt: true
`);
  fs.writeFileSync(path.join(catalogDir, 'dashscope.yaml'), `version: 1
provider: dashscope
catalog_version: local-agent-product-native-voice
models:
  - model_id: qwen3-tts-runtime-live-native-stream
    provider: dashscope
    model_type: tts
    updated_at: "2026-07-12"
    capabilities: [audio.synthesize]
    pricing: {unit: request, input: "0", output: "0", currency: USD, as_of: "2026-07-12", notes: Deterministic product Journey native TTS route.}
    source_ref: {url: http://127.0.0.1/local-agent-product/voice-catalog, retrieved_at: "2026-07-12", note: Deterministic product Journey native TTS route.}
    voice_set_id: dashscope:runtime-agent-live-e2e-voice-set
    voice_discovery_mode: static_catalog
    voice_request_options:
      timing_modes: [none, word]
      audio_formats: [wav]
      supports_native_stream_tts: true
    voice_ref_kinds: [preset_voice_id, voice_asset_id]
voices:
  - voice_set_id: dashscope:runtime-agent-live-e2e-voice-set
    provider: dashscope
    voice_id: runtime-live-voice
    name: Runtime Live Voice
    langs: [zh, en]
    model_ids: [qwen3-tts-runtime-live-native-stream]
    source_ref: {url: http://127.0.0.1/local-agent-product/voice-catalog, retrieved_at: "2026-07-12", note: Deterministic product Journey native TTS route.}
`);
  return { ...seed, deterministicRoutesSeeded: true, catalogDir };
}

function collectExistingDataRootDependencies({ value, sourceRoot }) {
  const candidates = new Set();
  const visit = (input) => {
    if (typeof input === 'string') {
      const normalized = input.startsWith('file://') ? input.slice('file://'.length) : input;
      if (normalized.startsWith(`${sourceRoot}${path.sep}`) && fs.existsSync(normalized)) candidates.add(normalized);
      return;
    }
    if (Array.isArray(input)) input.forEach(visit);
    else if (input && typeof input === 'object') Object.values(input).forEach(visit);
  };
  visit(value);
  return [...candidates]
    .sort((left, right) => left.length - right.length)
    .filter((candidate, index, values) => !values.slice(0, index).some((parent) => candidate.startsWith(`${parent}${path.sep}`)));
}

export function normalizeOptionalPath(value) {
  return String(value || '').trim();
}

export async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

export async function terminateDaemon(daemon) {
  if (process.platform === 'win32' && daemon.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(daemon.pid), '/T', '/F'], { stdio: 'ignore' });
    await delay(1000);
    return;
  }
  let signaledProcessGroup = false;
  if (daemon.pid !== undefined) {
    try {
      process.kill(-daemon.pid, 'SIGTERM');
      signaledProcessGroup = true;
    } catch {
      try {
        process.kill(daemon.pid, 'SIGTERM');
      } catch {
        return;
      }
    }
  }
  const [daemonExitedAfterTerm, processGroupExitedAfterTerm] = await Promise.all([
    waitForDaemonExit(daemon, 5_000),
    signaledProcessGroup && daemon.pid !== undefined
      ? waitForProcessGroupExit(daemon.pid, 5_000)
      : Promise.resolve(true),
  ]);
  if (daemonExitedAfterTerm && processGroupExitedAfterTerm) return;
  if (daemon.pid !== undefined) {
    try {
      process.kill(signaledProcessGroup ? -daemon.pid : daemon.pid, 'SIGKILL');
    } catch {
      try {
        process.kill(daemon.pid, 'SIGKILL');
      } catch {
        // The process may have exited between the timeout and escalation.
      }
    }
  }
  const [daemonExitedAfterKill, processGroupExitedAfterKill] = await Promise.all([
    waitForDaemonExit(daemon, 2_000),
    signaledProcessGroup && daemon.pid !== undefined
      ? waitForProcessGroupExit(daemon.pid, 2_000)
      : Promise.resolve(true),
  ]);
  if (!daemonExitedAfterKill || !processGroupExitedAfterKill) {
    throw new Error(`Runtime daemon process group ${String(daemon.pid || '')} did not terminate`);
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const startedAt = Date.now();
  while (processGroupAlive(processGroupId)) {
    if (Date.now() - startedAt >= timeoutMs) return false;
    await delay(25);
  }
  return true;
}

function processGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function waitForDaemonExit(daemon, timeoutMs) {
  if (daemon.exitCode !== null || daemon.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      daemon.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    daemon.once('exit', onExit);
  });
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} failed with ${response.status}`);
  }
  return response.json();
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function safeResetDir(dir, { reportsRoot }) {
  const resolved = path.resolve(dir);
  const reportsRootPath = path.resolve(reportsRoot);
  if (!resolved.startsWith(reportsRootPath + path.sep)) {
    throw new Error(`refusing to reset non-report directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? String(error.cause) : undefined,
    };
  }
  return { message: String(error || '') };
}
