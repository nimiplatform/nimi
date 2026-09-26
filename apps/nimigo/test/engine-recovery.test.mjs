import assert from 'node:assert/strict';
import test from 'node:test';
import { GoEngine } from '../src/product/engine.ts';
import { createWork, createWorkspace, workCanEdit } from '../src/product/model.ts';

function fixture(works, workspace) {
  const documents = new Map([['nimigo/v1/workspace.json', structuredClone(workspace)], ...works.map(work => [`nimigo/v1/work-${work.id}.json`, structuredClone(work)])]);
  const calls = { starts: [], gets: [], cancels: [], results: [], assets: [] };
  const client = {
    storage: { readJson: async path => ({ value: structuredClone(documents.get(path)) }), writeJson: async (path, value) => { documents.set(path, structuredClone(value)); }, assets: { write: async input => { calls.assets.push(input); } } },
    agentWork: {
      listReferences: async () => [{ agentBinding: 'test-binding', agentHandle: 'test-handle', displayName: 'Test Agent', avatarUrl: null }],
      status: async () => ({ busy: false, ownExecutionId: null }),
      start: async input => { calls.starts.push(input); return { executionId: `execution-${calls.starts.length}` }; },
      get: async input => { calls.gets.push(input); return { executionId: input.executionId, state: 'succeeded', outputText: '完整结果', reasonCode: '', message: '' }; },
      listToolCalls: async () => [],
      submitToolResult: async input => { calls.results.push(input); return { callId: input.callId }; },
      cancel: async input => { calls.cancels.push(input); return { executionId: input.executionId, state: 'cancelled' }; },
    },
    activity: { onOpenRequest: () => ({ stop: async () => {} }), put: async () => {} },
    integration: { registerProvider: async () => { throw new Error('provider not selected in this fixture'); } },
    realm: {},
  };
  return { engine: new GoEngine(client), documents, calls, client };
}
function workFixture() { const workspace = createWorkspace(); workspace.agentBinding = 'test-binding'; workspace.notifyHome = false; const work = createWork(workspace.projects[0].id, '分析', '保存完整成果', 'brief'); workspace.workIds = [work.id]; return { workspace, work }; }
function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }

test('reopening never resubmits queued work, and does not read canonical chat', async () => {
  const { workspace, work } = workFixture(); work.status = 'queued'; work.queuedInput = { sequence: 1, followup: '保留追加要求' };
  const { engine, calls } = fixture([work], workspace);
  try { await engine.initialize(); assert.equal(engine.getWork(work.id).status, 'draft'); assert.equal(engine.getWork(work.id).queuedInput.followup, '保留追加要求'); assert.equal(workCanEdit(engine.getWork(work.id)), true); assert.equal(calls.starts.length, 0); assert.equal(calls.gets.length, 0); }
  finally { engine.dispose(); }
});

test('a submitted execution is observed only by its own reference and never replayed', async () => {
  const { workspace, work } = workFixture(); work.status = 'running'; work.attempts = [{ id: 'request', agentBinding: 'test-binding', executionId: 'own-execution', startedAt: work.createdAt, status: 'running' }];
  const { engine, calls } = fixture([work], workspace);
  try { await engine.initialize(); assert.equal(engine.getWork(work.id).status, 'review'); assert.deepEqual(calls.gets, [{ agentHandle: 'test-handle', executionId: 'own-execution' }]); assert.equal(calls.starts.length, 0); }
  finally { engine.dispose(); }
});

test('complete work output remains App state and a model completion alone is not a saved delivery', async () => {
  const { workspace, work } = workFixture(); const { engine, calls, documents } = fixture([work], workspace);
  try { await engine.initialize(); await engine.run(work.id, '读取修订稿再交付'); assert.equal(engine.getWork(work.id).status, 'review'); assert.equal(calls.starts[0].prompt, '读取修订稿再交付'); assert.equal(documents.get(`nimigo/v1/work-${work.id}.json`).messages[1].parts[0].text, '完整结果'); assert.equal('conversationAnchorId' in calls.starts[0], false); }
  finally { engine.dispose(); }
});

