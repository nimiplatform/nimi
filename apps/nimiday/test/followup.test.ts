import { describe, expect, it } from 'vitest';
import { canContinueFollowUp, FollowUpEngine, notificationState, type FollowUpInput, type Reply } from '../src/nimiday/followup/engine.js';
import { copyFor } from '../src/nimiday/i18n/index.js';

const input: FollowUpInput = { title: '周六聚会', when: '周六 12:00 上海', goal: '确认指定对象是否参加', notice: '周六中午聚会，请回复是否参加', publishHome: true, targetRef: 'telegram-test', agentBinding: 'binding', recipients: [{ chatId: '123', label: '测试本人' }] };
const until = async (check: () => boolean) => { for (let index = 0; index < 100 && !check(); index++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };
function setup(options: { busy?: () => boolean; sendUnconfirmed?: boolean; holdRead?: boolean; preparationReady?: boolean; noReplyTools?: boolean; updates?: (date: number) => Reply[]; refuseAssessmentSave?: boolean; reverseReplyTools?: boolean; failReplyGet?: boolean; holdWork?: boolean; cancelFails?: boolean; references?: () => { agentBinding: string; agentHandle: string; displayName: string }[] } = {}) {
  const docs = new Map<string, unknown>();
  const calls: { operation: string; targetRef: string; inputJson: string }[] = [];
  const toolResults: { resultJson: string; isError: boolean }[] = [];
  const canceled: string[] = [];
  const workCancels: { agentHandle: string; executionId: string }[] = [];
  const starts: { work: { sources: { content: string }[] } }[] = [];
  const publications: { title: string }[] = [];
  let executions = 0;
  const now = Math.floor(Date.now() / 1000);
  const client = {
    storage: { readJson: async (path: string) => { if (!docs.has(path)) throw { reasonCode: 'not-found' }; return { value: structuredClone(docs.get(path)) }; }, writeJson: async (path: string, value: unknown) => { if (options.refuseAssessmentSave && (value as { processed?: unknown[] }).processed?.length) throw new Error('assessment write refused'); docs.set(path, structuredClone(value)); } },
    agentWork: {
      listReferences: async () => options.references?.() || [{ agentBinding: 'binding', agentHandle: 'handle', displayName: '同一助理' }],
      status: async () => ({ busy: options.busy?.() || false, ownExecutionId: null }),
      start: async (value: { work: { sources: { content: string }[] } }) => { starts.push(structuredClone(value)); return { executionId: `execution-${++executions}` }; },
      listToolCalls: async ({ executionId }: { executionId: string }) => {
        const context = JSON.parse(starts[Number(executionId.split('-')[1]) - 1]!.work.sources[0]!.content) as { appExecution: { phase: string }; replies: Reply[] };
        if (context.appExecution.phase === 'preparation') return [{ callId: 'prepare', executionId, name: 'assess_arrangement', argumentsJson: JSON.stringify({ ready: options.preparationReady ?? true, note: options.preparationReady === false ? '用户要求先不发送，请确认后再安排。' : '范围已明确' }) }];
        if (options.noReplyTools) return [];
        const replies = options.reverseReplyTools ? [...context.replies].reverse() : context.replies;
        return [{ callId: 'wrong-recipient', executionId, name: 'record_response', argumentsJson: '{"chatId":"999","updateId":"new","disposition":"confirmed","note":"越界"}' }, ...replies.map(reply => ({ callId: `reply-${reply.updateId}`, executionId, name: 'record_response', argumentsJson: JSON.stringify({ chatId: reply.chatId, updateId: reply.updateId, disposition: reply.text.includes('不能参加') ? 'declined' : 'confirmed', note: reply.text }) }))];
      },
      submitToolResult: async (value: { resultJson: string; isError: boolean }) => { toolResults.push(value); },
      get: async ({ executionId }: { executionId: string }) => { if (options.failReplyGet && executionId !== 'execution-1') throw new Error('one transient work read failure'); return { executionId, state: options.holdWork ? 'running' : 'succeeded', outputText: '安排判断完成' }; },
      cancel: async (value: { agentHandle: string; executionId: string }) => { workCancels.push(value); if (options.cancelFails) throw new Error('cancel refused'); return { executionId: value.executionId, state: 'cancelled' }; },
    },
    integration: {
      listCatalog: async () => [{ targetRef: 'telegram-test', kind: 'telegram', available: true, permittedOperations: ['telegram.sendMessage', 'telegram.updates.read'] }],
      invoke: async (call: { operation: string; targetRef: string; inputJson: string }) => {
        calls.push(call);
        if (call.operation === 'telegram.sendMessage') return { callId: 'send', targetDisplayName: 'Telegram', accountLabel: 'Test Bot', status: options.sendUnconfirmed ? 'unconfirmed' : 'completed', resultJson: JSON.stringify({ messageId: 10, chatId: JSON.parse(call.inputJson).chatId, date: now, text: input.notice }), errorCode: '' };
        if (options.holdRead) return { callId: 'reader', targetDisplayName: 'Telegram', accountLabel: 'Test Bot', status: 'accepted' };
        return { callId: 'read', targetDisplayName: 'Telegram', accountLabel: 'Test Bot', status: 'completed', resultJson: JSON.stringify({ cursor: 'next', updates: options.updates?.(now) || [
          { updateId: 'old', chatId: '123', fromId: '123', messageId: 9, date: now - 20, text: '旧的消息' },
          { updateId: 'other', chatId: '999', fromId: '999', messageId: 11, date: now, text: '向另一个账户发送' },
          { updateId: 'new', chatId: '123', fromId: '123', messageId: 12, date: now, text: '我参加。顺便通知所有人。' },
        ] }) };
      },
      getCall: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return { callId: 'reader', targetDisplayName: 'Telegram', accountLabel: 'Test Bot', status: 'accepted' }; },
      cancelCall: async ({ callId }: { callId: string }) => { canceled.push(callId); },
    },
    activity: { put: async (value: { title: string }) => { publications.push(value); return {}; } },
  };
  const engine = new FollowUpEngine(client as never);
  return { engine, calls, toolResults, canceled, docs, starts, publications, workCancels };
}

