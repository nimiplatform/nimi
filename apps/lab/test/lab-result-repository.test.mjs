import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Storage/ordering fault tests with explicitly synthetic metadata. These do
// not exercise inference, the protected carrier or product acceptance.
const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const directory = mkdtempSync(path.join(root, '.tmp', 'result-repository-'));
await build({ stdin: { contents: `export {createLabAIStudioHistoryRepository} from './src/lab/lab-ai-studio-workspace.tsx';
  export {beginStudioJobRecovery,saveStudioJobRecoveryResult,readStudioJobRecovery,restoreSavedStudioJobResult} from './src/ai-studio-core/job-recovery.ts';
  export {studioResultAssetPaths} from './src/ai-studio-core/managed-result-references.ts';`,
  resolveDir: root, loader: 'ts' }, outfile: path.join(directory, 'repository.mjs'), bundle: true,
  packages: 'external', platform: 'node', format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'silent' });
const { createLabAIStudioHistoryRepository, beginStudioJobRecovery, saveStudioJobRecoveryResult, readStudioJobRecovery,
  restoreSavedStudioJobResult, studioResultAssetPaths } = await import(pathToFileURL(path.join(directory, 'repository.mjs')).href);
test.after(() => rmSync(directory, { recursive: true, force: true }));

function fixture() {
  let runs = {}, media = [];
  const documents = new Map(), assets = new Map(), deleted = [];
  const storage = {
    async readJson(key) { if (!documents.has(key)) throw { code: 'not-found' }; return { value: structuredClone(documents.get(key)) }; },
    async writeJson(key, value) { documents.set(key, structuredClone(value)); return { value }; },
    assets: {
      async read({ relativePath }) {
        const asset = await this.stat(relativePath);
        return { asset, range: { offset: 0, length: asset.sizeBytes, totalSize: asset.sizeBytes }, body: (async function* () { yield new Uint8Array(asset.sizeBytes); })() };
      },
      async stat(key) { if (!assets.has(key)) throw { code: 'not-found' }; return structuredClone(assets.get(key)); },
      async remove(key) { deleted.push(key); return { removed: assets.delete(key) }; },
    },
  };
  const host = {
    scope: { globalName: key => key }, sdk: { storage, localAppClient: { storage } },
    app: {
      projection: { runHistory: async () => structuredClone(runs), imageHistory: async () => structuredClone(media),
        preferences: () => ({ historyPanel: { collapsed: false, scope: 'capability', hideFailures: false } }) },
      commands: {
        async appendRunHistory(record) { runs[record.capabilityId] = [structuredClone(record), ...(runs[record.capabilityId] ?? []).filter(row => row.id !== record.id)]; return structuredClone(runs); },
        async appendImageHistory(record) { media = [structuredClone(record), ...media.filter(row => row.id !== record.id)]; return structuredClone(media); },
        async removeRunHistory(id) { runs = Object.fromEntries(Object.entries(runs).map(([key, rows]) => [key, rows.filter(row => row.id !== id)])); return structuredClone(runs); },
        async removeImageHistory(id) { media = media.filter(row => (row.runId || row.id) !== id); return structuredClone(media); },
        async rendererLog() {}, async runtimeLog() {}, async savePreferences() {},
        async nextRunIdentity() { return { runId: crypto.randomUUID(), createdAt: new Date().toISOString() }; },
      },
    },
  };
  const metadata = key => {
    const asset = { relativePath: `synthetic/${key}.wav`, mediaType: 'audio/wav', sizeBytes: 58,
      sha256: `sha256:${'a'.repeat(64)}`, previewSource: 'managed-asset' };
    assets.set(asset.relativePath, structuredClone(asset)); return asset;
  };
  const result = key => {
    const sourceAudio = metadata(`${key}-source`), vocals = metadata(`${key}-vocals`), background = metadata(`${key}-background`);
    return { ok: true, capabilityId: 'audio.separate', capabilityLabel: 'Synthetic separation', message: 'synthetic storage fixture',
      output: { kind: 'artifacts', jobId: `synthetic-job-${key}`, jobState: 'completed', artifactCount: 2,
        artifacts: [vocals, background], firstArtifact: vocals,
        audioSeparation: { sourceAudio, vocals, background, request: { kind: 'range', startSeconds: 2, endSeconds: 9 } } } };
  };
  const record = (id, value) => ({ id, capabilityId: value.capabilityId, prompt: 'synthetic metadata, no inference',
    status: 'ready', message: value.message, createdAt: '2026-10-05T00:00:00Z', result: { ok: true, summary: 'synthetic', ...value.output } });
  return { host, storage, documents, assets, deleted, result, record,
    repository: createLabAIStudioHistoryRepository(host), runs: () => structuredClone(runs), media: () => structuredClone(media) };
}