for (const name of ['save_deliverable', 'set_steps', 'request_input']) test(`stopping an execution rejects its late ${name}`, async () => {
  const { workspace, work } = workFixture(); const { engine, client, calls } = fixture([work], workspace);
  const entered = deferred(); const release = deferred();
  client.agentWork.listToolCalls = async () => { entered.resolve(); await release.promise; return [{ callId: 'late', executionId: 'execution-1', name, argumentsJson: JSON.stringify(name === 'save_deliverable' ? { title: '不可保存', content: '迟到' } : name === 'set_steps' ? { steps: [{ title: '迟到', done: true }] } : { question: '过期问题' }) }]; };
  await engine.initialize(); const running = engine.run(work.id);
  try { await entered.promise; await engine.stop(work.id); release.resolve(); await running; assert.equal(engine.getWork(work.id).status, 'stopped'); assert.equal(calls.assets.length, 0); assert.equal(calls.results.length, 0); assert.equal(engine.pending.size, 0); assert.equal(calls.cancels[0].executionId, 'execution-1'); }
  finally { release.resolve(); engine.dispose(); }
});

test('a pending question is returned and the bounded execution ends before a new answer', async () => {
  const { workspace, work } = workFixture(); const { engine, client, calls } = fixture([work], workspace);
  client.agentWork.listToolCalls = async scope => scope.executionId === 'execution-1' ? [{ callId: 'question', executionId: scope.executionId, name: 'request_input', argumentsJson: '{"question":"选哪个受众？"}' }] : [];
  try { await engine.initialize(); await engine.run(work.id); assert.equal(engine.active, null); assert.equal(engine.getWork(work.id).status, 'needs-input'); assert.equal(JSON.parse(calls.results[0].resultJson).status, 'awaiting-user'); await engine.answer(work.id, '新用户'); assert.equal(calls.starts.length, 2); assert.match(calls.starts[1].prompt, /新用户/u); }
  finally { engine.dispose(); }
});

test('successive work clarifications retain the earlier answer in the third real start request', async () => {
  const { workspace, work } = workFixture();
  const unrelated = createWork(work.projectId, '另一项工作', '不属于当前工作的委托', 'brief');
  unrelated.messages = [{ messageId: 'other', executionId: 'other-execution', role: 'user', parts: [{ kind: 'text', text: '其他工作的秘密要求' }] }];
  workspace.workIds.push(unrelated.id);
  const { engine, client, calls } = fixture([work, unrelated], workspace);
  client.agentWork.listToolCalls = async ({ executionId }) => {
    const question = executionId === 'execution-1' ? '受众是谁？' : executionId === 'execution-2' ? '语气是什么？' : '';
    return question ? [{ callId: `question-${executionId}`, executionId, name: 'request_input', argumentsJson: JSON.stringify({ question }) }] : [{ callId: 'read-exchanges', executionId, name: 'read_material', argumentsJson: '{"sourceId":"work-exchanges"}' }];
  };
  try {
    await engine.initialize(); await engine.run(work.id);
    await engine.answer(work.id, '集团采购负责人');
    await engine.answer(work.id, '简洁正式');
    assert.equal(calls.starts.length, 3);
    const third = calls.starts[2];
    assert.match(third.prompt, /语气是什么.*简洁正式/u);
    const history = JSON.parse(third.work.sources.find(source => source.sourceId === 'work-exchanges').content);
    assert.equal(history.workId, work.id);
    assert.equal(history.currentAgentBinding, 'test-binding');
    assert.equal(history.exchanges.length, 2);
    assert.match(history.exchanges[1].request.text, /受众是谁.*集团采购负责人/u);
    assert.equal(history.exchanges[1].assistant, '当前搭档');
    assert.equal(history.truncated, false);
    assert.equal(third.work.sources.find(source => source.sourceId === 'work-brief').content, work.brief);
    assert.equal(JSON.stringify(third).includes('其他工作的秘密要求'), false);
    assert.equal('conversationAnchorId' in third, false);
    assert.equal(calls.results.at(-1).isError, false);
    assert.deepEqual(JSON.parse(JSON.parse(calls.results.at(-1).resultJson).content), history);
  } finally { engine.dispose(); }
});