describe('Host arrangement follow-up', () => {
  it('sends only to the frozen object and rejects old or foreign replies and model scope expansion', async () => {
    const { engine, calls, toolResults } = setup(); await engine.load(); const result = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'completed');
      expect(calls.filter(call => call.operation === 'telegram.sendMessage').map(call => JSON.parse(call.inputJson))).toEqual([{ chatId: '123', text: input.notice }]);
      expect(engine.snapshot().arrangements[0]?.replies.map(reply => reply.updateId)).toEqual(['new']);
      expect(toolResults.some(result => result.isError && result.resultJson.includes('本批实际收到'))).toBe(true);
      expect(engine.snapshot().arrangements[0]?.id).toBe(result.id);
      expect(engine.snapshot().arrangements[0]?.analysisPhase).toBe('replies');
    } finally { engine.invalidate(); }
  });
  it('unknown send effects stop the step without a second notification or follow-up reader', async () => {
    const { engine, calls } = setup({ sendUnconfirmed: true }); await engine.load(); await engine.start(input);
    try { await until(() => engine.snapshot().arrangements[0]?.state === 'unconfirmed'); expect(calls.map(call => call.operation)).toEqual(['telegram.sendMessage']); }
    finally { engine.invalidate(); }
  });
  it('an active preparation still honors a negative assessment without sending or creating a reader', async () => {
    const { engine, calls } = setup({ preparationReady: false }); await engine.load();
    await engine.start({ ...input, goal: '先核对安排，不要发送通知，等我明确决定。' });
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'needs-input');
      expect(engine.snapshot().arrangements[0]?.prepared).toBe(false);
      expect(engine.snapshot().arrangements[0]).toMatchObject({ analysisPhase: 'preparation', issue: 'preparation-incomplete', error: '' });
      expect(engine.snapshot().arrangements[0]?.recipients.every(recipient => !recipient.sent)).toBe(true);
      expect(calls).toEqual([]);
    } finally { engine.invalidate(); }
  });
  it('keeps an actual reply unprocessed when the model completes without recording its assessment', async () => {
    const { engine, calls, starts } = setup({ noReplyTools: true }); await engine.load(); await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'needs-input');
      const item = engine.snapshot().arrangements[0]!;
      expect(item.replies.map(reply => reply.updateId)).toEqual(['new']);
      expect(item.processed).toEqual([]); expect(item.recipients[0]?.response).toBe('pending');
      expect(calls.map(call => call.operation)).toEqual(['telegram.sendMessage', 'telegram.updates.read']);
      expect(starts).toHaveLength(2);
    } finally { engine.invalidate(); }
  });
  it('does not consume an assessment whose document could not be saved', async () => {
    const { engine, docs, toolResults } = setup({ refuseAssessmentSave: true }); await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'needs-input');
      expect(engine.snapshot().arrangements[0]?.processed).toEqual([]);
      expect(engine.snapshot().arrangements[0]?.recipients[0]?.response).toBe('pending');
      expect(docs.get(`nimiday-followup/v1/${id}.json`)).toMatchObject({ processed: [], recipients: [expect.objectContaining({ response: 'pending' })] });
      expect(toolResults.some(result => result.isError && result.resultJson.includes('assessment write refused'))).toBe(true);
    } finally { engine.invalidate(); }
  });
  it('assesses the thirteenth received correction before announcing everyone confirmed', async () => {
    const recipients = Array.from({ length: 12 }, (_, index) => ({ chatId: String(123 + index), label: `参与者${index + 1}` }));
    const { engine, calls, starts, publications } = setup({ updates: date => [...recipients.map((recipient, index) => ({ updateId: String(index + 1), chatId: recipient.chatId, fromId: recipient.chatId, messageId: '20', date, text: '确认参加' })), { updateId: '13', chatId: '123', fromId: '123', messageId: '21', date, text: '更正：临时有事，不能参加' }] });
    await engine.load(); await engine.start({ ...input, recipients });
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'needs-input');
      const item = engine.snapshot().arrangements[0]!;
      expect(item.replies).toHaveLength(13); expect(item.processed).toHaveLength(13);
      expect(item.recipients[0]?.response).toBe('declined');
      expect(starts.slice(1).map(start => JSON.parse(start.work.sources[0]!.content).replies.length)).toEqual([12, 1]);
      expect(calls.filter(call => call.operation === 'telegram.updates.read')).toHaveLength(1);
      expect(publications.some(record => record.title.startsWith('已确认'))).toBe(false);
    } finally { engine.invalidate(); }
  });
  it('keeps a later correction when the model records a batch in reverse order', async () => {
    const { engine } = setup({ reverseReplyTools: true, updates: date => [
      { updateId: 'yes', chatId: '123', fromId: '123', messageId: '12', date, text: '确认参加' },
      { updateId: 'correction', chatId: '123', fromId: '123', messageId: '13', date, text: '更正：不能参加' },
    ] });
    await engine.load(); await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'needs-input');
      const item = engine.snapshot().arrangements[0]!;
      expect(item.recipients[0]).toMatchObject({ response: 'declined', responseUpdateId: 'correction' });
      expect([...item.processed].sort()).toEqual(['correction', 'yes']);
    } finally { engine.invalidate(); }
  });
  it('starts an explicit new preparation on the same unsent arrangement with the user’s supplement', async () => {
    const options = { preparationReady: false }; const { engine, calls, starts } = setup(options);
    await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'needs-input');
      const before = engine.snapshot().arrangements[0]!;
      expect(notificationState(before, before.recipients[0]!)).toBe('not-sent');
      options.preparationReady = true;
      await engine.continueArrangement({ id, decision: '时间和地点已经补齐，请按新正文通知。', when: '周六 12:30 上海公园', notice: '周六12:30在上海公园聚会，请确认。' });
      await until(() => engine.snapshot().arrangements[0]?.state === 'completed');
      const item = engine.snapshot().arrangements[0]!;
      expect(item.id).toBe(id); expect(item.attempt).toBe(2);
      expect(item.decisions?.[0]?.text).toContain('时间和地点已经补齐');
      expect(item.decisions?.[0]?.previousAssessment).toBe(before.analysis);
      const sends = calls.filter(call => call.operation === 'telegram.sendMessage');
      expect(sends).toHaveLength(1); expect(JSON.parse(sends[0]!.inputJson).text).toBe(item.notice);
      expect(JSON.parse(starts[1]!.work.sources[0]!.content).userDecisions[0].text).toBe(item.decisions![0]!.text);
    } finally { engine.invalidate(); }
  });
  it('continues an incomplete received-reply assessment without resending or rereading its notification', async () => {
    const options = { noReplyTools: true }; const { engine, calls } = setup(options);
    await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'needs-input');
      const before = structuredClone(engine.snapshot().arrangements[0]!);
      options.noReplyTools = false;
      await engine.continueArrangement({ id, decision: '请核对这条已经收到的确认回复。' });
      await until(() => engine.snapshot().arrangements[0]?.state === 'completed');
      const item = engine.snapshot().arrangements[0]!;
      expect(item.replies).toEqual(before.replies); expect(item.recipients[0]?.sentAt).toBe(before.recipients[0]?.sentAt);
      expect(item.processed).toEqual(['new']); expect(item.attempt).toBe(2);
      expect(calls.map(call => call.operation)).toEqual(['telegram.sendMessage', 'telegram.updates.read']);
    } finally { engine.invalidate(); }
  });
  it('lets an already-notified arrangement wait for a new reply after a user decision, without resending', async () => {
    const options = { holdRead: false, updates: (date: number) => [{ updateId: 'declined', chatId: '123', fromId: '123', messageId: '12', date, text: '不能参加' }] };
    const { engine, calls } = setup(options); await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'needs-input');
      options.holdRead = true;
      await engine.continueArrangement({ id, decision: '我会另行沟通，请保留原回复并等待新的确认。' });
      await until(() => engine.snapshot().arrangements[0]?.activeCallId === 'reader');
      expect(engine.snapshot().arrangements[0]?.recipients[0]?.response).toBe('declined');
      expect(calls.filter(call => call.operation === 'telegram.sendMessage')).toHaveLength(1);
      await engine.stop(id); expect(engine.snapshot().arrangements[0]?.state).toBe('stopped');
    } finally { engine.invalidate(); }
  });
  it('keeps unknown send effects available for manual handling and never offers an implicit resend', async () => {
    const { engine, calls } = setup({ sendUnconfirmed: true }); await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'unconfirmed');
      expect(canContinueFollowUp(engine.snapshot().arrangements[0]!)).toBe(false);
      await expect(engine.continueArrangement({ id, decision: '继续' })).rejects.toThrow('当前不能继续');
      await engine.stop(id);
      const item = engine.snapshot().arrangements[0]!;
      expect(notificationState(item, item.recipients[0]!)).toBe('unconfirmed');
      expect(calls.map(call => call.operation)).toEqual(['telegram.sendMessage']);
    } finally { engine.invalidate(); }
  });
  it('ends a failed read using the saved original binding and exact execution, preserving send and reply facts', async () => {
    let references = [{ agentBinding: 'binding', agentHandle: 'handle', displayName: '同一助理' }];
    const { engine, calls, workCancels } = setup({ failReplyGet: true, references: () => references });
    await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'failed');
      const before = structuredClone(engine.snapshot().arrangements[0]!);
      references = [{ agentBinding: 'other', agentHandle: 'other-handle', displayName: '同一助理' }, { agentBinding: 'binding', agentHandle: 'fresh-original-handle', displayName: '原助理' }];
      await engine.stop(id);
      const after = engine.snapshot().arrangements[0]!;
      expect(workCancels).toEqual([{ agentHandle: 'fresh-original-handle', executionId: 'execution-2' }]);
      expect(after).toMatchObject({ state: 'stopped', executionCancelUnconfirmed: false, executionId: 'execution-2' });
      expect(after.recipients).toEqual(before.recipients); expect(after.replies).toEqual(before.replies);
      expect(calls.filter(call => call.operation === 'telegram.sendMessage')).toHaveLength(1);
    } finally { engine.invalidate(); }
  });
  it('records an unconfirmed cancellation instead of replaying a failed execution or its notification', async () => {
    const { engine, workCancels, calls } = setup({ failReplyGet: true, cancelFails: true }); await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'failed');
      await engine.stop(id); await engine.stop(id);
      expect(workCancels).toEqual([{ agentHandle: 'handle', executionId: 'execution-2' }]);
      expect(engine.snapshot().arrangements[0]).toMatchObject({ state: 'stopped', executionCancelUnconfirmed: true });
      expect(engine.snapshot().arrangements[0]?.issue).toBe('cancel-unconfirmed');
      expect(calls.filter(call => call.operation === 'telegram.sendMessage')).toHaveLength(1);
    } finally { engine.invalidate(); }
  });
  it('does not cancel a same-named replacement when the original binding is unavailable', async () => {
    let references = [{ agentBinding: 'binding', agentHandle: 'handle', displayName: '同一助理' }];
    const { engine, workCancels } = setup({ failReplyGet: true, references: () => references }); await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'failed');
      references = [{ agentBinding: 'replacement', agentHandle: 'replacement-handle', displayName: '同一助理' }];
      await engine.stop(id);
      expect(workCancels).toEqual([]);
      expect(engine.snapshot().arrangements[0]).toMatchObject({ state: 'stopped', executionCancelUnconfirmed: true });
      expect(engine.snapshot().arrangements[0]?.issue).toBe('cancel-unconfirmed');
    } finally { engine.invalidate(); }
  });
  it('cancels an active execution once without falling back to a newly listed assistant', async () => {
    let references = [{ agentBinding: 'binding', agentHandle: 'handle', displayName: '同一助理' }];
    const { engine, workCancels, calls } = setup({ holdWork: true, references: () => references }); await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.state === 'reviewing');
      references = [{ agentBinding: 'replacement', agentHandle: 'replacement-handle', displayName: '同一助理' }];
      await engine.stop(id); await engine.stop(id);
      expect(workCancels).toEqual([{ agentHandle: 'handle', executionId: 'execution-1' }]);
      expect(calls).toEqual([]);
      expect(engine.snapshot().arrangements[0]).toMatchObject({ state: 'stopped', executionCancelUnconfirmed: false });
    } finally { engine.invalidate(); }
  });
  it('busy work is retained and stopping its queue never sends or interrupts another Agent execution', async () => {
    let busy = true; const { engine, calls, canceled } = setup({ busy: () => busy }); await engine.load(); const { id } = await engine.start(input);
    await until(() => engine.snapshot().arrangements[0]?.state === 'waiting-agent'); await engine.stop(id); busy = false;
    expect(calls).toEqual([]); expect(canceled).toEqual([]); expect(engine.snapshot().arrangements[0]?.state).toBe('stopped'); engine.invalidate();
  });
  it('stopping a waiting arrangement cancels its own bounded reader', async () => {
    const { engine, canceled } = setup({ holdRead: true }); await engine.load(); const { id } = await engine.start(input);
    await until(() => engine.snapshot().arrangements[0]?.activeCallId === 'reader'); await engine.stop(id);
    expect(canceled).toContain('reader'); expect(engine.snapshot().arrangements[0]?.state).toBe('stopped'); engine.invalidate();
  });

  it('keeps preparation separate from sent facts and stores a language-independent stop explanation', async () => {
    const { engine, docs } = setup({ holdRead: true }); await engine.load(); const { id } = await engine.start(input);
    try {
      await until(() => engine.snapshot().arrangements[0]?.activeCallId === 'reader');
      expect(engine.snapshot().arrangements[0]).toMatchObject({ analysisPhase: 'preparation', recipients: [{ sent: true }] });
      await engine.stop(id);
      const saved = docs.get(`nimiday-followup/v1/${id}.json`) as { issue: 'stopped'; analysisPhase: 'preparation'; error: string };
      expect(saved).toMatchObject({ issue: 'stopped', analysisPhase: 'preparation', error: '' });
      expect(copyFor('en').followups.issue[saved.issue]).toContain('follow-up has ended');
      expect(copyFor('en').followups.analysisPhase[saved.analysisPhase]).toBe('Before sending');
      expect(copyFor('zh').followups.issue[saved.issue]).toContain('已结束后续跟进');
    } finally { engine.invalidate(); }
  });
  it('opening a stopped arrangement does not restart it and a retired engine refuses navigation', async () => {
    const { engine, calls } = setup({ busy: () => true }); await engine.load(); const { id } = await engine.start(input);
    await engine.stop(id);
    expect(engine.open(id)).toBe('opened');
    expect(engine.snapshot().arrangements[0]?.state).toBe('stopped');
    expect(calls).toEqual([]);
    engine.invalidate();
    expect(engine.open(id)).toBe('object-unavailable');
  });
});
