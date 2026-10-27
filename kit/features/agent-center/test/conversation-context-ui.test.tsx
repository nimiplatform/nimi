import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentCenterConversationContext } from '../src/components/AgentCenterConversationContext.js';
import { useAgentCenterStore } from '../src/store.js';
import type { AgentCenterSession, AgentCenterStateInput } from '../src/types.js';
import { sessionFor, testManagerActionAvailability } from './session-fixture.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
let sessions: AgentCenterSession[] = [];
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  sessions.forEach((session) => session.dispose());
  sessions = [];
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function Harness({ session, onOpenRuntimeSettings }: { session: AgentCenterSession; onOpenRuntimeSettings?: () => void }) {
  return <AgentCenterConversationContext
    session={session}
    snapshot={useAgentCenterStore(session).snapshot}
    onOpenRuntimeSettings={onOpenRuntimeSettings}
  />;
}
const manager = (busy = false) => ({ life: { activities: [], revision:'1',current:null,recent:[],future:[],nextCheckAt:null,waitReason:''}, lifecycleStatus: 'active' as const, executionState: 'idle' as const, statusText: '', currentEmotion: '', source: null, context: null,
  actionAvailability: testManagerActionAvailability(), conversationContext: { conversationAnchorId: 'agent_anchor_context', contextRevision: '1', firstTurnSequence: '0', omitSupplementalContext: false,
    committedTurnCount: '8', suggestedFirstTurnSequence: '2', busy, canUpdate: !busy } });
const button = (label: string) => {
  const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
};
const radio = (value: string) => document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
const supplementalToggle = () => document.querySelector<HTMLButtonElement>('[role="switch"]')!;
async function renderContext(projection: AgentCenterStateInput = { manager: manager() }, onOpenRuntimeSettings?: () => void) {
  const calls: unknown[] = [];
  const session = await sessionFor(projection, null, undefined, null, null, calls);
  sessions.push(session);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness session={session} onOpenRuntimeSettings={onOpenRuntimeSettings} />));
  return { calls, session };
}

it('summarizes both inputs and preserves edits through review before changing only supplemental context', async () => {
  const { calls, session } = await renderContext();
  const beforeAI = session.getSnapshot().state.sharedAIConfig;
  expect(document.body.textContent).toContain('Conversation history');
  expect(document.body.textContent).toContain('Memory & retrieval');
  expect(document.body.textContent).toContain('Full history (not excluded here)');
  expect(document.body.textContent).toContain('Allowed');
  expect(document.body.textContent).not.toContain('Character settings, app instructions');
  await act(async () => button('Adjust context').click());
  expect(radio('keep').checked).toBe(true);
  expect(supplementalToggle().getAttribute('aria-checked')).toBe('true');
  expect(button('Review changes').disabled).toBe(true);
  expect(calls).toHaveLength(0);
  await act(async () => supplementalToggle().click());
  await act(async () => button('Review changes').click());
  expect(document.body.textContent).toContain('Review your changes');
  expect(document.body.textContent).toContain('Unchanged');
  expect(document.body.textContent).toContain('Starts with your next message');
  expect(document.body.textContent).toContain('draft will not be sent');
  expect(document.body.textContent).not.toContain('Earlier sensitive content will be checked again');
  expect(calls).toHaveLength(0);
  await act(async () => button('Back to edit').click());
  expect(radio('keep').checked).toBe(true);
  expect(supplementalToggle().getAttribute('aria-checked')).toBe('false');
  await act(async () => button('Review changes').click());
  await act(async () => button('Confirm context change').click());
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ conversationAnchorId: 'agent_anchor_context', expectedContextRevision: '1', firstTurnSequence: '0', omitSupplementalContext: true });
  expect(session.getSnapshot().state.conversationContext?.contextRevision).toBe('2');
  expect(session.getSnapshot().state.sharedAIConfig).toEqual(beforeAI);
  expect(document.body.textContent).toContain('The change starts with your next message');
  expect(document.body.textContent).toContain('Not used');
});

it('changes fresh and full history independently of supplemental context', async () => {
  const projection = manager();
  projection.conversationContext.firstTurnSequence = '2';
  projection.conversationContext.omitSupplementalContext = true;
  const { calls } = await renderContext({ manager: projection });
  expect(document.body.textContent).toContain('Skip the first 2 turns');
  await act(async () => button('Adjust context').click());
  expect(supplementalToggle().getAttribute('aria-checked')).toBe('false');
  await act(async () => radio('fresh').click());
  await act(async () => button('Review changes').click());
  expect(document.body.textContent).toContain('Skip the first 8 turns');
  expect(document.body.textContent).toContain('Unchanged');
  await act(async () => button('Confirm context change').click());
  expect(calls[0]).toMatchObject({ expectedContextRevision: '1', firstTurnSequence: '8', omitSupplementalContext: true });
  await act(async () => button('Adjust context').click());
  await act(async () => radio('full').click());
  expect(supplementalToggle().getAttribute('aria-checked')).toBe('false');
  await act(async () => button('Review changes').click());
  expect(document.body.textContent).toContain('Earlier sensitive content will be checked again');
  expect(document.body.textContent).toContain('Unchanged');
  await act(async () => button('Confirm context change').click());
  expect(calls[1]).toMatchObject({ expectedContextRevision: '2', firstTurnSequence: '0', omitSupplementalContext: true });
});