test('an uncertain accepted execution is cancelled by its exact reference after the local runner ended', async () => {
  const { workspace, work } = workFixture(); const { engine, client, calls } = fixture([work], workspace);
  client.agentWork.get = async () => { throw new Error('one transient read failure'); };
  try {
    await engine.initialize(); await engine.run(work.id);
    assert.equal(engine.active, null); assert.equal(engine.getWork(work.id).status, 'uncertain');
    assert.equal(engine.getWork(work.id).attempts.at(-1).executionId, 'execution-1');
    await engine.stop(work.id);
    assert.deepEqual(calls.cancels, [{ agentHandle: 'test-handle', executionId: 'execution-1' }]);
    assert.equal(engine.getWork(work.id).status, 'stopped');
    assert.equal(engine.getWork(work.id).attempts.at(-1).status, 'stopped');
  } finally { engine.dispose(); }
});

for (const outcome of ['failed', 'still-running', 'agent-unavailable']) test(`Stop keeps an honest uncertain state when cancellation is ${outcome}`, async () => {
  const { workspace, work } = workFixture(); const { engine, client, calls } = fixture([work], workspace);
  client.agentWork.get = async () => { throw new Error('read failed'); };
  try {
    await engine.initialize(); await engine.run(work.id);
    if (outcome === 'agent-unavailable') client.agentWork.listReferences = async () => [];
    client.agentWork.cancel = async input => { calls.cancels.push(input); if (outcome === 'failed') throw new Error('cancel timed out'); return { executionId: input.executionId, state: 'running' }; };
    await engine.stop(work.id);
    assert.equal(engine.getWork(work.id).status, 'uncertain');
    assert.equal(engine.getWork(work.id).attempts.at(-1).status, 'uncertain');
    assert.equal(engine.getWork(work.id).attempts.at(-1).executionId, 'execution-1');
    assert.match(engine.getWork(work.id).error, /已停止本地推进.*取消尚未确认/u);
    assert.equal(calls.cancels.length, outcome === 'agent-unavailable' ? 0 : 1);
  } finally { engine.dispose(); }
});

test('stopping an old uncertain attempt uses its Agent and leaves another active execution intact', async () => {
  const { workspace, work } = workFixture(); const other = createWork(work.projectId, '另一工作', '继续实际工作', 'brief'); workspace.workIds.push(other.id);
  const { engine, client, calls } = fixture([work, other], workspace); const entered = deferred(); const release = deferred();
  client.agentWork.listReferences = async () => [
    { agentBinding: 'test-binding', agentHandle: 'test-handle', displayName: '同名搭档' },
    { agentBinding: 'other-binding', agentHandle: 'other-handle', displayName: '同名搭档' },
  ];
  client.agentWork.get = async ({ executionId }) => { if (executionId === 'execution-1') throw new Error('read failed once'); return { executionId, state: 'succeeded', outputText: '第二位搭档完成' }; };
  client.agentWork.listToolCalls = async ({ executionId }) => { if (executionId === 'execution-2') { entered.resolve(); await release.promise; } return []; };
  await engine.initialize(); await engine.run(work.id); await engine.assign('other-binding'); const running = engine.run(other.id);
  try {
    await entered.promise; await engine.stop(work.id);
    assert.deepEqual(calls.cancels, [{ agentHandle: 'test-handle', executionId: 'execution-1' }]);
    assert.equal(engine.active, other.id); assert.equal(engine.getWork(other.id).status, 'running');
    release.resolve(); await running;
    assert.equal(engine.getWork(other.id).status, 'review');
    assert.equal(engine.getWork(other.id).messages.at(-1).parts[0].text, '第二位搭档完成');
  } finally { release.resolve(); engine.dispose(); }
});

