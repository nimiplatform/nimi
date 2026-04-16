#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultEngineRoot = path.join(os.homedir(), '.nimi', 'engines', 'speech', 'qwen3');
const defaultTTSVenvRoot = path.join(defaultEngineRoot, 'tts-python');
const defaultASRVenvRoot = path.join(defaultEngineRoot, 'asr-python');
const defaultModelsRoot = path.join(os.homedir(), '.nimi', 'data', 'models');
const defaultCacheRoot = path.join(os.homedir(), '.nimi', 'cache', 'huggingface');
const defaultHost = '127.0.0.1';
const defaultPort = 8330;

function expandHome(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('~/')) {
    return text;
  }
  return path.join(os.homedir(), text.slice(2));
}

function parseArgs(argv) {
  const options = {
    host: defaultHost,
    port: defaultPort,
    modelsRoot: expandHome(process.env.NIMI_RUNTIME_LOCAL_MODELS_PATH || defaultModelsRoot),
    engineRoot: defaultEngineRoot,
    ttsVenvRoot: defaultTTSVenvRoot,
    asrVenvRoot: defaultASRVenvRoot,
    cacheRoot: expandHome(process.env.HF_HOME || defaultCacheRoot),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') {
      options.host = String(argv[index + 1] || '').trim() || defaultHost;
      index += 1;
      continue;
    }
    if (arg === '--port') {
      options.port = Number.parseInt(String(argv[index + 1] || ''), 10) || defaultPort;
      index += 1;
      continue;
    }
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
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
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

export function buildHostLaunchSpec(options) {
  const resolved = {
    host: String(options.host || defaultHost).trim() || defaultHost,
    port: Number.parseInt(String(options.port || defaultPort), 10) || defaultPort,
    modelsRoot: path.resolve(String(options.modelsRoot || defaultModelsRoot)),
    ttsVenvRoot: path.resolve(String(options.ttsVenvRoot || defaultTTSVenvRoot)),
    asrVenvRoot: path.resolve(String(options.asrVenvRoot || defaultASRVenvRoot)),
    cacheRoot: path.resolve(String(options.cacheRoot || process.env.HF_HOME || defaultCacheRoot)),
  };
  const pythonPath = pythonExecutable(resolved.ttsVenvRoot);
  const asrPythonPath = pythonExecutable(resolved.asrVenvRoot);
  const serverScript = path.join(repoRoot, 'runtime', 'internal', 'engine', 'assets', 'speech_server.py');
  const ttsDriverScript = path.join(repoRoot, 'scripts', 'qwen3-tts-driver.py');
  const asrDriverScript = path.join(repoRoot, 'scripts', 'qwen3-asr-driver.py');
  const caches = huggingFaceCachePaths(resolved.cacheRoot);
  return {
    pythonPath,
    serverScript,
    args: [serverScript, '--host', resolved.host, '--port', String(resolved.port)],
    baseURL: `http://${resolved.host}:${resolved.port}/v1`,
    env: {
      ...process.env,
      NIMI_RUNTIME_LOCAL_MODELS_PATH: resolved.modelsRoot,
      NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD: process.env.NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD
        || `${pythonPath} ${ttsDriverScript}`,
      NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD: process.env.NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD
        || `${asrPythonPath} ${asrDriverScript}`,
      HF_HOME: process.env.HF_HOME || caches.hfHome,
      HUGGINGFACE_HUB_CACHE: process.env.HUGGINGFACE_HUB_CACHE || caches.hubCache,
      TRANSFORMERS_CACHE: process.env.TRANSFORMERS_CACHE || caches.transformersCache,
    },
  };
}

async function main() {
  const spec = buildHostLaunchSpec(parseArgs(process.argv.slice(2)));
  if (!fs.existsSync(spec.pythonPath)) {
    throw new Error(`missing qwen3 speech python at ${spec.pythonPath}; run node ${path.join(repoRoot, 'scripts', 'bootstrap-local-qwen3-speech.mjs')} first`);
  }
  process.stdout.write(`starting local qwen3 speech host at ${spec.baseURL}\n`);
  process.stdout.write(`models root: ${spec.env.NIMI_RUNTIME_LOCAL_MODELS_PATH}\n`);
  process.stdout.write(`huggingface cache: ${spec.env.HF_HOME}\n`);
  const child = spawn(spec.pythonPath, spec.args, {
    cwd: repoRoot,
    env: spec.env,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (entrypoint === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
