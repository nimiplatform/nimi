import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createWork, createWorkspace, workCanEdit } from '../src/product/model.ts';

// Execute the real initialization and store, replacing only the external SDK port.
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/product/engine.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'sdk-test-port', setup(builder) {
    builder.onResolve({ filter: /shell\/auth\/local-app-client$/ }, () => ({ path: 'client', namespace: 'test-port' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-port' }, () => ({ contents: 'export function getNimiLocalAppClient() { return globalThis.nimigoTestClient; }' }));
  } }],
});
const { GoEngine } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture(works, workspace, turns = []) {
  const documents = new Map([['nimigo/v1/workspace.json', structuredClone(workspace)], ...works.map(work => [`nimigo/v1/work-${work.id}.json`, structuredClone(work)])]);
  const calls = { sends: 0, snapshots: 0, interruptions: 0 };
  globalThis.nimigoTestClient = {
    storage: { readJson: async path => ({ value: structuredClone(documents.get(path)) }), writeJson: async (path, value) => { documents.set(path, structuredClone(value)); } },
    agents: { listReferences: async () => [{ agentBinding: 'test-binding', agentHandle: 'test-handle', displayName: 'Test Agent' }] },
    activity: { onOpenRequest: () => ({ stop: async () => {} }) },
    conversation: {
      snapshot: async () => { calls.snapshots++; return { turns, messages: [] }; },
      send: async () => { calls.sends++; throw new Error('Initialization must never submit work'); },
      interruptTurn: async () => { calls.interruptions++; },
    },
  };
  return { engine: new GoEngine(), documents, calls };
}

function queuedWork() {
  const workspace = createWorkspace();
  const work = createWork(workspace.projects[0].id, '恢复验收 B', '按资料交付一份指南', 'brief');
  work.status = 'queued'; work.queuedInput = { sequence: 2, followup: '保留这次追加的交付要求' };
  work.materials = [{ id: 'material', title: '真实资料的测试夹具', content: '资料正文', createdAt: work.createdAt }];
  workspace.workIds = [work.id];
  return { workspace, work };
}

test('initialize restores a never-submitted queue to a manual start, retaining material and request', async () => {
  const { workspace, work } = queuedWork();
  const { engine, documents, calls } = fixture([work], workspace);
  try {
    await engine.initialize();
    const restored = engine.getWork(work.id);
    assert.equal(engine.ready, true);
    assert.equal(restored.status, 'draft');
    assert.equal(workCanEdit(restored), true);
    assert.deepEqual(restored.attempts, []);
    assert.deepEqual(restored.materials, work.materials);
    assert.equal(restored.queuedInput.followup, work.queuedInput.followup);
    assert.equal(documents.get(`nimigo/v1/work-${work.id}.json`).status, 'draft');
    assert.deepEqual(calls, { sends: 0, snapshots: 0, interruptions: 0 });
  } finally { engine.dispose(); }
});

test('initialize never treats an earlier completed attempt as the result of a new queue entry', async () => {
  const { workspace, work } = queuedWork();
  work.attempts = [{ id: 'earlier', agentBinding: 'test-binding', anchorId: 'anchor', turnId: 'previous-turn', startedAt: work.createdAt, status: 'complete' }];
  const { engine, calls } = fixture([work], workspace, [{ turnId: 'previous-turn', status: 'completed' }]);
  try {
    await engine.initialize();
    assert.equal(engine.getWork(work.id).status, 'draft');
    assert.deepEqual(engine.getWork(work.id).attempts, work.attempts);
    assert.equal(calls.snapshots, 0);
    assert.equal(calls.sends, 0);
  } finally { engine.dispose(); }
});

