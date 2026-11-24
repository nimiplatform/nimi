import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEditableHandoffBriefDraft,
  composeHandoffBriefPayload,
  submitZhiyuHarnessHandoff,
  type ZhiyuHandoffSubmitPayload,
} from '../src/shell/agent-chat/zhiyu-harness-handoff';

test('C1 editable handoff brief includes only user-checked points and never leaks raw companion transcript', async () => {
  const draft = buildEditableHandoffBriefDraft({
    partnerName: '小满',
    currentDraft: '把五一出行计划整理成桌面文档',
    recentTopicHints: ['日期：5月1日-5月4日', '预算：5000元以内', '私密情绪吐槽（不带出）'],
  });
  assert.equal(draft.partnerName, '小满');
  assert.equal(draft.goal, '把五一出行计划整理成桌面文档');
  assert.equal(draft.points.length, 3);
  assert.match(draft.stayedInZhiyuNotice, /保留在织羽/);

  // User unchecks the private item and edits the remaining point.
  const editedPoints = draft.points.map((pt, idx) =>
    idx === 2 ? { ...pt, selected: false } : idx === 1 ? { ...pt, text: '预算：4500元含机票' } : pt,
  );

  const payload = composeHandoffBriefPayload({
    agentHandle: 'agent_ref_xiaoman',
    goal: draft.goal,
    points: editedPoints,
    extraNotes: '输出为 Markdown 表格',
    requestId: 'req-zhiyu-handoff-1',
  });

  assert.equal(payload.entrySurface, 'zhiyu_handoff');
  assert.equal(payload.trustTierHint, 'trusted');
  assert.equal(payload.requestId, 'req-zhiyu-handoff-1');
  assert.match(payload.handoffBriefText, /把五一出行计划整理成桌面文档/);
  assert.match(payload.handoffBriefText, /预算：4500元含机票/);
  assert.match(payload.handoffBriefText, /输出为 Markdown 表格/);
  assert.doesNotMatch(payload.handoffBriefText, /私密情绪吐槽/);

  let received: ZhiyuHandoffSubmitPayload | null = null;
  const result = await submitZhiyuHarnessHandoff(payload, {
    async submit(submitted) {
      received = submitted;
      return {
        resolvedWorkSessionRef: 'ws_pc_travel_1',
        sessionKind: 'pc_work',
        ownerBodyKind: 'pc_harness',
        deduplicated: false,
      };
    },
  });
  assert.deepEqual(received, payload);
  assert.equal(result.resolvedWorkSessionRef, 'ws_pc_travel_1');
  assert.equal(result.ownerBodyKind, 'pc_harness');
});

test('C1 editable handoff brief fails closed on empty brief or missing host bridge', async () => {
  assert.throws(
    () => composeHandoffBriefPayload({ agentHandle: 'agent_ref_1', goal: '   ', points: [], extraNotes: '' }),
    /请填写/,
  );
  const valid = composeHandoffBriefPayload({
    agentHandle: 'agent_ref_1',
    goal: '整理周报',
    points: [],
  });
  await assert.rejects(() => submitZhiyuHarnessHandoff(valid), /Harness 转交通道/);
});
