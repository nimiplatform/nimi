import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEPENDENCY_LINK_THRESHOLD_BYTES,
  cloneDataRootDependency,
} from '../../../apps/desktop/e2e/fixtures/acceptance-files.mjs';

const TEST_THRESHOLD = 1024;

function makeWorkspace(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-dependency-clone-test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

function newStats() {
  return { linkedFiles: 0, linkedBytes: 0, copiedFiles: 0, copiedBytes: 0, linkFallbackCode: null };
}

test('large immutable artifacts are hardlinked, small mutable files are copied', (t) => {
  const workspace = makeWorkspace(t);
  const source = path.join(workspace, 'source', 'models', 'resolved', 'example');
  fs.mkdirSync(source, { recursive: true });
  const largeBody = 'w'.repeat(TEST_THRESHOLD * 4);
  fs.writeFileSync(path.join(source, 'model.gguf'), largeBody);
  fs.writeFileSync(path.join(source, 'bundle.manifest.json'), '{"entry":"model.gguf"}');
  const target = path.join(workspace, 'target', 'models', 'resolved', 'example');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const stats = cloneDataRootDependency(source, target, newStats(), TEST_THRESHOLD);

  const linked = fs.statSync(path.join(target, 'model.gguf'));
  assert.equal(linked.nlink, 2, 'large artifact must be a hardlink to the source cache');
  assert.equal(fs.readFileSync(path.join(target, 'model.gguf'), 'utf8'), largeBody);
  const copied = fs.statSync(path.join(target, 'bundle.manifest.json'));
  assert.equal(copied.nlink, 1, 'small manifest must remain an isolated copy');
  assert.equal(fs.readFileSync(path.join(target, 'bundle.manifest.json'), 'utf8'), '{"entry":"model.gguf"}');
  assert.equal(stats.linkedFiles, 1);
  assert.equal(stats.linkedBytes, largeBody.length);
  assert.equal(stats.copiedFiles, 1);
  assert.equal(stats.linkFallbackCode, null);
});

test('rewriting a copied manifest in the trial does not touch the source cache', (t) => {
  const workspace = makeWorkspace(t);
  const source = path.join(workspace, 'source');
  fs.mkdirSync(source, { recursive: true });
  const manifestPath = path.join(source, 'manifest.json');
  fs.writeFileSync(manifestPath, 'original');
  const target = path.join(workspace, 'target');

  cloneDataRootDependency(source, target, newStats(), TEST_THRESHOLD);
  fs.writeFileSync(path.join(target, 'manifest.json'), 'mutated-in-trial');

  assert.equal(fs.readFileSync(manifestPath, 'utf8'), 'original');
});

test('existing targets are replaced when re-cloning', (t) => {
  const workspace = makeWorkspace(t);
  const source = path.join(workspace, 'source');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'model.bin'), 'x'.repeat(TEST_THRESHOLD * 2));
  const target = path.join(workspace, 'target');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'model.bin'), 'stale copy');

  cloneDataRootDependency(source, target, newStats(), TEST_THRESHOLD);

  const replaced = fs.statSync(path.join(target, 'model.bin'));
  assert.equal(replaced.nlink, 2);
  assert.equal(replaced.size, TEST_THRESHOLD * 2);
});

test('single-file dependency roots clone without a wrapping directory', (t) => {
  const workspace = makeWorkspace(t);
  const source = path.join(workspace, 'runtime.dll');
  fs.writeFileSync(source, 'd'.repeat(TEST_THRESHOLD * 2));
  const target = path.join(workspace, 'trial', 'runtime.dll');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const stats = cloneDataRootDependency(source, target, newStats(), TEST_THRESHOLD);

  assert.equal(fs.statSync(target).nlink, 2);
  assert.equal(stats.linkedFiles, 1);
});

test('default link threshold keeps manifests below the immutable-artifact cutoff', () => {
  assert.equal(DEPENDENCY_LINK_THRESHOLD_BYTES, 4 * 1024 * 1024);
});
