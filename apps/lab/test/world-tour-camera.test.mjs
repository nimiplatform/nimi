import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/lab/world-tour/world-tour-camera.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { parseWorldTourCameraPreset, assertWorldCameraArchive } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('saved viewpoints preserve position and orientation and reject unusable cameras', () => {
  const pose = { position: [1.5, 1.7, -3], quaternion: [0, 0, 0, 1], fov: 65 };
  assert.deepEqual(parseWorldTourCameraPreset(JSON.parse(JSON.stringify(pose))), pose);
  for (const invalid of [
    { ...pose, position: [1, 2] }, { ...pose, position: [NaN, 0, 0] },
    { ...pose, quaternion: [0, 0, 0, 0] }, { ...pose, fov: 180 },
  ]) assert.throws(() => parseWorldTourCameraPreset(invalid), /camera-preset-invalid/);
});

test('new navigation viewpoints retain body/mode and exact archive identity without rewriting legacy poses',()=>{
 const pose={position:[0,1.6,0],quaternion:[0,0,0,1],fov:65,archiveSha256:`sha256:${'a'.repeat(64)}`,navigation:{mode:'walk',bodyHeight:1.7,radius:.25}};
 assert.deepEqual(parseWorldTourCameraPreset(pose),pose);assertWorldCameraArchive(pose,pose.archiveSha256);assert.throws(()=>assertWorldCameraArchive(pose,`sha256:${'b'.repeat(64)}`),/archive-mismatch/);
 for(const navigation of [{mode:'auto',bodyHeight:1.7,radius:.25},{mode:'walk',bodyHeight:.5,radius:.4}])assert.throws(()=>parseWorldTourCameraPreset({...pose,navigation}));
 const legacy={position:[0,.2,0],quaternion:[0,0,0,1],fov:65};assert.deepEqual(parseWorldTourCameraPreset(legacy),legacy);assertWorldCameraArchive(legacy,pose.archiveSha256);
});
