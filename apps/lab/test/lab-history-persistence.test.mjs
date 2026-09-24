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
const historyPolicyModuleUrl = compileModule('src/ai-studio-core/history-policy.ts', [
  ['@nimiplatform/sdk/types', jsonTypesModuleUrl],
]);
const historyStorageModuleUrl = compileModule('src/lab/lab-history-storage.ts', [
  ['../ai-studio-core/history-policy.js', historyPolicyModuleUrl],
  ['./lab-standard-storage.js', standardStorageModuleUrl],
]);
const imageHistoryModuleUrl = compileModule('src/lab/lab-image-history.ts', [
  ['@nimiplatform/sdk/types', jsonTypesModuleUrl],
  ['./lab-standard-storage.js', standardStorageModuleUrl],
]);
const standardStorageModule = await import(standardStorageModuleUrl);
const historyPolicyModule = await import(historyPolicyModuleUrl);
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

test('large Locate results retain a history reference without rejecting or truncating the current result', () => {
  const result = {
    imageArtifactId:'image-1', width:1200, height:800,
    locations:Array.from({length:1000},()=>({type:'point',x:0.123,y:0.456,label:'a'.repeat(230)})),
  };
  const record = runRecord('large-locate', '2026-09-09T00:00:00.000Z', {
    capabilityId:'vision.locate',
    result:{ok:true,kind:'vision-locate',summary:'1000 matches',jobId:'job-large',result},
  });
  const before = runRecord('previous', '2026-09-08T00:00:00.000Z');
  const history = historyPolicyModule.boundStudioRunHistoryWithRecord({'text.generate':[before]},record);
  assert.equal(history['text.generate'][0].id, 'previous');
  assert.deepEqual(history['vision.locate'][0].result,{ok:true,kind:'vision-locate',summary:'1000 matches',jobId:'job-large'});
  assert.equal(record.result.result.locations.length,1000);
  assert.ok(Buffer.byteLength(JSON.stringify(history)) <= historyPolicyModule.STUDIO_HISTORY_LIMIT_BYTES);
  assert.deepEqual(historyPolicyModule.parseStudioRunHistory(JSON.parse(JSON.stringify(history))),JSON.parse(JSON.stringify(history)));
});

test('shared history policy enforces global count and byte bounds', () => {
  let history = {};
  for (let index = 0; index < 161; index += 1) {
    history = historyPolicyModule.boundStudioRunHistoryWithRecord(history, runRecord(
      `run-${index}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      { capabilityId: `capability.${index}` },
    ));
  }
  const records = historyPolicyModule.flattenStudioHistoryRecords(history);
  assert.equal(records.length, 160);
  assert.equal(records.some((record) => record.id === 'run-160'), true);
  assert.equal(records.some((record) => record.id === 'run-0'), false);

  const oversized = runRecord('oversized', '2026-01-01T00:00:00.000Z');
  assert.throws(
    () => historyPolicyModule.boundStudioRunHistoryWithRecord({}, {
      ...oversized,
      result: { ...oversized.result, body: 'x'.repeat(241 * 1024) },
    }),
    /exceeds the storage document limit/,
  );
});

test('a long input keeps a bounded history preview instead of evicting other capabilities', () => {
  let history = {};
  for (let index = 0; index < 30; index += 1) {
    history = historyPolicyModule.boundStudioRunHistoryWithRecord(history, runRecord(
      `other-${index}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      { capabilityId: `capability.${index % 6}` },
    ));
  }
  const limit = historyPolicyModule.STUDIO_HISTORY_INPUT_LIMIT_BYTES;
  const base = runRecord('long-input', '2026-02-01T00:00:00.000Z');
  // The four-byte character straddles the limit, so the preview stops before it.
  const prompt = `${'a'.repeat(limit - 2)}🍰${'b'.repeat(200 * 1024)}`;
  const context = 'c'.repeat(limit + 1);
  const record = {
    ...base,
    capabilityId: 'text.annotate',
    prompt,
    runConfig: { ...base.runConfig, promptControls: { ...base.runConfig.promptControls, contextAttached: true, context } },
  };
  const next = historyPolicyModule.boundStudioRunHistoryWithRecord(history, record);
  assert.equal(historyPolicyModule.flattenStudioHistoryRecords(next).length, 31);
  const stored = next['text.annotate'][0];
  assert.equal(stored.inputTruncated, true);
  assert.equal(stored.prompt, 'a'.repeat(limit - 2));
  assert.equal(stored.runConfig.promptControls.context, 'c'.repeat(limit));
  assert.equal(record.prompt, prompt);
  assert.equal(record.inputTruncated, undefined);
  const roundTrip = JSON.parse(JSON.stringify(next));
  assert.deepEqual(historyPolicyModule.parseStudioRunHistory(roundTrip), roundTrip);

  const short = historyPolicyModule.boundStudioRunHistoryWithRecord({}, runRecord('short', '2026-02-02T00:00:00.000Z'));
  assert.equal(short['text.generate'][0].inputTruncated, undefined);
  assert.throws(
    () => historyPolicyModule.parseStudioRunHistory({ 'text.generate': [{ ...runRecord('flag', '2026-02-03T00:00:00.000Z'), inputTruncated: false }] }),
    /inputTruncated/,
  );
  assert.throws(
    () => historyPolicyModule.parseStudioRunHistory({ 'text.generate': [{ ...runRecord('preview', '2026-02-03T00:00:00.000Z', { prompt: 'x'.repeat(limit + 1) }), inputTruncated: true }] }),
    /prompt/,
  );
});

