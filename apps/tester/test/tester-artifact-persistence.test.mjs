import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const source = readFileSync(path.join(root, 'src/tester/tester-artifact-persistence.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
const { shouldPersistTesterArtifactRecord } = await import(moduleUrl);
const historyActionsSource = readFileSync(path.join(root, 'src/tester/tester-managed-history.ts'), 'utf8');
const historyActionsOutput = ts.transpileModule(historyActionsSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const historyActionsUrl = `data:text/javascript;base64,${Buffer.from(historyActionsOutput).toString('base64')}`;
const { clearTesterManagedHistoryScope, deleteTesterManagedHistoryRecord } = await import(historyActionsUrl);

function managedHistoryPort() {
  let runHistory = {
    'image.generate': [
      { id: 'run-1', capabilityId: 'image.generate' },
      { id: 'run-2', capabilityId: 'image.generate' },
    ],
  };
  let imageHistory = [
    { id: 'run-1', runId: 'run-1', capabilityId: 'image.generate', relativePath: 'media/one.asset' },
    { id: 'run-2', runId: 'run-2', capabilityId: 'image.generate', relativePath: 'media/two.asset' },
  ];
  const assets = new Set(['media/one.asset', 'media/two.asset']);
  const assetCalls = [];
  const failingAssets = new Set();
  const port = {
    loadRunHistory: async () => structuredClone(runHistory),
    loadImageHistory: async () => structuredClone(imageHistory),
    async removeAsset(relativePath) {
      assetCalls.push(relativePath);
      if (failingAssets.has(relativePath)) throw new Error(`failed:${relativePath}`);
      return { removed: assets.delete(relativePath) };
    },
    async removeRunHistory(runId) {
      runHistory = Object.fromEntries(Object.entries(runHistory).map(([capabilityId, records]) => [
        capabilityId,
        records.filter((record) => record.id !== runId),
      ]));
      return structuredClone(runHistory);
    },
    async removeImageHistory(runId) {
      imageHistory = imageHistory.filter((record) => (record.runId || record.id) !== runId);
      return structuredClone(imageHistory);
    },
    async clearRunHistory(capabilityId) {
      runHistory = capabilityId ? Object.fromEntries(Object.entries(runHistory).filter(([key]) => key !== capabilityId)) : {};
      return structuredClone(runHistory);
    },
    async clearImageHistory(capabilityId) {
      imageHistory = capabilityId ? imageHistory.filter((record) => record.capabilityId !== capabilityId) : [];
      return structuredClone(imageHistory);
    },
  };
  return { port, assets, assetCalls, failingAssets };
}

test('artifact persistence gate accepts only real non-world runtime artifacts', () => {
  assert.equal(shouldPersistTesterArtifactRecord({
    ok: true,
    capabilityId: 'image.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 1,
      jobId: 'job-1',
      jobState: 'ready',
      firstArtifact: {
        relativePath: 'media/image-generate/asset.asset',
        mediaType: 'image/png',
        sizeBytes: 8,
        sha256: `sha256:${'a'.repeat(64)}`,
      },
    },
  }), true);

  assert.equal(shouldPersistTesterArtifactRecord({
    ok: true,
    capabilityId: 'video.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 0,
      jobId: 'job-2',
      jobState: 'ready',
    },
  }), false);

  assert.equal(shouldPersistTesterArtifactRecord({
    ok: true,
    capabilityId: 'image.generate',
    output: { kind: 'artifacts', artifactCount: 1, jobId: 'job-source-only', jobState: 'ready', firstArtifact: { artifactId: 'source-artifact' } },
  }), false);

  assert.equal(shouldPersistTesterArtifactRecord({
    ok: false,
    capabilityId: 'image.generate',
  }), false);

  assert.equal(shouldPersistTesterArtifactRecord({
    ok: true,
    capabilityId: 'world.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 2,
      jobId: 'world-fixture',
      jobState: 'ready',
    },
  }), false);
});

test('record-only deletion removes both linked history rows and retains the managed asset', async () => {
  const state = managedHistoryPort();
  const outcome = await deleteTesterManagedHistoryRecord(state.port, 'run-1', false);
  assert.deepEqual(outcome, {
    completed: 1,
    skipped: 0,
    failed: 0,
    runHistory: { 'image.generate': [{ id: 'run-2', capabilityId: 'image.generate' }] },
    imageHistory: [{ id: 'run-2', runId: 'run-2', capabilityId: 'image.generate', relativePath: 'media/two.asset' }],
    issues: [],
  });
  assert.equal(state.assets.has('media/one.asset'), true);
  assert.deepEqual(state.assetCalls, []);
});

test('record-plus-asset treats absent as success and retains both rows when asset deletion fails', async () => {
  const absent = managedHistoryPort();
  absent.assets.delete('media/one.asset');
  const completed = await deleteTesterManagedHistoryRecord(absent.port, 'run-1', true);
  assert.deepEqual({ completed: completed.completed, skipped: completed.skipped, failed: completed.failed }, { completed: 1, skipped: 0, failed: 0 });

  const failed = managedHistoryPort();
  failed.failingAssets.add('media/one.asset');
  const skipped = await deleteTesterManagedHistoryRecord(failed.port, 'run-1', true);
  assert.deepEqual({ completed: skipped.completed, skipped: skipped.skipped, failed: skipped.failed }, { completed: 0, skipped: 1, failed: 0 });
  assert.equal(skipped.runHistory['image.generate'].some((record) => record.id === 'run-1'), true);
  assert.equal(skipped.imageHistory.some((record) => record.runId === 'run-1'), true);
});

test('scoped record-plus-asset clear reports completed, skipped, and failed-shaped outcomes after reload', async () => {
  const state = managedHistoryPort();
  state.failingAssets.add('media/two.asset');
  const outcome = await clearTesterManagedHistoryScope(state.port, 'image.generate', true);
  assert.deepEqual({ completed: outcome.completed, skipped: outcome.skipped, failed: outcome.failed }, { completed: 1, skipped: 1, failed: 0 });
  assert.equal(outcome.runHistory['image.generate'].some((record) => record.id === 'run-1'), false);
  assert.equal(outcome.runHistory['image.generate'].some((record) => record.id === 'run-2'), true);
  assert.equal(outcome.imageHistory.some((record) => record.runId === 'run-1'), false);
  assert.equal(outcome.imageHistory.some((record) => record.runId === 'run-2'), true);
});
