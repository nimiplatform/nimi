import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEditableHandoffBriefDraft,
  composeHandoffBriefPayload,
  submitZhiyuHarnessHandoff,
  type ZhiyuHandoffSubmitPayload,
} from '../src/shell/agent-chat/zhiyu-harness-handoff';
import {
  registerZhiyuHarnessHandoffIpc,
  validateZhiyuHandoffBriefPayload,
  ZHIYU_HARNESS_HANDOFF_SUBMIT_CHANNEL,
} from '../src-electron/harness-handoff-ipc';

test('C1 editable handoff brief emits strict 4-key DTO, includes only user-checked points, and never leaks raw companion transcript', async () => {
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

  // Strict 4-key DTO accepted by both standalone and bundled Zhiyu IPC hosts.
  assert.deepEqual(Object.keys(payload).sort(), ['agentHandle', 'handoffBriefText', 'requestId', 'text']);
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
        outcome: 'ACCEPTED',
        resolvedWorkSessionRef: 'ws_pc_travel_1',
        sessionKind: 'pc_work',
        ownerBodyKind: 'os.pc.workspace',
        routeReason: 'explicit_zhiyu_handoff',
        deduplicated: false,
      };
    },
  });
  assert.deepEqual(received, payload);
  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(result.resolvedWorkSessionRef, 'ws_pc_travel_1');
  assert.equal(result.ownerBodyKind, 'os.pc.workspace');
});

test('C1 shared Zhiyu handoff IPC enforces strict DTO, sender authorization, and honest DEFERRED_BODY_OFFLINE outcome', async () => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  let authorized = true;
  let capturedRequest: Record<string, unknown> | null = null;

  const reg = registerZhiyuHarnessHandoffIpc({
    ipcMain: {
      handle(channel, listener) {
        handlers.set(channel, listener as (event: unknown, payload: unknown) => Promise<unknown>);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    authorizeSender: () => authorized,
    getAgentSessionClient: () => ({
      async routeAndSubmitInput(req: Record<string, unknown>) {
        capturedRequest = req;
        return {
          outcome: 3, // ROUTE_AND_SUBMIT_OUTCOME_DEFERRED_BODY_OFFLINE
          resolvedWorkSessionRef: 'ws_deferred_1',
          sessionKind: 'pc_work',
          ownerBodyKind: 'os.pc.workspace',
          routeReason: 'body_offline_queued',
          deduplicated: false,
        };
      },
    } as never),
  });

  const handler = handlers.get(ZHIYU_HARNESS_HANDOFF_SUBMIT_CHANNEL);
  assert.ok(handler, 'expected handoff IPC handler registration');

  // Strict 4-key payload succeeds end-to-end and surfaces honest DEFERRED_BODY_OFFLINE outcome.
  const payload = composeHandoffBriefPayload({
    agentHandle: 'agent_ref_xiaoman',
    goal: '整理资料',
    points: [],
    requestId: 'req-zhiyu-ipc-1',
  });
  const res = await handler({}, payload) as Record<string, unknown>;
  assert.equal(res.outcome, 'DEFERRED_BODY_OFFLINE');
  assert.equal(res.resolvedWorkSessionRef, 'ws_deferred_1');
  assert.equal(capturedRequest?.entrySurface, 'zhiyu_handoff');
  assert.equal(capturedRequest?.trustTierHint, 'trusted');

  // Extra fields, missing keys, non-string values, & control characters are rejected fail-closed.
  assert.throws(
    () => validateZhiyuHandoffBriefPayload({ ...payload, entrySurface: 'forged' }),
    /zhiyu-handoff-invalid-brief/,
  );
  assert.throws(
    () => validateZhiyuHandoffBriefPayload({
      agentHandle: payload.agentHandle,
      requestId: payload.requestId,
      handoffBriefText: payload.handoffBriefText,
    }),
    /zhiyu-handoff-invalid-brief/,
  );
  assert.throws(
    () => validateZhiyuHandoffBriefPayload({ ...payload, text: 123 }),
    /zhiyu-handoff-invalid-brief/,
  );
  assert.throws(
    () => validateZhiyuHandoffBriefPayload({ ...payload, handoffBriefText: 'bad\u0007bell' }),
    /zhiyu-handoff-invalid-brief/,
  );

  // Unauthorized sender is rejected fail-closed.
  authorized = false;
  await assert.rejects(() => handler({}, payload), /zhiyu-handoff-sender-unauthorized/);

  reg.dispose();
  assert.equal(handlers.has(ZHIYU_HARNESS_HANDOFF_SUBMIT_CHANNEL), false);
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
