#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultModelsRootValue = path.join(os.homedir(), '.nimi', 'data', 'models');
const defaultEngineRootValue = path.join(os.homedir(), '.nimi', 'engines', 'speech', 'qwen3');
const defaultTTSVenvRootValue = path.join(defaultEngineRootValue, 'tts-python');
const defaultASRVenvRootValue = path.join(defaultEngineRootValue, 'asr-python');
const defaultCacheRootValue = path.join(os.homedir(), '.nimi', 'cache', 'huggingface');
const defaultPythonVersion = '3.12';
const defaultHostPackages = [
  'huggingface-hub',
  'fastapi==0.121.1',
  'uvicorn[standard]==0.38.0',
  'python-multipart',
];
const defaultTTSPackages = [
  'qwen-tts',
  'soundfile',
  ...defaultHostPackages,
];
const defaultASRPackages = [
  'qwen-asr',
  ...defaultHostPackages,
];
const installStateFileName = '.qwen3-speech-bootstrap.json';

const manifestSpecs = [
  {
    modelID: 'speech/qwen3tts',
    logicalModelID: 'nimi/tts-qwen3-customvoice',
    modelRef: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    entryName: 'qwen3-tts-customvoice-entry.json',
    capabilities: ['audio.synthesize'],
    family: 'qwen3_tts',
    driverBackend: 'qwen_tts',
  },
  {
    modelID: 'speech/qwen3tts-base',
    logicalModelID: 'nimi/voice-qwen3-tts-base',
    modelRef: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
    entryName: 'qwen3-tts-base-entry.json',
    capabilities: ['audio.synthesize'],
    family: 'qwen3_tts',
    driverBackend: 'qwen_tts',
  },
  {
    modelID: 'speech/qwen3tts-design',
    logicalModelID: 'nimi/voice-qwen3-tts-voicedesign',
    modelRef: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    entryName: 'qwen3-tts-voicedesign-entry.json',
    capabilities: ['audio.synthesize'],
    family: 'qwen3_tts',
    driverBackend: 'qwen_tts',
  },
  {
    modelID: 'speech/qwen3asr',
    logicalModelID: 'nimi/stt-qwen3-asr',
    modelRef: 'Qwen/Qwen3-ASR-0.6B',
    entryName: 'qwen3-asr-entry.json',
    capabilities: ['audio.transcribe'],
    family: 'qwen3_asr',
    driverBackend: 'qwen_asr',
  },
];

function expandHome(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('~/')) {
    return text;
  }
  return path.join(os.homedir(), text.slice(2));
}

