import { describe, expect, it } from 'vitest';
import { createAgentDesk } from '../src/nimiday/platform/agent-desk.js';
import { needsAiSetup } from '../src/nimiday/platform/ai-setup.js';
import { parseRecipientLines } from '../src/nimiday/domain/followup-recipients.js';
import { FollowUpEngine } from '../src/nimiday/followup/engine.js';
import { createDayFollowUpHost } from '../src-electron/followup-host.js';
import { createFakeAgentClient, handle, settle } from './fake-agent.js';

const aya = { agentHandle: handle('aya'), displayName: 'Aya', avatarUrl: null, agentBinding: `agent_binding_${'a'.repeat(43)}` };
const work = { workId: 'w1', instructions: '执行', sources: [], tools: [] };

describe('window-owned Agent work', () => {
  it('reports only the execution this window started, and labels Day\'s other work as Day\'s', async () => {
    const fake = createFakeAgentClient({ references: [aya], withWork: true });
    const reported: unknown[] = [];
    const window = createAgentDesk(fake.client, { startWork: async input => { const result = await fake.client.agentWork.start(input); reported.push({ agentHandle: input.agentHandle, executionId: result.executionId }); return result; }, onExecutionEnded: () => reported.push(null) });
    const hostWork = createAgentDesk(fake.client);
    await window.start(null); await window.appoint(aya.agentHandle as never);
    await hostWork.start(null); await hostWork.appoint(aya.agentHandle as never);

    const other = await hostWork.sendWork({ text: '跟进', requestId: 'h1', work });
    expect(other.ok).toBe(true);
    await window.reconnect(); await settle();
    expect(window.getState()).toMatchObject({ resourceBusy: true, busyWithinDay: true, activeTurnId: null });
    expect(reported).toEqual([]);

    fake.push({ type: 'turn-completed', turnId: 'turn_1' }); await settle();
    await window.reconnect(); await settle();
    expect(window.getState().resourceBusy).toBe(false);
    const own = await window.sendWork({ text: '我的问题', requestId: 'r1', work });
    expect(own.ok).toBe(true);
    expect(reported).toEqual([{ agentHandle: aya.agentHandle, executionId: 'turn_2' }]);
    await window.reconnect(); await settle();
    expect(window.getState().busyWithinDay).toBe(false);
    fake.push({ type: 'turn-completed', turnId: 'turn_2' }); await settle(); await window.reconnect(); await settle();
    expect(reported.at(-1)).toBeNull();
    await window.dispose(); await hostWork.dispose();
  });

  it('owns admission before a window disappears and cancels its late accepted result', async () => {
    const cancels: unknown[] = [];
    const host = createDayFollowUpHost(() => undefined);
    let accept!: (value: { executionId: string }) => void;
    host.bind({ agentWork: { start: () => new Promise(resolve => { accept = resolve; }), cancel: async (scope: unknown) => { cancels.push(scope); return {}; } } } as never);
    const listeners = new Map<string, () => void>();
    const sender = { id: 1, isDestroyed: () => false, on: (event: string, listener: () => void) => listeners.set(event, listener) };
    const pending = host.handlers['nimiday.desk.start']!({ payload: { input: { agentHandle: 'h', requestId: 'r1', prompt: 'test', work } }, event: { sender } } as never);
    const rejected = expect(pending).rejects.toThrow('窗口已关闭');
    listeners.get('destroyed')!();
    accept({ executionId: 'late' });
    await rejected;
    expect(cancels).toEqual([{ agentHandle: 'h', executionId: 'late' }]);
  });

  it('cancels admitted window work without cancelling other windows or Host followups', async () => {
    const cancels: unknown[] = [];
    const host = createDayFollowUpHost(() => undefined);
    let count = 0;
    host.bind({ agentWork: { start: async () => ({ executionId: `window-${++count}` }), cancel: async (scope: unknown) => { cancels.push(scope); return {}; } } } as never);
    const listeners = new Map<number, Map<string, () => void>>();
    const sender = (id: number) => ({ id, on: (event: string, listener: () => void) => { const map = listeners.get(id) ?? new Map(); map.set(event, listener); listeners.set(id, map); } });
    const start = host.handlers['nimiday.desk.start']!;
    for (const id of [1, 2]) await start({ payload: { input: { agentHandle: 'h', requestId: `r${id}`, prompt: 'test', work } }, event: { sender: sender(id) } } as never);
    await host.handlers['nimiday.desk.release']!({ payload: { executionId: 'window-2' }, event: { sender: sender(2) } } as never);
    listeners.get(2)!.get('destroyed')!();
    expect(cancels).toEqual([]);
    listeners.get(1)!.get('destroyed')!();
    await settle();
    expect(cancels).toEqual([{ agentHandle: 'h', executionId: 'window-1' }]);
  });

});

describe('arrangement recipients', () => {
  it('reports each problem at its own line and echoes the names that will be used', () => {
    const parsed = parseRecipientLines('123456 张三\n@lisi 李四\n-100200 群\n12ab 王五\n123456 重复\n\n789', index => `对象 ${index}`);
    expect(parsed.recipients).toEqual([
      { line: 1, chatId: '123456', label: '张三', named: true },
      { line: 7, chatId: '789', label: '对象 2', named: false },
    ]);
    expect(parsed.problems.map(problem => [problem.line, problem.reason])).toEqual([[2, 'username'], [3, 'group-or-channel'], [4, 'not-numeric'], [5, 'duplicate']]);
  });

  it('stops at the engine\'s limit of twenty recipients', () => {
    const lines = Array.from({ length: 21 }, (_, index) => `${index + 1} 对象${index + 1}`).join('\n');
    const parsed = parseRecipientLines(lines, index => `对象 ${index}`);
    expect(parsed.recipients).toHaveLength(20);
    expect(parsed.problems).toEqual([{ line: 21, value: '21', reason: 'too-many' }]);
  });
});

describe('setup and retry', () => {
  it('points AI configuration refusals to Nimi settings and nothing else', () => {
    expect(needsAiSetup('ai-config-not-found')).toBe(true);
    expect(needsAiSetup('AI_LOCAL_CONFIGURATION_NOT_CONFIGURED')).toBe(true);
    expect(needsAiSetup('agent-busy')).toBe(false);
    expect(needsAiSetup(undefined)).toBe(false);
  });

  it('retries a transient follow-up load in the same Host', async () => {
    let failures = 1;
    const docs = new Map<string, unknown>([['nimiday/followups/index.json', { version: 1, ids: [] }]]);
    const client = {
      storage: {
        readJson: async (path: string) => { if (failures > 0) { failures -= 1; throw new Error('storage temporarily unavailable'); } if (!docs.has(path)) throw { reasonCode: 'not-found' }; return { value: docs.get(path) }; },
        writeJson: async (path: string, value: unknown) => { docs.set(path, value); },
      },
      integration: { listCatalog: async () => [] },
      agentWork: { listReferences: async () => [] },
    };
    const engine = new FollowUpEngine(client as never);
    await engine.load();
    expect(engine.snapshot()).toMatchObject({ ready: false, error: expect.stringContaining('temporarily unavailable') });
    await engine.load();
    expect(engine.snapshot()).toMatchObject({ ready: true, error: '' });
  });
});
