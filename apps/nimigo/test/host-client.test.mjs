import assert from 'node:assert/strict';
import test from 'node:test';
import { GoHostClient } from '../src/product/host-client.ts';
import { createWork, createWorkspace } from '../src/product/model.ts';
import { GoWorkspaceProjection, defaultWorkspaceQuery, WORKSPACE_CHANGED } from '../src/product/workspace-projection.ts';
import { createGoWorkspaceHost } from '../src-electron/workspace-host.ts';

// In-memory transport tests exercise races in the actual client and projection.
// They do not establish Desktop-supervised product acceptance.
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const workspace = createWorkspace();
  const works = ['alpha', 'beta'].map((title, i) => ({ ...createWork(workspace.projects[0].id, title, `${title} 完整目标`, 'brief'), id: title,
    messages: Array.from({ length: i ? 2 : 105 }, (_, n) => ({ messageId: `${title}-${n}`, executionId: 'execution', role: 'assistant', parts: [{ kind: 'text', text: `${title} 正文 ${n}` }] })),
  }));
  workspace.workIds = works.map(work => work.id);
  const host = { workspace, works, pending: new Map(), agents: [], activities: [], activityNextPage: null, activityLoading: false,
    worlds: [], active: null, error: '', agentError: '', ready: true, selectedWork: null, selectionVersion: 0, integrationTargets: [], revision: 1,
    snapshot() { return this.revision; }, getWork(id) { const work = this.works.find(work => work.id === id); if (!work) throw new Error('工作不存在'); return work; },
    replace(id, change) { this.works = this.works.map(work => work.id === id ? { ...work, ...change } : work); this.revision++; },
  };
  let scope = 4; let projection = new GoWorkspaceProjection(host, scope); let listener;
  const calls = [], gates = [];
  const transport = {
    async listen(event, callback) { assert.equal(event, WORKSPACE_CHANGED); listener = callback; return () => { if (listener === callback) listener = undefined; }; },
    async invoke(command, payload) {
      calls.push({ command, payload: structuredClone(payload) });
      if (command === 'nimigo.workspace.sync') {
        const result = structuredClone(projection.sync(payload));
        const gate = gates.shift(); if (gate) await gate.promise;
        return result;
      }
      if (command === 'nimigo.work.update') { host.replace(payload.args[0], payload.args[1]); listener?.(); return; }
      throw new Error(`Unselected component command: ${command}`);
    },
  };
  const client = new GoHostClient(transport);
  return { client, host, calls, transport,
    hold() { const gate = deferred(); gates.push(gate); return gate; },
    event() { listener?.(); },
    replaceScope() { projection = new GoWorkspaceProjection(host, ++scope); },
  };
}

test('idle checks do not notify React or rebuild the selected message map; events fetch current summaries', async () => {
  const f = fixture(); const { client } = f;
  let renders = 0; client.subscribe(() => renders++);
  try {
    await client.initialize(); assert.equal(client.ready, true); assert.equal(client.works.length, 2);
    await client.selectWork('alpha');
    const before = renders, messages = client.messages, detail = client.detail;
    await client.refresh(); await client.refresh();
    assert.equal(renders, before); assert.equal(client.messages, messages); assert.equal(client.detail, detail);
    f.host.replace('beta', { title: '后台已交付', deliverables: [{ id: 'doc', title: '成果', revisions: [{ id: 'revision', path: 'doc.md', createdAt: '2026-10-24T13:00:00.000Z', by: 'agent', note: '' }] }] });
    f.event(); await client.refresh();
    assert.equal(client.works.find(work => work.id === 'beta').deliverableCount, 1);
    assert.equal(client.page.recentDeliverables[0].id, 'doc');
    assert.equal(client.detail, detail, 'unrelated update must not replace selected full detail');
    assert.equal(client.messages, messages);
    assert.ok(f.calls.at(-1).payload.after);
  } finally { client.disconnect(); }
});

