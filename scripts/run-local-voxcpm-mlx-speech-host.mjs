#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultVenvRoot = path.join(os.homedir(), '.nimi', 'engines', 'speech', 'voxcpm-mlx', 'python');
const defaultModelsRoot = path.join(os.homedir(), '.nimi', 'data', 'models');
const defaultModelRef = 'mlx-community/VoxCPM2-4bit';
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
    venvRoot: defaultVenvRoot,
    modelRef: defaultModelRef,
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
    if (arg === '--venv-root') {
      options.venvRoot = expandHome(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg === '--model-ref') {
      options.modelRef = String(argv[index + 1] || '').trim() || defaultModelRef;
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

export function buildHostLaunchSpec(options) {
  const resolved = {
    host: String(options.host || defaultHost).trim() || defaultHost,
    port: Number.parseInt(String(options.port || defaultPort), 10) || defaultPort,
    modelsRoot: path.resolve(String(options.modelsRoot || defaultModelsRoot)),
    venvRoot: path.resolve(String(options.venvRoot || defaultVenvRoot)),
    modelRef: String(options.modelRef || defaultModelRef).trim() || defaultModelRef,
  };
  const pythonPath = pythonExecutable(resolved.venvRoot);
  const serverScript = path.join(repoRoot, 'runtime', 'internal', 'engine', 'assets', 'speech_server.py');
  const driverScript = path.join(repoRoot, 'scripts', 'voxcpm-mlx-driver.py');
  return {
    pythonPath,
    serverScript,
    args: [serverScript, '--host', resolved.host, '--port', String(resolved.port)],
    baseURL: `http://${resolved.host}:${resolved.port}/v1`,
    env: {
      ...process.env,
      NIMI_RUNTIME_LOCAL_MODELS_PATH: resolved.modelsRoot,
      NIMI_RUNTIME_SPEECH_VOXCPM_CMD: process.env.NIMI_RUNTIME_SPEECH_VOXCPM_CMD
        || `${pythonPath} ${driverScript} --model ${resolved.modelRef}`,
    },
  };
}

async function main() {
  const spec = buildHostLaunchSpec(parseArgs(process.argv.slice(2)));
  if (!fs.existsSync(spec.pythonPath)) {
    throw new Error(`missing mlx speech python at ${spec.pythonPath}; run node ${path.join(repoRoot, 'scripts', 'bootstrap-local-voxcpm-mlx.mjs')} first`);
  }
  process.stdout.write(`starting local voxcpm mlx speech host at ${spec.baseURL}\n`);
  process.stdout.write(`models root: ${spec.env.NIMI_RUNTIME_LOCAL_MODELS_PATH}\n`);
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
