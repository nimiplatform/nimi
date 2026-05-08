#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const defaultSpeechBaseURL = 'http://127.0.0.1:8330/v1';
const defaultModelID = 'speech/qwen3tts-design';
const admittedWorkflowFamily = 'qwen3_tts';
const goTestPattern = 'TestLiveSmokeLocalQwen3VoiceAssetLifecycle';

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/run-local-voxcpm-live-asset-lifecycle-smoke.mjs [--help]\n\n`);
  process.stdout.write(`Runs the admitted local voice asset lifecycle live smoke target.\n\n`);
  process.stdout.write(`Authority boundary:\n`);
  process.stdout.write(`- admitted workflow family: ${admittedWorkflowFamily}\n`);
  process.stdout.write(`- go test target: ${goTestPattern}\n\n`);
  process.stdout.write(`Environment:\n`);
  process.stdout.write(`- NIMI_LIVE_LOCAL_SPEECH_BASE_URL or NIMI_LIVE_LOCAL_BASE_URL\n`);
  process.stdout.write(`- NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID or NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID\n`);
}

function qualifyLocalSpeechModelID(modelID) {
  const normalized = String(modelID || '').trim();
  if (!normalized) {
    return '';
  }
  const lower = normalized.toLowerCase();
  if (lower.startsWith('speech/') || normalized.includes('/')) {
    return normalized;
  }
  return `speech/${normalized}`;
}

function isAdmittedQwen3WorkflowModelID(modelID) {
  const normalized = String(modelID || '').trim().toLowerCase();
  return normalized.includes('qwen3-tts') || normalized.includes('qwen3tts');
}

function runGoTestAndRequireTarget({ env }) {
  const result = spawnSync(
    'go',
    [
      'test',
      '-json',
      '-timeout',
      '240s',
      './internal/services/ai',
      '-run',
      goTestPattern,
    ],
    {
      cwd: runtimeDir,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  let selectedTestEvents = 0;
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (event && event.Test === goTestPattern && ['run', 'pass', 'skip', 'fail'].includes(event.Action)) {
        selectedTestEvents += 1;
      }
    } catch {
      // Non-JSON output is preserved above; it is not proof that the target ran.
    }
  }

  if (selectedTestEvents === 0) {
    process.stderr.write(`local voice asset lifecycle smoke failed closed: go test target ${goTestPattern} executed zero tests\n`);
    return 3;
  }
  return result.status ?? 1;
}

if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
  printHelp();
  process.exit(0);
}

const speechBaseURL = firstNonEmpty(process.env.NIMI_LIVE_LOCAL_SPEECH_BASE_URL, process.env.NIMI_LIVE_LOCAL_BASE_URL, defaultSpeechBaseURL);
const speechModelID = qualifyLocalSpeechModelID(firstNonEmpty(
  process.env.NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_TTS_MODEL_ID,
  defaultModelID,
));

if (!isAdmittedQwen3WorkflowModelID(speechModelID)) {
  process.stderr.write(`local voice asset lifecycle smoke failed closed: model ${speechModelID || '(empty)'} is outside admitted ${admittedWorkflowFamily} workflow family\n`);
  process.exit(2);
}

const env = {
  ...process.env,
  NIMI_LIVE_LOCAL_SPEECH_BASE_URL: speechBaseURL,
  NIMI_LIVE_LOCAL_BASE_URL: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_BASE_URL, speechBaseURL),
  NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID, speechModelID),
  NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID, speechModelID),
  NIMI_LIVE_LOCAL_TTS_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_TTS_MODEL_ID, speechModelID),
};

process.stdout.write(`local voice asset lifecycle speech base URL: ${env.NIMI_LIVE_LOCAL_SPEECH_BASE_URL}\n`);
process.stdout.write(`local voice asset lifecycle admitted workflow family: ${admittedWorkflowFamily}\n`);
process.stdout.write(`local voice asset lifecycle model id: ${speechModelID}\n`);

process.exit(runGoTestAndRequireTarget({ env }));
