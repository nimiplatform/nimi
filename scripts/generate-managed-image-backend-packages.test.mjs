import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  assertManagedImageBackendPackageProjection,
  renderManagedImageBackendPackages,
  SOURCE_RELATIVE,
} from './lib/managed-image-backend-package-sync.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sourceText = fs.readFileSync(path.join(repoRoot, SOURCE_RELATIVE), 'utf8');

test('managed image backend package projection is deterministic', () => {
  const output = renderManagedImageBackendPackages(sourceText);
  assert.match(output, /Code generated/u);
  assert.match(output, /windows-x64-nvidia-stablediffusion-ggml/u);
  assertManagedImageBackendPackageProjection(sourceText, output);
});

test('managed image backend package projection rejects byte drift', () => {
  const output = renderManagedImageBackendPackages(sourceText);
  assert.throws(
    () => assertManagedImageBackendPackageProjection(sourceText, `${output}# drift\n`),
    /out of date/u,
  );
});
