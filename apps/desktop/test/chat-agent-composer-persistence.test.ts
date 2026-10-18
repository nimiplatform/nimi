import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentSubmissionSaveError, createAgentComposerPersistence, type AgentDraftSaveStatus } from '@nimiplatform/kit/features/chat/headless';

const BINDING = `agent_binding_${'a'.repeat(43)}`;
type Storage = Parameters<typeof createAgentComposerPersistence>[0]['storage'];
function localDraft(initial = '') {
  let text = initial;
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    ref: {
      get current() { return text; },
      get revision() { return revision; },
      set current(value: string) {
        if (value !== text) { text = value; revision++; for (const changed of listeners) changed(); }
      },
    },
    subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(ready => { resolve = ready; });
  return { promise, resolve };
}
const missing = () => Object.assign(new Error('missing'), { reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' });
function attach(draft: ReturnType<typeof localDraft>, storage: Storage, options: {
  isCurrent?: () => boolean; onState?: (state: AgentDraftSaveStatus) => void; onRestored?: () => void;
} = {}) {
  return createAgentComposerPersistence({
    agentBinding: BINDING, draft: draft.ref, storage, subscribe: draft.subscribe,
    isCurrent: options.isCurrent || (() => true), onState: options.onState || (() => {}), onRestored: options.onRestored || (() => {}),
  });
}

test('a fresh view restores the same stable binding without persisting a session handle', async () => {
  let value: { version: number; draft: string } | null = null;
  const paths: string[] = [];
  const storage: Storage = {
    readJson: async (path) => { paths.push(path); if (!value) throw missing(); return { value, sizeBytes: 20 }; },
    writeJson: async (path, next) => { paths.push(path); value = next as typeof value; return { value: next, sizeBytes: 20 }; },
  };
  const first = localDraft();
  const firstWriter = attach(first, storage);
  assert.equal(await firstWriter.ready, true);
  first.ref.current = '未发送的草稿';
  assert.equal(await firstWriter.flush(), true);
  firstWriter.close();
  const fresh = localDraft();
  const recovered = attach(fresh, storage);
  assert.equal(await recovered.ready, true);
  assert.equal(fresh.ref.current, '未发送的草稿');
  assert.ok(paths.every(path => path === `agent-chat/drafts/${BINDING}.json`));
  recovered.close();
});

test('a late read never replaces edits made while restoration is pending', async () => {
  const read = deferred<Awaited<ReturnType<Storage['readJson']>>>();
  const writes: string[] = [];
  const draft = localDraft();
  let restores = 0;
  const writer = attach(draft, {
    readJson: () => read.promise,
    writeJson: async (_path, value) => { writes.push((value as { draft: string }).draft); return { value, sizeBytes: 20 }; },
  }, { onRestored: () => restores++ });
  draft.ref.current = 'new edit';
  read.resolve({ value: { version: 1, draft: 'old saved text' }, sizeBytes: 20 });
  assert.equal(await writer.ready, true);
  assert.equal(draft.ref.current, 'new edit');
  assert.deepEqual(writes, ['new edit']);
  assert.equal(restores, 0);
  writer.close();
});

test('writes serialize and coalesce newer edits, acknowledging the latest value only', async () => {
  const firstWrite = deferred<void>();
  const writes: string[] = [];
  const statuses: AgentDraftSaveStatus[] = [];
  let active = 0;
  let maxActive = 0;
  const draft = localDraft();
  const writer = attach(draft, {
    readJson: async () => ({ value: { version: 1, draft: '' }, sizeBytes: 20 }),
    writeJson: async (_path, value) => {
      writes.push((value as { draft: string }).draft);
      active++; maxActive = Math.max(maxActive, active);
      if (writes.length === 1) await firstWrite.promise;
      active--;
      return { value, sizeBytes: 20 };
    },
  }, { onState: status => statuses.push(status) });
  await writer.ready;
  draft.ref.current = 'a';
  draft.ref.current = 'ab';
  draft.ref.current = 'abc';
  assert.deepEqual(writes, ['a']);
  assert.equal(statuses.at(-1), 'saving');
  firstWrite.resolve();
  assert.equal(await writer.flush(), true);
  assert.deepEqual(writes, ['a', 'abc']);
  assert.equal(maxActive, 1);
  assert.equal(statuses.at(-1), 'saved');
  writer.close();
});

test('a retired scope does not adopt a read or dispatch a queued write', async () => {
  const pendingRead = deferred<Awaited<ReturnType<Storage['readJson']>>>();
  const draft = localDraft();
  let current = true;
  let writes = 0;
  const reader = attach(draft, {
    readJson: () => pendingRead.promise,
    writeJson: async (_path, value) => { writes++; return { value, sizeBytes: 20 }; },
  }, { isCurrent: () => current });
  current = false;
  pendingRead.resolve({ value: { version: 1, draft: 'account A private text' }, sizeBytes: 20 });
  assert.equal(await reader.ready, false);
  assert.equal(draft.ref.current, '');
  assert.equal(writes, 0);
  reader.close();

  const pendingWrite = deferred<void>();
  const draftA = localDraft();
  const values: string[] = [];
  const statuses: AgentDraftSaveStatus[] = [];
  const writer = attach(draftA, {
    readJson: async () => ({ value: { version: 1, draft: '' }, sizeBytes: 20 }),
    writeJson: async (_path, value) => { values.push((value as { draft: string }).draft); await pendingWrite.promise; return { value, sizeBytes: 20 }; },
  }, { onState: status => statuses.push(status) });
  await writer.ready;
  draftA.ref.current = 'first';
  draftA.ref.current = 'late';
  writer.close();
  const statusAtClose = [...statuses];
  pendingWrite.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(values, ['first']);
  assert.deepEqual(statuses, statusAtClose);
});

test('a storage failure preserves text and retries storage without a generation path', async () => {
  const draft = localDraft();
  let calls = 0;
  const statuses: AgentDraftSaveStatus[] = [];
  const writer = attach(draft, {
    readJson: async () => ({ value: { version: 1, draft: '' }, sizeBytes: 20 }),
    writeJson: async (_path, value) => { calls++; if (calls === 1) throw new Error('offline'); return { value, sizeBytes: 20 }; },
  }, { onState: status => statuses.push(status) });
  await writer.ready;
  draft.ref.current = 'keep this';
  assert.equal(await writer.flush(), false);
  assert.equal(draft.ref.current, 'keep this');
  assert.equal(statuses.at(-1), 'unsaved');
  assert.equal(await writer.retry(), true);
  assert.equal(calls, 2);
  assert.equal(statuses.at(-1), 'saved');
  writer.close();
});

test('an unreadable saved document is never silently replaced by an empty draft', async () => {
  const draft = localDraft();
  let writes = 0;
  const writer = attach(draft, {
    readJson: async () => ({ value: { version: 99, draft: 'keep the original document' }, sizeBytes: 20 }),
    writeJson: async (_path, value) => { writes++; return { value, sizeBytes: 20 }; },
  });
  assert.equal(await writer.ready, false);
  assert.equal(writes, 0);
  assert.equal(draft.ref.current, '');
  writer.close();
});

test('a submission copy is durable before clearing and survives uncertain admission', async () => {
  let saved: unknown = { version: 1, draft: 'question' };
  const storage: Storage = {
    readJson: async () => ({ value: saved as never, sizeBytes: 20 }),
    writeJson: async (_path, value) => { saved = value; return { value, sizeBytes: 20 }; },
  };
  const draft = localDraft();
  const writer = attach(draft, storage);
  await writer.ready;
  const submission = { requestId: 'request-1', conversationAnchorId: 'anchor-1', text: 'question', artifactIds: ['image-1'] };
  await writer.prepare(submission);
  assert.deepEqual((saved as { submission: unknown }).submission, submission);
  draft.ref.current = '';
  await writer.flush();
  writer.close();
  const restored = attach(localDraft(), storage);
  await restored.ready;
  await assert.rejects(restored.prepare({ ...submission, requestId: 'request-2' }), /previous submission/);
  await restored.prepare(submission);
  await restored.acknowledge('unrelated-request');
  assert.deepEqual((saved as { submission: unknown }).submission, submission);
  await restored.acknowledge(submission.requestId);
  assert.equal((saved as { submission: unknown }).submission, null);
  restored.close();
});

test('a failed submission-copy write does not authorize sending or clear the draft', async () => {
  const draft = localDraft('original');
  const writer = attach(draft, {
    readJson: async () => ({ value: { version: 1, draft: 'original' }, sizeBytes: 20 }),
    writeJson: async () => { throw new Error('full disk'); },
  });
  await writer.ready;
  await assert.rejects(writer.prepare({ requestId: 'request', conversationAnchorId: 'anchor', text: 'original', artifactIds: [] }), /could not be saved/);
  assert.equal(draft.ref.current, 'original');
  writer.close();
});


test('durable original regeneration keeps its request in memory despite unreadable Home storage', async () => {
  const draft = localDraft('next question');
  let pending: unknown;
  const writer = createAgentComposerPersistence({agentBinding:BINDING,draft:draft.ref,subscribe:draft.subscribe,isCurrent:()=>true,onState:()=>{},onRestored:()=>{},onSubmission:value=>{pending=value;},storage:{readJson:async()=>{throw new Error('corrupt');},writeJson:async()=>{throw new Error('full');}}});
  assert.equal(await writer.ready,false);
  const request={requestId:'retry-1',conversationAnchorId:'anchor',text:'original',artifactIds:[],retryOfTurnId:'failed-turn'};
  await writer.prepare(request);
  assert.deepEqual(pending,request);
  assert.equal(draft.ref.current,'next question');
  await assert.rejects(writer.prepare({...request,requestId:'another'}),/previous submission/);
  await writer.acknowledge(request.requestId);
  assert.equal(pending,null);
  writer.close();
});

test('late storage restoration cannot replace or resurrect a regeneration request', async () => {
  const read=deferred<Awaited<ReturnType<Storage['readJson']>>>();
  const draft=localDraft(); let pending: unknown;
  const writer=createAgentComposerPersistence({agentBinding:BINDING,draft:draft.ref,subscribe:draft.subscribe,isCurrent:()=>true,onState:()=>{},onRestored:()=>{},onSubmission:value=>{pending=value;},storage:{readJson:()=>read.promise,writeJson:async(_path,value)=>({value,sizeBytes:20})}});
  await writer.prepare({requestId:'retry-new',conversationAnchorId:'anchor',text:'original',artifactIds:[],retryOfTurnId:'failed-turn'});
  await writer.acknowledge('retry-new');
  read.resolve({value:{version:1,draft:'',submission:{requestId:'old',conversationAnchorId:'anchor',text:'old',artifactIds:[]}},sizeBytes:20});
  await writer.ready;
  assert.equal(pending,null);
  writer.close();
});


test('submission persists original text once and preserves a separate next draft', async () => {
  const text = '【保存前置验收样本】\n' + '<p>x</p>\n'.repeat(6000);
  const draft = localDraft(text);
  let saved: any = { version:1, draft:text, submission:null };
  const storage: Storage = {
    readJson: async()=>({value:saved,sizeBytes:0}),
    writeJson: async(_path,value)=>{
      // Match Runtime JSON HTML escaping and the existing document quota.
      const encoded=JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e');
      assert.ok(Buffer.byteLength(encoded)<256*1024);
      saved=value; return {value,sizeBytes:Buffer.byteLength(encoded)};
    },
  };
  const writer=attach(draft,storage); await writer.ready;
  const pending={requestId:'same-request',conversationAnchorId:'anchor',text:text.trim(),artifactIds:[]};
  await writer.prepare(pending);
  assert.equal(saved.draft,''); assert.deepEqual(saved.submission,pending);
  assert.equal(draft.ref.current,text);
  draft.ref.current='a separate next question'; await writer.flush();
  assert.equal(saved.draft,'a separate next question'); assert.deepEqual(saved.submission,pending);
  writer.close();
  let restored: unknown;
  const next=localDraft();
  const controller=createAgentComposerPersistence({agentBinding:BINDING,draft:next.ref,storage,subscribe:next.subscribe,isCurrent:()=>true,onState:()=>{},onRestored:()=>{},onSubmission:value=>{restored=value;}});
  await controller.ready;
  assert.deepEqual(restored,pending);assert.equal(next.ref.current,'a separate next question');
  controller.close();
});

test('failed prepare preserves the typed storage cause and leaves no pending send', async () => {
 const cause=Object.assign(new Error('quota'),{reasonCode:'APP_STORAGE_QUOTA_EXCEEDED',traceId:'storage-trace'});
 const draft=localDraft('original');let pending:unknown;
 const writer=createAgentComposerPersistence({agentBinding:BINDING,draft:draft.ref,subscribe:draft.subscribe,isCurrent:()=>true,onState:()=>{},onRestored:()=>{},onSubmission:value=>{pending=value;},storage:{readJson:async()=>({value:{version:1,draft:'original'},sizeBytes:20}),writeJson:async()=>{throw cause;}}});
 await writer.ready;
 await assert.rejects(writer.prepare({requestId:'request',conversationAnchorId:'anchor',text:'original',artifactIds:[]}),error=>error instanceof AgentSubmissionSaveError && error.cause===cause && error.reasonCode==='APP_STORAGE_QUOTA_EXCEEDED' && error.traceId==='storage-trace');
 assert.equal(pending,null);assert.equal(draft.ref.current,'original');writer.close();
});


test('a protected App storage not-found starts an empty draft without swallowing access denial', async () => {
  for (const code of ['not-found', 'permission-denied']) {
    let writes = 0;
    const draft = { current: '', revision: 0 };
    const controller = createAgentComposerPersistence({ agentBinding: `agent_binding_${'a'.repeat(43)}`, draft,
      storage: { readJson: async () => { throw Object.assign(new Error(code), { code, reasonCode: code }); },
        writeJson: async () => { writes++; return {} as never; } } as never,
      isCurrent: () => true, subscribe: () => () => {}, onState: () => {}, onRestored: () => {},
    });
    assert.equal(await controller.ready, code === 'not-found');
    assert.equal(writes, 0);
    controller.close();
  }
});