test('initialize keeps a potentially submitted request uncertain and observes accepted turns without replay', async () => {
  const { workspace, work } = queuedWork();
  work.status = 'running'; work.queuedInput = undefined;
  work.attempts = [{ id: 'request', agentBinding: 'test-binding', anchorId: 'anchor', turnId: null, startedAt: work.createdAt, status: 'running' }];
  const accepted = { ...structuredClone(work), id: 'accepted', attempts: [{ ...work.attempts[0], turnId: 'accepted-turn' }] };
  workspace.workIds.push(accepted.id);
  const { engine, calls } = fixture([work, accepted], workspace, [{ turnId: 'accepted-turn', status: 'completed' }]);
  try {
    await engine.initialize();
    assert.equal(engine.getWork(work.id).status, 'uncertain');
    assert.equal(workCanEdit(engine.getWork(work.id)), false);
    assert.equal(engine.getWork(accepted.id).status, 'review');
    assert.deepEqual(calls, { sends: 0, snapshots: 1, interruptions: 0 });
  } finally { engine.dispose(); }
});

test('manual retry of a failed follow-up preserves that request instead of reverting to the original goal', async () => {
  const { workspace, work } = queuedWork();
  work.status = 'draft'; work.queuedInput = undefined; workspace.agentBinding = 'test-binding';
  workspace.skills[0].materials = '用户修订的现稿';
  workspace.skills[0].result = '保留修订意见的完整指南';
  const { engine, calls } = fixture([work], workspace);
  const submitted = [];
  let turnId = '';
  engine.client.conversation.open = async () => ({ conversationAnchorId: 'anchor', activeTurnId: null });
  engine.client.conversation.send = async input => {
    const method = JSON.parse(input.work.sources.find(source => source.sourceId === 'work-method').content);
    assert.equal(method.materials, '用户修订的现稿');
    assert.equal(method.result, '保留修订意见的完整指南');
    calls.sends++; submitted.push(input.parts[0].text); turnId = `turn-${calls.sends}`; return { turnId };
  };
  engine.client.conversation.listToolCalls = async () => [];
  engine.client.conversation.snapshot = async () => ({ messages: [], turns: [{ turnId, status: 'failed', reasonCode: 'AI_OUTPUT_INVALID' }] });
  try {
    await engine.initialize();
    assert.equal(calls.sends, 0);
    await engine.run(work.id, '读取我修订的 v2，只压缩正文并保留口径');
    assert.equal(engine.getWork(work.id).status, 'failed');
    await engine.run(work.id);
    assert.deepEqual(submitted, ['读取我修订的 v2，只压缩正文并保留口径', '读取我修订的 v2，只压缩正文并保留口径']);
    assert.equal(engine.getWork(work.id).materials.length, 1);
  } finally { engine.dispose(); }
});

function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }

for (const name of ['save_deliverable', 'set_steps', 'request_input']) {
  test(`F02: stopped turn cannot apply late ${name} while the next queued work is active`, async () => {
    const workspace = createWorkspace(); workspace.agentBinding = 'test-binding'; workspace.notifyHome = false;
    const a = createWork(workspace.projects[0].id, 'A', '保持原稿', 'brief');
    const b = createWork(workspace.projects[0].id, 'B', '下一项工作', 'brief');
    const existing = { id: 'saved', title: '停止前已保存', revisions: [{ id: 'v1', path: 'saved.md', createdAt: a.createdAt, by: 'agent', note: '', turnId: 'earlier' }] };
    a.deliverables = [existing]; workspace.workIds = [a.id,b.id];
    const { engine } = fixture([a,b],workspace);
    const pollEntered = deferred(), releasePoll = deferred(), nextEntered = deferred(), releaseNext = deferred();
    const assets = [], interrupts = [], submitted = [];
    engine.client.storage.assets = { write: async input => { assets.push(input); } };
    engine.client.conversation.open = async () => ({ conversationAnchorId: 'anchor', activeTurnId: null });
    engine.client.conversation.send = async input => ({ turnId: input.work.workId === a.id ? 'turn-a' : 'turn-b' });
    engine.client.conversation.listToolCalls = async scope => {
      if (scope.turnId === 'turn-b') { nextEntered.resolve(); await releaseNext.promise; return []; }
      pollEntered.resolve(); await releasePoll.promise;
      return [{ callId:'late-a', turnId:'turn-a', name, argumentsJson: JSON.stringify(name === 'save_deliverable' ? { title:'不应写入', content:'停止后内容' } : name === 'set_steps' ? { steps:[{title:'旧步骤',done:false}] } : {question:'过期问题'}) }];
    };
    engine.client.conversation.interruptTurn = async input => { interrupts.push(input.expectedTurnId); };
    engine.client.conversation.submitToolResult = async input => { submitted.push(input); };
    engine.client.conversation.snapshot = async () => ({ messages:[],turns:[{turnId:'turn-a',status:'interrupted'},{turnId:'turn-b',status:'active'}] });
    await engine.initialize();
    const running = engine.run(a.id);
    try {
      await pollEntered.promise; await engine.run(b.id); await engine.stop(a.id); await nextEntered.promise;
      assert.equal(assets.length,0); assert.equal(engine.active,b.id);
      releasePoll.resolve(); await running;
      assert.equal(assets.length,0); assert.deepEqual(engine.getWork(a.id).deliverables,[existing]);
      assert.deepEqual(engine.getWork(a.id).steps,[]); assert.equal(engine.getWork(a.id).status,'stopped');
      assert.equal(engine.pending,null); assert.equal(engine.active,b.id); assert.deepEqual(submitted,[]);
      await engine.stop(b.id); assert.deepEqual(interrupts,['turn-a','turn-b']);
    } finally { releasePoll.resolve(); releaseNext.resolve(); engine.dispose(); }
  });
}