function quoteShell(value) {
  const text = String(value || '');
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function parseArgs(argv) {
  const options = {
    modelsRoot: expandHome(process.env.NIMI_RUNTIME_LOCAL_MODELS_PATH || defaultModelsRootValue),
    engineRoot: defaultEngineRootValue,
    ttsVenvRoot: defaultTTSVenvRootValue,
    asrVenvRoot: defaultASRVenvRootValue,
    cacheRoot: expandHome(process.env.HF_HOME || defaultCacheRootValue),
    speechBaseURL: '',
    skipInstall: false,
    refreshInstall: false,
    prefetchModels: false,
    quiet: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--models-root') {
      options.modelsRoot = expandHome(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--engine-root' || arg === '--venv-root') {
      options.engineRoot = expandHome(argv[index + 1] || '');
      options.ttsVenvRoot = path.join(options.engineRoot, 'tts-python');
      options.asrVenvRoot = path.join(options.engineRoot, 'asr-python');
      index += 1;
      continue;
    }
    if (arg === '--tts-venv-root') {
      options.ttsVenvRoot = expandHome(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--asr-venv-root') {
      options.asrVenvRoot = expandHome(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--cache-root') {
      options.cacheRoot = expandHome(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--speech-base-url') {
      options.speechBaseURL = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--skip-install') {
      options.skipInstall = true;
      continue;
    }
    if (arg === '--refresh-install') {
      options.refreshInstall = true;
      continue;
    }
    if (arg === '--prefetch-models') {
      options.prefetchModels = true;
      continue;
    }
    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.modelsRoot) {
    throw new Error('models root required');
  }
  if (!options.ttsVenvRoot) {
    throw new Error('tts venv root required');
  }
  if (!options.asrVenvRoot) {
    throw new Error('asr venv root required');
  }
  if (!options.cacheRoot) {
    throw new Error('cache root required');
  }
  return options;
}

function execOrFail(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim() || `${command} exited non-zero`;
    throw new Error(detail);
  }
  return result;
}

function pythonExecutable(venvRoot) {
  return path.join(venvRoot, 'bin', 'python3');
}

function huggingFaceCachePaths(cacheRoot) {
  const hfHome = path.resolve(cacheRoot);
  return {
    hfHome,
    hubCache: path.join(hfHome, 'hub'),
    transformersCache: path.join(hfHome, 'transformers'),
  };
}

function buildBundlePaths(modelsRoot, modelID, entryName) {
  const segments = String(modelID || '').trim().split('/').filter(Boolean);
  const bundleDir = path.join(modelsRoot, 'resolved', ...segments);
  return {
    bundleDir,
    manifestPath: path.join(bundleDir, 'asset.manifest.json'),
    entryPath: path.join(bundleDir, entryName),
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function installStatePath(venvRoot) {
  return path.join(venvRoot, installStateFileName);
}

function installStatePayload(packages) {
  return {
    schemaVersion: 1,
    pythonVersion: defaultPythonVersion,
    packages: [...packages],
  };
}

async function readInstallState(venvRoot) {
  try {
    const raw = await fs.readFile(installStatePath(venvRoot), 'utf8');
    const payload = JSON.parse(raw);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

async function writeInstallState(venvRoot, packages) {
  await fs.writeFile(installStatePath(venvRoot), `${JSON.stringify(installStatePayload(packages), null, 2)}\n`, 'utf8');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeManifestBundle(modelsRoot, spec) {
  const paths = buildBundlePaths(modelsRoot, spec.modelID, spec.entryName);
  await ensureDir(paths.bundleDir);
  const manifest = {
    schemaVersion: '1.0.0',
    asset_id: spec.modelID,
    logical_model_id: spec.logicalModelID,
    kind: spec.capabilities.includes('audio.transcribe') ? 'stt' : 'tts',
    engine: 'speech',
    entry: path.basename(paths.entryPath),
    files: [path.basename(paths.entryPath)],
    capabilities: spec.capabilities,
    license: 'apache-2.0',
    source: {
      repo: `https://huggingface.co/${spec.modelRef}`,
      revision: 'main',
    },
    integrity_mode: 'local_unverified',
    family: spec.family,
    engine_config: {
      driver_family: spec.family,
      driver_backend: spec.driverBackend,
      model_ref: spec.modelRef,
    },
  };
  const entryPayload = {
    driver_family: spec.family,
    driver_backend: spec.driverBackend,
    model_ref: spec.modelRef,
    target_model_id: spec.modelID,
    entry_type: spec.capabilities.includes('audio.transcribe') ? 'qwen3_asr' : 'qwen3_tts',
  };
  await fs.writeFile(paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.writeFile(paths.entryPath, `${JSON.stringify(entryPayload, null, 2)}\n`, 'utf8');
  return paths;
}

export function recommendedEnvLines({
  modelsRoot,
  ttsVenvRoot,
  asrVenvRoot,
  cacheRoot = defaultCacheRootValue,
  speechBaseURL = '',
}) {
  const ttsPythonPath = pythonExecutable(ttsVenvRoot);
  const asrPythonPath = pythonExecutable(asrVenvRoot);
  const ttsDriverPath = path.join(repoRoot, 'scripts', 'qwen3-tts-driver.py');
  const asrDriverPath = path.join(repoRoot, 'scripts', 'qwen3-asr-driver.py');
  const caches = huggingFaceCachePaths(cacheRoot);
  const lines = [
    `export NIMI_RUNTIME_LOCAL_MODELS_PATH=${quoteShell(modelsRoot)}`,
    `export HF_HOME=${quoteShell(caches.hfHome)}`,
    `export HUGGINGFACE_HUB_CACHE=${quoteShell(caches.hubCache)}`,
    `export TRANSFORMERS_CACHE=${quoteShell(caches.transformersCache)}`,
    `export NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD=${quoteShell(`${ttsPythonPath} ${ttsDriverPath}`)}`,
    `export NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD=${quoteShell(`${asrPythonPath} ${asrDriverPath}`)}`,
    `export NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID='speech/qwen3tts'`,
    `export NIMI_LIVE_LOCAL_QWEN3_TTS_BASE_MODEL_ID='speech/qwen3tts-base'`,
    `export NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID='speech/qwen3tts-design'`,
    `export NIMI_LIVE_LOCAL_STT_MODEL_ID='speech/qwen3asr'`,
    `export NIMI_LIVE_LOCAL_TTS_MODEL_ID='speech/qwen3tts'`,
  ];
  if (speechBaseURL) {
    lines.push(`export NIMI_LIVE_LOCAL_SPEECH_BASE_URL=${quoteShell(speechBaseURL)}`);
  }
  return lines;
}

function prefetchScript() {
  return [
    'import sys',
    'from huggingface_hub import snapshot_download',
    'cache_dir = sys.argv[1]',
    'repos = [item for item in sys.argv[2:] if item]',
    'for repo in repos:',
    '    snapshot_download(repo_id=repo, cache_dir=cache_dir)',
  ].join('\n');
}

async function prefetchModelWeights(venvRoot, cacheRoot) {
  const caches = huggingFaceCachePaths(cacheRoot);
  await ensureDir(caches.hfHome);
  await ensureDir(caches.hubCache);
  await ensureDir(caches.transformersCache);
  const uniqueModelRefs = [...new Set(manifestSpecs.map((spec) => spec.modelRef))];
  execOrFail(pythonExecutable(venvRoot), [
    '-c',
    prefetchScript(),
    caches.hubCache,
    ...uniqueModelRefs,
  ], {
    env: {
      ...process.env,
      HF_HOME: caches.hfHome,
      HUGGINGFACE_HUB_CACHE: caches.hubCache,
      TRANSFORMERS_CACHE: caches.transformersCache,
    },
  });
}

async function ensureEnvInstalled(venvRoot, packages, options) {
  const installState = await readInstallState(venvRoot);
  const pythonPath = pythonExecutable(venvRoot);
  const pythonExists = await pathExists(pythonPath);
  const installCurrent = JSON.stringify(installState) === JSON.stringify(installStatePayload(packages));

  if (options.skipInstall) {
    return {
      venvRoot,
      pythonPath,
      installReused: false,
      skippedInstall: true,
    };
  }

  if (!pythonExists || !installCurrent || options.refreshInstall) {
    execOrFail('uv', ['venv', '--python', defaultPythonVersion, venvRoot]);
    execOrFail('uv', [
      'pip',
      'install',
      '--python',
      pythonExecutable(venvRoot),
      ...packages,
    ]);
    await writeInstallState(venvRoot, packages);
    return {
      venvRoot,
      pythonPath: pythonExecutable(venvRoot),
      installReused: false,
      skippedInstall: false,
    };
  }

  return {
    venvRoot,
    pythonPath,
    installReused: true,
    skippedInstall: false,
  };
}

export async function bootstrapLocalQwen3Speech(options) {
  const resolved = {
    ...options,
    modelsRoot: path.resolve(options.modelsRoot),
    engineRoot: path.resolve(options.engineRoot || defaultEngineRootValue),
    ttsVenvRoot: path.resolve(options.ttsVenvRoot || path.join(options.engineRoot || defaultEngineRootValue, 'tts-python')),
    asrVenvRoot: path.resolve(options.asrVenvRoot || path.join(options.engineRoot || defaultEngineRootValue, 'asr-python')),
    cacheRoot: path.resolve(options.cacheRoot),
  };
  const bundlePaths = [];
  for (const spec of manifestSpecs) {
    bundlePaths.push(await writeManifestBundle(resolved.modelsRoot, spec));
  }

  const ttsInstall = await ensureEnvInstalled(resolved.ttsVenvRoot, defaultTTSPackages, resolved);
  const asrInstall = await ensureEnvInstalled(resolved.asrVenvRoot, defaultASRPackages, resolved);

  if (resolved.prefetchModels) {
    const prefetchPython = await pathExists(ttsInstall.pythonPath) ? ttsInstall.pythonPath : asrInstall.pythonPath;
    if (!(await pathExists(prefetchPython))) {
      throw new Error('cannot prefetch models without qwen3 speech python environment; remove --skip-install or run bootstrap first');
    }
    await prefetchModelWeights(path.dirname(path.dirname(prefetchPython)), resolved.cacheRoot);
  }

  const envLines = recommendedEnvLines(resolved);
  return {
    ...resolved,
    bundlePaths,
    envLines,
    ttsInstall,
    asrInstall,
    prefetchedModels: resolved.prefetchModels,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await bootstrapLocalQwen3Speech(options);
  if (options.quiet) {
    return;
  }
  process.stdout.write('local qwen3 speech bootstrap complete\n');
  for (const bundle of result.bundlePaths) {
    process.stdout.write(`- manifest: ${bundle.manifestPath}\n`);
    process.stdout.write(`- entry: ${bundle.entryPath}\n`);
  }
  process.stdout.write(`- tts venv: ${result.ttsVenvRoot}${result.skipInstall ? ' (install skipped)' : ''}\n`);
  process.stdout.write(`- asr venv: ${result.asrVenvRoot}${result.skipInstall ? ' (install skipped)' : ''}\n`);
  process.stdout.write(`- cache: ${result.cacheRoot}\n`);
  if (!result.skipInstall) {
    process.stdout.write(`- tts install: ${result.ttsInstall.installReused ? 'reused existing environment' : 'installed/updated packages'}\n`);
    process.stdout.write(`- asr install: ${result.asrInstall.installReused ? 'reused existing environment' : 'installed/updated packages'}\n`);
  }
  if (result.prefetchedModels) {
    process.stdout.write('- prefetch: completed requested model downloads\n');
  }
  process.stdout.write('\nrecommended environment:\n');
  for (const line of result.envLines) {
    process.stdout.write(`${line}\n`);
  }
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (entrypoint === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
