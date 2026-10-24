import assert from 'node:assert/strict';
import test from 'node:test';
import { createWork, createWorkspace } from '../src/product/model.ts';
import { GoWorkspaceProjection, defaultWorkspaceQuery, MESSAGE_PAGE_SIZE, WORK_PAGE_SIZE } from '../src/product/workspace-projection.ts';

// Component contract tests: these exercise the production projection, not App acceptance.
function fixture(count = 1000) {
  const workspace = createWorkspace();
  workspace.projects.push({ id: 'second-project', name: '第二项目', description: '', archived: false, createdAt: '2026-10-24T00:00:00.000Z' });
  const works = Array.from({ length: count }, (_, i) => ({
    ...createWork(i % 2 ? 'second-project' : workspace.projects[0].id, `工作 ${i}`, `${'长目标资料。'.repeat(500)}唯一词-${i}`, 'brief'),
    id: `work-${i}`, updatedAt: new Date(Date.UTC(2026, 9, 24, 0, 0, i)).toISOString(),
    messages: [{ messageId: `message-${i}`, executionId: 'execution', role: 'assistant', parts: [{ kind: 'text', text: '不应出现在摘要中的消息'.repeat(500) }] }],
    materials: [{ id: 'material', title: '资料', content: '不应出现在摘要中的资料'.repeat(500), createdAt: '2026-10-24T00:00:00.000Z' }],
  }));
  workspace.workIds = works.map(work => work.id);
  const engine = { workspace, works, pending: new Map(), agents: [], activities: [], activityNextPage: null,
    activityLoading: false, worlds: [], active: null, error: '', agentError: '', ready: true,
    selectedWork: null, selectionVersion: 0, integrationTargets: [], revision: 1,
    snapshot() { return this.revision; }, getWork(id) { const work = this.works.find(work => work.id === id); if (!work) throw new Error('工作不存在'); return work; },
    replace(id, change) { this.works = this.works.map(work => work.id === id ? { ...work, ...change } : work); this.revision++; },
  };
  return { engine, projection: new GoWorkspaceProjection(engine, 7) };
}
function query(patch = {}) { return { ...defaultWorkspaceQuery(), ...patch }; }
function document(id, revisionCount, latest) {
  return { id, title: `成果 ${id}`, revisions: Array.from({ length: revisionCount }, (_, i) => ({ id: `${id}-v${i + 1}`, path: `${id}/${i + 1}.md`, createdAt: i === revisionCount - 1 ? latest : '2026-10-23T00:00:00.000Z', by: 'user', note: '' })) };
}

for (const count of [1, 50, 500, 1000]) test(`${count} works: bounded page, no full bodies or work-ID index, unchanged response is cursor only`, () => {
  const { projection } = fixture(count);
  const result = projection.sync({ query: query() });
  assert.equal(result.page.works.length, Math.min(count, WORK_PAGE_SIZE));
  assert.equal(result.page.total, count); assert.equal(result.page.allWorkCount, count);
  assert.equal('workIds' in result.state.workspace, false);
  for (const work of result.page.works) {
    assert.equal(work.brief.length, 240);
    for (const field of ['messages', 'materials', 'attempts', 'history', 'deliverables']) assert.equal(field in work, false, field);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 80 * 1024, 'list payload must not grow with unselected work bodies');
  const unchanged = projection.sync({ query: query(), after: result.cursor });
  assert.deepEqual(unchanged, { cursor: result.cursor });
  assert.ok(Buffer.byteLength(JSON.stringify(unchanged)) < 512);
});

test('title and full brief search reach an unopened work beyond the first page', () => {
  const { projection } = fixture();
  const first = projection.sync({ query: query() });
  assert.equal(first.page.works.some(work => work.id === 'work-0'), false);
  const match = projection.sync({ query: query({ search: '唯一词-0' }), after: first.cursor });
  assert.deepEqual(match.page.works.map(work => work.id), ['work-0']);
  assert.equal(match.page.works[0].brief.includes('唯一词-0'), false, 'the match is beyond the summary excerpt');
  assert.equal(projection.catalog(query({ search: '工作 0' })).total, 1);
  assert.equal(projection.catalog(query({ projectId: 'second-project', search: '唯一词-0' })).total, 0);
  const detail = projection.sync({ query: query({ search: '唯一词-0' }), after: match.cursor, detail: { id: 'work-0', before: null } });
  assert.ok(detail.detail.work.brief.endsWith('唯一词-0'));
  assert.equal(detail.detail.work.materials.length, 1);
  assert.equal(detail.detail.messages.items[0].messageId, 'message-0');
});

test('project, archive, attention and target scopes filter the complete set before paging', () => {
  const { engine, projection } = fixture();
  for (let i = 0; i < 10; i++) engine.replace(`work-${i}`, { status: 'failed', archived: i === 0 });
  engine.replace('work-10', { status: 'draft', queuedInput: { sequence: 4, followup: '完整委托不得进入摘要' } });
  engine.replace('work-12', { status: 'needs-input', question: '需要回答', pendingRequest: { kind: 'input', question: '需要回答' } });
  const attention = projection.catalog(query({ attentionOnly: true }));
  assert.equal(attention.total, 11); assert.equal(attention.attentionCount, 11); assert.equal(attention.attention.length, 3);
  assert.equal(attention.works[0].id, 'work-12'); // the list retains updated-time ordering
  assert.equal(attention.attention[0].id, 'work-12'); // priority strip puts questions first
  assert.equal(attention.works.some(work => work.id === 'work-0'), false);
  assert.deepEqual(attention.works.find(work => work.id === 'work-10').queuedInput, { sequence: 4 });
  assert.deepEqual(projection.catalog(query({ archived: true })).works.map(work => work.id), ['work-0']);
  assert.equal(projection.catalog(query({ projectId: 'second-project', attentionOnly: true })).total, 5);
  const second = projection.catalog(query({ projectId: 'second-project', offset: 450 }));
  assert.equal(second.total, 500); assert.equal(second.works.length, 50); assert.equal(second.works.at(-1).id, 'work-1');
  const targets = projection.catalog(query({ view: 'targets', archived: true, attentionOnly: true, search: '唯一词-10' }));
  assert.equal(targets.works.some(work => work.id === 'work-10'), true, 'editable queued draft remains target despite other-view filters');
  assert.equal(projection.catalog(query({ view: 'targets', search: '唯一词-12' })).works.some(work => work.id === 'work-12'), false);
});

