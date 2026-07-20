import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bootstrapLocalQwen3Speech, recommendedEnvLines } from './bootstrap-local-qwen3-speech.mjs';

test('bootstrapLocalQwen3Speech writes discoverable qwen3 speech manifest bundles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-qwen3-speech-'));
  const modelsRoot = path.join(root, 'models');
  const ttsVenvRoot = path.join(root, 'tts-venv');
  const asrVenvRoot = path.join(root, 'asr-venv');

  const result = await bootstrapLocalQwen3Speech({
    modelsRoot,
    ttsVenvRoot,
    asrVenvRoot,
    cacheRoot: path.join(root, 'hf'),
    speechBaseURL: '',
    skipInstall: true,
    quiet: true,
  });

  assert.equal(result.bundlePaths.length, 4);

  const ttsManifest = JSON.parse(await fs.readFile(result.bundlePaths[0].manifestPath, 'utf8'));
  const asrManifest = JSON.parse(await fs.readFile(result.bundlePaths[3].manifestPath, 'utf8'));
  const ttsEntry = JSON.parse(await fs.readFile(result.bundlePaths[0].entryPath, 'utf8'));

  assert.equal(ttsManifest.asset_id, 'speech/qwen3tts');
  assert.equal(ttsManifest.engine, 'speech');
  assert.deepEqual(ttsManifest.capabilities, ['audio.synthesize']);
  assert.equal(ttsManifest.engine_config.driver_family, 'qwen3_tts');
  assert.equal(ttsEntry.model_ref, 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice');
  assert.equal(asrManifest.asset_id, 'speech/qwen3asr');
  assert.deepEqual(asrManifest.capabilities, ['audio.transcribe']);
  assert.equal(asrManifest.engine_config.driver_family, 'qwen3_asr');
});

test('bootstrapLocalQwen3Speech reuses existing install state when unchanged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-qwen3-speech-'));
  const modelsRoot = path.join(root, 'models');
  const ttsVenvRoot = path.join(root, 'tts-venv');
  const asrVenvRoot = path.join(root, 'asr-venv');
  const ttsPythonPath = fixturePythonExecutable(ttsVenvRoot);
  const asrPythonPath = fixturePythonExecutable(asrVenvRoot);
  await fs.mkdir(path.dirname(ttsPythonPath), { recursive: true });
  await fs.mkdir(path.dirname(asrPythonPath), { recursive: true });
  await fs.writeFile(ttsPythonPath, '', 'utf8');
  await fs.writeFile(asrPythonPath, '', 'utf8');
  await fs.writeFile(path.join(ttsVenvRoot, '.qwen3-speech-bootstrap.json'), `${JSON.stringify({
    schemaVersion: 1,
    pythonVersion: '3.12',
    packages: [
      'qwen-tts',
      'soundfile',
      'huggingface-hub',
      'fastapi==0.121.1',
      'uvicorn[standard]==0.38.0',
      'python-multipart',
    ],
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(asrVenvRoot, '.qwen3-speech-bootstrap.json'), `${JSON.stringify({
    schemaVersion: 1,
    pythonVersion: '3.12',
    packages: [
      'qwen-asr',
      'huggingface-hub',
      'fastapi==0.121.1',
      'uvicorn[standard]==0.38.0',
      'python-multipart',
    ],
  }, null, 2)}\n`, 'utf8');

  const result = await bootstrapLocalQwen3Speech({
    modelsRoot,
    ttsVenvRoot,
    asrVenvRoot,
    cacheRoot: path.join(root, 'hf'),
    speechBaseURL: '',
    skipInstall: false,
    quiet: true,
  });

  assert.equal(result.ttsInstall.installReused, true);
  assert.equal(result.asrInstall.installReused, true);
});

test('recommendedEnvLines points runtime to repo-local qwen3 driver wrappers', () => {
  const fixtureRoot = path.join(os.tmpdir(), 'nimi-qwen3-env-fixture');
  const modelsRoot = path.join(fixtureRoot, 'models');
  const ttsVenvRoot = path.join(fixtureRoot, 'tts-venv');
  const asrVenvRoot = path.join(fixtureRoot, 'asr-venv');
  const cacheRoot = path.join(fixtureRoot, 'hf');
  const lines = recommendedEnvLines({
    modelsRoot,
    ttsVenvRoot,
    asrVenvRoot,
    cacheRoot,
    speechBaseURL: 'http://127.0.0.1:43111/v1',
  });

  assert.equal(lines[0], `export NIMI_RUNTIME_LOCAL_MODELS_PATH='${modelsRoot}'`);
  assert.equal(lines[1], `export HF_HOME='${cacheRoot}'`);
  assert.equal(lines[2], `export HUGGINGFACE_HUB_CACHE='${path.join(cacheRoot, 'hub')}'`);
  assert.equal(lines[3], `export TRANSFORMERS_CACHE='${path.join(cacheRoot, 'transformers')}'`);
  assert.equal(lines[4], `export NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD='${fixturePythonExecutable(ttsVenvRoot)} ${path.join(process.cwd(), 'scripts', 'qwen3-tts-driver.py')}'`);
  assert.equal(lines[5], `export NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD='${fixturePythonExecutable(asrVenvRoot)} ${path.join(process.cwd(), 'scripts', 'qwen3-asr-driver.py')}'`);
  assert.equal(lines[6], "export NIMI_LIVE_LOCAL_QWEN3_TTS_MODEL_ID='speech/qwen3tts'");
  assert.equal(lines[7], "export NIMI_LIVE_LOCAL_QWEN3_TTS_BASE_MODEL_ID='speech/qwen3tts-base'");
  assert.equal(lines[8], "export NIMI_LIVE_LOCAL_QWEN3_TTS_VOICEDESIGN_MODEL_ID='speech/qwen3tts-design'");
  assert.equal(lines[9], "export NIMI_LIVE_LOCAL_STT_MODEL_ID='speech/qwen3asr'");
  assert.equal(lines[10], "export NIMI_LIVE_LOCAL_TTS_MODEL_ID='speech/qwen3tts'");
  assert.equal(lines[11], "export NIMI_LIVE_LOCAL_SPEECH_BASE_URL='http://127.0.0.1:43111/v1'");
});

function fixturePythonExecutable(venvRoot) {
  return process.platform === 'win32'
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python3');
}
