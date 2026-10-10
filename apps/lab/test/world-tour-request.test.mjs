import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const compiled=await build({entryPoints:[new URL('../src/lab/world-tour/world-tour-runtime.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {parsePendingWorld,isDefiniteWorldAdmissionRejection,clearRejectedWorldPending}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const config={target:{capabilityId:'world.generate',capabilityContract:'world.generate',section:'world',source:'cloud',status:'configured',detail:'exact committed target',intentLabel:'Cloud',params:{inputMode:'text'},paramsSummary:[],profileOrigin:null},promptControls:{context:'original context',contextAttached:true,attachmentCount:0}};
const saved={version:1,jobId:'known-job',request:{prompt:'original prompt',generationPrompt:'original prompt with original context',createdAt:'2026-10-06T01:00:00.000Z',runConfig:config,inputMode:'text'}};
test('World recovery preserves original request and time; no current draft or config is supplied',()=>{const value=parsePendingWorld(structuredClone(saved));assert.deepEqual(value,saved)});
test('World rejects missing or malformed original snapshots and marks a lost receipt without guessing a Job',()=>{for(const value of [{jobId:'known-job'},{...saved,request:{...saved.request,runConfig:undefined}},{...saved,request:{...saved.request,createdAt:'invalid'}},{...saved,request:{...saved.request,inputMode:'auto'}}])assert.throws(()=>parsePendingWorld(value));const unknown=structuredClone(saved);delete unknown.jobId;assert.equal(parsePendingWorld(unknown).jobId,undefined)});

test('World definite admission rejection uses typed Runtime and SDK reason shapes, not message or retry flags', async()=>{
 for(const reasonCode of ['ai-config-invalid','ai-media-option-unsupported','AI_MEDIA_SPEC_INVALID','SDK_LOCAL_APP_INPUT_INVALID','artifact-forbidden']) {
  let pending={version:1,request:structuredClone(saved.request)};let removed=0;
  const storage={async readJson(){return {value:pending}},async removeJson(){removed++;pending=undefined}};
  assert.equal(isDefiniteWorldAdmissionRejection({reasonCode}),true);
  await clearRejectedWorldPending(storage,{version:1,request:saved.request},{reasonCode});assert.equal(removed,1);
 }
 for(const cause of [{reasonCode:'AI_PROVIDER_UNAVAILABLE',retryable:false},{reasonCode:'runtime-grpc-deadline-exceeded'},
   {reasonCode:'unknown-error',message:'ai-config-invalid',retryable:false},{message:'AI_INPUT_INVALID'}]) {
  let removed=0;await clearRejectedWorldPending({async readJson(){return{value:{version:1,request:saved.request}}},async removeJson(){removed++}},{version:1,request:saved.request},cause);assert.equal(removed,0);
 }
});
test('World late rejection cannot clear a different request or an already known Job', async()=>{
 for(const pending of [{version:1,jobId:'known-job',request:saved.request},{version:1,request:{...saved.request,prompt:'later request'}}]) {
  let removed=0;await clearRejectedWorldPending({async readJson(){return{value:pending}},async removeJson(){removed++}},{version:1,request:saved.request},{reasonCode:'ai-media-option-unsupported'});assert.equal(removed,0);
 }
});


test('World late rejection cannot clear a new action even when its original request is identical', async () => {
  const previous = { version: 1, clientSubmissionId: 'action-a', request: saved.request };
  const current = { ...previous, clientSubmissionId: 'action-b' }; let removed = 0;
  await clearRejectedWorldPending({ readJson: async () => ({ value: current }), removeJson: async () => { removed++; } }, previous, { reasonCode: 'AI_INPUT_INVALID' });
  assert.equal(removed, 0);
});

// Execute the real World pending/finish owner against isolated public ports.
// No App, Runtime, model, registration or actual user storage is accessed.
const ownerBuild = await build({ entryPoints: [new URL('../src/lab/world-tour/world-tour-runtime.ts', import.meta.url).pathname],
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

test('World run and Resume cannot finalize A twice; a later B keeps its own unresolved record', async () => {
  const documents = new Map(); let submits = 0, gets = 0, histories = 0;
  const enteredHistory = Promise.withResolvers(), history = Promise.withResolvers();
  const asset = { relativePath: 'world-tour/world-a/world.zip', mediaType: 'application/vnd.nimi.world+zip', sizeBytes: 3, sha256: 'sha256:' + 'a'.repeat(64) };
  const job = { jobId: 'world-a', scenarioType: 'world-generate', status: 'completed', traceId: 'world-a-trace',
    reasonCode: '', reasonDetail: '', progressPercent: 100, progressCurrentStep: 1, progressTotalSteps: 1,
    createdAt: null, updatedAt: null, transcriptionText: '', artifacts: [{ artifactId: 'archive-a', mimeType: asset.mediaType, sizeBytes: 3, sha256: 'a'.repeat(64), bytes: [] }] };
  const client = { storage: {
    readJson: async path => { if (!documents.has(path)) throw { code: 'not-found' }; return { value: structuredClone(documents.get(path)) }; },
    writeJson: async (path, value) => { documents.set(path, structuredClone(value)); },
    removeJson: async path => { documents.delete(path); },
    assets: { stat: async () => asset, read: async () => ({ asset, range: { offset: 0, length: 3, totalSize: 3 }, body: (async function* () { yield Uint8Array.of(1, 2, 3); })() }) },
  },
    ai: { scenarioJobs: {
      submit: async () => { if (++submits > 1) throw new Error('B Submit response lost'); return { job }; },
      get: async () => { gets++; return { job, asset: null, voiceReference: null }; },
    }, artifacts: {} },
  };
  globalThis.__worldOwnerFixture = { client, loadHistory: async () => ({}),
    appendHistory: async () => { histories++; enteredHistory.resolve(); await history.promise; }, openWindow: async () => ({}) };
  try {
    const input = { capabilityId: 'world.generate', prompt: 'A', recordedRunConfig: config };
    const a = worldOwner.runWorldTour(input); await enteredHistory.promise;
    const pendingA = structuredClone(documents.get('world-tour/pending.json')); const currentGets = gets;
    await assert.rejects(() => worldOwner.resumeWorldTour(new AbortController().signal, () => {}));
    await assert.rejects(() => worldOwner.runWorldTour({ ...input, prompt: 'B' }));
    assert.equal(submits, 1); assert.equal(gets, currentGets); assert.equal(histories, 1);
    history.resolve(); assert.equal((await a).ok, true); assert.equal(documents.has('world-tour/pending.json'), false);
    await assert.rejects(() => worldOwner.runWorldTour({ ...input, prompt: 'B' }), /B Submit response lost/);
    const pendingB = structuredClone(documents.get('world-tour/pending.json'));
    assert.notEqual(pendingB.clientSubmissionId, pendingA.clientSubmissionId); assert.equal(pendingB.request.prompt, 'B');
    await worldOwner.clearRejectedWorldPending(client.storage, pendingA, { reasonCode: 'AI_INPUT_INVALID' });
    assert.deepEqual(documents.get('world-tour/pending.json'), pendingB); assert.equal(histories, 1);
  } finally { delete globalThis.__worldOwnerFixture; }
});
