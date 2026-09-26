// Test-only independent business execution port. Canonical chat is intentionally absent.
import type { NimiLocalAppAgentWorkEvent, NimiLocalAppAgentWorkExecution, NimiLocalAppConversationMessage } from '@nimiplatform/sdk/app';
type Reference = { agentHandle: string; displayName: string; avatarUrl: string | null; agentBinding?: string };
export type FakeCall = { callId: string; turnId: string; name: string; argumentsJson: string };
export function handle(suffix: string): string { return `agent_ref_${suffix.padEnd(43, 'x').slice(0, 43)}`; }
export function createFakeAgentClient(options: { references: Reference[]; withWork?: boolean; busy?: () => boolean; openFails?: () => boolean; openGate?: Promise<void> }) {
  let sequence = 0; let count = 0; let references = options.references; let interruptNotActive = false; let externalBusy = false;
  const executions = new Map<string, NimiLocalAppAgentWorkExecution>();
  const pendingCalls: FakeCall[] = [];
  const subscribers = new Set<{ id: string; queue: NimiLocalAppAgentWorkEvent[]; wake?: () => void; closed: boolean }>();
  const sent: Record<string, unknown>[] = [];
  const submitted: { callId: string; resultJson: string; isError: boolean }[] = [];
  const interrupts: { expectedTurnId?: string }[] = [];
  const stale = new Set<string>();
  const requireHandle = (input: { agentHandle?: string }) => { if (input.agentHandle && stale.has(input.agentHandle)) throw Object.assign(new Error('expired scope'), { reasonCode: 'session-revoked' }); };
  const publish = (event: NimiLocalAppAgentWorkEvent) => { for (const sub of subscribers) if (sub.id === event.executionId) { sub.queue.push(event); sub.wake?.(); } };
  const push = (event: Record<string, unknown>) => {
    const id = String(event.turnId); sequence++;
    let execution = executions.get(id);
    if (!execution) return;
    if (event.type === 'message-committed') {
      const message = event.message as NimiLocalAppConversationMessage;
      execution = { ...execution, outputText: message.parts.map(part => part.kind === 'text' ? part.text : '').join('\n') }; executions.set(id, execution); return;
    }
    if (event.type === 'text-delta') { publish({ executionId: id, sequence: String(sequence), type: 'text-delta', delta: String(event.delta) }); return; }
    if (['turn-completed', 'turn-failed', 'turn-interrupted'].includes(String(event.type))) {
      execution = { ...execution, state: event.type === 'turn-completed' ? 'succeeded' : event.type === 'turn-failed' ? 'failed' : 'cancelled', reasonCode: String(event.reasonCode || event.reason || ''), message: String(event.message || ''), sequence: String(sequence) };
      executions.set(id, execution); publish({ executionId: id, sequence: String(sequence), type: 'snapshot', execution });
    }
  };
  const agentWork = {
    listReferences: async () => { if (options.openGate) await options.openGate; if (options.openFails?.()) throw new Error('work references unavailable'); return references; },
    status: async (input: { agentHandle: string }) => { requireHandle(input); return { busy: externalBusy || options.busy?.() || [...executions.values()].some(value => value.state === 'running'), ownExecutionId: [...executions.values()].find(value => value.state === 'running')?.executionId || null }; },
    start: async (input: Record<string, unknown>) => { requireHandle(input); if (externalBusy || options.busy?.()) throw Object.assign(new Error('busy'), { reasonCode: 'AGENT_BUSY' }); if (options.withWork === false) throw Object.assign(new Error('work unsupported'), { reasonCode: 'local-app-operation-unsupported' }); sent.push(input); const id = `turn_${++count}`; executions.set(id, { executionId: id, workId: String((input.work as { workId: string }).workId), state: 'running', outputText: '', reasonCode: '', message: '', sequence: String(++sequence) }); return { executionId: id }; },
    get: async (input: { agentHandle: string; executionId: string }) => { requireHandle(input); const value = executions.get(input.executionId); if (!value) throw new Error('execution missing'); return value; },
    listToolCalls: async (input: { executionId: string }) => pendingCalls.filter(call => call.turnId === input.executionId && !submitted.some(value => value.callId === call.callId)).map(call => ({ executionId: call.turnId, callId: call.callId, name: call.name, argumentsJson: call.argumentsJson })),
    submitToolResult: async (input: { callId: string; resultJson: string; isError: boolean }) => { submitted.push({ callId: input.callId, resultJson: input.resultJson, isError: input.isError }); return { callId: input.callId }; },
    cancel: async (input: { executionId: string }) => { interrupts.push({ expectedTurnId: input.executionId }); if (interruptNotActive) throw new Error('execution-not-active'); push({ type: 'turn-interrupted', turnId: input.executionId, reason: 'cancelled' }); return executions.get(input.executionId); },
    subscribe: async (input: { executionId: string }) => { const sub = { id: input.executionId, queue: [] as NimiLocalAppAgentWorkEvent[], closed: false, wake: undefined as (() => void) | undefined }; subscribers.add(sub); return { cancel: async () => { sub.closed = true; subscribers.delete(sub); sub.wake?.(); }, async *[Symbol.asyncIterator]() { while (!sub.closed) { const next = sub.queue.shift(); if (next) yield next; else await new Promise<void>(resolve => { sub.wake = resolve; }); } } }; },
  };
  return { client: { agentWork } as never, anchor: '', sent, submitted, interrupts, setInterruptNotActive: (value: boolean) => { interruptNotActive = value; if (value) for (const [id, execution] of executions) executions.set(id, { ...execution, state: 'cancelled', reasonCode: 'cancelled' }); },
    setBusy: (value: boolean) => { externalBusy = value; },
    setExecutionState: (id: string, patch: Partial<NimiLocalAppAgentWorkExecution>) => { const value = executions.get(id); if (value) executions.set(id, { ...value, ...patch }); },
    endStream: () => { for (const sub of subscribers) { sub.closed = true; sub.wake?.(); } },
    renewSession: (suffix: string) => { references.forEach(reference => stale.add(reference.agentHandle)); references = references.map(reference => ({ ...reference, agentHandle: handle(`${suffix}${reference.displayName}`) })); },
    push, addMessage: (_message: NimiLocalAppConversationMessage) => {},
    requestCall: (call: FakeCall) => { pendingCalls.push(call); publish({ executionId: call.turnId, sequence: String(++sequence), type: 'tool-call', call: { executionId: call.turnId, callId: call.callId, name: call.name, argumentsJson: call.argumentsJson } }); },
  };
}
export async function settle(rounds = 8): Promise<void> { for (let index = 0; index < rounds; index++) await new Promise(resolve => setTimeout(resolve, 0)); }