it('uses a Runtime suggestion without changing supplemental context', async () => {
  const { calls } = await renderContext();
  await act(async () => button('Adjust context').click());
  expect(document.body.textContent).toContain('Suggested by the current content check');
  await act(async () => radio('suggested').click());
  await act(async () => button('Review changes').click());
  await act(async () => button('Confirm context change').click());
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ firstTurnSequence: '2', omitSupplementalContext: false });
});

it('does not offer a write while another surface owns an active turn', async () => {
  const { calls } = await renderContext({ manager: manager(true) });
  expect(button('Adjust context').disabled).toBe(true);
  expect(document.body.textContent).toContain('active conversation or realtime session');
  expect(calls).toHaveLength(0);
});

it('explains unavailable writes and offers the existing owner recovery action', async () => {
  const projection = manager();
  projection.conversationContext.canUpdate = false;
  const openRuntimeSettings = vi.fn();
  const { calls } = await renderContext({ manager: projection }, openRuntimeSettings);
  expect(button('Adjust context').disabled).toBe(true);
  expect(document.body.textContent).toContain('Runtime rejected this action');
  await act(async () => button('Open Runtime settings').click());
  expect(openRuntimeSettings).toHaveBeenCalledTimes(1);
  expect(calls).toHaveLength(0);
});

it('shows refresh progress and confirms a completed refresh', async () => {
  const { session } = await renderContext();
  const originalRefresh = session.refresh.bind(session);
  let release!: () => void;
  let pendingRefresh: Promise<void> | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const refreshSpy = vi.spyOn(session, 'refresh').mockImplementation(() => {
    const controlled = gate.then(() => originalRefresh());
    pendingRefresh = controlled;
    return controlled;
  });
  await act(async () => button('Refresh state & memory').click());
  expect(button('Refreshing…').getAttribute('aria-busy')).toBe('true');
  expect(button('Refreshing…').disabled).toBe(true);
  await act(async () => button('Refreshing…').click());
  expect(refreshSpy).toHaveBeenCalledTimes(1);
  await act(async () => { release(); await pendingRefresh; });
  expect(document.body.textContent).toContain('State and memory refreshed');
  expect(button('Refresh state & memory').getAttribute('aria-busy')).toBeNull();
});

it('shows refresh failure even when no context projection is available', async () => {
  await renderContext({ runtimeError: 'RUNTIME_UNAVAILABLE' });
  expect(document.body.textContent).toContain('No conversation history settings are available yet');
  await act(async () => button('Refresh state & memory').click());
  expect(document.body.textContent).toContain('Could not refresh state and memory');
  expect(document.body.textContent).not.toContain('State and memory refreshed');
});

it.each(['contextRevision', 'conversationAnchorId', 'committedTurnCount', 'suggestedFirstTurnSequence'] as const)('requires reconfirmation when %s changes during editing', async (field) => {
  const projection = manager();
  const { calls, session } = await renderContext({ manager: projection });
  await act(async () => button('Adjust context').click());
  await act(async () => radio('fresh').click());
  expect(button('Review changes').disabled).toBe(false);
  if (field === 'contextRevision') projection.conversationContext.contextRevision = '2';
  if (field === 'conversationAnchorId') projection.conversationContext.conversationAnchorId = 'agent_anchor_changed';
  if (field === 'committedTurnCount') projection.conversationContext.committedTurnCount = '9';
  if (field === 'suggestedFirstTurnSequence') projection.conversationContext.suggestedFirstTurnSequence = '3';
  await act(async () => { await session.refresh(); });
  expect(document.body.textContent).toContain('The conversation or its context settings have changed');
  expect(button('Review changes').disabled).toBe(true);
  expect(calls).toHaveLength(0);
});

it.each([
  { reason: 'AGENT_CONVERSATION_CONTEXT_REVISION_CONFLICT', message: 'The conversation or its context settings have changed' },
  { reason: 'RUNTIME_UNAVAILABLE', message: 'The result could not be confirmed' },
])('does not claim success when saving fails with $reason', async ({ reason, message }) => {
  const { calls, session } = await renderContext();
  vi.spyOn(session, 'updateConversationContext').mockRejectedValue(Object.assign(new Error('Save failed'), { reasonCode: reason }));
  await act(async () => button('Adjust context').click());
  await act(async () => radio('fresh').click());
  await act(async () => button('Review changes').click());
  await act(async () => button('Confirm context change').click());
  expect(document.body.textContent).toContain(message);
  expect(document.body.textContent).not.toContain('The change starts with your next message');
  expect(radio('fresh').checked).toBe(true);
  expect(calls).toHaveLength(0);
});