test('F02: asset started before Stop may finish, but its late completion cannot append a revision', async () => {
  const workspace=createWorkspace();workspace.agentBinding='test-binding';workspace.notifyHome=false;
  const work=createWork(workspace.projects[0].id,'异步成果','保留已提交的数据','brief');workspace.workIds=[work.id];
  const {engine}=fixture([work],workspace); const writing=deferred(), release=deferred(); let assets=0;
  engine.client.storage.assets={write:async()=>{writing.resolve();await release.promise;assets++;}};
  engine.client.conversation.open=async()=>({conversationAnchorId:'anchor',activeTurnId:null});
  engine.client.conversation.send=async()=>({turnId:'turn'});
  engine.client.conversation.listToolCalls=async()=>[{callId:'save',turnId:'turn',name:'save_deliverable',argumentsJson:JSON.stringify({title:'在途资产',content:'正文'})}];
  engine.client.conversation.snapshot=async()=>({messages:[],turns:[{turnId:'turn',status:'interrupted'}]});
  engine.client.conversation.submitToolResult=async()=>{throw new Error('Cannot submit a result after Stop');};
  await engine.initialize();const running=engine.run(work.id);
  try{await writing.promise;await engine.stop(work.id);release.resolve();await running;assert.equal(assets,1);assert.deepEqual(engine.getWork(work.id).deliverables,[]);assert.equal(engine.getWork(work.id).status,'stopped');}
  finally{release.resolve();engine.dispose();}
});

test('F02: a storage scope read released after Stop cannot initiate an asset write', async () => {
  const workspace=createWorkspace();workspace.agentBinding='test-binding';workspace.notifyHome=false;
  const work=createWork(workspace.projects[0].id,'停止前置检查','等待存储读取','brief');workspace.workIds=[work.id];
  const {engine}=fixture([work],workspace);const reading=deferred(),release=deferred();let toolReturned=false,held=false,assets=0;
  const read=engine.client.storage.readJson;
  engine.client.storage.readJson=async path=>{if(toolReturned&&!held&&path.endsWith('/workspace.json')){held=true;reading.resolve();await release.promise;}return read(path);};
  engine.client.storage.assets={write:async()=>{assets++;}};
  engine.client.conversation.open=async()=>({conversationAnchorId:'anchor',activeTurnId:null});
  engine.client.conversation.send=async()=>({turnId:'turn'});
  engine.client.conversation.listToolCalls=async()=>{toolReturned=true;return [{callId:'save',turnId:'turn',name:'save_deliverable',argumentsJson:JSON.stringify({title:'迟到文档',content:'正文'})}];};
  engine.client.conversation.snapshot=async()=>({messages:[],turns:[{turnId:'turn',status:'interrupted'}]});
  await engine.initialize();const running=engine.run(work.id);
  try{await reading.promise;await engine.stop(work.id);release.resolve();await running;assert.equal(assets,0);assert.deepEqual(engine.getWork(work.id).deliverables,[]);}
  finally{release.resolve();engine.dispose();}
});

