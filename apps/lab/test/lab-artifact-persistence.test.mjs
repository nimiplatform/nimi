import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const source = readFileSync(path.join(root, 'src/lab/lab-artifact-persistence.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
const {
  cleanupLabManagedArtifactPaths,
  persistLabRunHistoryWithArtifactCompensation,
  settleLabHistorySaveIssueAfterPersistedRun,
  shouldPersistLabArtifactRecord,
} = await import(moduleUrl);
const historyActionsSource = readFileSync(path.join(root, 'src/lab/lab-managed-history.ts'), 'utf8');
const sdkTypesStubUrl = `data:text/javascript;base64,${Buffer.from('export const isJsonObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);').toString('base64')}`;
const sharedHistorySource = readFileSync(path.join(root, 'src/ai-studio-core/history.ts'), 'utf8');
const sharedHistoryOutput = ts.transpileModule(sharedHistorySource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(
  /from\s+['"]@nimiplatform\/sdk\/types['"]/g,
  `from ${JSON.stringify(sdkTypesStubUrl)}`,
);
const sharedHistoryUrl = `data:text/javascript;base64,${Buffer.from(sharedHistoryOutput).toString('base64')}`;
const sharedHistoryPolicySource = readFileSync(path.join(root, 'src/ai-studio-core/history-policy.ts'), 'utf8');
const sharedHistoryPolicyOutput = ts.transpileModule(sharedHistoryPolicySource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(
  /from\s+['"]@nimiplatform\/sdk\/types['"]/g,
  `from ${JSON.stringify(sdkTypesStubUrl)}`,
);
const sharedHistoryPolicyUrl = `data:text/javascript;base64,${Buffer.from(sharedHistoryPolicyOutput).toString('base64')}`;
const sharedHistoryFacadeUrl = `data:text/javascript;base64,${Buffer.from([
  `export * from ${JSON.stringify(sharedHistoryUrl)};`,
  `export * from ${JSON.stringify(sharedHistoryPolicyUrl)};`,
].join('\n')).toString('base64')}`;
const historyActionsOutput = ts.transpileModule(historyActionsSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(
  /from\s+['"]\.\.\/ai-studio-core\/index\.js['"]/g,
  `from ${JSON.stringify(sharedHistoryFacadeUrl)}`,
);
const historyActionsUrl = `data:text/javascript;base64,${Buffer.from(historyActionsOutput).toString('base64')}`;
const {
  clearLabManagedHistoryScope,
  deleteLabManagedHistoryRecord,
  reconcileLabManagedHistoryProjection,
} = await import(historyActionsUrl);

function managedHistoryPort(initial = {}) {
  let runHistory = structuredClone(initial.runHistory ?? {
    'image.generate': [
      { id: 'run-1', capabilityId: 'image.generate' },
      { id: 'run-2', capabilityId: 'image.generate' },
    ],
  });
  let imageHistory = structuredClone(initial.imageHistory ?? [
    { id: 'run-1', runId: 'run-1', capabilityId: 'image.generate', relativePath: 'media/one.asset' },
    { id: 'run-1:1', runId: 'run-1', capabilityId: 'image.generate', relativePath: 'media/one-last-frame.asset' },
    { id: 'run-2', runId: 'run-2', capabilityId: 'image.generate', relativePath: 'media/two.asset' },
  ]);
  const assets = new Set(initial.assets ?? ['media/one.asset', 'media/one-last-frame.asset', 'media/two.asset']);
  const assetCalls = [];
  const failingAssets = new Set();
  const failingRunHistory = new Set();
  const failingImageHistory = new Set();
  const port = {
    loadRunHistory: async () => structuredClone(runHistory),
    loadImageHistory: async () => structuredClone(imageHistory),
    async removeAsset(relativePath) {
      assetCalls.push(relativePath);
      if (failingAssets.has(relativePath)) throw new Error(`failed:${relativePath}`);
      return { removed: assets.delete(relativePath) };
    },
    async removeRunHistory(runId) {
      if (failingRunHistory.has(runId)) throw new Error(`failed-run-history:${runId}`);
      runHistory = Object.fromEntries(Object.entries(runHistory).map(([capabilityId, records]) => [
        capabilityId,
        records.filter((record) => record.id !== runId),
      ]));
      return structuredClone(runHistory);
    },
    async removeImageHistory(runId) {
      if (failingImageHistory.has(runId)) throw new Error(`failed-image-history:${runId}`);
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
  return { port, assets, assetCalls, failingAssets, failingRunHistory, failingImageHistory };
}

test('artifact persistence gate accepts only real non-world runtime artifacts', () => {
  assert.equal(shouldPersistLabArtifactRecord({
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

  assert.equal(shouldPersistLabArtifactRecord({
    ok: true,
    capabilityId: 'video.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 0,
      jobId: 'job-2',
      jobState: 'ready',
    },
  }), false);

  assert.equal(shouldPersistLabArtifactRecord({
    ok: true,
    capabilityId: 'image.generate',
    output: { kind: 'artifacts', artifactCount: 1, jobId: 'job-source-only', jobState: 'ready', firstArtifact: { artifactId: 'source-artifact' } },
  }), false);

  assert.equal(shouldPersistLabArtifactRecord({
    ok: false,
    capabilityId: 'image.generate',
  }), false);

  assert.equal(shouldPersistLabArtifactRecord({
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

test('history persistence compensation removes every managed artifact and reports cleanup failures', async () => {
  const result = {
    ok: true,
    capabilityId: 'video.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 2,
      jobId: 'job-video',
      jobState: 'COMPLETED',
      artifacts: [
        { relativePath: 'media/video.asset', sizeBytes: 4096, sha256: `sha256:${'a'.repeat(64)}` },
        { relativePath: 'media/last-frame.asset', sizeBytes: 2048, sha256: `sha256:${'b'.repeat(64)}` },
      ],
      firstArtifact: { relativePath: 'media/video.asset', sizeBytes: 4096, sha256: `sha256:${'a'.repeat(64)}` },
    },
  };
  const removalCalls = [];
  let persistenceCalls = 0;

  const outcome = await persistLabRunHistoryWithArtifactCompensation(
    result,
    async () => {
      persistenceCalls += 1;
      throw new Error('history unavailable');
    },
    async (relativePath) => {
      removalCalls.push(relativePath);
      if (relativePath === 'media/video.asset') throw new Error('asset locked');
    },
  );

  assert.equal(persistenceCalls, 1);
  assert.deepEqual(removalCalls, ['media/last-frame.asset', 'media/video.asset']);
  assert.deepEqual(outcome, {
    ok: false,
    message: 'history unavailable Managed artifact cleanup also failed: media/video.asset: asset locked',
    managedArtifactCleanup: 'failed',
    remainingCleanupPaths: ['media/video.asset'],
    displayFailure: {
      reason: 'runtime-call-failed',
      message: 'history unavailable Managed artifact cleanup also failed: media/video.asset: asset locked',
    },
  });
});

test('history compensation never leaves a successful artifact projection after removing its files', async () => {
  const result = {
    ok: true,
    capabilityId: 'image.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 1,
      artifacts: [{ relativePath: 'media/image.asset' }],
      firstArtifact: {
        relativePath: 'media/image.asset',
        sizeBytes: 1024,
        sha256: `sha256:${'c'.repeat(64)}`,
      },
      jobId: 'job-image',
      jobState: 'COMPLETED',
    },
  };

  const outcome = await persistLabRunHistoryWithArtifactCompensation(
    result,
    async () => { throw new Error('history unavailable'); },
    async () => ({ removed: true }),
  );

  assert.deepEqual(outcome, {
    ok: false,
    message: 'history unavailable',
    managedArtifactCleanup: 'completed',
    remainingCleanupPaths: [],
    displayFailure: { reason: 'runtime-call-failed', message: 'history unavailable' },
  });
});

test('failed compensation paths remain directly retryable without a new persistence owner', async () => {
  let locked = true;
  const calls = [];
  const removeAsset = async (relativePath) => {
    calls.push(relativePath);
    if (relativePath === 'media/locked.asset' && locked) throw new Error('asset locked');
    return { removed: true };
  };

  const first = await cleanupLabManagedArtifactPaths(
    ['media/removed.asset', 'media/locked.asset'],
    removeAsset,
  );
  assert.deepEqual(first.remainingCleanupPaths, ['media/locked.asset']);

  locked = false;
  const retry = await cleanupLabManagedArtifactPaths(first.remainingCleanupPaths, removeAsset);
  assert.deepEqual(retry, { failures: [], remainingCleanupPaths: [] });
  assert.deepEqual(calls, ['media/removed.asset', 'media/locked.asset', 'media/locked.asset']);
});

test('a later successful run does not erase a surviving artifact cleanup retry', () => {
  const survivor = settleLabHistorySaveIssueAfterPersistedRun({
    message: 'cleanup incomplete',
    records: [],
    cleanupPaths: ['media/locked.asset'],
  }, 'later-success');
  assert.deepEqual(survivor, {
    message: 'cleanup incomplete',
    records: [],
    cleanupPaths: ['media/locked.asset'],
  });

  assert.equal(settleLabHistorySaveIssueAfterPersistedRun({
    message: 'history retry pending',
    records: [{ id: 'later-success' }],
    cleanupPaths: [],
  }, 'later-success'), null);
});

test('record-only deletion removes both linked history rows and retains the managed asset', async () => {
  const state = managedHistoryPort();
  const outcome = await deleteLabManagedHistoryRecord(state.port, 'run-1', false);
  assert.deepEqual(outcome, {
    completed: 1,
    skipped: 0,
    failed: 0,
    runHistory: { 'image.generate': [{ id: 'run-2', capabilityId: 'image.generate' }] },
    imageHistory: [{ id: 'run-2', runId: 'run-2', capabilityId: 'image.generate', relativePath: 'media/two.asset' }],
    issues: [],
  });
  assert.equal(state.assets.has('media/one.asset'), true);
  assert.equal(state.assets.has('media/one-last-frame.asset'), true);
  assert.deepEqual(state.assetCalls, []);
});

test('record-plus-asset treats absent as success and retains both rows when asset deletion fails', async () => {
  const absent = managedHistoryPort();
  absent.assets.delete('media/one.asset');
  const completed = await deleteLabManagedHistoryRecord(absent.port, 'run-1', true);
  assert.deepEqual({ completed: completed.completed, skipped: completed.skipped, failed: completed.failed }, { completed: 1, skipped: 0, failed: 0 });
  assert.equal(absent.assets.has('media/one-last-frame.asset'), false);

  const failed = managedHistoryPort();
  failed.failingAssets.add('media/one-last-frame.asset');
  const skipped = await deleteLabManagedHistoryRecord(failed.port, 'run-1', true);
  assert.deepEqual({ completed: skipped.completed, skipped: skipped.skipped, failed: skipped.failed }, { completed: 0, skipped: 1, failed: 0 });
  assert.equal(skipped.runHistory['image.generate'].some((record) => record.id === 'run-1'), true);
  assert.equal(skipped.imageHistory.some((record) => record.runId === 'run-1'), true);
});

test('multi-artifact deletion uses canonical run history and converges after a partial asset failure', async () => {
  const firstPath = 'media/video.asset';
  const secondPath = 'media/video-last-frame.asset';
  const sortedPaths = [firstPath, secondPath].sort((left, right) => left.localeCompare(right));
  const state = managedHistoryPort({
    runHistory: {
      'video.generate': [{
        id: 'run-video',
        capabilityId: 'video.generate',
        result: {
          ok: true,
          kind: 'artifacts',
          artifacts: [{ relativePath: firstPath }, { relativePath: secondPath }],
          firstArtifact: { relativePath: firstPath },
        },
      }],
    },
    imageHistory: [{ id: 'run-video', runId: 'run-video', capabilityId: 'video.generate', relativePath: firstPath }],
    assets: [firstPath, secondPath],
  });
  state.failingAssets.add(secondPath);

  const first = await deleteLabManagedHistoryRecord(state.port, 'run-video', true);
  assert.deepEqual({ completed: first.completed, skipped: first.skipped, failed: first.failed }, { completed: 0, skipped: 1, failed: 0 });
  assert.deepEqual(state.assetCalls, sortedPaths);
  assert.equal(first.runHistory['video.generate'].some((record) => record.id === 'run-video'), true);
  assert.equal(first.imageHistory.some((record) => record.runId === 'run-video'), true);
  assert.equal(state.assets.has(firstPath), false);
  assert.equal(state.assets.has(secondPath), true);

  state.failingAssets.clear();
  state.assetCalls.length = 0;
  const second = await deleteLabManagedHistoryRecord(state.port, 'run-video', true);
  assert.deepEqual({ completed: second.completed, skipped: second.skipped, failed: second.failed }, { completed: 1, skipped: 0, failed: 0 });
  assert.deepEqual(state.assetCalls, sortedPaths);
  assert.deepEqual(second.runHistory['video.generate'], []);
  assert.deepEqual(second.imageHistory, []);
  assert.deepEqual([...state.assets], []);
});

test('multi-artifact deletion retains canonical run history when image-history cleanup fails', async () => {
  const state = managedHistoryPort();
  state.failingImageHistory.add('run-1');

  const result = await deleteLabManagedHistoryRecord(state.port, 'run-1', true);
  assert.deepEqual({ completed: result.completed, skipped: result.skipped, failed: result.failed }, { completed: 0, skipped: 0, failed: 1 });
  assert.equal(result.runHistory['image.generate'].some((record) => record.id === 'run-1'), true);
});

test('managed history projection restores every canonical artifact after a partial media-index write', async () => {
  const runHistory = {
    'video.generate': [{
      id: 'run-video',
      capabilityId: 'video.generate',
      prompt: 'animate',
      status: 'ready',
      message: 'completed',
      createdAt: '2026-08-11T00:00:00.000Z',
      result: {
        ok: true,
        kind: 'artifacts',
        summary: 'completed',
        jobId: 'job-video',
        jobState: 'completed',
        artifactCount: 2,
        artifacts: [
          { relativePath: 'media/video.asset', mediaType: 'video/mp4', sizeBytes: 10, sha256: `sha256:${'1'.repeat(64)}`, displayName: 'Video' },
          { relativePath: 'media/video-last-frame.asset', mediaType: 'image/png', sizeBytes: 5, sha256: `sha256:${'2'.repeat(64)}`, displayName: 'Last frame' },
        ],
      },
    }],
  };
  const partialImageHistory = [{
    id: 'run-video',
    runId: 'run-video',
    kind: 'runtime-media',
    capabilityId: 'video.generate',
    title: 'Video',
    status: 'ready',
    createdAt: '2026-08-11T00:00:00.000Z',
    relativePath: 'media/video.asset',
    sizeBytes: 10,
    sha256: `sha256:${'1'.repeat(64)}`,
  }];

  const projection = await reconcileLabManagedHistoryProjection(
    runHistory,
    partialImageHistory,
    async (relativePath) => relativePath.endsWith('last-frame.asset')
      ? { sizeBytes: 5, sha256: `sha256:${'2'.repeat(64)}` }
      : { sizeBytes: 10, sha256: `sha256:${'1'.repeat(64)}` },
  );

  assert.deepEqual(
    projection.imageHistory.map((record) => [record.id, record.relativePath, record.status]),
    [
      ['run-video', 'media/video.asset', 'ready'],
      ['run-video:1', 'media/video-last-frame.asset', 'ready'],
    ],
  );
});

test('managed history projection never reports Ready after managed bytes are missing', async () => {
  const runHistory = {
    'image.generate': [{
      id: 'run-image',
      capabilityId: 'image.generate',
      prompt: 'draw',
      status: 'ready',
      message: 'completed',
      createdAt: '2026-08-11T00:00:00.000Z',
      result: {
        ok: true,
        kind: 'artifacts',
        summary: 'completed',
        jobId: 'job-image',
        jobState: 'completed',
        artifactCount: 1,
        artifacts: [{ relativePath: 'media/missing.asset', sizeBytes: 10, sha256: `sha256:${'3'.repeat(64)}` }],
      },
    }],
  };

  const projection = await reconcileLabManagedHistoryProjection(
    runHistory,
    [],
    async () => { throw new Error('not found'); },
  );

  assert.equal(projection.runHistory['image.generate'][0].status, 'unavailable');
  assert.equal(projection.imageHistory[0].status, 'unavailable');

  const mismatch = await reconcileLabManagedHistoryProjection(
    runHistory,
    [],
    async () => ({ sizeBytes: 9, sha256: `sha256:${'3'.repeat(64)}` }),
  );
  assert.equal(mismatch.runHistory['image.generate'][0].status, 'unavailable');
  assert.equal(mismatch.imageHistory[0].status, 'unavailable');
  assert.match(mismatch.imageHistory[0].message, /verification failed/);
});

test('scoped record-plus-asset clear reports completed, skipped, and failed-shaped outcomes after reload', async () => {
  const state = managedHistoryPort();
  state.failingAssets.add('media/two.asset');
  const outcome = await clearLabManagedHistoryScope(state.port, 'image.generate', true);
  assert.deepEqual({ completed: outcome.completed, skipped: outcome.skipped, failed: outcome.failed }, { completed: 1, skipped: 1, failed: 0 });
  assert.equal(outcome.runHistory['image.generate'].some((record) => record.id === 'run-1'), false);
  assert.equal(outcome.runHistory['image.generate'].some((record) => record.id === 'run-2'), true);
  assert.equal(outcome.imageHistory.some((record) => record.runId === 'run-1'), false);
  assert.equal(outcome.imageHistory.some((record) => record.runId === 'run-2'), true);
});

test('retained media-only history deletes its row and managed asset through the shared policy', async () => {
  const state = managedHistoryPort({
    runHistory: {},
    imageHistory: [{
      id: 'orphan',
      runId: 'orphan',
      capabilityId: 'image.generate',
      relativePath: 'media/orphan.asset',
    }],
    assets: ['media/orphan.asset'],
  });
  const outcome = await deleteLabManagedHistoryRecord(state.port, 'orphan', true);
  assert.deepEqual({ completed: outcome.completed, skipped: outcome.skipped, failed: outcome.failed }, { completed: 1, skipped: 0, failed: 0 });
  assert.deepEqual(outcome.imageHistory, []);
  assert.deepEqual([...state.assets], []);
});

test('retained media-only clear preserves failed assets and reports them as skipped', async () => {
  const state = managedHistoryPort({
    runHistory: {},
    imageHistory: [
      { id: 'orphan-1', runId: 'orphan-1', capabilityId: 'image.generate', relativePath: 'media/orphan-1.asset' },
      { id: 'orphan-2', runId: 'orphan-2', capabilityId: 'image.generate', relativePath: 'media/orphan-2.asset' },
    ],
    assets: ['media/orphan-1.asset', 'media/orphan-2.asset'],
  });
  state.failingAssets.add('media/orphan-2.asset');
  const outcome = await clearLabManagedHistoryScope(state.port, 'image.generate', true);
  assert.deepEqual({ completed: outcome.completed, skipped: outcome.skipped, failed: outcome.failed }, { completed: 1, skipped: 1, failed: 0 });
  assert.deepEqual(outcome.imageHistory.map((record) => record.runId), ['orphan-2']);
  assert.deepEqual([...state.assets], ['media/orphan-2.asset']);
  assert.deepEqual(outcome.issues.map((issue) => [issue.runId, issue.step]), [['orphan-2', 'asset']]);
});
