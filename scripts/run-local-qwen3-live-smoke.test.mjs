import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findQwen3SpeechManifest } from './run-local-qwen3-live-smoke.mjs';

test('findQwen3SpeechManifest locates qwen3 speech bundle by family', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-qwen3-smoke-'));
  const bundleDir = path.join(root, 'resolved', 'speech', 'qwen3tts');
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.writeFile(path.join(bundleDir, 'asset.manifest.json'), JSON.stringify({
    asset_id: 'speech/qwen3tts',
    family: 'qwen3_tts',
    engine: 'speech',
  }), 'utf8');

  const found = findQwen3SpeechManifest(root);
  assert.equal(found, path.join(bundleDir, 'asset.manifest.json'));
});
