import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRoutineTime, createWorkspace, createWork, attachMaterial, nextQueuedWork, projectDeliverables, reviseMaterial, reviseWorkDetails, workSources } from '../src/product/model.ts';
test('daily schedules select the next future wall-clock time, never automatic catch-up', () => {
  const after = new Date(2026, 8, 24, 10, 30);
  const next = new Date(nextRoutineTime('09:00', after));
  assert.equal(next.getDate(), 25); assert.equal(next.getHours(), 9); assert.ok(next > after);
  assert.throws(() => nextRoutineTime('25:00', after));
});
test('workspace starts with no fabricated Agent or completed task', () => {
  const state = createWorkspace(); assert.equal(state.agentBinding, null); assert.deepEqual(state.workIds, []);
  const work = createWork(state.projects[0].id, '发布简报', '根据资料完成可编辑文档', 'brief');
  assert.equal(work.status, 'draft'); assert.deepEqual(work.attempts, []); assert.deepEqual(work.deliverables, []);
  assert.throws(() => createWork(state.projects[0].id, '', 'Goal', 'brief'));
});

test('a completed Agent reply only counts as delivered after a real scoped business effect', async () => {
  const { deliveredWorkStatus } = await import('../src/product/model.ts');
  const work = createWork('project', '交付', '保存报告', 'brief');
  assert.equal(deliveredWorkStatus(work, 'turn-current'), 'review');
  work.deliverables.push({ id: 'doc', title: '旧稿', revisions: [{ id: 'v1', path: 'old.md', by: 'agent', note: '', createdAt: new Date().toISOString(), turnId: 'turn-before' }] });
  assert.equal(deliveredWorkStatus(work, 'turn-current'), 'review');
  work.deliverables[0].revisions.push({ ...work.deliverables[0].revisions[0], id: 'v2', turnId: 'turn-current' });
  assert.equal(deliveredWorkStatus(work, 'turn-current'), 'complete');
});

test('queue order follows enqueue order, independently of newest-first work display', () => {
  const first = createWork('project', '先加入', '先处理', 'brief');
  const second = createWork('project', '后加入', '后处理', 'brief');
  first.status = second.status = 'queued';
  first.queuedInput = { sequence: 1, followup: '本次补充' };
  second.queuedInput = { sequence: 2 };
  assert.equal(nextQueuedWork([second, first]).id, first.id);
  first.status = 'stopped';
  assert.equal(nextQueuedWork([second, first]).id, second.id);
  second.queuedInput = undefined;
  assert.throws(() => nextQueuedWork([second, first]), /不会自动执行/);
});

test('correcting inputs resets delivery state but retains real artifacts and execution evidence', () => {
  const work = createWork('project', '旧名', '旧目标', 'brief');
  work.status = 'complete';
  work.attempts = [{ id: 'attempt', agentBinding: 'agent', turnId: 'turn', anchorId: 'anchor', startedAt: new Date().toISOString(), status: 'complete' }];
  work.deliverables = [{ id: 'doc', title: '原稿', revisions: [{ id: 'v1', path: 'doc.md', by: 'agent', note: '', createdAt: new Date().toISOString(), turnId: 'turn' }] }];
  work.steps = [{ id: 'step', title: '旧步骤', done: true }];
  const evidence = structuredClone({ attempts: work.attempts, deliverables: work.deliverables });
  reviseWorkDetails(work, { title: '新名', brief: work.brief, projectId: 'new-project', skillId: work.skillId });
  assert.equal(work.status, 'complete');
  assert.equal(work.projectId, 'new-project');
  reviseWorkDetails(work, { title: work.title, brief: '新目标', projectId: work.projectId, skillId: 'decision' });
  assert.equal(work.status, 'draft');
  assert.deepEqual(work.steps, []);
  assert.deepEqual({ attempts: work.attempts, deliverables: work.deliverables }, evidence);
  for (const status of ['running', 'needs-input', 'queued', 'uncertain']) {
    work.status = status;
    assert.throws(() => reviseWorkDetails(work, { title: '不可修改', brief: work.brief, projectId: work.projectId, skillId: work.skillId }), /请先结束或核对/);
    assert.equal(work.title, '新名');
  }
});

