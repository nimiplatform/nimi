import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: [new URL('../src/lab/world-tour/world-tour-history.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { worldTourHistoryManifest, openWorldTourHistory } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const saved = {
  capabilityId: 'world.generate',
  result: { ok: true, kind: 'artifacts', jobId: 'world-a', artifacts: [{ mediaType: 'application/vnd.nimi.world+zip', relativePath: 'world-tour/world-a/world.zip' }] },
};

test('opening world A history uses its own manifest while latest world B stays unchanged', async () => {
  const latest = { archivePath: 'world-tour/world-b/world.zip' };
  const opened = [];
  const resolved = [];
  await openWorldTourHistory(saved, {
    async resolveWorldTourFixture(input) {
      resolved.push(input);
      return { manifestPath: input.manifestPath, archivePath: 'world-tour/world-a/world.zip', viewerPresetPath: 'world-tour/world-a/world.zip.camera.json' };
    },
    async openWorldTourWindow(input) { opened.push(input); return { windowLabel: 'viewer-a', manifestPath: input.manifestPath }; },
  });
  assert.deepEqual(resolved, [{ manifestPath: 'world-tour/world-a/world.json' }]);
  assert.deepEqual(opened, resolved);
  assert.equal(latest.archivePath, 'world-tour/world-b/world.zip');
});

test('a saved manifest redirected to world B never opens either world or rewrites latest', async () => {
  let opened = 0;
  await assert.rejects(openWorldTourHistory(saved, {
    async resolveWorldTourFixture(input) { return { manifestPath: input.manifestPath, archivePath: 'world-tour/world-b/world.zip' }; },
    async openWorldTourWindow() { opened++; },
  }), /manifest-mismatch/);
  assert.equal(opened, 0);
  assert.equal(worldTourHistoryManifest({ ...saved, result: { ...saved.result, jobId: 'other' } }), null);
});
