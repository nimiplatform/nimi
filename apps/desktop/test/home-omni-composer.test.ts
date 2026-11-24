import assert from 'node:assert/strict';
import test from 'node:test';
import { RouteAndSubmitOutcome } from '@nimiplatform/sdk/runtime/generated';
import {
  addReadOnlyAttachmentPaths,
  bindWritableWorkspaceRoot,
  buildRouteAndSubmitRequest,
  EMPTY_OMNI_ATTACHMENTS,
  isAmbiguousRouteOutcome,
  isLightQaRouteResponse,
  isPcWorkRouteResponse,
  parseBrainSessionEvent,
  parseOmniTriggerToken,
  projectSessionOverviewAttention,
  resolveEffectivePartnerMode,
  stripOmniTriggerToken,
  toggleOmniPartnerMode,
  type OmniTargetSelection,
} from '../src/shell/renderer/features/home/home-omni-composer-model.js';

test('A2 symbol trigger parser enforces strict boundaries and avoids false triggers', () => {
  // Valid triggers at index 0 or after whitespace (ASCII & fullwidth Chinese IME).
  assert.deepEqual(parseOmniTriggerToken('@张三', 3), {
    kind: 'human',
    triggerStart: 0,
    triggerEnd: 3,
    query: '张三',
  });
  assert.deepEqual(parseOmniTriggerToken('请帮我 ＠李四', 7), {
    kind: 'human',
    triggerStart: 4,
    triggerEnd: 7,
    query: '李四',
  });
  assert.deepEqual(parseOmniTriggerToken('~小满', 3), {
    kind: 'partner',
    triggerStart: 0,
    triggerEnd: 3,
    query: '小满',
  });
  assert.deepEqual(parseOmniTriggerToken('让 ～代码搭档', 7), {
    kind: 'partner',
    triggerStart: 2,
    triggerEnd: 7,
    query: '代码搭档',
  });
  assert.deepEqual(parseOmniTriggerToken('#Q3报销', 5), {
    kind: 'session',
    triggerStart: 0,
    triggerEnd: 5,
    query: 'Q3报销',
  });
  assert.deepEqual(parseOmniTriggerToken('继续 ＃合同整理', 8), {
    kind: 'session',
    triggerStart: 3,
    triggerEnd: 8,
    query: '合同整理',
  });

  // Zero false triggers for emails, ranges, paths, URL anchors, and preprocessor directives.
  assert.equal(parseOmniTriggerToken('test@nimi.ai', 12), null);
  assert.equal(parseOmniTriggerToken('发邮件给 a@b.com', 12), null);
  assert.equal(parseOmniTriggerToken('大约 3~5天', 7), null);
  assert.equal(parseOmniTriggerToken('~/docs/plan.md', 14), null);
  assert.equal(parseOmniTriggerToken('查看 ~/docs', 9), null);
  assert.equal(parseOmniTriggerToken('https://a.com#top', 17), null);
  assert.equal(parseOmniTriggerToken('#include', 8), null);
  assert.equal(parseOmniTriggerToken('  #define FOO', 9), null);

  // Stripping matched trigger preserves remaining text cleanly.
  const match = parseOmniTriggerToken('~小满', 3)!;
  assert.equal(stripOmniTriggerToken('~小满 帮我总结', match), '帮我总结');
});

test('A3 read-only attachments vs writable workspace split and partner mode auto-lock', () => {
  const partner: OmniTargetSelection = {
    kind: 'partner',
    agentHandle: 'agent_xiaoman',
    displayName: '小满',
    mode: 'zhiyu',
  };

  // Without files, Tab toggles companion <-> harness freely.
  const toggled = toggleOmniPartnerMode(partner, EMPTY_OMNI_ATTACHMENTS);
  assert.equal(toggled.kind, 'partner');
  assert.equal(toggled.mode, 'harness');
  const toggledBack = toggleOmniPartnerMode(toggled, EMPTY_OMNI_ATTACHMENTS);
  assert.equal(toggledBack.kind, 'partner');
  assert.equal(toggledBack.mode, 'zhiyu');

  // Adding a read-only attachment does NOT set workspaceWritable and locks mode to harness.
  const withReadOnly = addReadOnlyAttachmentPaths(EMPTY_OMNI_ATTACHMENTS, ['D:\\notes\\spec.pdf']);
  assert.equal(withReadOnly.workspaceWritable, false);
  assert.equal(withReadOnly.workspaceRoot, null);
  assert.deepEqual(withReadOnly.attachmentPaths, ['D:\\notes\\spec.pdf']);
  assert.equal(resolveEffectivePartnerMode('zhiyu', withReadOnly), 'harness');
  const lockedToggle = toggleOmniPartnerMode(partner, withReadOnly);
  assert.equal(lockedToggle.kind, 'partner');
  assert.equal(lockedToggle.mode, 'harness');

  // Explicit workspace authorization sets workspaceRoot + workspaceWritable=true.
  const withWorkspace = bindWritableWorkspaceRoot(withReadOnly, 'D:\\repo\\project');
  assert.equal(withWorkspace.workspaceWritable, true);
  assert.equal(withWorkspace.workspaceRoot, 'D:\\repo\\project');
});

