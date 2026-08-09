import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const clientModuleUrl = `data:text/javascript;base64,${Buffer.from(`
  export function getTesterLocalAppClient() {
    return globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__;
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

const standardStorageModuleUrl = compileModule('src/tester/tester-standard-storage.ts', [
  ['../shell/local-app-runtime-platform.js', clientModuleUrl],
]);
const historyStorageModuleUrl = compileModule('src/tester/tester-history-storage.ts', [
  ['@nimiplatform/sdk/types', jsonTypesModuleUrl],
  ['./tester-standard-storage.js', standardStorageModuleUrl],
]);
const imageHistoryModuleUrl = compileModule('src/tester/tester-image-history.ts', [
  ['@nimiplatform/sdk/types', jsonTypesModuleUrl],
  ['./tester-standard-storage.js', standardStorageModuleUrl],
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
  const normalized = standardStorageModule.normalizeTesterStandardStorageJsonValue({
    kept: true,
    omitted: undefined,
    nested: { value: 'ready', traceId: undefined },
  });
  assert.deepEqual(normalized, { kept: true, nested: { value: 'ready' } });
  assert.throws(
    () => standardStorageModule.normalizeTesterStandardStorageJsonValue([undefined]),
    /contains undefined in an array/u,
  );
  assert.throws(
    () => standardStorageModule.normalizeTesterStandardStorageJsonValue({ value: Number.POSITIVE_INFINITY }),
    /non-finite number/u,
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => standardStorageModule.normalizeTesterStandardStorageJsonValue(cyclic),
    /contains a cycle/u,
  );
});

test('run history persists optional snapshots, reloads them, and retries idempotently', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    const record = runRecord('run-1', '2026-08-08T08:00:00.000Z');
    await historyStorageModule.appendTesterRunHistory(record);
    await historyStorageModule.appendTesterRunHistory({ ...record, message: 'updated-message' });

    const stored = storage.documents.get('tester-run-history.json');
    assertNoUndefined(stored);
    assert.equal(stored['text.generate'].length, 1);
    assert.equal(stored['text.generate'][0].message, 'updated-message');
    assert.equal(Object.hasOwn(stored['text.generate'][0].result, 'traceId'), false);
    assert.equal(Object.hasOwn(stored['text.generate'][0].runConfig.promptControls, 'tone'), false);

    const reloaded = await historyStorageModule.loadTesterRunHistory();
    assert.equal(reloaded['text.generate'].length, 1);
    assert.equal(reloaded['text.generate'][0].id, 'run-1');
  } finally {
    delete globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__;
  }
});

test('concurrent run-history appends are serialized and retain both records', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await Promise.all([
      historyStorageModule.appendTesterRunHistory(runRecord('run-1', '2026-08-08T08:00:00.000Z')),
      historyStorageModule.appendTesterRunHistory(runRecord('run-2', '2026-08-08T08:01:00.000Z')),
    ]);
    const reloaded = await historyStorageModule.loadTesterRunHistory();
    assert.deepEqual(reloaded['text.generate'].map((record) => record.id), ['run-2', 'run-1']);
  } finally {
    delete globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__;
  }
});

test('run-history loading fails closed on a malformed capability list', async () => {
  const storage = createStorageClient({
    'tester-run-history.json': { 'text.generate': {} },
  });
  globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await assert.rejects(
      historyStorageModule.loadTesterRunHistory(),
      /requires an array/u,
    );
  } finally {
    delete globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__;
  }
});

test('removeTesterRunHistoryRecord deletes only the targeted record', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendTesterRunHistory(runRecord('run-1', '2026-08-08T08:00:00.000Z'));
    await historyStorageModule.appendTesterRunHistory(runRecord('run-2', '2026-08-08T08:01:00.000Z'));
    await historyStorageModule.appendTesterRunHistory(runRecord('run-3', '2026-08-08T08:02:00.000Z', { capabilityId: 'image.generate' }));

    const next = await historyStorageModule.removeTesterRunHistoryRecord('run-1');
    assert.deepEqual(next['text.generate'].map((record) => record.id), ['run-2']);
    assert.deepEqual(next['image.generate'].map((record) => record.id), ['run-3']);

    const reloaded = await historyStorageModule.loadTesterRunHistory();
    assert.deepEqual(reloaded['text.generate'].map((record) => record.id), ['run-2']);
  } finally {
    delete globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__;
  }
});

test('clearTesterRunHistory clears one capability or the whole store', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendTesterRunHistory(runRecord('run-1', '2026-08-08T08:00:00.000Z'));
    await historyStorageModule.appendTesterRunHistory(runRecord('run-2', '2026-08-08T08:01:00.000Z', { capabilityId: 'image.generate' }));

    const afterScopedClear = await historyStorageModule.clearTesterRunHistory('text.generate');
    assert.equal(Object.hasOwn(afterScopedClear, 'text.generate'), false);
    assert.deepEqual(afterScopedClear['image.generate'].map((record) => record.id), ['run-2']);

    const afterFullClear = await historyStorageModule.clearTesterRunHistory();
    assert.deepEqual(afterFullClear, {});
    const reloaded = await historyStorageModule.loadTesterRunHistory();
    assert.deepEqual(reloaded, {});
  } finally {
    delete globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__;
  }
});

test('image-history append, remove, and clear share the serialized JSON mutation queue', async () => {
  const storage = createStorageClient();
  globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__ = storage.client;
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
      imageHistoryModule.appendTesterImageHistoryRecord(record('run-1', 'image.generate', 'media/one.asset')),
      imageHistoryModule.appendTesterImageHistoryRecord(record('run-2', 'video.generate', 'media/two.asset')),
    ]);
    let loaded = await imageHistoryModule.loadTesterImageHistory();
    assert.deepEqual(new Set(loaded.map((entry) => entry.id)), new Set(['run-1', 'run-2']));

    loaded = await imageHistoryModule.removeTesterImageHistoryRecord('run-1');
    assert.deepEqual(loaded.map((entry) => entry.id), ['run-2']);

    loaded = await imageHistoryModule.clearTesterImageHistory('image.generate');
    assert.deepEqual(loaded.map((entry) => entry.id), ['run-2']);
    loaded = await imageHistoryModule.clearTesterImageHistory();
    assert.deepEqual(loaded, []);
  } finally {
    delete globalThis.__NIMI_TESTER_HISTORY_STORAGE_CLIENT__;
  }
});