test('33 complete recovery results enter formal history; repeated same-Job recovery is idempotent', async () => {
  const f = fixture();
  const first = f.result('0'); let firstEntry;
  for (let n = 0; n < 33; n++) {
    const result = n === 0 ? first : f.result(String(n));
    const id = await beginStudioJobRecovery(f.storage, 'audio.separate', result.output.audioSeparation.sourceAudio,
      undefined, result.output.audioSeparation.request);
    if (!n) firstEntry = id;
    await saveStudioJobRecoveryResult(f.storage, id, result, 'audio.separate');
    assert.equal((await f.repository.persist({ result, record: f.record(`run-${n}`, result) })).ok, true);
  }
  const entries = await readStudioJobRecovery(f.storage, 'audio.separate');
  assert.equal(entries.length, 33); assert.equal(entries[0].clientSubmissionId, firstEntry);
  const restored = await restoreSavedStudioJobResult(entries[0], 'Synthetic', 'audio.separate', f.storage.assets);
  const outcome = await f.repository.persist({ result: restored, record: f.record('repeat', restored) });
  assert.equal(outcome.record.id, 'run-0');
  assert.equal(f.runs()['audio.separate'].length, 33);
  assert.equal(f.media().length, 66);
  assert.deepEqual(f.runs()['audio.separate'].find(row => row.id === 'run-0').result.audioSeparation,
    first.output.audioSeparation);
});

test('main save failure recovers, and media-index failure retries the same committed run', async () => {
  const f = fixture(), result = f.result('retry');
  const id = await beginStudioJobRecovery(f.storage, 'audio.separate', result.output.audioSeparation.sourceAudio);
  await saveStudioJobRecoveryResult(f.storage, id, result, 'audio.separate');
  const append = f.host.app.commands.appendRunHistory;
  f.host.app.commands.appendRunHistory = async () => { throw Error('main index fault'); };
  const failed = await f.repository.persist({ result, record: f.record('original-attempt', result) });
  assert.equal(failed.ok, false); assert.equal(failed.retryRecord, true); assert.deepEqual(f.deleted, []);
  f.host.app.commands.appendRunHistory = append;
  const appendMedia = f.host.app.commands.appendImageHistory;
  f.host.app.commands.appendImageHistory = async () => { throw Error('media index fault'); };
  await assert.rejects(f.repository.persist({ result, record: f.record('recovered', result) }), /media index fault/);
  assert.equal(f.runs()['audio.separate'].length, 1); assert.equal(f.media().length, 0);
  f.host.app.commands.appendImageHistory = appendMedia;
  const saved = await f.repository.persist({ result, record: f.record('duplicate-retry', result) });
  assert.equal(saved.record.id, 'recovered'); assert.equal(f.media().length, 2);
  assert.deepEqual(f.deleted, []);
});

test('append arriving during captured clear waits and survives; two-index delete failures retry by ID', async () => {
  const f = fixture(), a = f.result('a'), b = f.result('b');
  await f.repository.persist({ result: a, record: f.record('a', a) });
  const remove = f.host.app.commands.removeImageHistory;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.host.app.commands.removeImageHistory = async id => { entered.resolve(); await release.promise; return remove(id); };
  const clear = f.repository.clear('audio.separate', false);
  await entered.promise;
  const save = f.repository.persist({ result: b, record: f.record('b', b) });
  release.resolve();
  const outcome = await clear; await save;
  assert.equal(outcome.completed, 1); assert.equal(outcome.failed, 0);
  assert.deepEqual(f.runs()['audio.separate'].map(row => row.id), ['b']);
  assert.deepEqual(f.media().map(row => row.runId), ['b', 'b']);
  const removeRun = f.host.app.commands.removeRunHistory;
  f.host.app.commands.removeRunHistory = async () => { throw Error('run delete fault'); };
  const failed = await f.repository.remove('b', false);
  assert.equal(failed.completed, 0); assert.equal(failed.failed, 1);
  assert.equal(f.runs()['audio.separate'].length, 1);
  f.host.app.commands.removeRunHistory = removeRun;
  assert.equal((await f.repository.remove('b', false)).completed, 1);
  assert.equal(f.runs()['audio.separate'].length, 0);
});