test('material corrections retain source provenance and enforce limits before mutating work', () => {
  const work = createWork('project', '资料工作', '处理资料', 'brief');
  const source = { id: 'source', title: '原始摘要', content: '来源原文', createdAt: '2026-09-24T00:00:00Z', origin: { title: '来源应用', activityId: 'activity', updatedAt: '2026-09-23T00:00:00Z' } };
  attachMaterial(work, source);
  work.status = 'complete';
  const edited = reviseMaterial(work, source.id, '核对后的摘要', '用户更正后的内容');
  assert.equal(work.status, 'draft');
  assert.equal(edited.id, source.id);
  assert.equal(edited.createdAt, source.createdAt);
  assert.deepEqual(edited.origin, source.origin);
  assert.ok(edited.editedAt);
  assert.equal(source.content, '来源原文');
  assert.throws(() => reviseMaterial(work, source.id, '超限', '中'.repeat(6000)), /长度限制/);
  assert.equal(work.materials[0].content, '用户更正后的内容');
  work.status = 'running';
  assert.throws(() => attachMaterial(work, { ...source, id: 'another' }), /请先结束或核对/);
  assert.throws(() => reviseMaterial(work, source.id, '改名', '改内容'), /请先结束或核对/);
  work.status = 'draft';
  work.materials = Array.from({ length: 16 }, (_, i) => ({ ...source, id: String(i) }));
  assert.throws(() => attachMaterial(work, source), /16 份资料/);
  work.materials = Array.from({ length: 6 }, (_, i) => ({ ...source, id: String(i), content: 'a'.repeat(16000) }));
  assert.throws(() => attachMaterial(work, { ...source, content: 'a'.repeat(4000) }), /96 KiB/);
});

test('Agent context carries project constraints and revised provenance, with searchable bounded deliverables', () => {
  const workspace = createWorkspace();
  workspace.projects[0].description = '受众是工作坊主持人；每次最多四个环节。';
  const work = createWork(workspace.projects[0].id, '活动手册', '整理流程', 'brief');
  work.materials = [{ id: 'material', title: '主持提示', content: '修订稿', createdAt: new Date().toISOString(), editedAt: new Date().toISOString(), origin: { title: '来源', activityId: 'source', updatedAt: new Date().toISOString() } }];
  const other = createWork(work.projectId, '历史工作', '已交付', 'brief');
  other.archived = true;
  other.deliverables = Array.from({ length: 20 }, (_, i) => ({ id: `doc-${i}`, title: i === 0 ? '开场安排' : `报告 ${i}`, revisions: [{ id: `rev-${i}`, path: `doc-${i}.md`, by: 'agent', note: '', createdAt: new Date(2026, 8, i + 1).toISOString() }] }));
  const unrelated = createWork('other-project', '不可读取', '其他项目', 'brief');
  unrelated.deliverables = [{ ...other.deliverables[0], id: 'private' }];
  const works = [work, other, unrelated];
  const sources = workSources(work, workspace, works);
  assert.equal(sources.find(s => s.sourceId === 'project-brief').content, workspace.projects[0].description);
  const materials = JSON.parse(sources.find(s => s.sourceId === 'material-catalog').content);
  assert.match(materials[0].provenance, /用户修订稿/);
  const docs = JSON.parse(sources.find(s => s.sourceId === 'deliverable-catalog').content);
  assert.equal(docs.total, 20); assert.equal(docs.deliverables.length, 16);
  assert.match(docs.lookup, /find_deliverables/);
  assert.equal(docs.deliverables[0].deliverableId, 'doc-19');
  const found = projectDeliverables(work, works, '开场');
  assert.equal(found.length, 1); assert.equal(found[0].archived, true); assert.equal(found[0].canReviseHere, false);
  assert.ok(sources.every(source => new TextEncoder().encode(source.content).length <= 16384));
});

test('returning work prioritizes questions and recoverable failures without pretending replies are deliveries', async () => {
  const { attentionWorks, nextWorkAction } = await import('../src/product/workbench-view.ts');
  const make = status => ({ ...createWork('project', status, '目标', 'brief'), status });
  const complete = make('complete'), failed = make('failed'), question = make('needs-input'), review = make('review'), restored = make('draft');
  restored.queuedInput = { sequence: 1 };
  const actual = attentionWorks([complete, restored, review, failed, question, make('draft')]);
  assert.deepEqual(actual.map(work => work.status), ['needs-input', 'failed', 'draft', 'review']);
  assert.equal(nextWorkAction(restored), '恢复这项委托');
  assert.equal(nextWorkAction(review), '继续完成交付');
});

test('source relevance uses the public source kind, keeps owner state, and never relies on App IDs', async () => {
  const { visibleActivities, skillPresentation } = await import('../src/product/workbench-view.ts');
  const record = (kind, appId) => ({ activityId: appId, source: { kind, appId, displayName: '相关资料', sourceRef: `src_${appId}` }, title: '项目进展', summary: null, todoState: 'open', updatedAt: '2026-09-24T00:00:00Z' });
  const app = record('app', 'unfamiliar-app');
  const runtime = record('runtime-agent', 'anything');
  assert.deepEqual(visibleActivities([runtime, app]), [app]);
  assert.equal(visibleActivities([runtime, app], true).length, 2);
  assert.equal(visibleActivities([app], false, '不存在').length, 0);
  assert.equal(visibleActivities([app])[0].todoState, 'open');
  const copy = skillPresentation({ id: 'custom', instructions: 'save_deliverable request_input secret execution text' });
  assert.ok(!JSON.stringify(copy).includes('save_deliverable'));
});
