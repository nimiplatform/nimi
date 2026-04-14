#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const defaultSpeechBaseURL = 'http://127.0.0.1:8330/v1';
const defaultModelID = 'speech/voxcpm2';
const defaultReferenceAudioPath = path.join(repoRoot, 'config', 'live', 'fixtures', 'live-audio-fixtures', 'dashscope-voice-reference.wav');

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
  });
}

const speechBaseURL = firstNonEmpty(process.env.NIMI_LIVE_LOCAL_SPEECH_BASE_URL, process.env.NIMI_LIVE_LOCAL_BASE_URL, defaultSpeechBaseURL);
const speechModelID = firstNonEmpty(
  process.env.NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_VOXCPM_TTS_MODEL_ID,
  process.env.NIMI_LIVE_LOCAL_TTS_MODEL_ID,
  defaultModelID,
);
const referenceAudioPath = firstNonEmpty(process.env.NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH, defaultReferenceAudioPath);

if (!fs.existsSync(referenceAudioPath)) {
  process.stderr.write(`reference audio fixture missing: ${referenceAudioPath}\n`);
  process.exit(2);
}

const env = {
  ...process.env,
  NIMI_LIVE_LOCAL_SPEECH_BASE_URL: speechBaseURL,
  NIMI_LIVE_LOCAL_BASE_URL: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_BASE_URL, speechBaseURL),
  NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID, speechModelID),
  NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID, speechModelID),
  NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID, speechModelID),
  NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID: firstNonEmpty(process.env.NIMI_LIVE_LOCAL_VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID, speechModelID),
  NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH: referenceAudioPath,
  NIMI_LIVE_VOICE_CLONE_TEXT: firstNonEmpty(process.env.NIMI_LIVE_VOICE_CLONE_TEXT, 'Hello from Nimi local VoxCPM clone smoke.'),
};

process.stdout.write(`local voxcpm workflow smoke speech base URL: ${env.NIMI_LIVE_LOCAL_SPEECH_BASE_URL}\n`);
process.stdout.write(`local voxcpm workflow smoke model id: ${speechModelID}\n`);
process.stdout.write(`local voxcpm workflow smoke reference audio: ${referenceAudioPath}\n`);

const result = run(
  'go',
  [
    'test',
    '-timeout',
    '180s',
    './internal/services/ai',
    '-run',
    'TestLiveSmokeLocalVoxCPMVoiceDesign|TestLiveSmokeLocalVoxCPMVoiceClone',
  ],
  {
    cwd: runtimeDir,
    env,
  },
);
process.exit(result.status ?? 1);