test('late search results cannot replace the newest search, including a failed old query', async () => {
  for (const outcome of ['success', 'failure']) {
    const f = fixture(); const { client } = f; const snapshots = [];
    try {
      await client.initialize(); client.subscribe(() => snapshots.push(client.works.map(work => work.id)));
      const gate = f.hold(); client.setQuery({ ...defaultWorkspaceQuery(), search: 'alpha' });
      client.setQuery({ ...defaultWorkspaceQuery(), search: 'beta' });
      if (outcome === 'failure') gate.reject(new Error('obsolete alpha failure')); else gate.resolve();
      await client.refresh();
      assert.deepEqual(client.works.map(work => work.id), ['beta']);
      assert.equal(client.error, ''); assert.equal(client.loading, false);
      assert.equal(snapshots.some(ids => ids.includes('alpha')), false);
      assert.equal(f.calls.at(-1).payload.query.search, 'beta');
    } finally { client.disconnect(); }
  }
});

test('switching detail during an in-flight read cannot expose the previous work or its messages', async () => {
  const f = fixture(); const { client } = f; const observed = [];
  try {
    await client.initialize(); client.subscribe(() => observed.push(client.detail?.id));
    const gate = f.hold(); const first = client.selectWork('alpha');
    const second = client.selectWork('beta');
    assert.equal(client.detail, null); assert.equal(client.messages.size, 0);
    gate.resolve(); await Promise.all([first, second]);
    assert.equal(client.detail.id, 'beta'); assert.deepEqual([...client.messages.keys()], ['beta']);
    assert.equal(observed.includes('alpha'), false); assert.equal(client.detailLoading, false);
    assert.throws(() => client.getWork('alpha'), /尚未载入/u);
  } finally { client.disconnect(); }
});

test('message navigation reaches every record and latest resumes from the actual tail', async () => {
  const { client } = fixture();
  try {
    await client.initialize(); await client.selectWork('alpha');
    assert.deepEqual(client.messagePage, { start: 65, end: 105, total: 105 });
    await client.pageMessages('older'); assert.deepEqual(client.messagePage, { start: 25, end: 65, total: 105 });
    await client.pageMessages('older'); assert.deepEqual(client.messagePage, { start: 0, end: 25, total: 105 });
    assert.equal(client.messages.get('alpha')[0].messageId, 'alpha-0');
    await client.pageMessages('newer'); assert.deepEqual(client.messagePage, { start: 25, end: 65, total: 105 });
    await client.pageMessages('latest'); assert.deepEqual(client.messagePage, { start: 65, end: 105, total: 105 });
    assert.equal(client.messages.get('alpha').at(-1).messageId, 'alpha-104');
    await client.selectWork(null); assert.equal(client.messages.size, 0); assert.equal(client.detail, null);
  } finally { client.disconnect(); }
});

test('disconnect rejects late read success and failure without restoring any old scope state', async () => {
  for (const outcome of ['success', 'failure']) {
    const f = fixture(); const { client } = f;
    try {
      await client.initialize(); await client.selectWork('alpha');
      const gate = f.hold(); const reading = client.refresh();
      client.disconnect(); const revision = client.snapshot();
      if (outcome === 'failure') gate.reject(new Error('old scope failure')); else gate.resolve();
      await reading; await tick();
      assert.equal(client.snapshot(), revision); assert.equal(client.workspace, null); assert.equal(client.ready, false);
      assert.equal(client.detail, null); assert.equal(client.detailId, null); assert.equal(client.messages.size, 0);
      assert.equal(client.error, ''); assert.equal(client.works.length, 0);
    } finally { client.disconnect(); }
  }
});

test('replacement scope clears the renderer and requires an explicit reconnect with no old detail selection', async () => {
  const f = fixture(); const { client } = f;
  try {
    await client.initialize(); await client.selectWork('alpha');
    f.replaceScope(); await client.refresh();
    assert.equal(client.ready, false); assert.equal(client.workspace, null); assert.equal(client.detailId, null);
    assert.match(client.error, /范围已变更.*重新连接/u); assert.equal(client.page.total, 0);
    await client.initialize();
    assert.equal(client.ready, true); assert.equal(client.detail, null); assert.equal(client.detailId, null);
    assert.equal(f.calls.at(-1).payload.after, undefined); assert.equal(f.calls.at(-1).payload.detail, undefined);
    assert.equal(client.error, '', 'explicit reconnect should clear a previous connection error');
  } finally { client.disconnect(); }
});

