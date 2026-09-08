import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/lab/world-tour/world-tour-camera.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { parseWorldTourCameraPreset } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('saved viewpoints preserve position and orientation and reject unusable cameras', () => {
  const pose = { position: [1.5, 1.7, -3], quaternion: [0, 0, 0, 1], fov: 65 };
  assert.deepEqual(parseWorldTourCameraPreset(JSON.parse(JSON.stringify(pose))), pose);
  for (const invalid of [
    { ...pose, position: [1, 2] }, { ...pose, position: [NaN, 0, 0] },
    { ...pose, quaternion: [0, 0, 0, 0] }, { ...pose, fov: 180 },
  ]) assert.throws(() => parseWorldTourCameraPreset(invalid), /camera-preset-invalid/);
});
