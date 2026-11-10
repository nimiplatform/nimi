import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { cleanupBehaviorModules, importBehaviorModule } from './lab-contract/helpers.mjs';
test.after(cleanupBehaviorModules);

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
const sdkAppModuleUrl = import.meta.resolve('@nimiplatform/sdk/app');

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

const historyMessages=JSON.parse(readFileSync(path.join(root,'src/shell/i18n/locales/en/common.json'),'utf8'));
const i18nModuleUrl=`data:text/javascript;base64,${Buffer.from(`
 const messages=${JSON.stringify(historyMessages)};
 export function t(key,args={}) { const text=key.split('.').reduce((value,part)=>value?.[part],messages); if(typeof text!=='string')throw Error('Missing test translation '+key);return text.replace(/{{(\\w+)}}/g,(_,name)=>String(args[name])); }
`).toString('base64')}`;

const standardStorageModuleUrl = compileModule('src/lab/lab-standard-storage.ts', [
  ['../shell/local-app-runtime-platform.js', clientModuleUrl],
]);
const separationRequestModuleUrl = compileModule('src/ai-studio-core/audio-separation-request.ts', []);
const managedReferencesModuleUrl = compileModule('src/ai-studio-core/managed-result-references.ts', []);
const historyPolicyModuleUrl = compileModule('src/ai-studio-core/history-policy.ts', [
  ['@nimiplatform/sdk/types', jsonTypesModuleUrl],
  ['@nimiplatform/sdk/app', sdkAppModuleUrl],
  ['./audio-separation-request.js', separationRequestModuleUrl],
  ['./managed-result-references.js', managedReferencesModuleUrl],
]);
const historyStorageModuleUrl = compileModule('src/lab/lab-history-storage.ts', [
  ['../shell/i18n/index.js', i18nModuleUrl],
  ['../ai-studio-core/history-policy.js', historyPolicyModuleUrl],
  ['./lab-standard-storage.js', standardStorageModuleUrl],
  ['../shell/local-app-runtime-platform.js', clientModuleUrl],
  ['@nimiplatform/kit/core/app-record-storage', import.meta.resolve('@nimiplatform/kit/core/app-record-storage')],
]);
const imageHistoryModuleUrl = compileModule('src/lab/lab-image-history.ts', [
  ['@nimiplatform/sdk/types', jsonTypesModuleUrl],
  ['./lab-standard-storage.js', standardStorageModuleUrl],
  ['../shell/local-app-runtime-platform.js', clientModuleUrl],
  ['@nimiplatform/kit/core/app-record-storage', import.meta.resolve('@nimiplatform/kit/core/app-record-storage')],
  ['./lab-history-storage.js', historyStorageModuleUrl],
]);
const standardStorageModule = await import(standardStorageModuleUrl);
const historyPolicyModule = await import(historyPolicyModuleUrl);
const historyStorageModule = await import(historyStorageModuleUrl);
const imageHistoryModule = await import(imageHistoryModuleUrl);

