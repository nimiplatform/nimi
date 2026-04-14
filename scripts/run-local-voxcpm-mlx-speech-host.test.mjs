import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHostLaunchSpec } from './run-local-voxcpm-mlx-speech-host.mjs';

test('buildHostLaunchSpec wires repo-local speech server and voxcpm mlx driver', () => {
  const spec = buildHostLaunchSpec({
    host: '127.0.0.1',
    port: 8330,
    modelsRoot: '/tmp/models',
    venvRoot: '/tmp/venv',
    modelRef: 'mlx-community/VoxCPM2-4bit',
  });

  assert.equal(spec.pythonPath, '/tmp/venv/bin/python3');
  assert.match(spec.serverScript, /runtime\/internal\/engine\/assets\/speech_server\.py$/);
  assert.deepEqual(spec.args.slice(-4), ['--host', '127.0.0.1', '--port', '8330']);
  assert.equal(spec.baseURL, 'http://127.0.0.1:8330/v1');
  assert.equal(spec.env.NIMI_RUNTIME_LOCAL_MODELS_PATH, '/tmp/models');
  assert.match(spec.env.NIMI_RUNTIME_SPEECH_VOXCPM_CMD, /voxcpm-mlx-driver\.py --model mlx-community\/VoxCPM2-4bit$/);
});
