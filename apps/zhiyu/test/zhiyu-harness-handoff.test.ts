import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import {
  buildEditableHandoffBriefDraft,
  composeHandoffBriefPayload,
  formatHandoffBriefPreview,
  hasZhiyuHarnessHandoffBridge,
  MAX_HANDOFF_BRIEF_CHARS,
  NAMED_HARNESS_APP_ID,
  NAMED_HARNESS_DISPLAY_NAME,
  submitZhiyuHarnessHandoff,
  type ZhiyuHandoffSubmitPayload,
  type ZhiyuHandoffSubmitResult,
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
  assert.ok(draft.points.every(point => !point.selected));
  assert.match(draft.stayedInZhiyuNotice, /保留在织羽/);

  // The user explicitly selects two points and edits the second.
  const editedPoints = draft.points.map((pt, idx) =>
    idx === 2 ? pt : { ...pt, selected: true, text: idx === 1 ? '预算：4500元含机票' : pt.text },
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

test('C1 editable handoff brief fails closed on empty brief, over-budget brief without truncation, or missing host bridge', async () => {
  assert.equal(NAMED_HARNESS_APP_ID, 'nimi.harness');
  assert.equal(NAMED_HARNESS_DISPLAY_NAME, 'Nimi Harness');
  assert.equal(hasZhiyuHarnessHandoffBridge(null), false);
  assert.equal(
    hasZhiyuHarnessHandoffBridge({ submit: async () => ({ outcome: 'ACCEPTED', resolvedWorkSessionRef: 'ws_1', sessionKind: 'pc_work', ownerBodyKind: 'os.pc.workspace', routeReason: 'ok', deduplicated: false }) }),
    true,
  );

  assert.throws(
    () => composeHandoffBriefPayload({ agentHandle: 'agent_ref_1', goal: '   ', points: [], extraNotes: '' }),
    /请填写/,
  );
  const oversizedNotes = '超'.repeat(MAX_HANDOFF_BRIEF_CHARS);
  const preview = formatHandoffBriefPreview({
    goal: '整理机密会议纪要',
    points: [],
    extraNotes: oversizedNotes,
  });
  assert.ok(preview.length > MAX_HANDOFF_BRIEF_CHARS);
  assert.throws(
    () => composeHandoffBriefPayload({
      agentHandle: 'agent_ref_1',
      goal: '整理机密会议纪要',
      points: [],
      extraNotes: oversizedNotes,
    }),
    /超过/,
  );

  const valid = composeHandoffBriefPayload({
    agentHandle: 'agent_ref_1',
    goal: '整理周报',
    points: [],
  });
  await assert.rejects(() => submitZhiyuHarnessHandoff(valid), /Harness 转交通道/);
});

// Radix and the animation scheduler select browser APIs when first imported.
const dom = new JSDOM('<button id="opener">交接简报</button><div id="root"></div>', {
  url: 'http://localhost', pretendToBeVisual: true,
});
const browserGlobals = {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
  Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, MutationObserver: dom.window.MutationObserver,
  CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
};
const originals = new Map(Object.keys(browserGlobals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(browserGlobals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
after(() => {
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

type HandoffDialogModule = typeof import('../src/shell/agent-chat/ZhiyuHarnessHandoffDialog');
let handoff: HandoffDialogModule;
before(async () => {
  handoff = await import('../src/shell/agent-chat/ZhiyuHarnessHandoffDialog');
});

async function waitForExit() {
  const deadline = Date.now() + 2000;
  while (document.querySelector('[role="dialog"]') && Date.now() < deadline) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
  }
  assert.equal(document.querySelector('[role="dialog"]'), null);
}

test('C1 ZhiyuHarnessHandoffDialog keeps draft editable across DEFERRED_BODY_OFFLINE and reopen, enforces re-confirmation on edits, and distinguishes retry vs new send', async () => {
  handoff.resetZhiyuHarnessHandoffScopesForTests();

  const submitted: ZhiyuHandoffSubmitPayload[] = [];
  const nextResponses: Array<() => Promise<ZhiyuHandoffSubmitResult>> = [];
  (dom.window as unknown as { __nimiZhiyuHarnessHandoff?: { submit(p: ZhiyuHandoffSubmitPayload): Promise<ZhiyuHandoffSubmitResult> } }).__nimiZhiyuHarnessHandoff = {
    async submit(payload) {
      submitted.push(payload);
      const handler = nextResponses.shift();
      if (!handler) {
        throw new Error('unexpected submit without mocked response');
      }
      return handler();
    },
  };

  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);

  let closeRequested = false;
  const renderDialog = async (open: boolean) => {
    await act(async () => {
      root.render(React.createElement(handoff.ZhiyuHarnessHandoffDialog, {
        open,
        partnerName: '小满',
        agentHandle: 'agent_ref_xiaoman',
        currentDraft: '整理五一出行方案',
        recentTopicHints: ['日期：5月1日-5月4日', '预算：5000元以内', '私密吐槽（不勾选）'],
        onClose: () => { closeRequested = true; },
      }));
    });
  };

  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    descriptor?.set?.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };

  try {
    const opener = document.getElementById('opener')!;
    opener.focus();
    await renderDialog(true);

    const dialog = dom.window.document.querySelector('[data-testid="zhiyu-harness-handoff-dialog"]');
    assert.ok(dialog, 'dialog should render');
    assert.equal(document.activeElement, dialog.querySelector('[aria-label="关闭交接简报"]'));
    assert.match(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent ?? '', /Nimi Harness/);
    assert.match(dialog.querySelector('[data-testid="zhiyu-handoff-recipient"]')?.textContent ?? '', /Nimi Harness \(nimi\.harness\)/);

    // Check first two points (leave private third point unchecked).
    const checkboxes = [...dialog.querySelectorAll('fieldset input[type="checkbox"]')] as HTMLInputElement[];
    assert.equal(checkboxes.length, 3);
    assert.ok(checkboxes.every((cb) => !cb.checked));
    await act(async () => { checkboxes[0].click(); });
    await act(async () => { checkboxes[1].click(); });

    const notesInput = dialog.querySelector('[data-testid="zhiyu-handoff-notes-input"]') as HTMLTextAreaElement;
    await act(async () => { setNativeValue(notesInput, '输出 Markdown 表格'); });

    // 1. Submit -> controlled DEFERRED_BODY_OFFLINE receipt.
    nextResponses.push(async () => ({
      outcome: 'DEFERRED_BODY_OFFLINE',
      resolvedWorkSessionRef: 'ws_deferred_ui_1',
      sessionKind: 'pc_work',
      ownerBodyKind: 'os.pc.workspace',
      routeReason: 'body_offline_queued',
      deduplicated: false,
    }));
    const submitBtn = () => dom.window.document.querySelector('[data-testid="zhiyu-handoff-submit"]') as HTMLButtonElement;
    await act(async () => { submitBtn().click(); });

    assert.equal(submitted.length, 1);
    const firstReqId = submitted[0].requestId;
    assert.match(submitted[0].handoffBriefText, /日期：5月1日-5月4日/);
    assert.match(submitted[0].handoffBriefText, /预算：5000元以内/);
    assert.doesNotMatch(submitted[0].handoffBriefText, /私密吐槽/);

    // Verify in-flight receipt + original payload + fieldset stays editable!
    const receiptEl = dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]');
    assert.equal(receiptEl?.getAttribute('data-outcome'), 'DEFERRED_BODY_OFFLINE');
    assert.match(receiptEl?.textContent ?? '', /ws_deferred_ui_1/);
    assert.match(receiptEl?.textContent ?? '', /Nimi Harness \(nimi\.harness\)/);
    assert.equal(
      dom.window.document.querySelector('[data-testid="zhiyu-handoff-inflight-brief"]')?.textContent,
      submitted[0].handoffBriefText,
    );
    const fieldsetAfterDeferred = dom.window.document.querySelector('fieldset') as HTMLFieldSetElement;
    assert.equal(fieldsetAfterDeferred.disabled, false, 'fieldset must remain editable after DEFERRED_BODY_OFFLINE');

    // Re-checking identical in-flight version reuses the EXACT same requestId (idempotent, no duplicate).
    nextResponses.push(async () => ({
      outcome: 'DEFERRED_BODY_OFFLINE',
      resolvedWorkSessionRef: 'ws_deferred_ui_1',
      sessionKind: 'pc_work',
      ownerBodyKind: 'os.pc.workspace',
      routeReason: 'body_offline_queued',
      deduplicated: true,
    }));
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 2);
    assert.equal(submitted[1].requestId, firstReqId, 'idempotent re-check must reuse same requestId');

    // 2. Close and reopen dialog -> selections, notes, and DEFERRED_BODY_OFFLINE receipt MUST persist!
    await act(async () => {
      document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(closeRequested, true);
    await renderDialog(false);
    await waitForExit();
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(document.activeElement, opener);
    await renderDialog(true);

    const reopenedCheckboxes = [...dom.window.document.querySelectorAll('fieldset input[type="checkbox"]')] as HTMLInputElement[];
    assert.equal(reopenedCheckboxes[0].checked, true, 'first point selection must survive close/reopen');
    assert.equal(reopenedCheckboxes[1].checked, true, 'second point selection must survive close/reopen');
    assert.equal(reopenedCheckboxes[2].checked, false, 'unchecked private point must stay unchecked');
    assert.equal((dom.window.document.querySelector('[data-testid="zhiyu-handoff-notes-input"]') as HTMLTextAreaElement).value, '输出 Markdown 表格');
    assert.equal(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]')?.getAttribute('data-outcome'), 'DEFERRED_BODY_OFFLINE');

    // 3. Edit draft after DEFERRED_BODY_OFFLINE -> requires explicit re-confirmation before submitting a new handoff!
    const goalInput = dom.window.document.querySelector('[data-testid="zhiyu-handoff-goal-input"]') as HTMLInputElement;
    await act(async () => { setNativeValue(goalInput, '整理五一出行方案（含高铁车次）'); });

    // Original in-flight payload banner must stay intact and unchanged.
    assert.equal(
      dom.window.document.querySelector('[data-testid="zhiyu-handoff-inflight-brief"]')?.textContent,
      submitted[0].handoffBriefText,
    );
    const reconfirmCheckbox = dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]') as HTMLInputElement;
    assert.ok(reconfirmCheckbox, 're-confirmation checkbox must appear for revised draft');
    assert.equal(reconfirmCheckbox.checked, false);
    assert.equal(submitBtn().disabled, true, 'submit must stay blocked until revised draft + recipient are re-confirmed');

    // Check re-confirmation -> editing again resets re-confirmation!
    await act(async () => { reconfirmCheckbox.click(); });
    assert.equal(submitBtn().disabled, false);
    await act(async () => { setNativeValue(goalInput, '整理五一出行方案（含高铁与酒店）'); });
    assert.equal((dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]') as HTMLInputElement).checked, false);
    assert.equal(submitBtn().disabled, true);

    // Confirm revised draft and submit -> first hits a transient rejection/failure!
    await act(async () => { (dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]') as HTMLInputElement).click(); });
    nextResponses.push(async () => { throw new Error('IPC 通道暂时中断'); });
    await act(async () => { submitBtn().click(); });

    assert.equal(submitted.length, 3);
    const revisedReqId = submitted[2].requestId;
    assert.notEqual(revisedReqId, firstReqId, 'revised draft must mint a brand-new requestId');
    assert.match(submitted[2].handoffBriefText, /含高铁与酒店/);
    assert.match(dom.window.document.querySelector('[data-testid="zhiyu-handoff-error"]')?.textContent ?? '', /IPC 通道暂时中断/);

    // 4. Retry unchanged revised draft after error -> MUST reuse revisedReqId (no duplicate delivery)!
    nextResponses.push(async () => ({
      outcome: 'AMBIGUOUS_CANDIDATES',
      resolvedWorkSessionRef: '',
      sessionKind: 'pc_work',
      ownerBodyKind: 'os.pc.workspace',
      routeReason: 'ambiguous',
      deduplicated: false,
    }));
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 4);
    assert.equal(submitted[3].requestId, revisedReqId, 'retry of unchanged unconfirmed draft must reuse requestId');
    assert.match(dom.window.document.querySelector('[data-testid="zhiyu-handoff-error"]')?.textContent ?? '', /多个可继续/);

    // 5. After AMBIGUOUS_CANDIDATES, clarify goal, re-confirm, and submit -> mints fresh requestId and gets ACCEPTED!
    await act(async () => { setNativeValue(goalInput, '新建独立文档：五一出行方案（含高铁与酒店）'); });
    await act(async () => { (dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]') as HTMLInputElement).click(); });
    nextResponses.push(async () => ({
      outcome: 'ACCEPTED',
      resolvedWorkSessionRef: 'ws_accepted_ui_2',
      sessionKind: 'pc_work',
      ownerBodyKind: 'os.pc.workspace',
      routeReason: 'explicit_zhiyu_handoff',
      deduplicated: false,
    }));
    await act(async () => { submitBtn().click(); });

    assert.equal(submitted.length, 5);
    assert.notEqual(submitted[4].requestId, revisedReqId, 'clarified draft after ambiguity must mint a fresh requestId');
    const acceptedReceipt = dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"][data-outcome="ACCEPTED"]');
    assert.ok(acceptedReceipt, 'ACCEPTED receipt must render');
    assert.match(acceptedReceipt.textContent ?? '', /ws_accepted_ui_2/);
  } finally {
    handoff.resetZhiyuHarnessHandoffScopesForTests();
    await act(async () => { root.unmount(); });
  }
});

test('C1 ZhiyuHarnessHandoffDialog preserves requestId and late DEFERRED_BODY_OFFLINE/ACCEPTED receipts when closed before receipt returns, scopes by account+partner, and isolates late old receipts from newer versions', async () => {
  handoff.resetZhiyuHarnessHandoffScopesForTests();

  type DeferredCall = {
    readonly payload: ZhiyuHandoffSubmitPayload;
    readonly resolve: (value: ZhiyuHandoffSubmitResult) => void;
    readonly reject: (reason?: unknown) => void;
  };
  const submitted: ZhiyuHandoffSubmitPayload[] = [];
  const pendingCalls: DeferredCall[] = [];
  // Deterministic Runtime-equivalent idempotency table keyed by (agentHandle, requestId).
  // Mirrors router.go:267 where same requestId + payload deduplicates to one task and a new
  // requestId creates a distinct task.
  const runtimeTasksByReqId = new Map<string, { ref: string; brief: string }>();
  const runtimeCreatedRefs: string[] = [];
  let autoMode: ((payload: ZhiyuHandoffSubmitPayload) => Promise<ZhiyuHandoffSubmitResult>) | null = null;

  const makeDeferredResult = (
    payload: ZhiyuHandoffSubmitPayload,
    outcome: 'DEFERRED_BODY_OFFLINE' | 'ACCEPTED' = 'DEFERRED_BODY_OFFLINE',
  ): ZhiyuHandoffSubmitResult => {
    const key = `${payload.agentHandle}::${payload.requestId}`;
    const existing = runtimeTasksByReqId.get(key);
    if (existing) {
      assert.equal(existing.brief, payload.handoffBriefText, 'reused requestId must carry identical brief text');
      return {
        outcome,
        resolvedWorkSessionRef: existing.ref,
        sessionKind: 'pc_work',
        ownerBodyKind: 'os.pc.workspace',
        routeReason: outcome === 'ACCEPTED' ? 'explicit_zhiyu_handoff' : 'body_offline_queued',
        deduplicated: true,
      };
    }
    const ref = `ws_rt_${runtimeCreatedRefs.length + 1}`;
    runtimeCreatedRefs.push(ref);
    runtimeTasksByReqId.set(key, { ref, brief: payload.handoffBriefText });
    return {
      outcome,
      resolvedWorkSessionRef: ref,
      sessionKind: 'pc_work',
      ownerBodyKind: 'os.pc.workspace',
      routeReason: outcome === 'ACCEPTED' ? 'explicit_zhiyu_handoff' : 'body_offline_queued',
      deduplicated: false,
    };
  };

  (dom.window as unknown as { __nimiZhiyuHarnessHandoff?: { submit(p: ZhiyuHandoffSubmitPayload): Promise<ZhiyuHandoffSubmitResult> } }).__nimiZhiyuHarnessHandoff = {
    submit(payload) {
      submitted.push(payload);
      if (autoMode) {
        return autoMode(payload);
      }
      return new Promise<ZhiyuHandoffSubmitResult>((resolve, reject) => {
        pendingCalls.push({ payload, resolve, reject });
      });
    },
  };

  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);

  const renderDialog = async (props: {
    open: boolean;
    accountScopeKey?: string | null;
    partnerName?: string;
    agentHandle?: string | null;
    currentDraft?: string;
    recentTopicHints?: readonly string[];
  }) => {
    await act(async () => {
      root.render(React.createElement(handoff.ZhiyuHarnessHandoffDialog, {
        open: props.open,
        accountScopeKey: props.accountScopeKey ?? 'acct_alpha',
        partnerName: props.partnerName ?? '小满',
        agentHandle: props.agentHandle === undefined ? 'agent_ref_xiaoman' : props.agentHandle,
        currentDraft: props.currentDraft ?? '整理季度复盘报告',
        recentTopicHints: props.recentTopicHints ?? ['核心指标汇总'],
        onClose: () => {},
      }));
    });
  };

  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    descriptor?.set?.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };

  const submitBtn = () => dom.window.document.querySelector('[data-testid="zhiyu-handoff-submit"]') as HTMLButtonElement;

  try {
    // === Case A: Close BEFORE DEFERRED_BODY_OFFLINE returns (prefilled unedited brief) ===
    await renderDialog({ open: true });
    assert.match(submitBtn().textContent ?? '', /确认交给 Nimi Harness/);

    // Submit with prefilled brief (no manual edits) and IMMEDIATELY close dialog before IPC resolves.
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 1);
    assert.equal(pendingCalls.length, 1);
    const req1 = submitted[0].requestId;

    await renderDialog({ open: false });
    await waitForExit();

    // DEFERRED_BODY_OFFLINE arrives while dialog is CLOSED.
    const call1 = pendingCalls.shift()!;
    await act(async () => {
      call1.resolve(makeDeferredResult(call1.payload, 'DEFERRED_BODY_OFFLINE'));
    });

    // Reopen dialog -> MUST display original DEFERRED_BODY_OFFLINE receipt and NOT revert to first-time confirm!
    await renderDialog({ open: true });
    const receiptA = dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]');
    assert.equal(receiptA?.getAttribute('data-outcome'), 'DEFERRED_BODY_OFFLINE');
    assert.match(receiptA?.textContent ?? '', /ws_rt_1/);
    assert.equal(
      dom.window.document.querySelector('[data-testid="zhiyu-handoff-inflight-brief"]')?.textContent,
      submitted[0].handoffBriefText,
    );
    assert.match(submitBtn().textContent ?? '', /重检同一版本状态/);

    // Clicking again with unchanged brief MUST reuse req1 and map to the SAME single Runtime task (ws_rt_1).
    autoMode = async (p) => makeDeferredResult(p, 'DEFERRED_BODY_OFFLINE');
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 2);
    assert.equal(submitted[1].requestId, req1, 're-submit of identical brief after close-before-receipt must reuse original requestId');
    assert.deepEqual(runtimeCreatedRefs, ['ws_rt_1'], 'Runtime must still have only ONE task for the repeated action');
    autoMode = null;

    // === Case B: Partner switch & Account switch isolation while another partner has an in-flight request ===
    // Partner B (agent_ref_lin) opens -> MUST NOT see Partner A's queued receipt or brief!
    await renderDialog({
      open: true,
      accountScopeKey: 'acct_alpha',
      partnerName: '阿林',
      agentHandle: 'agent_ref_lin',
      currentDraft: '整理后端接口文档',
    });
    assert.equal(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]'), null);
    assert.match(submitBtn().textContent ?? '', /确认交给 Nimi Harness/);

    // Partner B submits and immediately closes dialog -> switch to Partner A BEFORE Partner B's receipt returns.
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 3);
    const partnerBReq1 = submitted[2].requestId;
    assert.notEqual(partnerBReq1, req1);
    await renderDialog({ open: false, partnerName: '阿林', agentHandle: 'agent_ref_lin', currentDraft: '整理后端接口文档' });

    // Reopen Partner B BEFORE receipt returns -> MUST show awaiting-receipt status and block duplicate send.
    await renderDialog({ open: true, partnerName: '阿林', agentHandle: 'agent_ref_lin', currentDraft: '整理后端接口文档' });
    assert.ok(dom.window.document.querySelector('[data-testid="zhiyu-handoff-awaiting"]'));
    assert.equal(submitBtn().disabled, true, 'must not allow double-submit while original request is still awaiting receipt');

    // Switch to Partner A while Partner B is still pending -> Partner B resolves late while Partner A is open!
    await renderDialog({ open: true, accountScopeKey: 'acct_alpha', partnerName: '小满', agentHandle: 'agent_ref_xiaoman' });
    const callPartnerB = pendingCalls.shift()!;
    await act(async () => {
      callPartnerB.resolve(makeDeferredResult(callPartnerB.payload, 'DEFERRED_BODY_OFFLINE'));
    });

    // Partner A MUST still show only Partner A's ws_rt_1 receipt, never Partner B's ws_rt_2!
    assert.match(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]')?.textContent ?? '', /ws_rt_1/);
    assert.doesNotMatch(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]')?.textContent ?? '', /ws_rt_2/);

    // Switching back to Partner B reveals Partner B's settled ws_rt_2 receipt and reuses partnerBReq1.
    await renderDialog({ open: true, accountScopeKey: 'acct_alpha', partnerName: '阿林', agentHandle: 'agent_ref_lin', currentDraft: '整理后端接口文档' });
    assert.match(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]')?.textContent ?? '', /ws_rt_2/);
    autoMode = async (p) => makeDeferredResult(p, 'DEFERRED_BODY_OFFLINE');
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted[3].requestId, partnerBReq1);
    assert.deepEqual(runtimeCreatedRefs, ['ws_rt_1', 'ws_rt_2']);
    autoMode = null;

    // Switching account (acct_beta) with the SAME agentHandle MUST NOT leak acct_alpha's receipt!
    await renderDialog({ open: true, accountScopeKey: 'acct_beta', partnerName: '小满', agentHandle: 'agent_ref_xiaoman', currentDraft: '新账号任务' });
    assert.equal(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]'), null);
    assert.match(submitBtn().textContent ?? '', /确认交给 Nimi Harness/);

    // === Case C: Late old receipt MUST NOT attach to a revised / newer submitted version ===
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 5);
    const betaReqV1 = submitted[4].requestId;
    assert.equal(pendingCalls.length, 1);

    // User edits draft to v2 while v1 is still pending, re-confirms, and submits v2 as a brand-new task.
    const goalInput = dom.window.document.querySelector('[data-testid="zhiyu-handoff-goal-input"]') as HTMLInputElement;
    await act(async () => { setNativeValue(goalInput, '新账号任务 v2（最终版）'); });
    const reconfirm = dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]') as HTMLInputElement;
    assert.ok(reconfirm, 'editing while v1 is awaiting receipt requires explicit re-confirmation');
    assert.equal(submitBtn().disabled, true);
    await act(async () => { reconfirm.click(); });
    assert.equal(submitBtn().disabled, false);

    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 6);
    const betaReqV2 = submitted[5].requestId;
    assert.notEqual(betaReqV2, betaReqV1, 'confirmed revised draft must mint a fresh requestId');
    assert.equal(pendingCalls.length, 2);

    // v2 settles FIRST with ACCEPTED (ws_rt_3).
    const [callV1, callV2] = [pendingCalls.shift()!, pendingCalls.shift()!];
    await act(async () => {
      callV2.resolve(makeDeferredResult(callV2.payload, 'ACCEPTED'));
    });
    const acceptedV2 = dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"][data-outcome="ACCEPTED"]');
    assert.ok(acceptedV2);
    assert.match(acceptedV2.textContent ?? '', /ws_rt_3/);

    // Now old v1 arrives LATE with DEFERRED_BODY_OFFLINE (ws_rt_4) -> MUST NOT overwrite or attach to v2!
    await act(async () => {
      callV1.resolve(makeDeferredResult(callV1.payload, 'DEFERRED_BODY_OFFLINE'));
    });
    const receiptsAfterLateV1 = [...dom.window.document.querySelectorAll('[data-testid="zhiyu-handoff-receipt"]')];
    assert.equal(receiptsAfterLateV1.length, 1, 'late stale v1 receipt must not attach alongside or replace v2');
    assert.equal(receiptsAfterLateV1[0].getAttribute('data-outcome'), 'ACCEPTED');
    assert.match(receiptsAfterLateV1[0].textContent ?? '', /ws_rt_3/);
    assert.doesNotMatch(receiptsAfterLateV1[0].textContent ?? '', /ws_rt_4/);

    // === Case D: Close BEFORE ACCEPTED returns -> reopen shows unseen ACCEPTED receipt & blocks duplicate ===
    await renderDialog({ open: true, accountScopeKey: 'acct_gamma', partnerName: '小满', agentHandle: 'agent_ref_xiaoman', currentDraft: '立即关闭等确认' });
    await act(async () => { submitBtn().click(); });
    assert.equal(pendingCalls.length, 1);
    const gammaCall = pendingCalls.shift()!;
    await renderDialog({ open: false, accountScopeKey: 'acct_gamma', partnerName: '小满', agentHandle: 'agent_ref_xiaoman', currentDraft: '立即关闭等确认' });
    await act(async () => {
      gammaCall.resolve(makeDeferredResult(gammaCall.payload, 'ACCEPTED'));
    });
    // First reopen after ACCEPTED arrived while closed: user MUST see ACCEPTED receipt and submit is disabled for identical text!
    await renderDialog({ open: true, accountScopeKey: 'acct_gamma', partnerName: '小满', agentHandle: 'agent_ref_xiaoman', currentDraft: '立即关闭等确认' });
    const unseenAccepted = dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"][data-outcome="ACCEPTED"]');
    assert.ok(unseenAccepted, 'ACCEPTED receipt that arrived while closed must be shown on reopen');
    assert.equal(submitBtn().disabled, true, 'must block duplicate submit of already-accepted identical brief');
    // Closing AFTER seeing ACCEPTED and reopening starts a fresh draft cleanly.
    await renderDialog({ open: false, accountScopeKey: 'acct_gamma', partnerName: '小满', agentHandle: 'agent_ref_xiaoman', currentDraft: '下一笔新任务' });
    await renderDialog({ open: true, accountScopeKey: 'acct_gamma', partnerName: '小满', agentHandle: 'agent_ref_xiaoman', currentDraft: '下一笔新任务' });
    assert.equal(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]'), null);
    assert.equal((dom.window.document.querySelector('[data-testid="zhiyu-handoff-goal-input"]') as HTMLInputElement).value, '下一笔新任务');

    // === Case E: User edits draft to v2 (unsubmitted) while v1 is in flight -> late v1 receipt attaches strictly to v1, never to v2 ===
    await act(async () => { submitBtn().click(); });
    assert.equal(pendingCalls.length, 1);
    const gammaV1Call = pendingCalls.shift()!;
    const gammaGoalInput = dom.window.document.querySelector('[data-testid="zhiyu-handoff-goal-input"]') as HTMLInputElement;
    await act(async () => { setNativeValue(gammaGoalInput, '下一笔新任务（已改稿未提交）'); });
    await act(async () => {
      gammaV1Call.resolve(makeDeferredResult(gammaV1Call.payload, 'DEFERRED_BODY_OFFLINE'));
    });
    assert.equal(
      (dom.window.document.querySelector('[data-testid="zhiyu-handoff-goal-input"]') as HTMLInputElement).value,
      '下一笔新任务（已改稿未提交）',
      'late v1 receipt must not overwrite edited unsubmitted v2 draft',
    );
    assert.equal(
      dom.window.document.querySelector('[data-testid="zhiyu-handoff-inflight-brief"]')?.textContent,
      gammaV1Call.payload.handoffBriefText,
      'late v1 receipt must stay bound to v1 text, not v2',
    );
    assert.ok(dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]'));
    assert.equal(submitBtn().disabled, true, 'v2 must require explicit re-confirmation before sending as a new task');
  } finally {
    handoff.resetZhiyuHarnessHandoffScopesForTests();
    await act(async () => { root.unmount(); });
  }
});

