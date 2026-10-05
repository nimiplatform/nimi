import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

test('production host inspection and history do not eagerly load the capability execution handlers', async () => {
  const { metafile } = await build({
    absWorkingDir: root, entryPoints: ['src/renderer/production-bindings.ts'],
    outdir: '.tmp/execution-loading', write: false, bundle: true, splitting: true,
    metafile: true, packages: 'external', platform: 'browser', format: 'esm', jsx: 'automatic', logLevel: 'silent',
  });
  const [entryPath] = Object.entries(metafile.outputs).find(([, value]) => value.entryPoint === 'src/renderer/production-bindings.ts');
  const staticInputs = new Set();
  const seen = new Set();
  function visit(outputPath) {
    if (seen.has(outputPath)) return;
    seen.add(outputPath);
    const output = metafile.outputs[outputPath];
    for (const input of Object.keys(output.inputs)) staticInputs.add(input);
    for (const link of output.imports) {
      if (!link.external && link.kind !== 'dynamic-import') visit(link.path);
    }
  }
  visit(entryPath);
  assert.equal(staticInputs.has('src/lab/lab-runtime-inspection.ts'), true);
  assert.equal(staticInputs.has('src/lab/lab-runtime.ts'), false);
  assert.equal(staticInputs.has('src/studio-modules/studio-media/audio-separate-runtime.ts'), false);
  assert.ok(Object.values(metafile.outputs).some(value => value.entryPoint === 'src/lab/lab-runtime.ts'), 'normal dispatch must keep the complete on-demand execution module');
});
