import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { AgentCenterConversationContext } from '../src/components/AgentCenterConversationContext.js';
import { useAgentCenterStore } from '../src/store.js';
import type { AgentCenterSession } from '../src/types.js';
import { sessionFor, testManagerActionAvailability } from './session-fixture.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); });
function Harness({ session }: { session: AgentCenterSession }) { return <AgentCenterConversationContext session={session} snapshot={useAgentCenterStore(session).snapshot} />; }
const manager = (busy = false) => ({ life: { activities: [], revision:'1',current:null,recent:[],future:[],nextCheckAt:null,waitReason:''}, lifecycleStatus: 'active' as const, executionState: 'idle' as const, statusText: '', currentEmotion: '', source: null, context: null,
  actionAvailability: testManagerActionAvailability(), conversationContext: { conversationAnchorId: 'agent_anchor_context', contextRevision: '1', firstTurnSequence: '0', omitSupplementalContext: false,
    committedTurnCount: '8', suggestedFirstTurnSequence: '2', busy, canUpdate: !busy } });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!;

it('keeps the current range by default and requires a review before changing only supplemental context', async () => {
  const calls: unknown[] = [];
  const session = await sessionFor({ manager: manager() }, null, undefined, null, null, calls);
  const beforeAI = session.getSnapshot().state.sharedAIConfig;
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<Harness session={session} />));
  await act(async () => button('Adjust context').click());
  expect(document.querySelector('[role="combobox"]')?.textContent).toContain('Keep the current history range');
  expect(button('Review changes').disabled).toBe(true); expect(calls).toHaveLength(0);
  await act(async () => (document.querySelector('[role="switch"]') as HTMLButtonElement).click());
  await act(async () => button('Review changes').click());
  expect(document.body.textContent).toContain('every app until you change it again');
  expect(document.body.textContent).toContain('draft will not be sent'); expect(calls).toHaveLength(0);
  await act(async () => button('Confirm context change').click());
  expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ conversationAnchorId: 'agent_anchor_context', expectedContextRevision: '1', firstTurnSequence: '0', omitSupplementalContext: true });
  expect(session.getSnapshot().state.conversationContext?.contextRevision).toBe('2');
  expect(session.getSnapshot().state.sharedAIConfig).toEqual(beforeAI);
  expect(document.body.textContent).toContain('Return to the same conversation');
});

it('does not offer a write while another surface owns an active turn', async () => {
  const calls: unknown[] = [];
  const session = await sessionFor({ manager: manager(true) }, null, undefined, null, null, calls);
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<Harness session={session} />));
  expect(button('Adjust context').disabled).toBe(true);
  expect(document.body.textContent).toContain('active conversation or realtime session');
  expect(calls).toHaveLength(0);
});