test('a prior read cannot corrupt a new lifetime even when it finishes after reconnect', async () => {
  const f = fixture(); const { client } = f;
  try {
    await client.initialize(); const gate = f.hold(); const oldRead = client.selectWork('alpha');
    client.disconnect(); f.replaceScope(); f.host.replace('beta', { title: '新范围标题' });
    await client.initialize(); await client.selectWork('beta');
    const revision = client.snapshot(); gate.resolve(); await oldRead;
    assert.equal(client.snapshot(), revision); assert.equal(client.detail.id, 'beta'); assert.equal(client.detail.title, '新范围标题');
    assert.deepEqual([...client.messages.keys()], ['beta']);
  } finally { client.disconnect(); }
});

test('a mutation while a read is pending queues a fresh read and does not lose its result', async () => {
  const f = fixture(); const { client } = f;
  try {
    await client.initialize(); await client.selectWork('alpha');
    const gate = f.hold(); const oldRead = client.refresh();
    const mutation = client.updateWorkDetails('alpha', { title: '保存后的标题', brief: '最新完整目标', projectId: f.host.workspace.projects[0].id, skillId: 'brief' });
    await tick(); gate.resolve(); await Promise.all([oldRead, mutation]);
    assert.equal(client.detail.title, '保存后的标题'); assert.equal(client.detail.brief, '最新完整目标');
    assert.equal(client.works.find(work => work.id === 'alpha').title, '保存后的标题');
  } finally { client.disconnect(); }
});

for (const action of ['query', 'invalidation']) test(`a ${action} queued in the completed read's notification microtask starts a new drain immediately`, async () => {
  const f = fixture(); const { client } = f;
  let scheduled = false;
  try {
    await client.initialize();
    const previousReads = f.calls.filter(call => call.command === 'nimigo.workspace.sync').length;
    client.subscribe(() => {
      if (scheduled || !client.works.some(work => work.title === '触发订阅更新')) return;
      scheduled = true;
      // The subscriber schedules work exactly as a renderer effect can: after
      // drain's final loop check, but before its promise's finally clears reading.
      queueMicrotask(() => {
        if (action === 'query') client.setQuery({ ...defaultWorkspaceQuery(), search: 'beta' });
        else { f.host.replace('beta', { title: '随后到达的后台成果' }); f.event(); }
      });
    });
    f.host.replace('alpha', { title: '触发订阅更新' });
    const gate = f.hold(); const reading = client.refresh(); gate.resolve();
    await reading; await tick();
    assert.equal(scheduled, true);
    assert.equal(f.calls.filter(call => call.command === 'nimigo.workspace.sync').length, previousReads + 2,
      'the queued request must run now, without another UI action or the five-second reconciliation timer');
    if (action === 'query') {
      assert.equal(client.loading, false); assert.deepEqual(client.works.map(work => work.id), ['beta']);
      assert.equal(f.calls.at(-1).payload.query.search, 'beta');
    } else assert.equal(client.works.find(work => work.id === 'beta').title, '随后到达的后台成果');
  } finally { client.disconnect(); }
});

test('a transient read error retains existing data and a subsequent current read recovers', async () => {
  const f = fixture(); const { client } = f;
  try {
    await client.initialize(); const gate = f.hold(); const pending = client.refresh(); gate.reject(new Error('暂时断开'));
    await pending; assert.equal(client.works.length, 2); assert.match(client.error, /暂时断开/u);
    client.clearError(); f.host.replace('beta', { title: '连接恢复后的更新' }); f.event(); await client.refresh();
    assert.equal(client.works.find(work => work.id === 'beta').title, '连接恢复后的更新'); assert.equal(client.error, '');
  } finally { client.disconnect(); }
});

