import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-lab-run-input-'));

await build({
  entryPoints: [path.join(root, 'src/ai-studio-core/section-ai-testing-input.ts')],
  outfile: path.join(buildDir, 'section-ai-testing-input.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'silent',
});

const { hasStudioCapabilityRunInput } = await import(
  pathToFileURL(path.join(buildDir, 'section-ai-testing-input.mjs')).href
);

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

test('file-backed capability runs do not require placeholder text', () => {
  assert.equal(hasStudioCapabilityRunInput({
    requiresPrompt: true,
    prompt: '   ',
    hasAlternativeInput: true,
  }), true);
});

test('prompt-backed capability runs still require a real input', () => {
  assert.equal(hasStudioCapabilityRunInput({
    requiresPrompt: true,
    prompt: '   ',
    hasAlternativeInput: false,
  }), false);
  assert.equal(hasStudioCapabilityRunInput({
    requiresPrompt: true,
    prompt: 'Generate a result.',
    hasAlternativeInput: false,
  }), true);
  assert.equal(hasStudioCapabilityRunInput({
    requiresPrompt: false,
    prompt: '',
    hasAlternativeInput: false,
  }), true);
});