test('C1 ZhiyuHarnessHandoffDialog binds unconfirmed requestId to submitted version across temporary edits, isolates late A receipt when B is confirmed, and prunes idle/settled scopes', async () => {
  handoff.resetZhiyuHarnessHandoffScopesForTests();

  type DeferredCall = {
    readonly payload: ZhiyuHandoffSubmitPayload;
    readonly resolve: (value: ZhiyuHandoffSubmitResult) => void;
    readonly reject: (reason?: unknown) => void;
  };
  const submitted: ZhiyuHandoffSubmitPayload[] = [];
  const pendingCalls: DeferredCall[] = [];
  // Test double keyed by (agentHandle, requestId) mirroring bridge request identity;
  // Runtime server-side single-enqueue authority is covered by stage2_test.go.
  const dedupedSessions = new Map<string, { ref: string; brief: string }>();
  const createdRefs: string[] = [];
  let nextMode: ((payload: ZhiyuHandoffSubmitPayload) => Promise<ZhiyuHandoffSubmitResult>) | null = null;

  const settleAs = (
    payload: ZhiyuHandoffSubmitPayload,
    outcome: 'DEFERRED_BODY_OFFLINE' | 'ACCEPTED',
  ): ZhiyuHandoffSubmitResult => {
    const key = `${payload.agentHandle}::${payload.requestId}`;
    const existing = dedupedSessions.get(key);
    if (existing) {
      assert.equal(existing.brief, payload.handoffBriefText, 'reused requestId must keep identical brief text');
      return {
        outcome,
        resolvedWorkSessionRef: existing.ref,
        sessionKind: 'pc_work',
        ownerBodyKind: 'os.pc.workspace',
        routeReason: outcome === 'ACCEPTED' ? 'explicit_zhiyu_handoff' : 'body_offline_queued',
        deduplicated: true,
      };
    }
    const ref = `ws_retry_${createdRefs.length + 1}`;
    createdRefs.push(ref);
    dedupedSessions.set(key, { ref, brief: payload.handoffBriefText });
    return {
      outcome,
      resolvedWorkSessionRef: ref,
      sessionKind: 'pc_work',
      ownerBodyKind: 'os.pc.workspace',
      routeReason: outcome === 'ACCEPTED' ? 'explicit_zhiyu_handoff' : 'body_offline_queued',
      deduplicated: false,
    };
  };

  (dom.window as unknown as { __nimiZhiyuHarnessHandoff?: { submit(p: ZhiyuHandoffSubmitPayload): Promise<ZhiyuHandoffSubmitResult> } }).__nimiZhiyuHarnessHandoff = {
    submit(payload) {
      submitted.push(payload);
      if (nextMode) {
        return nextMode(payload);
      }
      return new Promise<ZhiyuHandoffSubmitResult>((resolve, reject) => {
        pendingCalls.push({ payload, resolve, reject });
      });
    },
  };

  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);

  const renderDialog = async (props: {
    open: boolean;
    accountScopeKey?: string | null;
    partnerName?: string;
    agentHandle?: string | null;
    currentDraft?: string;
    recentTopicHints?: readonly string[];
  }) => {
    await act(async () => {
      root.render(React.createElement(handoff.ZhiyuHarnessHandoffDialog, {
        open: props.open,
        accountScopeKey: props.accountScopeKey ?? 'acct_retry',
        partnerName: props.partnerName ?? '小满',
        agentHandle: props.agentHandle === undefined ? 'agent_ref_xiaoman' : props.agentHandle,
        currentDraft: props.currentDraft ?? '整理版本发布清单',
        recentTopicHints: props.recentTopicHints ?? ['补充回归检查项'],
        onClose: () => {},
      }));
    });
  };

  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    descriptor?.set?.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };

  const submitBtn = () => dom.window.document.querySelector('[data-testid="zhiyu-handoff-submit"]') as HTMLButtonElement;

  try {
    // 0. Closed dialogs across partners/accounts allocate zero entries in handoffScopes.
    await renderDialog({ open: false, accountScopeKey: 'acct_browse_1', agentHandle: 'agent_a' });
    await renderDialog({ open: false, accountScopeKey: 'acct_browse_2', agentHandle: 'agent_b' });
    assert.equal(handoff.getZhiyuHarnessHandoffScopeCountForTests(), 0, 'closed dialogs must not allocate scope entries');

    // Open and close without edits/submissions -> pruned immediately.
    await renderDialog({ open: true, accountScopeKey: 'acct_retry', agentHandle: 'agent_ref_xiaoman' });
    assert.equal(handoff.getZhiyuHarnessHandoffScopeCountForTests(), 1);
    await renderDialog({ open: false, accountScopeKey: 'acct_retry', agentHandle: 'agent_ref_xiaoman' });
    assert.equal(handoff.getZhiyuHarnessHandoffScopeCountForTests(), 0, 'idle closed dialog scope must be pruned');

    // === Row 1: A unconfirmed -> direct retry A -> temporarily toggle point to B then revert to A (never submitting B) -> retry A ===
    await renderDialog({ open: true, accountScopeKey: 'acct_retry', agentHandle: 'agent_ref_xiaoman' });

    // Submit #1 (A) -> IPC failure (no authoritative receipt).
    nextMode = async () => { throw new Error('IPC 临时断开'); };
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 1);
    const reqA = submitted[0].requestId;
    const briefA = submitted[0].handoffBriefText;
    assert.match(submitBtn().textContent ?? '', /重试同一版本/);

    // Submit #2 (direct retry A) -> returns UNSPECIFIED (still unconfirmed).
    nextMode = async () => ({
      outcome: 'UNSPECIFIED',
      resolvedWorkSessionRef: '',
      sessionKind: 'pc_work',
      ownerBodyKind: 'os.pc.workspace',
      routeReason: 'unknown',
      deduplicated: false,
    });
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 2);
    assert.equal(submitted[1].handoffBriefText, briefA);
    assert.equal(submitted[1].requestId, reqA, 'direct retry of unconfirmed A must reuse original requestId');

    // Temporarily toggle a point ON (draft becomes B, NEVER submitted), then toggle OFF (draft returns to A).
    const pointCheckbox = dom.window.document.querySelector('fieldset input[type="checkbox"]') as HTMLInputElement;
    assert.ok(pointCheckbox);
    assert.equal(pointCheckbox.checked, false);
    await act(async () => { pointCheckbox.click(); });
    assert.equal(pointCheckbox.checked, true);
    assert.ok(
      dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]'),
      'editing away from unconfirmed A must require explicit re-confirmation before sending B',
    );
    assert.equal(submitBtn().disabled, true);

    // Revert draft back to A without ever submitting B -> re-confirmation disappears & CTA returns to retrying A.
    await act(async () => { pointCheckbox.click(); });
    assert.equal(pointCheckbox.checked, false);
    assert.equal(dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]'), null);
    assert.equal(submitBtn().disabled, false);
    assert.match(submitBtn().textContent ?? '', /重试同一版本/);

    // Submit #3 (reverted back to A) -> MUST reuse the EXACT SAME payload A and reqA!
    nextMode = async (p) => settleAs(p, 'ACCEPTED');
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 3);
    assert.equal(submitted[2].handoffBriefText, briefA, 'reverted draft must match original brief A');
    assert.equal(submitted[2].requestId, reqA, 'all three identical-payload calls for A must share one requestId');
    assert.deepEqual(createdRefs, ['ws_retry_1']);

    // Closing dialog AFTER seeing ACCEPTED prunes the completed scope immediately.
    assert.ok(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"][data-outcome="ACCEPTED"]'));
    await renderDialog({ open: false, accountScopeKey: 'acct_retry', agentHandle: 'agent_ref_xiaoman' });
    assert.equal(handoff.getZhiyuHarnessHandoffScopeCountForTests(), 0, 'settled scope with seen ACCEPTED receipt must be pruned on close');

    // === Row 2: Submit A (pending), confirm & submit distinct version B (new requestId), then A's receipt arrives BEFORE B settles ===
    nextMode = null;
    await renderDialog({ open: true, accountScopeKey: 'acct_row2', agentHandle: 'agent_ref_xiaoman', currentDraft: '版本 A 目标' });
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 4);
    const pendingReqA = submitted[3].requestId;
    assert.equal(pendingCalls.length, 1);

    // Edit to B, explicitly re-confirm, and submit B while A is still pending.
    const goalInput = dom.window.document.querySelector('[data-testid="zhiyu-handoff-goal-input"]') as HTMLInputElement;
    await act(async () => { setNativeValue(goalInput, '版本 B 目标（已确认新版本）'); });
    const reconfirm = dom.window.document.querySelector('[data-testid="zhiyu-handoff-reconfirm-checkbox"]') as HTMLInputElement;
    assert.ok(reconfirm);
    await act(async () => { reconfirm.click(); });
    await act(async () => { submitBtn().click(); });
    assert.equal(submitted.length, 5);
    const pendingReqB = submitted[4].requestId;
    assert.notEqual(pendingReqB, pendingReqA, 'confirmed version B must mint a fresh requestId');
    assert.equal(pendingCalls.length, 2);

    const [callA, callB] = [pendingCalls.shift()!, pendingCalls.shift()!];

    // Late A receipt arrives BEFORE B settles -> must belong to A only and must NOT overwrite B's awaiting state or B's draft!
    const lateReceiptA = settleAs(callA.payload, 'DEFERRED_BODY_OFFLINE');
    assert.equal(lateReceiptA.resolvedWorkSessionRef, 'ws_retry_2');
    await act(async () => { callA.resolve(lateReceiptA); });
    const awaitingB = dom.window.document.querySelector('[data-testid="zhiyu-handoff-awaiting"]');
    assert.ok(awaitingB, 'B must remain awaiting its own receipt after late A receipt arrives');
    assert.equal(awaitingB?.getAttribute('data-request-id'), pendingReqB);
    assert.equal((dom.window.document.querySelector('[data-testid="zhiyu-handoff-goal-input"]') as HTMLInputElement).value, '版本 B 目标（已确认新版本）');
    assert.equal(dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"]'), null, 'late A receipt must not render as B receipt');

    // Now B settles -> B's own ACCEPTED receipt (ws_retry_3) and draft B are shown accurately.
    await act(async () => { callB.resolve(settleAs(callB.payload, 'ACCEPTED')); });
    const receiptB = dom.window.document.querySelector('[data-testid="zhiyu-handoff-receipt"][data-outcome="ACCEPTED"]');
    assert.ok(receiptB);
    assert.match(receiptB.textContent ?? '', /ws_retry_3/);
    assert.doesNotMatch(receiptB.textContent ?? '', /ws_retry_2/);
    assert.equal((dom.window.document.querySelector('[data-testid="zhiyu-handoff-goal-input"]') as HTMLInputElement).value, '版本 B 目标（已确认新版本）');
  } finally {
    handoff.resetZhiyuHarnessHandoffScopesForTests();
    await act(async () => { root.unmount(); });
  }
});