function createStorageClient() {
  const documents = new Map(), records = new Map(), writes = [];
  return { documents, records, writes, client: { storage: {
    async readJson(path) { if (!documents.has(path)) throw { reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' }; return { value: structuredClone(documents.get(path)) }; },
    async writeJson(path, value) { const stored = JSON.parse(JSON.stringify(value)); documents.set(path, stored); return { value: stored }; },
    async removeJson(path) { return { removed: documents.delete(path) }; },
    assets: {
      async list({ prefix }) { return { assets: [...records.keys()].filter(path => path.startsWith(prefix)).sort().map(relativePath => ({ relativePath })), nextCursor: '' }; },
      async read({ relativePath }) {
        if (!records.has(relativePath)) throw { reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' };
        const bytes = new TextEncoder().encode(JSON.stringify(records.get(relativePath)));
        return {
          asset: {
            relativePath,
            mediaType: 'application/json',
            sizeBytes: bytes.byteLength,
            sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          },
          body: (async function* () { yield bytes; })(),
        };
      },
      async write({ relativePath, body }) { const value = JSON.parse(new TextDecoder().decode(body)); records.set(relativePath, value); writes.push({ relativePath, value }); return {}; },
      async remove(path) { return { removed: records.delete(path) }; },
    },
  } } };
}

test('native reply normal and stop-late facts save, reopen and serialize without unapproved source or draft previews',async()=>{
 const {createNativeReplyController}=await importBehaviorModule('lab/integrations/native-reply-controller.js');
 const source='PRIVATE_SOURCE_SENTINEL😀',draft='PRIVATE_DRAFT_SENTINEL😀';
 for(const late of [false,true])for(const saveBodies of [false,true]){
  const storage=createStorageClient();globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__=storage.client;
  let resolveInference,entered;const inference=new Promise(resolve=>{resolveInference=resolve});const started=new Promise(resolve=>{entered=resolve});let recorded=0,dispatches=0;
  const controller=createNativeReplyController({targetRef:'original-target',adapter:'qq-official',event:{eventId:'actual-source',replyRef:'actual-source-ref',segments:[{kind:'text',text:source}]},currentScope:()=>true,authStatus:async()=>({sessionBound:true}),
   prepareAI:async()=>({runId:'actual-run',createdAt:'2026-10-06T10:00:00Z'}),generate:()=>{entered();return inference},
   recordAI:async record=>{recorded++;await historyStorageModule.appendLabRunHistory(record)},
   integration:{invoke:()=>{dispatches++;assert.fail('inference is not send authorization')},getCall:()=>assert.fail(),cancelCall:()=>assert.fail()},recordIntegration:()=>assert.fail(),onState:()=>{}});
  try{
   const run=controller.generate(saveBodies);await started;if(late)controller.stop();
   resolveInference({ok:true,capabilityId:'chat.stream',capabilityLabel:'Chat Stream',message:'Actual inference completed.',output:{kind:'text',text:draft,finishReason:'stop',streamed:true,inputTokens:9,outputTokens:5,totalTokens:14},trace:{traceId:'actual-trace'}});await run;
   assert.equal(recorded,1);assert.equal(dispatches,0);assert.equal(controller.getState().draft,late?'':draft);
   if(late)assert.equal(controller.send(),null);
   const reopened=await historyStorageModule.loadLabRunHistory();const record=reopened['chat.stream'][0];
   assert.equal(record.id,'actual-run');assert.equal(record.status,'ready');assert.equal(record.result.traceId,'actual-trace');assert.equal(record.result.finishReason,'stop');assert.equal(record.result.charCount,draft.length);assert.equal(record.result.totalTokens,14);
   const saved=JSON.stringify([...storage.records.values()]);const exported=JSON.stringify(reopened);
   for(const text of [saved,exported]){assert.equal(text.includes('PRIVATE_SOURCE_SENTINEL'),saveBodies);assert.equal(text.includes('PRIVATE_DRAFT_SENTINEL'),saveBodies)}
   assert.deepEqual(historyPolicyModule.parseStudioRunHistory(JSON.parse(exported)),reopened);
   assert.equal(record.result.body,saveBodies?draft:'');assert.equal(record.result.summary,saveBodies?draft:'');
  }finally{await controller.dispose();delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__}
 }
});

test('retrieval history retains valid order and rejects invented or incomplete comparisons', () => {
  const record = runRecord('retrieval', '2026-11-06T00:00:00Z', {
    capabilityId: 'text.embed', runConfig: undefined,
    result: { ok: true, kind: 'embedding', summary: '2 vectors', vectorCount: 2, dimensions: 2, spaceId: 'space', sample: [1, 0],
      retrieval: { query: 'query', matches: [{ inputIndex: 1, excerpt: 'match', score: 1 }, { inputIndex: 0, excerpt: 'other', score: 0 }] } },
  });
  const good = JSON.parse(JSON.stringify({ 'text.embed': [record] }));
  assert.deepEqual(historyPolicyModule.parseStudioRunHistory(good), good);
  for (const mutate of [
    result => { result.spaceId = ''; },
    result => { result.retrieval.matches.reverse(); },
    result => { result.retrieval.matches.pop(); },
    result => { result.retrieval.matches[0].score = 2; },
    result => { result.retrieval.matches[0].inputIndex = 0; },
  ]) {
    const bad = structuredClone(good);
    mutate(bad['text.embed'][0].result);
    assert.throws(() => historyPolicyModule.parseStudioRunHistory(bad));
  }
});

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

test('large Locate results keep their complete saved result across document boundaries', () => {
  const result = {
    imageArtifactId:'image-1', width:1200, height:800,
    locations:Array.from({length:1000},()=>({type:'point',x:0.123,y:0.456,label:'a'.repeat(230)})),
  };
  const record = runRecord('large-locate', '2026-09-09T00:00:00.000Z', {
    capabilityId:'vision.locate',
    result:{ok:true,kind:'vision-locate',summary:'1000 matches',jobId:'job-large',result},
  });
  const before = runRecord('previous', '2026-09-08T00:00:00.000Z');
  const history = historyPolicyModule.appendStudioRunHistoryRecord({'text.generate':[before]},record);
  assert.equal(history['text.generate'][0].id, 'previous');
  assert.deepEqual(history['vision.locate'][0].result,record.result);
  assert.equal(record.result.result.locations.length,1000);
  assert.ok(Buffer.byteLength(JSON.stringify(history)) > 240 * 1024);
  assert.deepEqual(historyPolicyModule.parseStudioRunHistory(JSON.parse(JSON.stringify(history))),JSON.parse(JSON.stringify(history)));
});

test('shared history saves beyond the old byte, per-capability and total bounds without eviction', () => {
  let history = {};
  for (let index = 0; index < 180; index += 1) {
    history = historyPolicyModule.appendStudioRunHistoryRecord(history, runRecord(`run-${index}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      { capabilityId: index % 2 ? 'text.generate' : 'text.annotate' }));
  }
  assert.equal(historyPolicyModule.flattenStudioHistoryRecords(history).length,180);
  assert.equal(history['text.generate'].length,90);
  const oversized=runRecord('oversized','2026-02-01T00:00:00.000Z');
  history=historyPolicyModule.appendStudioRunHistoryRecord(history,{...oversized,result:{...oversized.result,body:'x'.repeat(300*1024)}});
  assert.equal(historyPolicyModule.flattenStudioHistoryRecords(history).length,181);
  assert.equal(history['text.generate'][0].result.body.length,300*1024);
});

test('a long input and context are saved in full without evicting other capabilities', () => {
  let history = {};
  for (let index = 0; index < 30; index += 1) {
    history = historyPolicyModule.appendStudioRunHistoryRecord(history, runRecord(
      `other-${index}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      { capabilityId: `capability.${index % 6}` },
    ));
  }
  const limit = (16 * 1024);
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
  const next = historyPolicyModule.appendStudioRunHistoryRecord(history, record);
  assert.equal(historyPolicyModule.flattenStudioHistoryRecords(next).length, 31);
  const stored = next['text.annotate'][0];
  assert.equal(stored.inputTruncated, undefined);
  assert.equal(stored.prompt, prompt);
  assert.equal(stored.runConfig.promptControls.context, context);
  assert.equal(record.prompt, prompt);
  assert.equal(record.inputTruncated, undefined);
  const roundTrip = JSON.parse(JSON.stringify(next));
  assert.deepEqual(historyPolicyModule.parseStudioRunHistory(roundTrip), roundTrip);

  const short = historyPolicyModule.appendStudioRunHistoryRecord({}, runRecord('short', '2026-02-02T00:00:00.000Z'));
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

test('speech word timing survives history reload and rejects invalid stored spans', () => {
  const base = runRecord('run-stt-words', '2026-09-29T10:24:00.000Z');
  const record = {
    ...base,
    capabilityId: 'audio.transcribe',
    result: {
      ok: true, kind: 'transcript', summary: 'hello audio', body: 'hello audio', charCount: 11,
      jobId: 'job-stt-words', jobState: 'COMPLETED', artifactCount: 1,
      transcription: { status: 'transcribed', text: 'hello audio', language: 'en', words: [
        { text: 'hello', startSeconds: 0.1, endSeconds: 0.6 },
        { text: 'audio', startSeconds: 0.7, endSeconds: 1.2 },
      ] },
    },
    runConfig: { ...base.runConfig, target: { ...base.runConfig.target, capabilityId: 'audio.transcribe', capabilityContract: 'audio.transcribe', section: 'voice' } },
  };
  const stored = { 'audio.transcribe': [record] };
  assert.deepEqual(historyPolicyModule.parseStudioRunHistory(structuredClone(stored)), stored);
  const corrupt = structuredClone(stored);
  corrupt['audio.transcribe'][0].result.transcription.words[1].endSeconds = 0.5;
  assert.throws(() => historyPolicyModule.parseStudioRunHistory(corrupt), /result\.transcription/u);
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
    const base = runRecord('run-1', '2026-08-08T08:00:00.000Z');
    const record = { ...base, runConfig: {
      ...base.runConfig,
      target: { ...base.runConfig.target, targetRef: 'test-model', configuredDefaults: { temperature: 0, topP: 0.8 } },
    } };
    await historyStorageModule.appendLabRunHistory(record);
    await historyStorageModule.appendLabRunHistory({ ...record, message: 'updated-message' });

    const stored = await historyStorageModule.loadLabRunHistory();
    assertNoUndefined(stored);
    assert.equal(stored['text.generate'].length, 1);
    assert.equal(stored['text.generate'][0].message, 'updated-message');
    assert.equal(Object.hasOwn(stored['text.generate'][0].result, 'traceId'), false);
    assert.equal(Object.hasOwn(stored['text.generate'][0].runConfig.promptControls, 'tone'), false);

    const reloaded = await historyStorageModule.loadLabRunHistory();
    assert.equal(reloaded['text.generate'].length, 1);
    assert.equal(reloaded['text.generate'][0].id, 'run-1');
    assert.equal(reloaded['text.generate'][0].runConfig.target.targetRef, 'test-model');
    assert.deepEqual(reloaded['text.generate'][0].runConfig.target.configuredDefaults, { temperature: 0, topP: 0.8 });
    assert.deepEqual(reloaded['text.generate'][0].runConfig.target.params, { temperature: 0.7 });
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

test('concurrent run-history appends retain both independent records', async () => {
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
  const storage = createStorageClient();
  storage.records.set('studio/history/run/invalid.json', { id: 'invalid', capabilityId: 'text.generate' });
  globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await assert.rejects(
      historyStorageModule.loadLabRunHistory(),
      /history|record/u,
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

test('image-history append, remove, and clear affect only selected record documents', async () => {
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
    'text.tools': [runRecord('json-object', '2026-11-04T00:00:00.000Z', {
      capabilityId: 'text.tools', result: {
        ok: true, kind: 'text-exchange', summary: 'JSON object', scenario: 'json-object', text: '{"answer":43}', structured: { answer: 43 },
        steps: [{ origin: 'model', finishReason: 'stop', items: [{ type: 'text', text: '{"answer":43}' }] }],
      },
    }), runRecord('tools', '2026-09-01T00:00:03.000Z', {
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
      result: { ok: true, kind: 'session', summary: 'terminated', capabilityContract: 'realtime.interact', startedAt: '2026-09-01T00:00:00.000Z', endedAt: '2026-09-01T00:00:05.000Z', ending: 'terminated', terminalReason: 'AI_PROVIDER_UNAVAILABLE', audioUsage: { audioSeconds: 4.8, final: false }, closure:{localResourcesReleased:true,providerSessionClosed:false}, observed: { 'text-input': 1, opened: 1 } },
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
  assert.equal(parsed['text.tools'][0].result.scenario, 'json-object');
  assert.deepEqual(parsed['text.tools'][0].result.structured, { answer: 43 });
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
  reject((copy) => { copy['text.tools'].find((entry) => entry.id === 'tools').result.steps[0].items[1].type = 'shell-command'; }, /unsupported value/u);
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

test('a large decision preserves its full spec and all candidate probabilities', () => {
  const limit = (16 * 1024);
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
  const next = historyPolicyModule.appendStudioRunHistoryRecord({ 'text.generate': [earlier] }, record);
  const stored = next['text.decide'][0];
  assert.equal(stored.inputTruncated, undefined);
  assert.equal(stored.prompt, spec);
  assert.deepEqual(stored.result.answers, answers);
  assert.equal(stored.result.questionCount,64);
  assert.equal(record.result.answers.length, 64);
  assert.equal(next['text.generate'][0].id, 'earlier');
  const roundTrip = JSON.parse(JSON.stringify(next));
  assert.deepEqual(historyPolicyModule.parseStudioRunHistory(roundTrip), roundTrip);

  const small = historyPolicyModule.appendStudioRunHistoryRecord({}, { ...record, prompt: '{}', result: { ...record.result, questionCount: 1, answers: answers.slice(0, 1) } });
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

test('saving annotations never evicts records or cleans their documents', async () => {
  const storage = createStorageClient();
  const removed = [];
  storage.client.storage.assets = {
    ...storage.client.storage.assets,
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
      );
    }
    assert.equal(removed.some(path=>path.startsWith('studio/text-annotate/')), false);
    const stored=await historyStorageModule.loadLabRunHistory();
    assert.equal(stored['text.annotate'].length,42);
    assert.equal(stored['image.generate'].length,1);
    assert.equal(removed.includes('media/image-generate/kept.asset'),false);
  } finally {
    delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__;
  }
});

test('independent history documents preserve large records without a shared root', async () => {
  const storage = createStorageClient(); globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    for (let i = 0; i < 90; i++) await historyStorageModule.appendLabRunHistory(runRecord('run-' + i, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
    const large = runRecord('large', '2026-02-01T00:00:00Z', { prompt: '中文😀'.repeat(80000) });
    await historyStorageModule.appendLabRunHistory(large);
    const read = await historyStorageModule.loadLabRunHistory();
    assert.equal(Object.values(read).flat().length, 91);
    assert.equal(read['text.generate'][0].prompt, large.prompt);
    assert.equal(storage.documents.size, 0);
    assert.equal(storage.records.size, 91);
  } finally { delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__; }
});

test('two independent history modules retain both successful appends', async () => {
  const second = await import(historyStorageModuleUrl + '#second-client');
  const storage = createStorageClient(); globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await Promise.all([historyStorageModule.appendLabRunHistory(runRecord('A', '2026-01-01T00:00:00Z')),
      second.appendLabRunHistory(runRecord('B', '2026-02-01T00:00:00Z'))]);
    assert.deepEqual((await second.loadLabRunHistory())['text.generate'].map(record => record.id), ['B', 'A']);
  } finally { delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__; }
});

test('a clear cannot delete another client before its independent record publishes', async () => {
  const storage = createStorageClient(); globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    const write = storage.client.storage.assets.write;
    let publish;
    storage.client.storage.assets.write = async input => { await new Promise(resolve => { publish = resolve; }); return write(input); };
    const pending = historyStorageModule.appendLabRunHistory(runRecord('A', '2026-01-01T00:00:00Z'));
    while (!publish) await new Promise(resolve => setImmediate(resolve));
    await historyStorageModule.clearLabRunHistory();
    publish(); await pending;
    assert.equal((await historyStorageModule.loadLabRunHistory())['text.generate'][0].id, 'A');
  } finally { delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__; }
});

test('publication errors keep prior records and never authorize artifact cleanup', async () => {
  const storage = createStorageClient(); globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__ = storage.client;
  try {
    await historyStorageModule.appendLabRunHistory(runRecord('old', '2026-01-01T00:00:00Z'));
    const write = storage.client.storage.assets.write;
    storage.client.storage.assets.write = async () => { throw new Error('write failed'); };
    await assert.rejects(historyStorageModule.appendLabRunHistory(runRecord('new', '2026-02-01T00:00:00Z')), error => error.historyPublicationUncertain === true);
    assert.equal(storage.records.size, 1);
    storage.client.storage.assets.write = async input => { await write(input); throw new Error('response lost'); };
    await assert.rejects(historyStorageModule.appendLabRunHistory(runRecord('new', '2026-02-01T00:00:00Z')), error => error.historyPublicationUncertain === true);
    assert.deepEqual((await historyStorageModule.loadLabRunHistory())['text.generate'].map(record => record.id), ['new', 'old']);
  } finally { delete globalThis.__NIMI_LAB_HISTORY_STORAGE_CLIENT__; }
});

test('explicit deletion and scoped clear protect artifacts another retained record references',async()=>{
 const artifact={relativePath:'media/shared.wav',mediaType:'audio/wav',sizeBytes:9,sha256:'sha256:'+'b'.repeat(64),previewSource:'managed-asset'};
 const record=(id,cap)=>runRecord(id,'2026-01-01T00:00:00.000Z',{capabilityId:cap,result:{ok:true,kind:'artifacts',summary:'ready',artifactCount:1,artifacts:[artifact]}});
 let history={'audio.synthesize':[record('a','audio.synthesize')],'audio.transcribe':[record('b','audio.transcribe')]};const removed=[];
 const port={deleteAssets:true,removeArtifact:async p=>{removed.push(p)},commit:async next=>{history=next},project:async()=>history};
 await historyPolicyModule.removeStudioHistoryWithPolicy({history,recordId:'a',...port});assert.deepEqual(removed,[]);assert.equal(history['audio.transcribe'][0].id,'b');
 history={'audio.synthesize':[record('a','audio.synthesize')],'audio.transcribe':[record('b','audio.transcribe')]};
 await historyPolicyModule.clearStudioHistoryWithPolicy({history,capabilityId:'audio.synthesize',...port});assert.deepEqual(removed,[]);assert.equal(history['audio.transcribe'][0].id,'b');
 await historyPolicyModule.clearStudioHistoryWithPolicy({history,capabilityId:null,...port});assert.deepEqual(removed,['media/shared.wav']);assert.deepEqual(history,{});
});
