import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bootstrapLocalVoxCPMMLX, recommendedEnvLines } from './bootstrap-local-voxcpm-mlx.mjs';

test('bootstrapLocalVoxCPMMLX writes a discoverable speech/voxcpm2 manifest bundle', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-voxcpm-mlx-'));
  const modelsRoot = path.join(root, 'models');
  const venvRoot = path.join(root, 'venv');

  const result = await bootstrapLocalVoxCPMMLX({
    modelsRoot,
    venvRoot,
    modelID: 'speech/voxcpm2',
    modelRef: 'mlx-community/VoxCPM2-4bit',
    speechBaseURL: '',
    skipInstall: true,
    quiet: true,
  });

  const manifest = JSON.parse(await fs.readFile(result.bundlePaths.manifestPath, 'utf8'));
  const entry = JSON.parse(await fs.readFile(result.bundlePaths.entryPath, 'utf8'));
  assert.equal(manifest.asset_id, 'speech/voxcpm2');
  assert.equal(manifest.logical_model_id, 'speech/voxcpm2');
  assert.equal(manifest.engine, 'speech');
  assert.deepEqual(manifest.capabilities, ['audio.synthesize']);
  assert.equal(manifest.engine_config.driver_backend, 'mlx');
  assert.equal(entry.model_ref, 'mlx-community/VoxCPM2-4bit');
  assert.equal(entry.target_model_id, 'speech/voxcpm2');
  assert.match(result.mlxAudioSource, /github\.com\/Blaizzy\/mlx-audio\.git@/);
});

test('bootstrapLocalVoxCPMMLX allows overriding the mlx-audio source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-voxcpm-mlx-'));
  const result = await bootstrapLocalVoxCPMMLX({
    modelsRoot: path.join(root, 'models'),
    venvRoot: path.join(root, 'venv'),
    modelID: 'speech/voxcpm2',
    modelRef: 'mlx-community/VoxCPM2-4bit',
    mlxAudioSource: 'git+https://example.com/custom/mlx-audio.git@deadbeef',
    speechBaseURL: '',
    skipInstall: true,
    quiet: true,
  });

  assert.equal(result.mlxAudioSource, 'git+https://example.com/custom/mlx-audio.git@deadbeef');
});

test('recommendedEnvLines points the runtime to the repo-local mlx driver wrapper', () => {
  const lines = recommendedEnvLines({
    modelsRoot: '/tmp/models',
    venvRoot: '/tmp/venv',
    modelID: 'speech/voxcpm2',
    modelRef: 'mlx-community/VoxCPM2-4bit',
    speechBaseURL: 'http://127.0.0.1:43111/v1',
  });

  assert.equal(lines[0], "export NIMI_RUNTIME_LOCAL_MODELS_PATH='/tmp/models'");
  assert.match(lines[1], /voxcpm-mlx-driver\.py --model mlx-community\/VoxCPM2-4bit'/);
  assert.equal(lines[2], "export NIMI_LIVE_LOCAL_VOXCPM_TTS_MODEL_ID='speech/voxcpm2'");
  assert.equal(lines[3], "export NIMI_LIVE_LOCAL_SPEECH_BASE_URL='http://127.0.0.1:43111/v1'");
});