test('FT-02 / A1 pre-session requestId, turn-2 non-promotion, file promotion, and os.pc.workspace alignment', () => {
  const activeLightQa = {
    workSessionRef: 'ws_inbox_1',
    agentHandle: 'agent_xiaoman',
    agentDisplayName: '小满',
    messages: [],
    lastSeq: 6,
    streaming: false,
    turnCount: 2,
    promotedToSessionRef: null,
    promotedHandoffTurns: 0,
    errorMessage: null,
  };

  // Normal turn 2-3 light Q&A follow-up MUST NOT send cardSourceSessionRef (otherwise Runtime promotes prematurely).
  const normalFollowUp = buildRouteAndSubmitRequest({
    requestId: 'req-stable-turn2',
    text: '再简短一点总结',
    agentHandle: 'agent_xiaoman',
    target: { kind: 'auto' },
    attachments: EMPTY_OMNI_ATTACHMENTS,
    activeLightQa,
  });
  assert.equal(normalFollowUp.requestId, 'req-stable-turn2');
  assert.equal(normalFollowUp.cardSourceSessionRef, '');
  assert.equal(normalFollowUp.cardSourceMaxSeq, '0');
  assert.equal(normalFollowUp.entrySurface, 'home_omni');

  // Attaching a file/workspace or explicitly promoting DOES send cardSourceSessionRef + cardSourceMaxSeq.
  const promotedReq = buildRouteAndSubmitRequest({
    requestId: 'req-stable-1',
    text: '把上面方案写进 plan.md',
    agentHandle: 'agent_xiaoman',
    target: { kind: 'auto' },
    attachments: addReadOnlyAttachmentPaths(EMPTY_OMNI_ATTACHMENTS, ['D:\\notes\\spec.md']),
    activeLightQa,
  });
  assert.equal(promotedReq.requestId, 'req-stable-1');
  assert.equal(promotedReq.cardSourceSessionRef, 'ws_inbox_1');
  assert.equal(promotedReq.cardSourceMaxSeq, '6');

  assert.equal(
    isAmbiguousRouteOutcome({
      outcome: RouteAndSubmitOutcome.AMBIGUOUS_CANDIDATES,
      resolvedWorkSessionRef: '',
      routeReason: 'ambiguous_short_followup',
      sessionKind: '',
      ownerBodyKind: '',
      effectivePermissionMode: '',
      outboxId: '',
      candidates: [],
      deduplicated: false,
      promotedHandoffTurns: 0,
    }),
    true,
  );
  assert.equal(
    isLightQaRouteResponse({
      outcome: RouteAndSubmitOutcome.ACCEPTED,
      resolvedWorkSessionRef: 'ws_inbox_1',
      routeReason: 'l2_general_inbox_new',
      sessionKind: 'general_inbox',
      ownerBodyKind: 'brain',
      effectivePermissionMode: 'readonly',
      outboxId: '',
      candidates: [],
      deduplicated: false,
      promotedHandoffTurns: 0,
    }),
    true,
  );
  assert.equal(
    isPcWorkRouteResponse({
      outcome: RouteAndSubmitOutcome.ACCEPTED,
      resolvedWorkSessionRef: 'ws_pc_2',
      routeReason: 'l2_workspace_new_pc_work',
      sessionKind: 'pc_work',
      ownerBodyKind: 'os.pc.workspace',
      effectivePermissionMode: 'workspace-edit',
      outboxId: 'out-1',
      candidates: [],
      deduplicated: false,
      promotedHandoffTurns: 4,
    }),
    true,
  );

  const delta = parseBrainSessionEvent({
    workSessionRef: 'ws_inbox_1',
    seq: '7',
    eventId: 'evt-7',
    eventType: 'assistant_delta',
    payloadJson: JSON.stringify({ delta: '三句总结如下：' }),
    createdAt: '2026-11-24T00:00:00Z',
    movedToWorkSessionRef: '',
  });
  assert.deepEqual(delta, { kind: 'assistant_delta', text: '三句总结如下：', seq: 7 });
});

test('Attention projection hides expired approvals and projects os.pc.workspace Harness-offline work cleanly', () => {
  const nowMs = Date.parse('2026-11-24T12:00:00Z');
  const items = projectSessionOverviewAttention({
    nowMs,
    carrierOnline: false,
    attentionItems: [
      {
        attentionId: 'att-active',
        workSessionRef: 'ws-1',
        agentBinding: 'agent-1',
        attentionKind: 'approval_pending',
        trustScope: 'owner',
        summaryJson: JSON.stringify({ title: '写入 Q3报销汇总.xlsx' }),
        expiresAt: '2026-11-25T06:00:00Z',
        updatedAt: '2026-11-24T11:00:00Z',
      },
      {
        attentionId: 'att-expired',
        workSessionRef: 'ws-old',
        agentBinding: 'agent-1',
        attentionKind: 'approval_pending',
        trustScope: 'owner',
        summaryJson: JSON.stringify({ title: '三天前的过期卡片' }),
        expiresAt: '2026-11-24T11:00:00Z',
        updatedAt: '2026-11-21T11:00:00Z',
      },
    ],
    sessions: [
      {
        workSessionRef: 'ws-offline',
        agentBinding: 'agent-1',
        sessionKind: 'pc_work',
        ownerBodyKind: 'os.pc.workspace',
        deviceId: '',
        publisherScopeKey: '',
        parentSessionRef: '',
        forkedFromSessionRef: '',
        forkedAtSeq: '0',
        isPrimaryCompanion: false,
        isGeneralInbox: false,
        title: '微信发来合同整理请求',
        status: 'active',
        trustTier: 'trusted',
        workspaceRoot: '',
        permissionMode: 'plan-readonly',
        latestReceiptJson: '',
        projectionSeq: '1',
        headSeq: '1',
        createdAt: '',
        updatedAt: '',
        archivedAt: '',
        bodyPurgePending: false,
      },
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0]?.id, 'session-attention:att-active');
  assert.equal(items[0]?.remainingLabel, '18h');
  assert.equal(items[1]?.id, 'session-offline:ws-offline');
  assert.equal(items[1]?.kind, 'body_offline');
});