test('shared clear outcome tone never presents skipped or failed work as success', () => {
  assert.equal(historyPolicyModule.studioHistoryClearOutcomeTone({ skipped: 0, failed: 0 }), 'success');
  assert.equal(historyPolicyModule.studioHistoryClearOutcomeTone({ skipped: 1, failed: 0 }), 'warning');
  assert.equal(historyPolicyModule.studioHistoryClearOutcomeTone({ skipped: 0, failed: 1 }), 'danger');
});

test('shared history codec rejects malformed nested result and run config', () => {
  const base = runRecord('run-malformed', '2026-01-01T00:00:00.000Z');
  assert.throws(
    () => historyPolicyModule.parseStudioRunHistory({
      'text.generate': [{ ...base, result: { ...base.result, charCount: 'invalid' } }],
    }),
    /charCount/,
  );
  assert.throws(
    () => historyPolicyModule.parseStudioRunHistory({
      'text.generate': [{ ...base, runConfig: { ...base.runConfig, promptControls: { contextAttached: true, attachmentCount: 'invalid' } } }],
    }),
    /attachmentCount/,
  );
  assert.throws(
    () => historyPolicyModule.parseStudioRunHistory({
      'text.generate': [{
        ...base,
        result: {
          ok: false,
          kind: 'non-success',
          summary: 'failed',
          reason: 'runtime-call-failed',
          message: 'failed',
          actionHint: 'retry',
          diagnostics: { reasonCode: 'lowercase-is-not-canonical', retryable: 'yes' },
        },
      }],
    }),
    /diagnostics\.reasonCode/,
  );
});

test('shared history grouping does not inherit object prototype capability entries', () => {
  const record = runRecord('run-constructor', '2026-01-01T00:00:00.000Z', { capabilityId: 'constructor' });
  const history = historyPolicyModule.studioHistoryFromRecords([record]);
  assert.equal(Object.hasOwn(history, 'constructor'), true);
  assert.deepEqual(history.constructor, [record]);
});

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

function annotationRun(id, createdAt, documentPath) {
  return runRecord(id, createdAt, {
    capabilityId: 'text.annotate',
    runConfig: undefined,
    result: {
      ok: true, kind: 'text-annotation', summary: 'en / 1 document', jobId: `job-${id}`, jobState: 'completed',
      language: 'en', documentCount: 1, tokenCount: 7, sentenceCount: 1,
      document: { relativePath: documentPath, mediaType: 'application/json', sizeBytes: 64, sha256: `sha256:${'a'.repeat(64)}`, previewSource: 'managed-asset' },
    },
  });
}