test('F02: a late answer acknowledgement cannot clear the next work question', async () => {
  const workspace=createWorkspace();workspace.agentBinding='test-binding';workspace.notifyHome=false;
  const a=createWork(workspace.projects[0].id,'A','询问','brief'),b=createWork(workspace.projects[0].id,'B','询问','brief');workspace.workIds=[a.id,b.id];
  const {engine}=fixture([a,b],workspace);const askingA=deferred(),askingB=deferred(),answerEntered=deferred(),releaseAnswer=deferred();
  const unsubscribe=engine.subscribe(()=>{if(engine.getWork(a.id).status==='needs-input')askingA.resolve();if(engine.getWork(b.id).status==='needs-input')askingB.resolve();});
  engine.client.conversation.open=async()=>({conversationAnchorId:'anchor',activeTurnId:null});
  engine.client.conversation.send=async input=>({turnId:input.work.workId===a.id?'turn-a':'turn-b'});
  engine.client.conversation.listToolCalls=async input=>[{callId:`ask-${input.turnId}`,turnId:input.turnId,name:'request_input',argumentsJson:JSON.stringify({question:input.turnId})}];
  engine.client.conversation.submitToolResult=async()=>{answerEntered.resolve();await releaseAnswer.promise;};
  engine.client.conversation.snapshot=async()=>({messages:[],turns:[{turnId:'turn-a',status:'active'},{turnId:'turn-b',status:'active'}]});
  await engine.initialize();const running=engine.run(a.id);
  try{
    await askingA.promise;await engine.run(b.id);const answer=engine.answer('实际回答');await answerEntered.promise;
    await engine.stop(a.id);await askingB.promise;releaseAnswer.resolve();await answer;
    assert.equal(engine.pending.workId,b.id);assert.equal(engine.getWork(a.id).status,'stopped');assert.equal(engine.getWork(b.id).status,'needs-input');
    await engine.stop(b.id);await running;
  }finally{releaseAnswer.resolve();unsubscribe();engine.dispose();}
});

test('F02: a source read completed after Stop cannot install an obsolete approval prompt', async () => {
  const workspace=createWorkspace();workspace.agentBinding='test-binding';workspace.notifyHome=false;
  const work=createWork(workspace.projects[0].id,'来源审核','只审核提案','review');workspace.workIds=[work.id];
  const {engine}=fixture([work],workspace);const reading=deferred(),release=deferred();let results=0;
  engine.client.realm={worldCore:{get:async()=>{reading.resolve();await release.promise;return {id:'world',core:{identity:{name:'来源'}},lorebookDeclaration:{}};}}};
  engine.client.conversation.open=async()=>({conversationAnchorId:'anchor',activeTurnId:null});
  engine.client.conversation.send=async()=>({turnId:'turn'});
  engine.client.conversation.listToolCalls=async()=>[{callId:'world',turnId:'turn',name:'update_world_summary',argumentsJson:JSON.stringify({worldId:'world',summary:'候选摘要'})}];
  engine.client.conversation.submitToolResult=async()=>{results++;};
  engine.client.conversation.snapshot=async()=>({messages:[],turns:[{turnId:'turn',status:'interrupted'}]});
  await engine.initialize();const running=engine.run(work.id);
  try{await reading.promise;await engine.stop(work.id);release.resolve();await running;assert.equal(engine.pending,null);assert.equal(engine.getWork(work.id).status,'stopped');assert.equal(results,0);}
  finally{release.resolve();engine.dispose();}
});
