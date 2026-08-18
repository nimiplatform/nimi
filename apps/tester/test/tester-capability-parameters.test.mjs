import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-tester-capability-parameters-'));

await build({
  entryPoints: [path.join(root, 'src/tester/tester-capability-parameters.ts')],
  outfile: path.join(buildDir, 'tester-capability-parameters.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'silent',
});

const { createTesterCapabilityParameterState } = await import(
  pathToFileURL(path.join(buildDir, 'tester-capability-parameters.mjs')).href
);

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

test('voice creation starts on the text-description path shown by the primary composer', () => {
  assert.deepEqual(createTesterCapabilityParameterState()['voice.create'], {
    creationSource: 'text-description',
  });
});