test('shared history codec accepts the new typed snapshots and keeps older embedding records readable', () => {
  const history = {
    'text.embed': [
      runRecord('embed-legacy', '2026-09-01T00:00:00.000Z', { capabilityId: 'text.embed', result: { ok: true, kind: 'embedding', summary: '1 vector', vectorCount: 1, dimensions: 3, sample: [0.1] } }),
      runRecord('embed-space', '2026-09-01T00:00:01.000Z', { capabilityId: 'text.embed', result: { ok: true, kind: 'embedding', summary: '1 vector', vectorCount: 1, dimensions: 3, spaceId: 'space-a', sample: [0.1] } }),
    ],
    'text.annotate': [annotationRun('annotate', '2026-09-01T00:00:02.000Z', 'studio/text-annotate/a.json')],
    'text.tools': [runRecord('tools', '2026-09-01T00:00:03.000Z', {
      capabilityId: 'text.tools',
      result: {
        ok: true, kind: 'text-exchange', summary: 'done', scenario: 'tool-call', text: 'done',
        steps: [
          { origin: 'model', finishReason: 'tool-calls', items: [
            { type: 'reasoning-continuity', carrierKind: 'opaque', version: 1, payloadBytes: 3 },
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'lab_convert_centimeters', arguments: { centimeters: 30 } },
          ] },
          { origin: 'app', items: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'lab_convert_centimeters', result: { inches: 11.811 }, isError: false }] },
          { origin: 'model', finishReason: 'stop', items: [{ type: 'text', text: 'done' }] },
        ],
      },
    })],
    'image.face_swap': [runRecord('face', '2026-09-01T00:00:04.000Z', {
      capabilityId: 'image.face_swap',
      result: {
        ok: true, kind: 'artifacts', summary: 'completed', jobId: 'job-face', jobState: 'completed', artifactCount: 1,
        artifacts: [{ relativePath: 'media/image-face_swap/x.png', mediaType: 'image/png', sizeBytes: 9, sha256: `sha256:${'b'.repeat(64)}`, previewSource: 'managed-asset' }],
        faceSwap: { inputs: [
          { role: 'reference-image', name: 'ref.png', mediaType: 'image/png', sizeBytes: 3, sha256: `sha256:${'c'.repeat(64)}` },
          { role: 'target-image', name: 'target.jpg', mediaType: 'image/jpeg', sizeBytes: 4, sha256: `sha256:${'d'.repeat(64)}` },
        ] },
      },
    })],
    'realtime.interact': [runRecord('session', '2026-09-01T00:00:05.000Z', {
      capabilityId: 'realtime.interact',
      status: 'failed',
      result: { ok: true, kind: 'session', summary: 'terminated', capabilityContract: 'realtime.interact', startedAt: '2026-09-01T00:00:00.000Z', endedAt: '2026-09-01T00:00:05.000Z', ending: 'terminated', terminalReason: 'AI_PROVIDER_UNAVAILABLE', observed: { 'text-input': 1, opened: 1 } },
    })],
    'video.face_swap': [runRecord('video-canceled', '2026-09-01T00:00:06.000Z', {
      capabilityId: 'video.face_swap',
      status: 'canceled',
      result: { ok: false, kind: 'non-success', summary: 'canceled', reason: 'runtime-canceled', message: 'canceled', actionHint: 'retry', jobId: 'job-video-1' },
    })],
    'text.decide': [
      runRecord('decide', '2026-09-01T00:00:07.000Z', {
        capabilityId: 'text.decide',
        prompt: '{"type":"text-decide"}',
        result: {
          ok: true, kind: 'text-decision', summary: 'relevant: true 0.88 / intent: learn 0.50', questionCount: 2, traceId: 'trace-decide',
          answers: [
            { questionId: 'relevant', kind: 'boolean', trueProbability: 0.875 },
            { questionId: 'intent', kind: 'choice', selectedCandidateId: 'learn', probabilities: [{ candidateId: 'buy', probability: 0.2 }, { candidateId: 'learn', probability: 0.5 }, { candidateId: 'compare', probability: 0.3 }] },
          ],
        },
      }),
      runRecord('decide-summary', '2026-09-01T00:00:08.000Z', {
        capabilityId: 'text.decide',
        result: { ok: true, kind: 'text-decision', summary: 'kept as a summary', questionCount: 64 },
      }),
      runRecord('decide-limit', '2026-09-01T00:00:09.000Z', {
        capabilityId: 'text.decide',
        status: 'unavailable',
        result: { ok: false, kind: 'non-success', summary: 'too long', reason: 'input-invalid', message: 'too long', actionHint: 'shorten', diagnostics: { reasonCode: 'AI_INPUT_LIMIT_EXCEEDED', source: 'runtime' } },
      }),
    ],
  };
  const parsed = historyPolicyModule.parseStudioRunHistory(JSON.parse(JSON.stringify(history)));
  assert.equal(parsed['text.embed'][0].result.spaceId, undefined);
  assert.equal(parsed['text.embed'][1].result.spaceId, 'space-a');
  assert.equal(parsed['video.face_swap'][0].result.jobId, 'job-video-1');
  assert.deepEqual(historyPolicyModule.studioHistoryArtifactPaths(parsed['text.annotate'][0]), ['studio/text-annotate/a.json']);
  assert.deepEqual(historyPolicyModule.studioHistoryDocumentPaths(parsed['image.face_swap'][0]), []);

  const reject = (mutate, pattern) => {
    const copy = JSON.parse(JSON.stringify(history));
    mutate(copy);
    assert.throws(() => historyPolicyModule.parseStudioRunHistory(copy), pattern);
  };
  reject((copy) => { copy['text.annotate'][0].result.document.mediaType = 'text/plain'; }, /saved JSON document/u);
  reject((copy) => { copy['image.face_swap'][0].result.faceSwap.inputs[1].role = 'reference-image'; }, /duplicate role/u);
  reject((copy) => { copy['image.face_swap'][0].result.faceSwap.noFacePolicy = 'fail'; }, /video target/u);
  reject((copy) => { copy['text.tools'][0].result.steps[0].items[1].type = 'shell-command'; }, /unsupported value/u);
  reject((copy) => { copy['realtime.interact'][0].result.observed.Bad = 1; }, /invalid counter/u);
  reject((copy) => { copy['text.embed'][1].result.spaceId = ''; }, /spaceId/u);
  assert.equal(parsed['text.decide'][0].result.answers[1].selectedCandidateId, 'learn');
  assert.equal(parsed['text.decide'][1].result.answers, undefined);
  reject((copy) => { copy['text.decide'][0].result.questionCount = 3; }, /one answer per question/u);
  reject((copy) => { delete copy['text.decide'][1].result.questionCount; }, /questionCount/u);
  reject((copy) => { copy['text.decide'][0].result.answers[1].questionId = 'relevant'; }, /repeated/u);
  reject((copy) => { copy['text.decide'][0].result.answers[0].trueProbability = 1.2; }, /probability from 0 to 1/u);
  reject((copy) => { copy['text.decide'][0].result.answers[1].probabilities[2].probability = Number.NaN; }, /probability from 0 to 1/u);
  reject((copy) => { copy['text.decide'][0].result.answers[1].selectedCandidateId = 'unknown'; }, /not one of its candidates/u);
  reject((copy) => { copy['text.decide'][0].result.answers[1].probabilities.splice(1); }, /2 to 255 candidates/u);
  reject((copy) => { copy['text.decide'][0].result.answers[0].kind = 'score'; }, /unsupported value/u);
});

