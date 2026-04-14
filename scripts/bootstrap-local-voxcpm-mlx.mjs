#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultModelsRootValue = path.join(os.homedir(), '.nimi', 'data', 'models');
const defaultVenvRootValue = path.join(os.homedir(), '.nimi', 'engines', 'speech', 'voxcpm-mlx', 'python');
const defaultModelID = 'speech/voxcpm2';
const defaultModelRef = 'mlx-community/VoxCPM2-4bit';
const defaultEntryName = 'voxcpm-mlx-entry.json';
const defaultPythonVersion = '3.12';
const defaultMLXAudioSource = 'git+https://github.com/Blaizzy/mlx-audio.git@0de15614991496c21d71440d2ce6fd0c26c94a91';
const bootstrapSupportPackages = ['fastapi==0.121.1', 'uvicorn[standard]==0.38.0', 'python-multipart'];

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
    venvRoot: defaultVenvRootValue,
    modelID: defaultModelID,
    modelRef: defaultModelRef,
    mlxAudioSource: String(process.env.NIMI_RUNTIME_SPEECH_MLX_AUDIO_SOURCE || '').trim() || defaultMLXAudioSource,
    speechBaseURL: '',
    skipInstall: false,
    quiet: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--models-root') {
      options.modelsRoot = expandHome(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--venv-root') {
      options.venvRoot = expandHome(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--model-id') {
      options.modelID = String(argv[index + 1] || '').trim() || defaultModelID;
      index += 1;
      continue;
    }
    if (arg === '--model-ref') {
      options.modelRef = String(argv[index + 1] || '').trim() || defaultModelRef;
      index += 1;
      continue;
    }
    if (arg === '--mlx-audio-source') {
      options.mlxAudioSource = String(argv[index + 1] || '').trim() || defaultMLXAudioSource;
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
    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.modelsRoot) {
    throw new Error('models root required');
  }
  if (!options.venvRoot) {
    throw new Error('venv root required');
  }
  if (!options.modelID) {
    throw new Error('model id required');
  }
  if (!options.modelRef) {
    throw new Error('model ref required');
  }
  if (!options.mlxAudioSource) {
    throw new Error('mlx-audio source required');
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

function buildBundlePaths(modelsRoot, modelID) {
  const segments = String(modelID || '').trim().split('/').filter(Boolean);
  const bundleDir = path.join(modelsRoot, 'resolved', ...segments);
  return {
    bundleDir,
    manifestPath: path.join(bundleDir, 'asset.manifest.json'),
    entryPath: path.join(bundleDir, defaultEntryName),
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeVoxCPMManifestBundle({ modelsRoot, modelID, modelRef }) {
  const paths = buildBundlePaths(modelsRoot, modelID);
  await ensureDir(paths.bundleDir);
  const manifest = {
    schemaVersion: '1.0.0',
    asset_id: modelID,
    logical_model_id: modelID,
    kind: 'tts',
    engine: 'speech',
    entry: path.basename(paths.entryPath),
    files: [path.basename(paths.entryPath)],
    capabilities: ['audio.synthesize'],
    license: 'unknown',
    source: {
      repo: `https://huggingface.co/${modelRef}`,
      revision: 'main',
    },
    integrity_mode: 'local_unverified',
    family: 'voxcpm',
    engine_config: {
      driver_family: 'voxcpm',
      driver_backend: 'mlx',
      model_ref: modelRef,
    },
  };
  const entryPayload = {
    driver_family: 'voxcpm',
    driver_backend: 'mlx',
    model_ref: modelRef,
    target_model_id: modelID,
    entry_type: 'mlx_audio_tts_generate',
  };
  await fs.writeFile(paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.writeFile(paths.entryPath, `${JSON.stringify(entryPayload, null, 2)}\n`, 'utf8');
  return paths;
}

export function recommendedEnvLines({ modelsRoot, venvRoot, modelID, modelRef, speechBaseURL = '' }) {
  const pythonPath = pythonExecutable(venvRoot);
  const driverPath = path.join(repoRoot, 'scripts', 'voxcpm-mlx-driver.py');
  const lines = [
    `export NIMI_RUNTIME_LOCAL_MODELS_PATH=${quoteShell(modelsRoot)}`,
    `export NIMI_RUNTIME_SPEECH_VOXCPM_CMD=${quoteShell(`${pythonPath} ${driverPath} --model ${modelRef}`)}`,
    `export NIMI_LIVE_LOCAL_VOXCPM_TTS_MODEL_ID=${quoteShell(modelID)}`,
  ];
  if (speechBaseURL) {
    lines.push(`export NIMI_LIVE_LOCAL_SPEECH_BASE_URL=${quoteShell(speechBaseURL)}`);
  }
  return lines;
}

export async function bootstrapLocalVoxCPMMLX(options) {
  const resolved = {
    ...options,
    modelsRoot: path.resolve(options.modelsRoot),
    venvRoot: path.resolve(options.venvRoot),
    mlxAudioSource: String(options.mlxAudioSource || '').trim() || defaultMLXAudioSource,
  };
  const bundlePaths = await writeVoxCPMManifestBundle(resolved);

  if (!resolved.skipInstall) {
    execOrFail('uv', ['venv', '--python', defaultPythonVersion, resolved.venvRoot]);
    execOrFail('uv', [
      'pip',
      'install',
      '--python',
      pythonExecutable(resolved.venvRoot),
      resolved.mlxAudioSource,
      ...bootstrapSupportPackages,
    ]);
  }

  const envLines = recommendedEnvLines(resolved);
  return {
    ...resolved,
    bundlePaths,
    envLines,
    mlxAudioSource: resolved.mlxAudioSource,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await bootstrapLocalVoxCPMMLX(options);
  if (options.quiet) {
    return;
  }
  process.stdout.write('local voxcpm mlx bootstrap complete\n');
  process.stdout.write(`- manifest: ${result.bundlePaths.manifestPath}\n`);
  process.stdout.write(`- entry: ${result.bundlePaths.entryPath}\n`);
  process.stdout.write(`- venv: ${result.venvRoot}${result.skipInstall ? ' (install skipped)' : ''}\n`);
  process.stdout.write(`- mlx-audio source: ${result.mlxAudioSource}\n`);
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