test('the actual Host continues an accepted delivery with its window closed, and reopen reads persisted summaries without replay', { timeout: 5000 }, async () => {
  const workspace = createWorkspace(); workspace.agentBinding = 'binding';
  const work = createWork(workspace.projects[0].id, '后台组件用例', '保存一份成果', 'brief'); workspace.workIds = [work.id];
  const documents = new Map([['nimigo/v1/workspace.json', workspace], [`nimigo/v1/work-${work.id}.json`, work]]);
  const entered = deferred(), release = deferred(), published = deferred();
  const starts = [], assets = [], events = [], reopenedEvents = [];
  let windowOpen = true;
  const services = {
    storage: {
      readJson: async path => ({ value: structuredClone(documents.get(path)) }),
      writeJson: async (path, value) => { documents.set(path, structuredClone(value)); },
      assets: { write: async input => { assets.push(input); } },
    },
    agentWork: {
      listReferences: async () => [{ agentBinding: 'binding', agentHandle: 'handle', displayName: '组件 Agent', avatarUrl: null }],
      status: async () => ({ busy: false, ownExecutionId: null }),
      start: async input => { starts.push(input); return { executionId: 'accepted-execution' }; },
      listToolCalls: async () => { entered.resolve(); await release.promise; return [{ callId: 'delivery', executionId: 'accepted-execution', name: 'save_deliverable', argumentsJson: '{"title":"关窗后的成果","content":"组件测试正文"}' }]; },
      submitToolResult: async input => { assert.equal(input.isError, false); },
      get: async () => ({ executionId: 'accepted-execution', state: 'succeeded', outputText: '已保存成果', reasonCode: '', message: '' }),
    },
    activity: { onOpenRequest: () => ({ stop: async () => {} }), put: async () => { published.resolve(); } },
    integration: { registerProvider: async () => { throw new Error('provider not selected by this component fixture'); } },
    realm: {},
  };
  const host = createGoWorkspaceHost({ windowOpen: () => windowOpen, openWork: () => {} });
  const sync = (payload, target = events) => host.handlers['nimigo.workspace.sync']({ payload, sendEvent: (name, payload) => target.push({ name, payload }) });
  host.bind(services);
  try {
    const first = await sync({ query: defaultWorkspaceQuery() }); assert.equal(first.page.total, 1);
    await host.handlers['nimigo.work.run']({ payload: { args: [work.id] } });
    await entered.promise; assert.equal(starts.length, 1);
    windowOpen = false; host.windowClosed(); const closedCount = events.length;
    release.resolve(); await published.promise; await tick();
    assert.equal(events.length, closedCount, 'a closed renderer must not remain an event recipient');
    assert.equal(assets.length, 1); assert.equal(documents.get(`nimigo/v1/work-${work.id}.json`).status, 'complete');
    windowOpen = true;
    const reopened = await sync({ query: defaultWorkspaceQuery(), after: first.cursor }, reopenedEvents);
    assert.equal(reopened.page.works[0].status, 'complete'); assert.equal(reopened.page.works[0].deliverableCount, 1);
    assert.equal(reopened.page.recentDeliverables[0].title, '关窗后的成果'); assert.equal(reopened.state.active, null);
    assert.equal(starts.length, 1);
    await host.handlers['nimigo.preferences.notify']({ payload: { args: [false] } });
    assert.equal(events.length, closedCount); assert.ok(reopenedEvents.length > 0);
    for (const event of [...events, ...reopenedEvents]) assert.deepEqual(event, { name: WORKSPACE_CHANGED, payload: null });
    host.invalidate(); host.bind(services);
    const restarted = await sync({ query: defaultWorkspaceQuery() }, reopenedEvents);
    assert.equal(restarted.page.works[0].status, 'complete'); assert.equal(restarted.page.recentDeliverables[0].versionCount, 1);
    assert.equal(starts.length, 1, 'fresh Host startup must not resubmit completed work');
  } finally { release.resolve(); host.invalidate(); }
});