test('a decision record keeps its spec as a bounded input and its answers only while they fit', () => {
  const limit = historyPolicyModule.STUDIO_HISTORY_INPUT_LIMIT_BYTES;
  const candidates = Array.from({ length: 255 }, (_, index) => `candidate-${String(index).padStart(3, '0')}-${'x'.repeat(48)}`);
  const answers = Array.from({ length: 64 }, (_, index) => ({
    questionId: `question-${index}`,
    kind: 'choice',
    selectedCandidateId: candidates[0],
    probabilities: candidates.map((candidateId, position) => ({ candidateId, probability: position === 0 ? 0.746 : 0.001 })),
  }));
  const spec = JSON.stringify({ type: 'text-decide', state: { text: 'z'.repeat(limit) }, questions: [] }, null, 2);
  const record = runRecord('decide-large', '2026-09-02T00:00:00.000Z', {
    capabilityId: 'text.decide',
    prompt: spec,
    result: { ok: true, kind: 'text-decision', summary: 'question-0: candidate-000 0.75', questionCount: 64, answers },
  });
  const earlier = runRecord('earlier', '2026-09-01T00:00:00.000Z');
  const next = historyPolicyModule.boundStudioRunHistoryWithRecord({ 'text.generate': [earlier] }, record);
  const stored = next['text.decide'][0];
  // The spec is a prompt like any other: a longer one keeps a marked preview.
  assert.equal(stored.inputTruncated, true);
  assert.equal(Buffer.byteLength(stored.prompt), limit);
  // Every candidate keeps its probability, so these answers outgrow the whole
  // budget; the stored copy keeps the summary and count, the run keeps them all.
  assert.equal(stored.result.answers, undefined);
  assert.equal(stored.result.questionCount, 64);
  assert.equal(stored.result.summary, 'question-0: candidate-000 0.75');
  assert.equal(record.result.answers.length, 64);
  assert.equal(next['text.generate'][0].id, 'earlier');
  const roundTrip = JSON.parse(JSON.stringify(next));
  assert.deepEqual(historyPolicyModule.parseStudioRunHistory(roundTrip), roundTrip);

  const small = historyPolicyModule.boundStudioRunHistoryWithRecord({}, { ...record, prompt: '{}', result: { ...record.result, questionCount: 1, answers: answers.slice(0, 1) } });
  assert.equal(small['text.decide'][0].result.answers.length, 1);
  assert.equal(small['text.decide'][0].inputTruncated, undefined);
});