test('a terminal completion returned by cancel is not relabelled as a cancelled execution', async () => {
  const { workspace, work } = workFixture(); const { engine, client } = fixture([work], workspace);
  client.agentWork.get = async () => { throw new Error('read failed'); };
  client.agentWork.cancel = async ({ executionId }) => ({ executionId, state: 'succeeded', outputText: '已先结束' });
  try {
    await engine.initialize(); await engine.run(work.id); await engine.stop(work.id);
    assert.equal(engine.getWork(work.id).status, 'review'); assert.equal(engine.getWork(work.id).attempts.at(-1).status, 'complete');
    assert.match(engine.getWork(work.id).error, /取消前结束/u);
  } finally { engine.dispose(); }
});

test('a late failed duplicate cancel cannot erase a cancellation already confirmed by Runtime', async () => {
  const { workspace, work } = workFixture(); const { engine, client } = fixture([work], workspace); const entered = deferred(); const release = deferred(); let count = 0;
  client.agentWork.get = async () => { throw new Error('read failed'); };
  client.agentWork.cancel = async ({ executionId }) => {
    if (++count === 1) { entered.resolve(); await release.promise; throw new Error('older cancel timed out'); }
    return { executionId, state: 'cancelled' };
  };
  await engine.initialize(); await engine.run(work.id); const firstStop = engine.stop(work.id);
  try {
    await entered.promise; await engine.stop(work.id); release.resolve(); await firstStop;
    assert.equal(engine.getWork(work.id).status, 'stopped');
    assert.equal(engine.getWork(work.id).attempts.at(-1).status, 'stopped');
    assert.equal(engine.getWork(work.id).error, undefined);
  } finally { release.resolve(); engine.dispose(); }
});

test('normal busy retains the request and later submits it without changing input', async () => {
  const { workspace, work } = workFixture(); const { engine, client, calls } = fixture([work], workspace); let occupied = true;
  client.agentWork.status = async () => ({ busy: occupied, ownExecutionId: null });
  try { await engine.initialize(); await engine.run(work.id, '原材料与要求'); assert.equal(engine.getWork(work.id).status, 'queued'); assert.equal(calls.starts.length, 0); occupied = false; await new Promise(resolve => setTimeout(resolve, 1700)); assert.equal(calls.starts.length, 1); assert.equal(calls.starts[0].prompt, '原材料与要求'); }
  finally { engine.dispose(); }
});

for (const admission of ['status', 'start']) test(`busy at ${admission} preserves FIFO and the queued request through automatic retry`, async () => {
  const { workspace, work: first } = workFixture();
  const second = createWork(first.projectId, '第二项', '第二项目标', 'brief'); workspace.workIds.push(second.id);
  const { engine, client, calls } = fixture([first, second], workspace);
  let occupied = true; let checks = 0;
  const start = client.agentWork.start;
  client.agentWork.status = async () => { if (admission === 'status') checks++; return { busy: admission === 'status' && occupied, ownExecutionId: null }; };
  client.agentWork.start = async input => {
    if (admission === 'start') { checks++; if (occupied) throw Object.assign(new Error('busy'), { reasonCode: 'AGENT_BUSY' }); }
    return start(input);
  };
  const until = async predicate => {
    const deadline = Date.now() + 4000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'queue did not advance'); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  try {
    await engine.initialize();
    await engine.run(first.id, '保留第一项的追加要求', '晨间整理'); await engine.run(second.id, '第二项要求');
    const queued = structuredClone(engine.getWork(first.id).queuedInput);
    await until(() => checks >= 3);
    assert.deepEqual(engine.getWork(first.id).queuedInput, queued);
    assert.ok(queued.sequence < engine.getWork(second.id).queuedInput.sequence);
    occupied = false;
    await until(() => calls.starts.length > 0);
    assert.equal(calls.starts[0].work.workId, first.id);
    assert.equal(calls.starts[0].prompt, '保留第一项的追加要求');
    assert.equal(calls.starts[0].work.routineName, '晨间整理');
  } finally { engine.dispose(); }
});

