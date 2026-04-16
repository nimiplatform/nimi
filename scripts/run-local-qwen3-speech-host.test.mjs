import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHostLaunchSpec } from './run-local-qwen3-speech-host.mjs';

test('buildHostLaunchSpec wires repo-local speech server and qwen3 speech drivers', () => {
  const spec = buildHostLaunchSpec({
    host: '127.0.0.1',
    port: 8330,
    modelsRoot: '/tmp/models',
    ttsVenvRoot: '/tmp/tts-venv',
    asrVenvRoot: '/tmp/asr-venv',
    cacheRoot: '/tmp/hf',
  });

  assert.equal(spec.pythonPath, '/tmp/tts-venv/bin/python3');
  assert.match(spec.serverScript, /runtime\/internal\/engine\/assets\/speech_server\.py$/);
  assert.deepEqual(spec.args.slice(-4), ['--host', '127.0.0.1', '--port', '8330']);
  assert.equal(spec.baseURL, 'http://127.0.0.1:8330/v1');
  assert.equal(spec.env.NIMI_RUNTIME_LOCAL_MODELS_PATH, '/tmp/models');
  assert.equal(spec.env.NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD, `${spec.pythonPath} ${process.cwd()}/scripts/qwen3-tts-driver.py`);
  assert.equal(spec.env.NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD, `/tmp/asr-venv/bin/python3 ${process.cwd()}/scripts/qwen3-asr-driver.py`);
  assert.equal(spec.env.HF_HOME, '/tmp/hf');
  assert.equal(spec.env.HUGGINGFACE_HUB_CACHE, '/tmp/hf/hub');
  assert.equal(spec.env.TRANSFORMERS_CACHE, '/tmp/hf/transformers');
});
