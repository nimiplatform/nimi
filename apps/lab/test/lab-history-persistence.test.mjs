import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const clientModuleUrl = `data:text/javascript;base64,${Buffer.from(`
  export function getLabLocalAppClient() {
    return globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
`).toString('base64')}`;
const jsonTypesModuleUrl = `data:text/javascript;base64,${Buffer.from(`
  export function isJsonObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
`).toString('base64')}`;

function compileModule(relativePath, replacements) {
  const source = readFileSync(path.join(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const rewritten = replacements.reduce(
    (current, [specifier, replacement]) => current.replace(
      new RegExp(`from\\s+['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g'),
      `from ${JSON.stringify(replacement)}`,
    ),
    output,
  );
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`;
}

const standardStorageModuleUrl = compileModule('src/lab/lab-standard-storage.ts', [
  ['../shell/local-app-runtime-platform.js', clientModuleUrl],
]);
const historyStorageModuleUrl = compileModule('src/lab/lab-history-storage.ts', [
  ['@nimiplatform/sdk/types', jsonTypesModuleUrl],
  ['./lab-standard-storage.js', standardStorageModuleUrl],
]);
const imageHistoryModuleUrl = compileModule('src/lab/lab-image-history.ts', [
  ['@nimiplatform/sdk/types', jsonTypesModuleUrl],
  ['./lab-standard-storage.js', standardStorageModuleUrl],
]);
const standardStorageModule = await import(standardStorageModuleUrl);
const historyStorageModule = await import(historyStorageModuleUrl);
const imageHistoryModule = await import(imageHistoryModuleUrl);

function createStorageClient(seed = {}) {
  const documents = new Map(Object.entries(seed));
  const writes = [];
  return {
    documents,
    writes,
    client: {
      storage: {
        async readJson(relativePath) {
          if (!documents.has(relativePath)) throw { code: 'not-found', reasonCode: 'not-found' };
          const value = structuredClone(documents.get(relativePath));
          return { value, sizeBytes: Buffer.byteLength(JSON.stringify(value)) };
        },
        async writeJson(relativePath, value) {
          const body = JSON.stringify(value);
          const stored = JSON.parse(body);
          documents.set(relativePath, stored);
          writes.push({ relativePath, value: stored });
          return { value: stored, sizeBytes: Buffer.byteLength(body) };
        },
      },
    },
  };
}

function runRecord(id, createdAt, overrides = {}) {
  return {
    id,
    capabilityId: 'text.generate',
    prompt: `prompt-${id}`,
    status: 'ready',
    message: `message-${id}`,
    createdAt,
    result: {
      ok: true,
      kind: 'text',
      summary: `summary-${id}`,
      body: `body-${id}`,
      charCount: 6,
      finishReason: 'stop',
      streamed: false,
      inputTokens: undefined,
      outputTokens: undefined,
      traceId: undefined,
    },
    runConfig: {
      target: {
        capabilityId: 'text.generate',
        capabilityContract: 'text.generate',
        section: 'text',
        status: 'configured',
        source: 'local',
        intentLabel: 'Local',
        detail: 'Configured local intent.',
        params: { temperature: 0.7, optional: undefined },
        paramsSummary: [],
        profileOrigin: null,
      },
      promptControls: {
        tone: undefined,
        contextAttached: false,
        context: undefined,
        attachmentCount: 0,
      },
      traceId: undefined,
    },
    ...overrides,
  };
}

function assertNoUndefined(value, path = '$') {
  assert.notEqual(value, undefined, `${path} must not be undefined`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoUndefined(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => assertNoUndefined(entry, `${path}.${key}`));
  }
}

test('standard storage normalizes optional object fields without weakening JSON validation', () => {
  const normalized = standardStorageModule.normalizeLabStandardStorageJsonValue({
    kept: true,
    omitted: undefined,
    nested: { value: 'ready', traceId: undefined },
  });
  assert.deepEqual(normalized, { kept: true, nested: { value: 'ready' } });
  assert.throws(
    () => standardStorageModule.normalizeLabStandardStorageJsonValue([undefined]),
    /contains undefined in an array/u,
  );
  assert.throws(
    () => standardStorageModule.normalizeLabStandardStorageJsonValue({ value: Number.POSITIVE_INFINITY }),
    /non-finite number/u,
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => standardStorageModule.normalizeLabStandardStorageJsonValue(cyclic),
    /contains a cycle/u,
  );
});

test('run history persists optional snapshots, reloads them, and retries idempotently', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    const record = runRecord('run-1', '2026-08-08T08:00:00.000Z');
    await historyStorageModule.appendLabRunHistory(record);
    await historyStorageModule.appendLabRunHistory({ ...record, message: 'updated-message' });

    const stored = storage.documents.get('lab-run-history.json');
    assertNoUndefined(stored);
    assert.equal(stored['text.generate'].length, 1);
    assert.equal(stored['text.generate'][0].message, 'updated-message');
    assert.equal(Object.hasOwn(stored['text.generate'][0].result, 'traceId'), false);
    assert.equal(Object.hasOwn(stored['text.generate'][0].runConfig.promptControls, 'tone'), false);

    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.equal(reloaded['text.generate'].length, 1);
    assert.equal(reloaded['text.generate'][0].id, 'run-1');
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('run history preserves a canceled Runtime outcome without reclassifying it as failed', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendLabRunHistory(runRecord('run-canceled', '2026-08-08T08:01:00.000Z', {
      capabilityId: 'video.generate',
      status: 'canceled',
      message: 'acceptance cancellation',
      result: {
        ok: false,
        kind: 'non-success',
        summary: 'acceptance cancellation',
        reason: 'runtime-canceled',
        message: 'acceptance cancellation',
        actionHint: 'Run the request again when you are ready.',
      },
    }));

    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.equal(reloaded['video.generate'][0].status, 'canceled');
    assert.equal(reloaded['video.generate'][0].result.reason, 'runtime-canceled');
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('run history preserves caller-local operation abort without fabricating Runtime cancellation', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendLabRunHistory(runRecord('run-operation-aborted', '2026-08-08T08:01:30.000Z', {
      capabilityId: 'video.generate',
      status: 'canceled',
      message: 'caller stopped waiting',
      result: {
        ok: false,
        kind: 'non-success',
        summary: 'caller stopped waiting',
        reason: 'operation-aborted',
        message: 'caller stopped waiting',
        actionHint: 'Inspect the ScenarioJob before inferring a terminal state.',
      },
    }));

    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.equal(reloaded['video.generate'][0].status, 'canceled');
    assert.equal(reloaded['video.generate'][0].result.reason, 'operation-aborted');
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('run history preserves a timed-out Runtime outcome without reclassifying it as failed', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendLabRunHistory(runRecord('run-timeout', '2026-08-08T08:02:00.000Z', {
      capabilityId: 'video.generate',
      status: 'timed-out',
      message: 'provider request timed out',
      result: {
        ok: false,
        kind: 'non-success',
        summary: 'provider request timed out',
        reason: 'runtime-timeout',
        message: 'provider request timed out',
        actionHint: 'Inspect the typed Runtime reason before retrying.',
        diagnostics: {
          reasonCode: 'AI_PROVIDER_TIMEOUT',
          actionHint: 'retry_provider_request',
          traceId: 'trace-timeout',
          retryable: true,
          source: 'runtime',
        },
      },
    }));

    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.equal(reloaded['video.generate'][0].status, 'timed-out');
    assert.equal(reloaded['video.generate'][0].result.reason, 'runtime-timeout');
    assert.deepEqual(reloaded['video.generate'][0].result.diagnostics, {
      reasonCode: 'AI_PROVIDER_TIMEOUT',
      actionHint: 'retry_provider_request',
      traceId: 'trace-timeout',
      retryable: true,
      source: 'runtime',
    });
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('run history preserves every managed artifact from a multi-output video job', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  const artifacts = [
    {
      relativePath: 'media/video-generate/video.asset',
      mediaType: 'video/mp4',
      sizeBytes: 4096,
      sha256: `sha256:${'a'.repeat(64)}`,
      displayName: 'Video Generate',
      previewSource: 'managed-asset',
    },
    {
      relativePath: 'media/video-generate/last-frame.asset',
      mediaType: 'image/png',
      sizeBytes: 2048,
      sha256: `sha256:${'b'.repeat(64)}`,
      displayName: 'Video Generate 2',
      previewSource: 'managed-asset',
    },
  ];
  try {
    await historyStorageModule.appendLabRunHistory(runRecord('run-video', '2026-08-08T08:02:00.000Z', {
      capabilityId: 'video.generate',
      result: {
        ok: true,
        kind: 'artifacts',
        summary: 'COMPLETED / 2 artifacts / video/mp4',
        jobId: 'job-video',
        jobState: 'COMPLETED',
        artifactCount: 2,
        artifacts,
        firstArtifact: artifacts[0],
      },
    }));

    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.deepEqual(reloaded['video.generate'][0].result.artifacts, artifacts);
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('concurrent run-history appends are serialized and retain both records', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await Promise.all([
      historyStorageModule.appendLabRunHistory(runRecord('run-1', '2026-08-08T08:00:00.000Z')),
      historyStorageModule.appendLabRunHistory(runRecord('run-2', '2026-08-08T08:01:00.000Z')),
    ]);
    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.deepEqual(reloaded['text.generate'].map((record) => record.id), ['run-2', 'run-1']);
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('run-history loading fails closed on a malformed capability list', async () => {
  const storage = createStorageClient({
    'lab-run-history.json': { 'text.generate': {} },
  });
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await assert.rejects(
      historyStorageModule.loadLabRunHistory(),
      /requires an array/u,
    );
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('removeLabRunHistoryRecord deletes only the targeted record', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendLabRunHistory(runRecord('run-1', '2026-08-08T08:00:00.000Z'));
    await historyStorageModule.appendLabRunHistory(runRecord('run-2', '2026-08-08T08:01:00.000Z'));
    await historyStorageModule.appendLabRunHistory(runRecord('run-3', '2026-08-08T08:02:00.000Z', { capabilityId: 'image.generate' }));

    const next = await historyStorageModule.removeLabRunHistoryRecord('run-1');
    assert.deepEqual(next['text.generate'].map((record) => record.id), ['run-2']);
    assert.deepEqual(next['image.generate'].map((record) => record.id), ['run-3']);

    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.deepEqual(reloaded['text.generate'].map((record) => record.id), ['run-2']);
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('clearLabRunHistory clears one capability or the whole store', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendLabRunHistory(runRecord('run-1', '2026-08-08T08:00:00.000Z'));
    await historyStorageModule.appendLabRunHistory(runRecord('run-2', '2026-08-08T08:01:00.000Z', { capabilityId: 'image.generate' }));

    const afterScopedClear = await historyStorageModule.clearLabRunHistory('text.generate');
    assert.equal(Object.hasOwn(afterScopedClear, 'text.generate'), false);
    assert.deepEqual(afterScopedClear['image.generate'].map((record) => record.id), ['run-2']);

    const afterFullClear = await historyStorageModule.clearLabRunHistory();
    assert.deepEqual(afterFullClear, {});
    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.deepEqual(reloaded, {});
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('image-history append, remove, and clear share the serialized JSON mutation queue', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  const record = (id, capabilityId, relativePath) => ({
    id,
    runId: id,
    kind: 'runtime-media',
    capabilityId,
    title: id,
    status: 'ready',
    createdAt: '2026-08-09T00:00:00.000Z',
    relativePath,
    mediaType: 'image/png',
    sizeBytes: 8,
    sha256: `sha256:${'a'.repeat(64)}`,
  });
  try {
    await Promise.all([
      imageHistoryModule.appendLabImageHistoryRecord(record('run-1', 'image.generate', 'media/one.asset')),
      imageHistoryModule.appendLabImageHistoryRecord(record('run-2', 'video.generate', 'media/two.asset')),
    ]);
    let loaded = await imageHistoryModule.loadLabImageHistory();
    assert.deepEqual(new Set(loaded.map((entry) => entry.id)), new Set(['run-1', 'run-2']));

    loaded = await imageHistoryModule.removeLabImageHistoryRecord('run-1');
    assert.deepEqual(loaded.map((entry) => entry.id), ['run-2']);

    loaded = await imageHistoryModule.clearLabImageHistory('image.generate');
    assert.deepEqual(loaded.map((entry) => entry.id), ['run-2']);
    loaded = await imageHistoryModule.clearLabImageHistory();
    assert.deepEqual(loaded, []);
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});