test('a video face swap history summary must keep consistent frame counts', () => {
  const record = runRecord('video-face', '2026-09-01T00:00:00.000Z', {
    capabilityId: 'video.face_swap',
    result: {
      ok: true, kind: 'artifacts', summary: 'completed', jobId: 'job-v', jobState: 'completed', artifactCount: 1,
      artifacts: [{ relativePath: 'media/video-face_swap/x.mp4', mediaType: 'video/mp4', sizeBytes: 9, sha256: `sha256:${'b'.repeat(64)}`, previewSource: 'managed-asset' }],
      faceSwap: {
        inputs: [
          { role: 'reference-image', name: 'ref.png', mediaType: 'image/png', sizeBytes: 3, sha256: `sha256:${'c'.repeat(64)}` },
          { role: 'target-video', name: 'clip.mp4', mediaType: 'video/mp4', sizeBytes: 4, sha256: `sha256:${'d'.repeat(64)}` },
        ],
        noFacePolicy: 'preserve-frame',
        video: { totalFrames: 90, transformedFrames: 80, preservedFrames: 10, durationUs: 3_000_000, frameRate: 30, audioPreserved: true },
      },
    },
  });
  historyPolicyModule.parseStudioRunHistory({ 'video.face_swap': [record] });
  const inconsistent = structuredClone(record);
  inconsistent.result.faceSwap.video.preservedFrames = 9;
  assert.throws(() => historyPolicyModule.parseStudioRunHistory({ 'video.face_swap': [inconsistent] }), /inconsistent video facts/u);
});

test('automatic history bounding releases only annotation documents no retained record references', async () => {
  const storage = createStorageClient();
  const removed = [];
  const failures = [];
  storage.client.storage.assets = {
    async remove(relativePath) {
      removed.push(relativePath);
      if (relativePath.endsWith('locked.json')) throw new Error('document locked');
      return { removed: true };
    },
  };
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendLabRunHistory(annotationRun('oldest', '2026-01-01T00:00:00.000Z', 'studio/text-annotate/oldest.json'));
    await historyStorageModule.appendLabRunHistory(annotationRun('locked', '2026-01-01T00:00:01.000Z', 'studio/text-annotate/locked.json'));
    await historyStorageModule.appendLabRunHistory(runRecord('media', '2026-01-01T00:00:02.000Z', {
      capabilityId: 'image.generate',
      result: {
        ok: true, kind: 'artifacts', summary: 'ready', jobId: 'job-media', jobState: 'completed', artifactCount: 1,
        artifacts: [{ relativePath: 'media/image-generate/kept.asset', mediaType: 'image/png', sizeBytes: 9, sha256: `sha256:${'b'.repeat(64)}`, previewSource: 'managed-asset' }],
      },
    }));
    for (let index = 0; index < 40; index += 1) {
      await historyStorageModule.appendLabRunHistory(
        annotationRun(`fresh-${index}`, new Date(Date.UTC(2026, 1, 1, 0, 0, index)).toISOString(), `studio/text-annotate/fresh-${index}.json`),
        (items) => failures.push(...items),
      );
    }
    // Forty newer annotations evict the two older annotation records only.
    assert.deepEqual(removed.sort(), ['studio/text-annotate/locked.json', 'studio/text-annotate/oldest.json']);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /locked\.json: document locked/u);
    const stored = await historyStorageModule.loadLabRunHistory();
    assert.equal(stored['text.annotate'].length, 40);
    assert.equal(stored['image.generate'].length, 1, 'media runs stay; annotation eviction never touches their assets');
    assert.equal(removed.includes('media/image-generate/kept.asset'), false);
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});