test('scope invalidation makes late model completion unable to write App state', async () => {
  const { workspace, work } = workFixture(); const { engine, client, documents } = fixture([work], workspace); const entered = deferred(); const release = deferred();
  client.agentWork.get = async input => { entered.resolve(); await release.promise; return { executionId: input.executionId, state: 'succeeded', outputText: '过期结果', message: '', reasonCode: '' }; };
  await engine.initialize(); const running = engine.run(work.id); await entered.promise; engine.dispose(); release.resolve(); await running;
  assert.equal(documents.get(`nimigo/v1/work-${work.id}.json`).messages.some(message => message.parts[0].text === '过期结果'), false);
});

test('Activity opens only existing work and a retired handler cannot navigate or restart it', async () => {
  const { workspace, work } = workFixture(); work.status = 'stopped'; const { client, calls } = fixture([work], workspace);
  let open; const navigated = [];
  client.activity.onOpenRequest = handler => { open = handler; return { stop: async () => {} }; };
  const engine = new GoEngine(client, () => true, id => navigated.push(id));
  await engine.initialize();
  assert.equal(await open({ objectRef: work.id }), 'opened');
  assert.equal(engine.getWork(work.id).status, 'stopped');
  assert.equal(await open({ objectRef: 'missing' }), 'object-unavailable');
  engine.dispose();
  assert.equal(await open({ objectRef: work.id }), 'object-unavailable');
  assert.deepEqual(navigated, [work.id]);
  assert.equal(calls.starts.length, 0);
});

test('Stop during admission cancels the exact execution once its reference arrives', async () => {
  const { workspace, work } = workFixture(); const { engine, client, calls } = fixture([work], workspace); const entered = deferred(); const release = deferred();
  client.agentWork.start = async () => { entered.resolve(); await release.promise; return { executionId: 'late-accepted' }; };
  await engine.initialize(); const running = engine.run(work.id);
  try { await entered.promise; await engine.stop(work.id); assert.equal(engine.getWork(work.id).status, 'uncertain'); release.resolve(); await running; assert.deepEqual(calls.cancels, [{ agentHandle: 'test-handle', executionId: 'late-accepted' }]); assert.equal(engine.getWork(work.id).status, 'stopped'); assert.equal(calls.results.length, 0); }
  finally { release.resolve(); engine.dispose(); }
});

test('an unconfirmed cancel after late admission retains the execution ID for exact later recovery', async () => {
  const { workspace, work } = workFixture(); const { engine, client } = fixture([work], workspace); const entered = deferred(); const release = deferred();
  client.agentWork.start = async () => { entered.resolve(); await release.promise; return { executionId: 'late-accepted' }; };
  client.agentWork.cancel = async () => { throw new Error('cancel timed out'); };
  await engine.initialize(); const running = engine.run(work.id);
  try {
    await entered.promise; await engine.stop(work.id); release.resolve(); await running;
    assert.equal(engine.getWork(work.id).status, 'uncertain');
    assert.equal(engine.getWork(work.id).attempts.at(-1).executionId, 'late-accepted');
    assert.match(engine.getWork(work.id).error, /取消尚未确认/u);
  } finally { release.resolve(); engine.dispose(); }
});

test('Stop between admission and execution ID persistence still cancels the accepted execution', async () => {
  const { workspace, work } = workFixture(); const { engine, client, calls } = fixture([work], workspace); const entered = deferred(); const release = deferred();
  const write = client.storage.writeJson;
  client.storage.writeJson = async (path, value) => {
    if (value.attempts?.at(-1)?.executionId === 'execution-1' && value.status === 'running') { entered.resolve(); await release.promise; }
    await write(path, value);
  };
  await engine.initialize(); const running = engine.run(work.id);
  try {
    await entered.promise; const stopping = engine.stop(work.id); release.resolve(); await Promise.all([running, stopping]);
    assert.deepEqual(calls.cancels, [{ agentHandle: 'test-handle', executionId: 'execution-1' }]);
    assert.equal(engine.getWork(work.id).status, 'stopped');
    assert.equal(engine.getWork(work.id).attempts.at(-1).executionId, 'execution-1');
    assert.equal(calls.results.length, 0);
  } finally { release.resolve(); engine.dispose(); }
});

