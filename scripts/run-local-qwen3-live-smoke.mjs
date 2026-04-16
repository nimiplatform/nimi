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
const defaultQwen3TTSPython = path.join(process.env.HOME || '', '.nimi', 'engines', 'speech', 'qwen3', 'tts-python', 'bin', 'python3');
const defaultQwen3ASRPython = path.join(process.env.HOME || '', '.nimi', 'engines', 'speech', 'qwen3', 'asr-python', 'bin', 'python3');
const suggestedBootstrapCommand = `node ${path.join(repoRoot, 'scripts', 'bootstrap-local-qwen3-speech.mjs')}`;
const suggestedHostCommand = `node ${path.join(repoRoot, 'scripts', 'run-local-qwen3-speech-host.mjs')}`;
const suggestedTTSDriverCommand = `${fs.existsSync(defaultQwen3TTSPython) ? defaultQwen3TTSPython : 'python3'} ${path.join(repoRoot, 'scripts', 'qwen3-tts-driver.py')}`;
const suggestedASRDriverCommand = `${fs.existsSync(defaultQwen3ASRPython) ? defaultQwen3ASRPython : 'python3'} ${path.join(repoRoot, 'scripts', 'qwen3-asr-driver.py')}`;

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

export function findQwen3SpeechManifest(root) {
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
          const engine = String(payload.engine || '').trim().toLowerCase();
          const family = String(payload.family || payload.engine_config?.driver_family || '').trim().toLowerCase();
          if (engine === 'speech' && (family === 'qwen3_tts' || family === 'qwen3_asr' || assetID.includes('speech/qwen3'))) {
            return target;
          }
        } catch {
          // ignore malformed manifests here; runtime host fails closed later
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-qwen3-driver-preflight-'));
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

function main() {
  const speechBaseURL = firstNonEmpty(process.env.NIMI_LIVE_LOCAL_SPEECH_BASE_URL, process.env.NIMI_LIVE_LOCAL_BASE_URL);
  const speechAPIKey = firstNonEmpty(process.env.NIMI_LIVE_LOCAL_SPEECH_API_KEY, process.env.NIMI_LIVE_LOCAL_API_KEY);
  const resolvedModelsRoot = modelsRoot();
  const manifestPath = findQwen3SpeechManifest(resolvedModelsRoot);
  const synthModelID = firstNonEmpty(
    process.env.NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID,
    process.env.NIMI_LIVE_LOCAL_TTS_MODEL_ID,
    manifestPath ? 'speech/qwen3tts' : '',
  );
  const baseModelID = firstNonEmpty(
    process.env.NIMI_LIVE_LOCAL_QWEN3_TTS_BASE_MODEL_ID,
    process.env.NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID,
    'speech/qwen3tts-base',
  );
  const voiceDesignModelID = firstNonEmpty(
    process.env.NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID,
    process.env.NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID,
    'speech/qwen3tts-design',
  );
  const asrModelID = firstNonEmpty(
    process.env.NIMI_LIVE_LOCAL_STT_MODEL_ID,
    'speech/qwen3asr',
  );
  const qwen3TTSPython = firstAvailablePython(defaultQwen3TTSPython, 'python3');
  const qwen3ASRPython = firstAvailablePython(defaultQwen3ASRPython, 'python3');
  const speechHostPython = qwen3TTSPython;

  const blockers = [];

  if (!speechBaseURL) {
    blockers.push('missing NIMI_LIVE_LOCAL_SPEECH_BASE_URL (or NIMI_LIVE_LOCAL_BASE_URL)');
  }
  if (!synthModelID) {
    blockers.push('missing NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID (or NIMI_LIVE_LOCAL_TTS_MODEL_ID)');
  }
  if (!pythonModuleAvailable('qwen_tts', qwen3TTSPython)) {
    blockers.push(`python module qwen_tts is not importable via ${qwen3TTSPython}`);
  }
  if (!pythonModuleAvailable('qwen_asr', qwen3ASRPython)) {
    blockers.push(`python module qwen_asr is not importable via ${qwen3ASRPython}`);
  }
  if (!pythonModuleAvailable('fastapi', speechHostPython)) {
    blockers.push(`python module fastapi is not importable via ${speechHostPython}`);
  }
  if (!pythonModuleAvailable('uvicorn', speechHostPython)) {
    blockers.push(`python module uvicorn is not importable via ${speechHostPython}`);
  }
  if (!pythonModuleAvailable('multipart', speechHostPython)) {
    blockers.push(`python module multipart is not importable via ${speechHostPython}`);
  }
  if (!manifestPath) {
    blockers.push(`no qwen3 speech manifest found under ${resolvedModelsRoot}`);
  }

  const ttsPreflight = pythonModuleAvailable('qwen_tts', qwen3TTSPython) ? driverPreflight(suggestedTTSDriverCommand) : null;
  const asrPreflight = pythonModuleAvailable('qwen_asr', qwen3ASRPython) ? driverPreflight(suggestedASRDriverCommand) : null;
  if (ttsPreflight && !ttsPreflight.ok) {
    blockers.push(`qwen3_tts driver preflight failed: ${ttsPreflight.detail}`);
  }
  if (asrPreflight && !asrPreflight.ok) {
    blockers.push(`qwen3_asr driver preflight failed: ${asrPreflight.detail}`);
  }

  printCheck('local speech base URL', Boolean(speechBaseURL), speechBaseURL);
  printCheck('local qwen3 synth model id', Boolean(synthModelID), synthModelID);
  printCheck('local qwen3 clone model id', Boolean(baseModelID), baseModelID);
  printCheck('local qwen3 design model id', Boolean(voiceDesignModelID), voiceDesignModelID);
  printCheck('local qwen3 asr model id', Boolean(asrModelID), asrModelID);
  printCheck('python module qwen_tts', pythonModuleAvailable('qwen_tts', qwen3TTSPython), qwen3TTSPython);
  printCheck('python module qwen_asr', pythonModuleAvailable('qwen_asr', qwen3ASRPython), qwen3ASRPython);
  printCheck('python module fastapi', pythonModuleAvailable('fastapi', speechHostPython), speechHostPython);
  printCheck('python module uvicorn', pythonModuleAvailable('uvicorn', speechHostPython), speechHostPython);
  printCheck('python module multipart', pythonModuleAvailable('multipart', speechHostPython), speechHostPython);
  if (ttsPreflight) {
    printCheck('qwen3_tts driver preflight', ttsPreflight.ok, ttsPreflight.detail);
  }
  if (asrPreflight) {
    printCheck('qwen3_asr driver preflight', asrPreflight.ok, asrPreflight.detail);
  }
  printCheck('qwen3 speech manifest discovery', Boolean(manifestPath), manifestPath || resolvedModelsRoot);

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
      const requiredModels = [synthModelID, baseModelID, voiceDesignModelID, asrModelID].filter(Boolean);
      const readyModels = Array.isArray(catalog.body?.models) ? catalog.body.models : [];
      const missingModels = requiredModels.filter((requiredModelID) => !readyModels.some((item) => String(item?.id || '').trim() === requiredModelID && item?.ready === true));
      const ok = missingModels.length === 0;
      if (!ok) {
        blockers.push(`speech host catalog missing ready qwen3 models: ${missingModels.join(', ')}`);
      }
      printCheck('speech host catalog probe', ok, JSON.stringify(catalog.body));
    }
  }

  if (blockers.length > 0) {
    process.stdout.write('\nlocal qwen3 speech smoke preflight blocked:\n');
    for (const blocker of blockers) {
      process.stdout.write(`- ${blocker}\n`);
    }
    process.stdout.write('\nrecommended qwen3 bootstrap helper:\n');
    process.stdout.write(`- ${suggestedBootstrapCommand}\n`);
    if (!speechBaseURL) {
      process.stdout.write('\nrecommended local speech host command:\n');
      process.stdout.write(`- ${suggestedHostCommand}\n`);
    }
    process.stdout.write('\nsuggested canonical qwen3 driver commands:\n');
    process.stdout.write(`- NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD='${suggestedTTSDriverCommand}'\n`);
    process.stdout.write(`- NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD='${suggestedASRDriverCommand}'\n`);
    process.exit(2);
  }

  process.stdout.write('\npreflight passed; running local qwen3 speech live smoke slice\n');
  const testResult = spawnSync(
      'go',
    [
      'test',
      '-timeout', '240s',
      './internal/services/ai',
      '-run',
      'TestLiveSmokeLocalQwen3Synthesize|TestLiveSmokeLocalQwen3Transcribe|TestLiveSmokeLocalQwen3VoiceDesign|TestLiveSmokeLocalQwen3VoiceClone|TestLiveSmokeLocalQwen3VoiceAssetLifecycle',
    ],
    {
      cwd: runtimeDir,
      env: process.env,
      stdio: 'inherit',
    },
  );
  process.exit(testResult.status ?? 1);
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (entrypoint === modulePath) {
  main();
}
