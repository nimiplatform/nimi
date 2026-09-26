// Day's business desk uses the independent work plane. It never reads canonical chat.
import type { NimiLocalAppAgentHandle, NimiLocalAppAgentReference, NimiLocalAppAgentWorkClient, NimiLocalAppAgentWorkExecution, NimiLocalAppAgentWorkScope, NimiLocalAppAgentWorkSubscription, NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { Appointment, SkillRun } from '../domain/types.js';
import type { DayWork } from '../domain/work.js';

export type AgentRef = { readonly agentHandle: NimiLocalAppAgentHandle; readonly displayName: string; readonly avatarUrl: string | null; readonly binding: string | null };
export type DeskPhase = 'idle' | 'loading' | 'unavailable' | 'no-agents' | 'choose' | 'opening' | 'ready';
export type DeskMessage = { readonly id: string; readonly turnId: string; readonly role: 'user' | 'assistant' | 'app'; readonly text: string; readonly images: readonly { artifactId: string; mimeType: string; name: string | null }[] };
export type LiveTool = { readonly turnId: string; readonly toolId: string; readonly name: string; readonly lifecycle: 'started' | 'updated' | 'completed' | 'failed' };
export type TurnOutcome = { readonly turnId: string; readonly kind: 'completed' | 'failed' | 'interrupted'; readonly detail: string | null };
export type DeskState = {
  readonly phase: DeskPhase; readonly references: readonly AgentRef[]; readonly agent: AgentRef | null;
  readonly awaitingConfirmation: Appointment | null; readonly unreachable: AgentRef | null; readonly restoring: boolean;
  readonly messages: readonly DeskMessage[]; readonly truncatedBefore: boolean;
  readonly activeTurnId: string | null; readonly resourceBusy: boolean;
  readonly streaming: { readonly turnId: string; readonly text: string } | null;
  readonly liveTools: readonly LiveTool[]; readonly lastOutcome: TurnOutcome | null;
  readonly connection: 'live' | 'reconnecting' | 'lost'; readonly error: string | null; readonly canUseWork: boolean;
};
export type TurnScope = NimiLocalAppAgentWorkScope;
export type SendResult = { readonly ok: true; readonly turnId: string; readonly scope: TurnScope } | { readonly ok: false; readonly reason: 'busy' | 'not-ready' | 'failed'; readonly message: string };
export type WorkSendInput = { readonly text: string; readonly requestId: string; readonly work: DayWork; readonly routineName?: string };
export type DeskEvent =
  | { readonly type: 'live-tool'; readonly turnId: string; readonly tool: LiveTool }
  | { readonly type: 'message-committed'; readonly turnId: string; readonly message: { readonly messageId: string; readonly role: 'assistant'; readonly parts: readonly { readonly kind: 'text'; readonly text: string }[] } }
  | { readonly type: 'turn-completed'; readonly turnId: string; readonly terminalReason: string }
  | { readonly type: 'turn-failed'; readonly turnId: string; readonly reasonCode: string; readonly message: string }
  | { readonly type: 'turn-interrupted'; readonly turnId: string; readonly reason: string };
export type DeskEventListener = (event: DeskEvent) => void;

export type AgentDesk = ReturnType<typeof createAgentDesk>;

const INITIAL: DeskState = { phase: 'idle', references: [], agent: null, awaitingConfirmation: null, unreachable: null, restoring: false, messages: [], truncatedBefore: false, activeTurnId: null, resourceBusy: false, streaming: null, liveTools: [], lastOutcome: null, connection: 'live', error: null, canUseWork: true };
const code = (error: unknown) => String((error as { reasonCode?: string; code?: string })?.reasonCode || (error as { code?: string })?.code || '');
export function isStaleSelector(error: unknown): boolean { return /session|account-changed|runtime-restarted|local.app.access.denied/iu.test(code(error)); }
const toRef = (agent: NimiLocalAppAgentReference): AgentRef => ({ agentHandle: agent.agentHandle, displayName: agent.displayName, avatarUrl: agent.avatarUrl, binding: agent.agentBinding || null });

// @nimi-authority: rule.nimi.nimiday.assistant.business-effects
export function createAgentDesk(client: Pick<NimiLocalAppClient, 'agentWork'> & Partial<Pick<NimiLocalAppClient, 'conversation'>>, options: { history?: () => readonly SkillRun[] } = {}) {
  let state: DeskState = INITIAL;
  let closed = false;
  let epoch = 0;
  let lastAppointment: Appointment | null = null;
  let active: TurnScope | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  let subscription: NimiLocalAppAgentWorkSubscription | undefined;
  const listeners = new Set<() => void>();
  const events = new Set<DeskEventListener>();
  const owned = new Set<string>();
  const terminal = new Set<string>();
  const publish = (patch: Partial<DeskState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const emit = (event: DeskEvent) => { events.forEach(listener => listener(event)); };
  const acceptResult = (execution: NimiLocalAppAgentWorkExecution) => {
    if (terminal.has(execution.executionId) || ['running', 'waiting_tool'].includes(execution.state)) return;
    terminal.add(execution.executionId);
    const turnId = execution.executionId;
    if (active?.executionId === turnId) { active = null; void subscription?.cancel().catch(() => {}); subscription = undefined; }
    publish({ activeTurnId: null, resourceBusy: false, streaming: null, lastOutcome: { turnId, kind: execution.state === 'succeeded' ? 'completed' : execution.state === 'failed' ? 'failed' : 'interrupted', detail: execution.message || null } });
    if (execution.state === 'succeeded') {
      const message: DeskMessage = { id: `${turnId}:result`, turnId, role: 'assistant', text: execution.outputText, images: [] };
      publish({ messages: [...state.messages, message] });
      emit({ type: 'message-committed', turnId, message: { messageId: message.id, role: 'assistant', parts: [{ kind: 'text', text: message.text }] } });
      emit({ type: 'turn-completed', turnId, terminalReason: '' });
    } else if (execution.state === 'failed') emit({ type: 'turn-failed', turnId, reasonCode: execution.reasonCode, message: execution.message });
    else emit({ type: 'turn-interrupted', turnId, reason: execution.reasonCode || 'cancelled' });

  };
  const consume = async (source: NimiLocalAppAgentWorkSubscription, expected: number) => {
    try {
      for await (const event of source) {
        if (closed || expected !== epoch || subscription !== source) return;
        if (event.type === 'snapshot') acceptResult(event.execution);
        else if (event.type === 'text-delta') publish({ streaming: { turnId: event.executionId, text: (state.streaming?.turnId === event.executionId ? state.streaming.text : '') + event.delta } });
        else emit({ type: 'live-tool', turnId: event.executionId, tool: { turnId: event.executionId, toolId: event.call.callId, name: event.call.name, lifecycle: 'started' } });
      }
    } catch (error) { if (!closed && expected === epoch) publish({ connection: 'lost', error: reasonText(error) }); }
  };
  const reasonText = (error: unknown) => code(error) || String(error);
  const poll = async () => {
    if (closed || polling || state.phase !== 'ready' || !state.agent) return;
    polling = true; const expected = epoch;
    try {
      if (active) { const execution = await client.agentWork.get(active); if (closed || expected !== epoch) return; acceptResult(execution); }
      const status = await client.agentWork.status({ agentHandle: state.agent.agentHandle });
      if (!closed && expected === epoch) publish({ resourceBusy: status.busy, connection: 'live' });
    } catch (error) {
      if (closed || expected !== epoch) return;
      publish({ connection: 'lost', error: code(error) || String(error) });
      if (isStaleSelector(error)) { closed = true; epoch++; active = null; if (timer) clearInterval(timer); publish({ phase: 'unavailable', activeTurnId: null }); }
    } finally { polling = false; }
  };
  const history = () => [...(options.history?.() || [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).flatMap(run => {
    if (!run.turnId) return [];
    const messages: DeskMessage[] = [{ id: `${run.turnId}:request`, turnId: run.turnId, role: run.trigger === 'rhythm' ? 'app' : 'user', text: run.requestText, images: [] }];
    if (run.replyText && run.replyMessageId) messages.push({ id: run.replyMessageId, turnId: run.turnId, role: 'assistant', text: run.replyText, images: [] });
    return messages;
  });
  const start = async (appointment: Appointment | null) => {
    closed = false; const expected = ++epoch; lastAppointment = appointment; active = null;
    if (timer) clearInterval(timer);
    publish({ ...INITIAL, phase: 'loading', restoring: !!appointment, messages: history() });
    try {
      const references = (await client.agentWork.listReferences()).map(toRef);
      if (closed || expected !== epoch) return;
      const agent = references.find(item => item.binding === appointment?.binding && item.binding !== null) || null;
      publish({ references, agent, restoring: false, phase: references.length === 0 ? 'no-agents' : agent ? 'ready' : 'choose', awaitingConfirmation: agent ? null : appointment });
      timer = setInterval(() => { void poll(); }, 1000);
      await poll();
    } catch (error) { if (expected === epoch) publish({ phase: 'unavailable', restoring: false, error: String(error) }); }
  };
  const sendWork = async (input: WorkSendInput): Promise<SendResult> => {
    const agent = state.agent; const expected = epoch;
    if (closed || state.phase !== 'ready' || !agent) return { ok: false, reason: 'not-ready', message: '当前助理尚未就绪' };
    if (state.resourceBusy || active) return { ok: false, reason: 'busy', message: '助理正在处理另一项请求' };
    try {
      const result = await client.agentWork.start({ agentHandle: agent.agentHandle, requestId: input.requestId, prompt: input.text, work: { ...input.work, ...(input.routineName ? { routineName: input.routineName } : {}) } });
      if (closed || expected !== epoch) { await client.agentWork.cancel({ agentHandle: agent.agentHandle, executionId: result.executionId }).catch(() => {}); return { ok: false, reason: 'failed', message: '执行范围已失效；不会继续旧工作' }; }
      active = { agentHandle: agent.agentHandle, executionId: result.executionId }; owned.add(result.executionId);
      publish({ activeTurnId: result.executionId, resourceBusy: true, messages: [...state.messages, { id: `${result.executionId}:request`, turnId: result.executionId, role: input.routineName ? 'app' : 'user', text: input.text, images: [] }] });
      const ownScope = active;
      // Return admission before observing events so the engine can associate
      // this execution with its run, even while subscription setup is pending.
      void (async () => {
        try {
          const source = await client.agentWork.subscribe(ownScope);
          if (closed || expected !== epoch || active?.executionId !== ownScope.executionId) { await source.cancel(); return; }
          subscription = source;
          setTimeout(() => { void consume(source, expected); }, 0);
        } catch { /* Own get polling still observes the actual execution. */ }
      })();
      return { ok: true, turnId: result.executionId, scope: ownScope };
    } catch (error) {
      if (code(error).replaceAll('_', '-').toLowerCase() === 'agent-busy') { publish({ resourceBusy: true }); return { ok: false, reason: 'busy', message: '助理正在处理另一项请求' }; }
      return { ok: false, reason: 'failed', message: String(error) };
    }
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onEvent: (listener: DeskEventListener) => { events.add(listener); return () => { events.delete(listener); }; },
    start,
    appoint: async (handle: NimiLocalAppAgentHandle) => { const agent = state.references.find(item => item.agentHandle === handle); if (!agent || active) return null; lastAppointment = { displayName: agent.displayName, avatarUrl: agent.avatarUrl, binding: agent.binding, appointedAt: new Date().toISOString() }; publish({ agent, phase: 'ready', awaitingConfirmation: null, resourceBusy: false }); await poll(); return agent; },
    refreshReferences: async () => { const references = (await client.agentWork.listReferences()).map(toRef); publish({ references }); },
    reconnect: async () => { if (closed) await start(lastAppointment); else await poll(); },
    runtimeActiveTurn: async () => { if (active) { try { const result = await client.agentWork.get(active); acceptResult(result); return ['running', 'waiting_tool'].includes(result.state) ? result.executionId : null; } catch { return undefined; } } return null; },
    sendWork,
    work: (): NimiLocalAppAgentWorkClient => client.agentWork,
    interrupt: async (executionId: string): Promise<'interrupted' | 'not-active' | 'failed'> => { if (!active || active.executionId !== executionId || !owned.has(executionId)) return 'not-active'; try { acceptResult(await client.agentWork.cancel(active)); return 'interrupted'; } catch { return 'failed'; } },
    ownsTurn: (id: string | null) => id !== null && owned.has(id),
    transcribe: async (input: { requestId: string; mimeType: string; bytes: Uint8Array }) => { if (!state.agent || !client.conversation) throw new Error('语音输入尚不可用'); const opened = await client.conversation.open({ agentHandle: state.agent.agentHandle }); const result = await client.conversation.transcribeVoice({ agentHandle: state.agent.agentHandle, conversationAnchorId: opened.conversationAnchorId, requestId: input.requestId, mimeType: input.mimeType, audioBytes: input.bytes }); return result.text; },
    dispose: async () => { closed = true; epoch++; if (timer) clearInterval(timer); const own = active; active = null; void subscription?.cancel().catch(() => {}); subscription = undefined; if (own) await client.agentWork.cancel(own).catch(() => {}); },
  };
}