test('closing then reopening a window does not catch up a missed foreground routine', async () => {
  const { workspace, work } = workFixture(); workspace.routines = [{ id: 'daily', name: '例行', projectId: work.projectId, skillId: 'brief', brief: '目标', time: '09:00', enabled: true, nextAt: new Date(Date.now() + 60000).toISOString() }];
  const { engine, calls } = fixture([work], workspace);
  try { await engine.initialize(); engine.windowClosed(); await engine.modifyWorkspace(value => { value.routines[0].nextAt = new Date(Date.now() - 1000).toISOString(); }); await engine.checkRoutines(); assert.ok(engine.workspace.routines[0].missedAt); assert.equal(calls.starts.length, 0); }
  finally { engine.dispose(); }
});

test('scope invalidation prevents a queued settings write after its stale workspace read', async () => {
  const { workspace, work } = workFixture(); const { engine, client, documents } = fixture([work], workspace); await engine.initialize();
  const original = client.storage.readJson; const entered = deferred(); const release = deferred();
  client.storage.readJson = async path => { entered.resolve(); await release.promise; return original(path); };
  const edit = engine.modifyWorkspace(value => { value.theme = 'dark'; }); await entered.promise; engine.dispose(); release.resolve();
  await assert.rejects(edit, /失效/u); assert.equal(documents.get('nimigo/v1/workspace.json').theme, 'light');
});

test('the direct Integration read saves sourced material without an Agent execution', async () => {
  const { workspace, work } = workFixture(); workspace.agentBinding = null; work.integrationReads = [{ targetRef: 'source', operation: 'docs.read' }];
  const { engine, client, calls } = fixture([work], workspace);
  client.agentWork.listReferences = async () => [];
  client.integration.listCatalog = async () => [{ targetRef: 'source', displayName: '公开文档', available: true, permittedOperations: ['docs.read'], operations: [{ name: 'docs.read', effect: 'read', description: '读取文档', inputSchemaJson: '{}' }] }];
  client.integration.invoke = async input => { assert.deepEqual(input, { targetRef: 'source', operation: 'docs.read', inputJson: '{"path":"intro"}' }); return { callId: 'direct-read', status: 'accepted', targetDisplayName: '公开文档', accountLabel: '' }; };
  client.integration.getCall = async () => ({ callId: 'direct-read', status: 'completed', targetDisplayName: '公开文档', accountLabel: '', errorCode: '', resultJson: '{"content":[{"type":"text","text":"# 实际读取的资料"}]}' });
  try { await engine.initialize(); const material = await engine.importIntegrationMaterial(work.id, 0, { path: 'intro' }); assert.equal(engine.agent, undefined); assert.equal(calls.starts.length, 0); assert.equal(material.content, '# 实际读取的资料'); assert.equal(material.origin.integration.callId, 'direct-read'); assert.equal(engine.getWork(work.id).materials[0].id, material.id); }
  finally { engine.dispose(); }
});

test('a forged saved read selection cannot turn the direct material action into a write', async () => {
  const { workspace, work } = workFixture(); work.integrationReads = [{ targetRef: 'source', operation: 'send' }]; const { engine, client, calls } = fixture([work], workspace); let invoked = false;
  client.integration.listCatalog = async () => [{ targetRef: 'source', displayName: '消息', available: true, permittedOperations: ['send'], operations: [{ name: 'send', effect: 'write' }] }];
  client.integration.invoke = async () => { invoked = true; throw new Error('must not invoke'); };
  try { await engine.initialize(); await assert.rejects(engine.importIntegrationMaterial(work.id, 0, {})); assert.equal(invoked, false); assert.equal(calls.starts.length, 0); assert.equal(engine.getWork(work.id).materials.length, 0); }
  finally { engine.dispose(); }
});
