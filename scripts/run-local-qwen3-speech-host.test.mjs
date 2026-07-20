import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildHostLaunchSpec } from './run-local-qwen3-speech-host.mjs';

test('buildHostLaunchSpec wires repo-local speech server and qwen3 speech drivers', () => {
  const fixtureRoot = path.join(os.tmpdir(), 'nimi-qwen3-host-fixture');
  const modelsRoot = path.join(fixtureRoot, 'models');
  const ttsVenvRoot = path.join(fixtureRoot, 'tts-venv');
  const asrVenvRoot = path.join(fixtureRoot, 'asr-venv');
  const cacheRoot = path.join(fixtureRoot, 'hf');
  const spec = buildHostLaunchSpec({
    host: '127.0.0.1',
    port: 8330,
    modelsRoot,
    ttsVenvRoot,
    asrVenvRoot,
    cacheRoot,
  });

  assert.equal(spec.pythonPath, fixturePythonExecutable(ttsVenvRoot));
  assert.equal(spec.serverScript, path.join(process.cwd(), 'runtime', 'internal', 'engine', 'assets', 'speech_server.py'));
  assert.deepEqual(spec.args.slice(-4), ['--host', '127.0.0.1', '--port', '8330']);
  assert.equal(spec.baseURL, 'http://127.0.0.1:8330/v1');
  assert.equal(spec.env.NIMI_RUNTIME_LOCAL_MODELS_PATH, modelsRoot);
  assert.equal(spec.env.NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD, `${spec.pythonPath} ${path.join(process.cwd(), 'scripts', 'qwen3-tts-driver.py')}`);
  assert.equal(spec.env.NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD, `${fixturePythonExecutable(asrVenvRoot)} ${path.join(process.cwd(), 'scripts', 'qwen3-asr-driver.py')}`);
  assert.equal(spec.env.HF_HOME, cacheRoot);
  assert.equal(spec.env.HUGGINGFACE_HUB_CACHE, path.join(cacheRoot, 'hub'));
  assert.equal(spec.env.TRANSFORMERS_CACHE, path.join(cacheRoot, 'transformers'));
});

function fixturePythonExecutable(venvRoot) {
  return process.platform === 'win32'
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python3');
}
