#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const defaultMLXVenvPython = path.join(process.env.HOME || '', '.nimi', 'engines', 'speech', 'voxcpm-mlx', 'python', 'bin', 'python3');
const backendKind = process.platform === 'darwin' && process.arch === 'arm64' ? 'mlx' : 'cuda';
const suggestedBootstrapCommand = backendKind === 'mlx'
  ? `node ${path.join(repoRoot, 'scripts', 'bootstrap-local-voxcpm-mlx.mjs')}`
  : '';
const suggestedHostCommand = backendKind === 'mlx'
  ? `node ${path.join(repoRoot, 'scripts', 'run-local-voxcpm-mlx-speech-host.mjs')}`
  : '';
const suggestedDriverCommand = backendKind === 'mlx'
  ? `${fs.existsSync(defaultMLXVenvPython) ? defaultMLXVenvPython : 'python3'} ${path.join(repoRoot, 'scripts', 'voxcpm-mlx-driver.py')} --model mlx-community/VoxCPM2-4bit`
  : `python3 ${path.join(repoRoot, 'scripts', 'voxcpm-driver.py')} --model openbmb/VoxCPM2`;

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function execCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function commandExists(name) {
  const probe = execCapture('sh', ['-lc', `command -v ${name}`]);
  return probe.status === 0;
}

function httpJson(url, headers = {}) {
  const result = execCapture('python3', [
    '-c',
    [
      'import json',
      'import sys',
      'import urllib.request',
      'url = sys.argv[1]',
      'headers = json.loads(sys.argv[2])',
      'req = urllib.request.Request(url, headers=headers)',
      'with urllib.request.urlopen(req, timeout=10) as resp:',
      '    body = json.loads(resp.read().decode("utf-8"))',
      '    print(json.dumps({"status": resp.status, "body": body}))',
    ].join('\n'),
    url,
    JSON.stringify(headers),
  ]);
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || '').trim() || `http probe failed: ${url}` };
  }
  try {
    const payload = JSON.parse(result.stdout.trim());
    return { ok: true, status: payload.status, body: payload.body };
  } catch (error) {
    return { ok: false, error: `invalid http probe payload: ${error}` };
  }
}

function pythonModuleAvailable(moduleName, pythonBinary = 'python3') {
  const result = execCapture(pythonBinary, [
    '-c',
    'import importlib.util,sys; sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)',
    moduleName,
  ]);
  return result.status === 0;
}

function firstAvailablePython(...candidates) {
  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === 'python3') {
      return trimmed;
    }
    if (fs.existsSync(trimmed)) {
      return trimmed;
    }
  }
  return 'python3';
}

function modelsRoot() {
  return firstNonEmpty(
    process.env.NIMI_RUNTIME_LOCAL_MODELS_PATH,
    path.join(process.env.HOME || '', '.nimi', 'data', 'models'),
  );
}

function findVoxCPMManifest(root) {
  const resolvedRoot = path.join(root, 'resolved');
  if (!fs.existsSync(resolvedRoot)) {
    return '';
  }
  const queue = [resolvedRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(target);
        continue;
      }
      if (entry.isFile() && entry.name === 'asset.manifest.json') {
        try {
          const payload = JSON.parse(fs.readFileSync(target, 'utf8'));
          const assetID = String(payload.asset_id || payload.assetId || '').trim().toLowerCase();
          const entryPath = String(payload.entry || '').trim().toLowerCase();
          const files = Array.isArray(payload.files) ? payload.files.map((item) => String(item || '').trim().toLowerCase()) : [];
          if (assetID.includes('voxcpm') || entryPath.includes('voxcpm') || files.some((item) => item.includes('voxcpm'))) {
            return target;
          }
        } catch {
          // ignore malformed manifests here; the runtime host will fail-close later
        }
      }
    }
  }
  return '';
}

function printCheck(label, ok, detail) {
  const prefix = ok ? 'ok   ' : 'fail ';
  process.stdout.write(`${prefix}${label}`);
  if (detail) {
    process.stdout.write(`: ${detail}`);
  }
  process.stdout.write('\n');
}

