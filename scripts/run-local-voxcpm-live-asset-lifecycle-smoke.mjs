#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const defaultSpeechBaseURL = 'http://127.0.0.1:8330/v1';
const defaultModelID = 'speech/voxcpm2';

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

const speechBaseURL = firstNonEmpty(process.env.NIMI_LIVE_LOCAL_SPEECH_BASE_URL, process.env.NIMI_LIVE_LOCAL_BASE_URL, defaultSpeechBaseURL);
const speechModelID = firstNonEmpty(
  process.env.NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_VOXCPM_TTS_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_TTS_MODEL_ID,
  defaultModelID,
);

const env = {
  ...process.env,
  NIMI_LIVE_LOCAL_SPEECH_BASE_URL: speechBaseURL,
  NIMI_LIVE_LOCAL_BASE_URL: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_BASE_URL, speechBaseURL),
  NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID, speechModelID),
  NIMI_LIVE_LOCAL_VOXCPM_TTS_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_VOXCPM_TTS_MODEL_ID, speechModelID),
  NIMI_LIVE_LOCAL_TTS_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_TTS_MODEL_ID, speechModelID),
};

process.stdout.write(`local voxcpm asset lifecycle speech base URL: ${env.NIMI_LIVE_LOCAL_SPEECH_BASE_URL}\n`);
process.stdout.write(`local voxcpm asset lifecycle model id: ${speechModelID}\n`);

const result = spawnSync(
  'go',
  [
    'test',
    '-timeout',
    '240s',
    './internal/services/ai',
    '-run',
    'TestLiveSmokeLocalVoxCPMVoiceAssetLifecycle',
  ],
  {
    cwd: runtimeDir,
    env,
    encoding: 'utf8',
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
