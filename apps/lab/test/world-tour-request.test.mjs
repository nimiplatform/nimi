import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {build} from 'esbuild';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/lab/world-tour/world-tour-runtime.ts', import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {parsePendingWorld,isDefiniteWorldAdmissionRejection,clearRejectedWorldPending,WORLD_TOUR_RECOVERY_PREFIX}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const config={target:{capabilityId:'world.generate',capabilityContract:'world.generate',section:'world',source:'cloud',status:'configured',detail:'exact committed target',intentLabel:'Cloud',params:{inputMode:'text'},paramsSummary:[],profileOrigin:null},promptControls:{context:'original context',contextAttached:true,attachmentCount:0}};
const saved={version:2,id:'sub-known',state:'acknowledged',clientSubmissionId:'sub-known',jobId:'known-job',request:{prompt:'original prompt',generationPrompt:'original prompt with original context',createdAt:'2026-10-06T01:00:00.000Z',runConfig:config,inputMode:'text'}};

function createCasAssetStore(initial = new Map()) {
  const store = new Map();
  const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  for (const [relativePath, value] of initial.entries()) {
    const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
    store.set(relativePath, { asset: { relativePath, mediaType: 'application/json', sizeBytes: bytes.byteLength, sha256: digest(bytes) }, bytes });
  }
  const removed = [];
  return {
    store,
    removed,
    assets: {
      async list({ prefix = '' } = {}) {
        return {
          assets: [...store.values()].filter((item) => item.asset.relativePath.startsWith(prefix)).map((item) => structuredClone(item.asset)),
          nextCursor: '',
        };
      },
      async read({ relativePath }) {
        const entry = store.get(relativePath);
        if (!entry) throw Object.assign(new Error('not found'), { code: 'not-found', reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' });
        return {
          asset: structuredClone(entry.asset),
          range: { offset: 0, length: entry.bytes.byteLength, totalSize: entry.bytes.byteLength },
          body: (async function* () { yield new Uint8Array(entry.bytes); })(),
        };
      },
      async stat(relativePath) {
        const entry = store.get(relativePath);
        if (!entry) throw Object.assign(new Error('not found'), { code: 'not-found', reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' });
        return structuredClone(entry.asset);
      },
      async write({ relativePath, body, mediaType, overwrite, expectedSha256 }) {
        const bytes = body instanceof Uint8Array ? new Uint8Array(body) : new TextEncoder().encode(String(body));
        const existing = store.get(relativePath);
        if (expectedSha256 !== undefined) {
          if (existing?.asset.sha256 !== expectedSha256) {
            throw Object.assign(new Error('cas conflict'), { reasonCode: 'APP_STORAGE_CONFLICT' });
          }
        } else if (overwrite === false && existing) {
          throw Object.assign(new Error('already exists'), { reasonCode: 'APP_STORAGE_CONFLICT' });
        }
        const asset = { relativePath, mediaType, sizeBytes: bytes.byteLength, sha256: digest(bytes) };
        store.set(relativePath, { asset, bytes });
        return structuredClone(asset);
      },
      async remove(relativePath) {
        removed.push(relativePath);
        return { removed: store.delete(relativePath) };
      },
    },
  };
}

test('World recovery preserves original request and time; no current draft or config is supplied',()=>{const value=parsePendingWorld(structuredClone(saved));assert.deepEqual(value,saved)});
test('World rejects missing or malformed original snapshots and marks a lost receipt without guessing a Job',()=>{
  for(const value of [{jobId:'known-job'},{...saved,request:{...saved.request,runConfig:undefined}},{...saved,request:{...saved.request,createdAt:'invalid'}},{...saved,request:{...saved.request,inputMode:'auto'}},{...saved,state:'pending'},{...saved,jobId:undefined}]) {
    assert.throws(()=>parsePendingWorld(value));
  }
  const unknown={...structuredClone(saved),state:'pending'};
  delete unknown.jobId;
  assert.equal(parsePendingWorld(unknown).jobId,undefined);
});

test('World definite admission rejection uses typed Runtime and SDK reason shapes, not message or retry flags', async()=>{
 for(const reasonCode of ['AI_LOCAL_ASSET_SLOT_MISSING','ai-config-invalid','ai-media-option-unsupported','AI_MEDIA_SPEC_INVALID','SDK_LOCAL_APP_INPUT_INVALID','artifact-forbidden']) {
  const pending={version:2,id:'action-1',state:'pending',clientSubmissionId:'action-1',request:structuredClone(saved.request)};
  const path=`${WORLD_TOUR_RECOVERY_PREFIX}/action-1.json`;
  const mem=createCasAssetStore(new Map([[path,pending]]));
  assert.equal(isDefiniteWorldAdmissionRejection({reasonCode}),true);
  const outcome=await clearRejectedWorldPending(mem.assets,pending,{reasonCode});
  assert.equal(outcome.removed,true);
  assert.equal(mem.removed.length,1);
  assert.equal(mem.store.has(path),false);
 }
 for(const cause of [{reasonCode:'PROTOCOL_ENVELOPE_INVALID'},{reasonCode:'AI_PROVIDER_UNAVAILABLE',retryable:false},{reasonCode:'runtime-grpc-deadline-exceeded'},
   {reasonCode:'unknown-error',message:'ai-config-invalid',retryable:false},{message:'AI_INPUT_INVALID'}]) {
  const pending={version:2,id:'action-2',state:'pending',clientSubmissionId:'action-2',request:structuredClone(saved.request)};
  const path=`${WORLD_TOUR_RECOVERY_PREFIX}/action-2.json`;
  const mem=createCasAssetStore(new Map([[path,pending]]));
  const outcome=await clearRejectedWorldPending(mem.assets,pending,cause);
  assert.equal(outcome.removed,false);
  assert.equal(mem.removed.length,0);
  assert.equal(mem.store.has(path),true);
 }
});
test('World late rejection cannot clear a different request or an already known Job', async()=>{
 for(const stored of [
   {version:2,id:'action-1',state:'acknowledged',clientSubmissionId:'action-1',jobId:'known-job',request:saved.request},
   {version:2,id:'action-1',state:'pending',clientSubmissionId:'action-1',request:{...saved.request,prompt:'later request'}},
 ]) {
  const path=`${WORLD_TOUR_RECOVERY_PREFIX}/action-1.json`;
  const mem=createCasAssetStore(new Map([[path,stored]]));
  const outcome=await clearRejectedWorldPending(mem.assets,{version:2,id:'action-1',state:'pending',clientSubmissionId:'action-1',request:saved.request},{reasonCode:'ai-media-option-unsupported'});
  assert.equal(outcome.removed,false);
  assert.equal(mem.removed.length,0);
  assert.equal(mem.store.has(path),true);
 }
});


test('World late rejection cannot clear a new action even when its original request is identical', async () => {
  const previous = { version: 2, id: 'action-a', state: 'pending', clientSubmissionId: 'action-a', request: saved.request };
  const current = { version: 2, id: 'action-b', state: 'pending', clientSubmissionId: 'action-b', request: saved.request };
  const pathB = `${WORLD_TOUR_RECOVERY_PREFIX}/action-b.json`;
  const mem = createCasAssetStore(new Map([[pathB, current]]));
  const outcome = await clearRejectedWorldPending(mem.assets, previous, { reasonCode: 'AI_INPUT_INVALID' });
  assert.equal(outcome.removed, false);
  assert.equal(mem.store.has(pathB), true);
});

// Execute the real World pending/finish owner against isolated public ports.
// No App, Runtime, model, registration or actual user storage is accessed.
const ownerBuild = await build({ entryPoints: [fileURLToPath(new URL('../src/lab/world-tour/world-tour-runtime.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  plugins: [{ name: 'world-owner-fixture', setup(api) {
    for (const [filter, contents] of [
      [/shell\/local-app-runtime-platform\.js$/, 'export const getLabLocalAppClient = () => globalThis.__worldOwnerFixture.client;'],
      [/lab-history-storage\.js$/, 'export const loadLabRunHistory = () => globalThis.__worldOwnerFixture.loadHistory(); export const appendLabRunHistory = record => globalThis.__worldOwnerFixture.appendHistory(record);'],
      [/world-tour-shared\.js$/, 'export const DEFAULT_MANIFEST_PATH = "world-tour/latest.json"; export const WORLD_BUNDLE_MIME = "application/vnd.nimi.world+zip"; export const openWorldTourWindow = input => globalThis.__worldOwnerFixture.openWindow(input);'],
    ]) {
      api.onResolve({ filter }, () => ({ path: String(filter), namespace: 'world-test' }));
      api.onLoad({ filter: /.*/, namespace: 'world-test' }, args => args.path === String(filter) ? { contents, loader: 'js' } : undefined);
    }
  } }],
});
const worldOwner = await import(`data:text/javascript;base64,${Buffer.from(ownerBuild.outputFiles[0].text).toString('base64')}`);

test('shared history treats an absent remote World recovery record as empty without hiding access failures', async () => {
  const missing = Object.assign(new Error('storage entry absent'), { reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' });
  assert.deepEqual(await worldOwner.worldTourRecoveryReferences({ list: async () => { throw missing; } }), []);
  const denied = Object.assign(new Error('access denied'), { reasonCode: 'APP_SCOPE_FORBIDDEN' });
  await assert.rejects(() => worldOwner.worldTourRecoveryReferences({ list: async () => { throw denied; } }), error => error === denied);
});

test('World run and Resume cannot finalize A twice; a later B keeps its own unresolved record', async () => {
  const documents = new Map(); let submits = 0, gets = 0, histories = 0;
  const enteredHistory = Promise.withResolvers(), history = Promise.withResolvers();
  const archivePath = 'world-tour/world-a/world.zip';
  const archiveBytes = Uint8Array.of(1, 2, 3);
  const archiveSha = `sha256:${createHash('sha256').update(archiveBytes).digest('hex')}`;
  const mem = createCasAssetStore();
  mem.store.set(archivePath, {
    asset: { relativePath: archivePath, mediaType: 'application/vnd.nimi.world+zip', sizeBytes: 3, sha256: archiveSha },
    bytes: archiveBytes,
  });
  const job = { jobId: 'world-a', scenarioType: 'world-generate', status: 'completed', traceId: 'world-a-trace',
    reasonCode: '', reasonDetail: '', progressPercent: 100, progressCurrentStep: 1, progressTotalSteps: 1,
    createdAt: null, updatedAt: null, transcriptionText: '', artifacts: [{ artifactId: 'archive-a', mimeType: 'application/vnd.nimi.world+zip', sizeBytes: 3, sha256: archiveSha.replace(/^sha256:/u, ''), bytes: [] }] };
  const client = { storage: {
    readJson: async path => { if (!documents.has(path)) throw { code: 'not-found' }; return { value: structuredClone(documents.get(path)) }; },
    writeJson: async (path, value) => { documents.set(path, structuredClone(value)); },
    removeJson: async path => { documents.delete(path); },
    assets: mem.assets,
  },
    ai: { scenarioJobs: {
      submit: async () => { if (++submits > 1) throw new Error('B Submit response lost'); return { job }; },
      get: async () => { gets++; return { job, asset: null, voiceReference: null }; },
    }, artifacts: {} },
  };
  const pendingRecords = () => [...mem.store.entries()]
    .filter(([key]) => key.startsWith(`${WORLD_TOUR_RECOVERY_PREFIX}/`))
    .map(([, entry]) => JSON.parse(new TextDecoder().decode(entry.bytes)));
  globalThis.__worldOwnerFixture = { client, loadHistory: async () => ({}),
    appendHistory: async () => { histories++; enteredHistory.resolve(); await history.promise; }, openWindow: async () => ({}) };
  try {
    const input = { capabilityId: 'world.generate', prompt: 'A', recordedRunConfig: config };
    const a = worldOwner.runWorldTour(input); await enteredHistory.promise;
    const [pendingA] = pendingRecords(); const currentGets = gets;
    await assert.rejects(() => worldOwner.resumeWorldTour(new AbortController().signal, () => {}));
    await assert.rejects(() => worldOwner.runWorldTour({ ...input, prompt: 'B' }));
    assert.equal(submits, 1); assert.equal(gets, currentGets); assert.equal(histories, 1);
    history.resolve(); assert.equal((await a).ok, true); assert.equal(pendingRecords().length, 0);
    await assert.rejects(() => worldOwner.runWorldTour({ ...input, prompt: 'B' }), /B Submit response lost/);
    const [pendingB] = pendingRecords();
    assert.notEqual(pendingB.clientSubmissionId, pendingA.clientSubmissionId); assert.equal(pendingB.request.prompt, 'B');
    await worldOwner.clearRejectedWorldPending(client.storage.assets, pendingA, { reasonCode: 'AI_INPUT_INVALID' });
    assert.deepEqual(pendingRecords(), [pendingB]); assert.equal(histories, 1);
  } finally { delete globalThis.__worldOwnerFixture; }
});