test('deliverable totals, versions, title search and recent ordering include unselected works', () => {
  const { engine, projection } = fixture();
  for (let i = 0; i < 125; i++) engine.replace(`work-${i}`, { deliverables: [document(`doc-${i}`, i === 0 ? 3 : 1, new Date(Date.UTC(2026, 9, 24, 0, 0, 200 - i)).toISOString())] });
  engine.replace('work-2', { archived: true });
  const page = projection.catalog(query({ view: 'deliverables' }));
  assert.equal(page.total, 124); assert.equal(page.deliverables.length, 50);
  assert.deepEqual(page.recentDeliverables.map(doc => doc.id), ['doc-0', 'doc-1', 'doc-3']);
  assert.equal(page.recentDeliverables[0].versionCount, 3);
  assert.deepEqual(projection.catalog(query({ view: 'deliverables', search: '成果 doc-124' })).deliverables.map(doc => doc.workId), ['work-124']);
  assert.equal(projection.catalog(query({ view: 'deliverables', projectId: 'second-project' })).total, 62);
  const last = projection.catalog(query({ view: 'deliverables', offset: 100 }));
  assert.equal(last.deliverables.length, 24); assert.equal(last.deliverables.at(-1).id, 'doc-124');
  assert.equal(projection.catalog(query({ search: '唯一词-0' })).works[0].deliverableCount, 1);
});

test('selected detail pages all messages and does not resend for an unrelated mutation', () => {
  const { engine, projection } = fixture(2);
  const messages = Array.from({ length: 105 }, (_, i) => ({ messageId: `m-${i}`, executionId: 'own', role: 'assistant', parts: [{ kind: 'text', text: `正文 ${i}` }] }));
  engine.replace('work-0', { messages });
  const first = projection.sync({ query: query(), detail: { id: 'work-0', before: null } });
  assert.equal('messages' in first.detail.work, false);
  assert.deepEqual({ ...first.detail.messages, items: first.detail.messages.items.length }, { items: MESSAGE_PAGE_SIZE, start: 65, end: 105, total: 105 });
  let request = { query: query(), after: first.cursor, detail: { id: 'work-0', before: null, after: first.detail.cursor } };
  assert.deepEqual(projection.sync(request), { cursor: first.cursor });
  engine.replace('work-1', { title: '另一项更新' });
  const unrelated = projection.sync(request); assert.ok(unrelated.page); assert.equal(unrelated.detail, undefined);
  const earlier = projection.sync({ query: query(), after: unrelated.cursor, detail: { ...request.detail, before: 65 } });
  assert.deepEqual(earlier.detail.messages.items.map(message => message.messageId), messages.slice(25, 65).map(message => message.messageId));
  const oldest = projection.sync({ query: query(), after: earlier.cursor, detail: { id: 'work-0', before: 25 } });
  assert.equal(oldest.detail.messages.start, 0); assert.equal(oldest.detail.messages.end, 25);
  const pending = { workId: 'work-0', question: '确认？', request: { kind: 'input', question: '确认？' } };
  engine.pending.set('work-0', pending); engine.revision++;
  const question = projection.sync(request); assert.deepEqual(question.detail.pending, pending);
  engine.pending.delete('work-0'); engine.revision++;
  const cleared = projection.sync({ ...request, detail: { ...request.detail, after: question.detail.cursor } });
  assert.ok(cleared.detail); assert.equal(cleared.detail.pending, undefined);
});

test('a background delivery replaces its summary; a replacement scope returns no old selected data', () => {
  const { engine, projection } = fixture(100);
  const initial = projection.sync({ query: query() });
  engine.replace('work-0', { status: 'complete', updatedAt: '2026-10-24T12:00:00.000Z', deliverables: [document('new-background', 2, '2026-10-24T12:00:00.000Z')] });
  const result = projection.sync({ query: query(), after: initial.cursor });
  assert.equal(result.page.works[0].id, 'work-0'); assert.equal(result.page.works[0].deliverableCount, 1);
  assert.equal(result.page.recentDeliverables[0].versionCount, 2);
  const replacement = new GoWorkspaceProjection(engine, 8);
  const obsolete = replacement.sync({ query: query(), after: result.cursor, detail: { id: 'no-longer-authorized-id', before: null } });
  assert.deepEqual(Object.keys(obsolete), ['cursor']); assert.equal(obsolete.cursor.scope, 8);
});

test('invalid queries and detail offsets are rejected rather than widening their scope', () => {
  const { projection } = fixture(1);
  for (const patch of [{ view: 'unknown' }, { offset: -1 }, { offset: 0.5 }, { search: 'a'.repeat(4097) }, { projectId: null }, { archived: 0 }]) {
    assert.throws(() => projection.sync({ query: query(patch) }), /工作列表查询无效/u);
  }
  for (const before of [-1, 0.5, '40']) assert.throws(() => projection.sync({ query: query(), detail: { id: 'work-0', before } }), /工作详情查询无效/u);
});