function driverPreflight(command) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-voxcpm-driver-preflight-'));
  const requestPath = path.join(tempRoot, 'request.json');
  const responsePath = path.join(tempRoot, 'response.json');
  fs.writeFileSync(requestPath, `${JSON.stringify({ operation: 'driver.preflight' })}\n`, 'utf8');
  const probe = execCapture('sh', ['-lc', `${command} --request ${JSON.stringify(requestPath)} --response ${JSON.stringify(responsePath)}`]);
  try {
    if (probe.status !== 0) {
      return {
        ok: false,
        detail: (probe.stderr || probe.stdout || '').trim() || 'driver preflight exited non-zero',
      };
    }
    const response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
    return {
      ok: true,
      detail: JSON.stringify(response),
    };
  } catch (error) {
    return {
      ok: false,
      detail: `driver preflight response invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const speechBaseURL = firstNonEmpty(process.env.NIMI_LIVE_LOCAL_SPEECH_BASE_URL, process.env.NIMI_LIVE_LOCAL_BASE_URL);
const speechAPIKey = firstNonEmpty(process.env.NIMI_LIVE_LOCAL_SPEECH_API_KEY, process.env.NIMI_LIVE_LOCAL_API_KEY);
const resolvedModelsRoot = modelsRoot();
const manifestPath = findVoxCPMManifest(resolvedModelsRoot);
const speechModelID = firstNonEmpty(
  process.env.NIMI_LIVE_LOCAL_VOXCPM_TTS_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_TTS_MODEL_ID,
  manifestPath ? 'speech/voxcpm2' : '',
);
const mlxPython = firstAvailablePython(defaultMLXVenvPython, 'python3');

const blockers = [];
const platformBlockers = [];

if (backendKind === 'cuda' && process.platform !== 'linux') {
  platformBlockers.push(
    `current host is ${process.platform}/${process.arch}; upstream VoxCPM2 quick start documents CUDA >= 12.0, so this host is not the canonical validation target`,
  );
} else if (backendKind === 'cuda' && !commandExists('nvidia-smi')) {
  platformBlockers.push('nvidia-smi not found; no NVIDIA/CUDA runtime detected for canonical VoxCPM2 validation');
}
for (const blocker of platformBlockers) {
  blockers.push(blocker);
}

if (!speechBaseURL) {
  blockers.push('missing NIMI_LIVE_LOCAL_SPEECH_BASE_URL (or NIMI_LIVE_LOCAL_BASE_URL)');
}
if (!speechModelID) {
  blockers.push('missing NIMI_LIVE_LOCAL_VOXCPM_TTS_MODEL_ID (or NIMI_LIVE_LOCAL_TTS_MODEL_ID)');
}
if (backendKind === 'mlx') {
  if (!pythonModuleAvailable('mlx_audio', mlxPython)) {
    blockers.push(`python module mlx_audio is not importable via ${mlxPython}`);
  }
  if (!pythonModuleAvailable('fastapi', mlxPython)) {
    blockers.push(`python module fastapi is not importable via ${mlxPython}`);
  }
  if (!pythonModuleAvailable('uvicorn', mlxPython)) {
    blockers.push(`python module uvicorn is not importable via ${mlxPython}`);
  }
  if (!pythonModuleAvailable('multipart', mlxPython)) {
    blockers.push(`python module multipart is not importable via ${mlxPython}`);
  }
} else {
  if (!pythonModuleAvailable('voxcpm')) {
    blockers.push('python module voxcpm is not importable');
  }
  if (!pythonModuleAvailable('torch')) {
    blockers.push('python module torch is not importable');
  }
  if (!pythonModuleAvailable('soundfile')) {
    blockers.push('python module soundfile is not importable');
  }
}
if (!manifestPath) {
  blockers.push(`no VoxCPM-like speech manifest found under ${resolvedModelsRoot}`);
}

const preflightDriver = backendKind === 'mlx' && pythonModuleAvailable('mlx_audio', mlxPython) ? driverPreflight(suggestedDriverCommand) : null;
if (preflightDriver && !preflightDriver.ok) {
  blockers.push(`voxcpm driver preflight failed: ${preflightDriver.detail}`);
}

printCheck('local speech base URL', Boolean(speechBaseURL), speechBaseURL);
printCheck('local voxcpm model id', Boolean(speechModelID), speechModelID);
printCheck('selected voxcpm backend', true, backendKind);
printCheck('host platform suitability', platformBlockers.length === 0, platformBlockers.join('; '));
if (backendKind === 'mlx') {
  printCheck('python module mlx_audio', pythonModuleAvailable('mlx_audio', mlxPython), mlxPython);
  printCheck('python module fastapi', pythonModuleAvailable('fastapi', mlxPython), mlxPython);
  printCheck('python module uvicorn', pythonModuleAvailable('uvicorn', mlxPython), mlxPython);
  printCheck('python module multipart', pythonModuleAvailable('multipart', mlxPython), mlxPython);
  if (preflightDriver) {
    printCheck('voxcpm mlx driver preflight', preflightDriver.ok, preflightDriver.detail);
  }
} else {
  printCheck('python module voxcpm', pythonModuleAvailable('voxcpm'), '');
  printCheck('python module torch', pythonModuleAvailable('torch'), '');
  printCheck('python module soundfile', pythonModuleAvailable('soundfile'), '');
}
printCheck('voxcpm manifest discovery', Boolean(manifestPath), manifestPath || resolvedModelsRoot);

if (speechBaseURL) {
  const headers = speechAPIKey ? { Authorization: `Bearer ${speechAPIKey}` } : {};
  const healthURL = speechBaseURL.endsWith('/v1') ? `${speechBaseURL.slice(0, -3)}/healthz` : `${speechBaseURL}/healthz`;
  const catalogURL = speechBaseURL.endsWith('/v1') ? `${speechBaseURL}/catalog` : `${speechBaseURL}/v1/catalog`;

  const health = httpJson(healthURL, headers);
  if (!health.ok) {
    blockers.push(`speech host health probe failed: ${health.error}`);
    printCheck('speech host health probe', false, health.error);
  } else {
    const ready = Boolean(health.body?.ready);
    if (!ready) {
      blockers.push(`speech host /healthz not ready: ${JSON.stringify(health.body)}`);
    }
    printCheck('speech host health probe', ready, JSON.stringify(health.body));
  }

  const catalog = httpJson(catalogURL, headers);
  if (!catalog.ok) {
    blockers.push(`speech host catalog probe failed: ${catalog.error}`);
    printCheck('speech host catalog probe', false, catalog.error);
  } else {
    const modelReady = Array.isArray(catalog.body?.models) && catalog.body.models.some((item) => String(item?.id || '').trim() === speechModelID && item?.ready === true);
    if (!modelReady) {
      blockers.push(`speech host catalog missing ready model ${speechModelID}`);
    }
    printCheck('speech host catalog probe', modelReady, JSON.stringify(catalog.body));
  }
}

if (blockers.length > 0) {
  process.stdout.write('\nlocal voxcpm smoke preflight blocked:\n');
  for (const blocker of blockers) {
    process.stdout.write(`- ${blocker}\n`);
  }
  if (suggestedBootstrapCommand) {
    process.stdout.write('\nrecommended mlx bootstrap helper:\n');
    process.stdout.write(`- ${suggestedBootstrapCommand}\n`);
  }
  if (suggestedHostCommand && !speechBaseURL) {
    process.stdout.write('\nrecommended local speech host command:\n');
    process.stdout.write(`- ${suggestedHostCommand}\n`);
  }
  process.stdout.write('\nsuggested canonical voxcpm driver command:\n');
  process.stdout.write(`- NIMI_RUNTIME_SPEECH_VOXCPM_CMD='${suggestedDriverCommand}'\n`);
  process.exit(2);
}

process.stdout.write('\npreflight passed; running TestLiveSmokeLocalVoxCPMSynthesize\n');
const testResult = spawnSync(
  'go',
  ['test', '-timeout', '120s', './internal/services/ai', '-run', 'TestLiveSmokeLocalVoxCPMSynthesize'],
  {
    cwd: runtimeDir,
    env: process.env,
    stdio: 'inherit',
  },
);
process.exit(testResult.status ?? 1);