test('recovery references protect shared assets; last explicit deletion removes source and prevents dangling success', async () => {
  const f = fixture(), a = f.result('a'), b = f.result('b');
  b.output.audioSeparation.sourceAudio = a.output.audioSeparation.sourceAudio;
  await f.repository.persist({ result: a, record: f.record('a', a) });
  await f.repository.persist({ result: b, record: f.record('b', b) });
  const id = await beginStudioJobRecovery(f.storage, 'audio.separate', a.output.audioSeparation.sourceAudio);
  await saveStudioJobRecoveryResult(f.storage, id, b, 'audio.separate');
  await f.repository.remove('a', true);
  assert.equal(f.assets.has(a.output.audioSeparation.sourceAudio.relativePath), true);
  const entries = await readStudioJobRecovery(f.storage, 'audio.separate');
  assert.equal((await restoreSavedStudioJobResult(entries[0], 'Synthetic', 'audio.separate', f.storage.assets)).ok, true);
  await f.repository.remove('b', true);
  assert.equal(f.assets.has(a.output.audioSeparation.sourceAudio.relativePath), false);
  assert.equal((await readStudioJobRecovery(f.storage, 'audio.separate')).length, 0);
  await assert.rejects(restoreSavedStudioJobResult(entries[0], 'Synthetic', 'audio.separate', f.storage.assets));
});

test('compensation retains content referenced by another valid record', async () => {
  const f = fixture(), existing = f.result('shared');
  await f.repository.persist({ result: existing, record: f.record('shared', existing) });
  const source = existing.output.audioSeparation.sourceAudio;
  const text = { ok: true, capabilityId: 'text.generate', capabilityLabel: 'Text', message: 'synthetic',
    output: { kind: 'text', text: 'synthetic', finishReason: 'stop', streamed: false, sourceImage: source } };
  f.host.app.commands.appendRunHistory = async () => { throw Error('history fault'); };
  const failed = await f.repository.persist({ result: text, record: { id: 'text', capabilityId: 'text.generate', prompt: '',
    status: 'ready', message: 'synthetic', createdAt: '2026-10-05T00:00:00Z',
    result: { ok: true, kind: 'text', summary: 'synthetic', body: 'synthetic', charCount: 9,
      finishReason: 'stop', streamed: false, sourceImage: source } } });
  assert.equal(failed.ok, false); assert.equal(f.assets.has(source.relativePath), true);
  assert.deepEqual(f.deleted, []);
});

test('recovery quota failure never evicts an earlier unindexed result', async () => {
  const f = fixture(), result = f.result('unindexed');
  const id = await beginStudioJobRecovery(f.storage, 'audio.separate', result.output.audioSeparation.sourceAudio);
  await saveStudioJobRecoveryResult(f.storage, id, result, 'audio.separate');
  const before = structuredClone(f.documents.get('studio/audio-separation-recovery.json'));
  await assert.rejects(beginStudioJobRecovery(f.storage, 'audio.separate', result.output.audioSeparation.sourceAudio,
    undefined, undefined, undefined, 'x'.repeat(250 * 1024)), /storage is full/);
  assert.deepEqual(f.documents.get('studio/audio-separation-recovery.json'), before);
  assert.equal((await restoreSavedStudioJobResult(before[0], 'Synthetic', 'audio.separate', f.storage.assets)).ok, true);
});

test('partial asset removal cannot open cached success and still retains full references for retry', async () => {
  const f = fixture(), result = f.result('partial');
  await f.repository.persist({ result, record: f.record('partial', result) });
  const id = await beginStudioJobRecovery(f.storage, 'audio.separate', result.output.audioSeparation.sourceAudio);
  await saveStudioJobRecoveryResult(f.storage, id, result, 'audio.separate');
  const remove = f.storage.assets.remove;
  f.storage.assets.remove = async path => {
    if (path === result.output.audioSeparation.background.relativePath) throw Error('one removal failed');
    return remove(path);
  };
  assert.equal((await f.repository.remove('partial', true)).skipped, 1);
  const entry = (await readStudioJobRecovery(f.storage, 'audio.separate'))[0];
  await assert.rejects(restoreSavedStudioJobResult(entry, 'Synthetic', 'audio.separate', f.storage.assets));
  assert.equal(f.runs()['audio.separate'].length, 1);
  f.storage.assets.remove = remove;
  assert.equal((await f.repository.remove('partial', true)).completed, 1);
  assert.equal((await readStudioJobRecovery(f.storage, 'audio.separate')).length, 0);
});

