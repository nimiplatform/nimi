import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildHostLaunchSpec } from './run-local-voxcpm-mlx-speech-host.mjs';

test('buildHostLaunchSpec wires repo-local speech server and voxcpm mlx driver', () => {
  const fixtureRoot = path.join(os.tmpdir(), 'nimi-voxcpm-host-fixture');
  const modelsRoot = path.join(fixtureRoot, 'models');
  const venvRoot = path.join(fixtureRoot, 'venv');
  const spec = buildHostLaunchSpec({
    host: '127.0.0.1',
    port: 8330,
    modelsRoot,
    venvRoot,
    modelRef: 'mlx-community/VoxCPM2-4bit',
  });

  assert.equal(spec.pythonPath, fixturePythonExecutable(venvRoot));
  assert.equal(spec.serverScript, path.join(process.cwd(), 'runtime', 'internal', 'engine', 'assets', 'speech_server.py'));
  assert.deepEqual(spec.args.slice(-4), ['--host', '127.0.0.1', '--port', '8330']);
  assert.equal(spec.baseURL, 'http://127.0.0.1:8330/v1');
  assert.equal(spec.env.NIMI_RUNTIME_LOCAL_MODELS_PATH, modelsRoot);
  assert.match(spec.env.NIMI_RUNTIME_SPEECH_VOXCPM_CMD, /voxcpm-mlx-driver\.py --model mlx-community\/VoxCPM2-4bit$/);
});

function fixturePythonExecutable(venvRoot) {
  return process.platform === 'win32'
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python3');
}