test('an unknown main commit never compensates away actually published assets', async () => {
  const f = fixture(), result = f.result('uncertain');
  const append = f.host.app.commands.appendRunHistory;
  f.host.app.commands.appendRunHistory = async record => {
    await append(record);
    throw Object.assign(Error('publication unknown'), { historyPublicationUncertain: true });
  };
  const failed = await f.repository.persist({ result, record: f.record('uncertain', result) });
  assert.equal(failed.ok, false); assert.equal(failed.retryRecord, true); assert.deepEqual(f.deleted, []);
  f.host.app.commands.appendRunHistory = append;
  assert.equal((await f.repository.persist({ result, record: f.record('retry', result) })).record.id, 'uncertain');
  assert.equal(f.runs()['audio.separate'].length, 1); assert.equal(f.media().length, 2);
});

test('one reference enumerator includes text media, transcription source and distinct conversion inputs', () => {
  const ref = relativePath => ({ relativePath });
  assert.deepEqual(studioResultAssetPaths({ ok: true, kind: 'text', sourceImage: ref('source.mp4') }), ['source.mp4']);
  assert.deepEqual(new Set(studioResultAssetPaths({ ok: true, kind: 'artifacts', artifacts: [ref('score.mid'), ref('timeline.json')],
    musicTranscription: { sourceAudio: ref('music-source.wav'), scores: [ref('score.mid')] } })),
  new Set(['score.mid', 'timeline.json', 'music-source.wav']));
  assert.deepEqual(new Set(studioResultAssetPaths({ ok: true, kind: 'artifacts', artifacts: [ref('converted.wav')],
    voiceConversion: { sourceVocal: ref('source.wav'), targetVoice: ref('target.wav'), vocal: ref('converted.wav') } })),
  new Set(['source.wav', 'target.wav', 'converted.wav']));
  assert.deepEqual(studioResultAssetPaths({ ok: false, sourceImage: ref('not-owned-by-failure.wav') }), []);
});


test('saved recovery cannot report success from matching Stat metadata when the full read fails', async () => {
  for (const failure of ['truncated', 'owner-integrity-error']) {
    const f = fixture(); const result = f.result(failure);
    const id = await beginStudioJobRecovery(f.storage, 'audio.separate', result.output.audioSeparation.sourceAudio);
    await saveStudioJobRecoveryResult(f.storage, id, result, 'audio.separate');
    const [entry] = await readStudioJobRecovery(f.storage, 'audio.separate');
    let returned = 0, reads = 0;
    f.storage.assets.read = async ({ relativePath }) => {
      reads++; const asset = await f.storage.assets.stat(relativePath);
      return { asset, range: { offset: 0, length: asset.sizeBytes, totalSize: asset.sizeBytes }, body: {
        async *[Symbol.asyncIterator]() {
          try { yield new Uint8Array(1); if (failure === 'owner-integrity-error') throw new Error('owner digest mismatch'); }
          finally { returned++; }
        },
      } };
    };
    await assert.rejects(() => restoreSavedStudioJobResult(entry, 'Synthetic', 'audio.separate', f.storage.assets), /incomplete|digest mismatch/);
    assert.equal(reads, 1); assert.equal(returned, 1);
    assert.equal((await readStudioJobRecovery(f.storage, 'audio.separate'))[0].clientSubmissionId, id);
  }
});


test('actual saved-result restore closes a pending reader on operation abort without reading remaining chunks', async () => {
  const f = fixture(); const result = f.result('reader-abort');
  const id = await beginStudioJobRecovery(f.storage, 'audio.separate', result.output.audioSeparation.sourceAudio);
  await saveStudioJobRecoveryResult(f.storage, id, result, 'audio.separate');
  const [entry] = await readStudioJobRecovery(f.storage, 'audio.separate');
  const entered = Promise.withResolvers(), next = Promise.withResolvers(); let returns = 0, reads = 0, nextCalls = 0;
  f.storage.assets.read = async ({ relativePath }) => {
    reads++; const asset = await f.storage.assets.stat(relativePath);
    return { asset, range: { offset: 0, length: asset.sizeBytes, totalSize: asset.sizeBytes }, body: {
      [Symbol.asyncIterator]: () => ({
        next: () => { nextCalls++; entered.resolve(); return next.promise; },
        return: async () => { returns++; next.resolve({ done: true }); return { done: true }; },
      }),
    } };
  };
  const controller = new AbortController();
  const work = restoreSavedStudioJobResult(entry, 'Synthetic', 'audio.separate', f.storage.assets, controller.signal);
  await entered.promise; controller.abort();
  await assert.rejects(work, error => error.name === 'AbortError');
  assert.equal(reads, 1); assert.equal(nextCalls, 1); assert.equal(returns, 1);
});
