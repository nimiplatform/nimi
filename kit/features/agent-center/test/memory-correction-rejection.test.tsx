import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AgentCenterCognitionSection } from '../src/components/AgentCenterCognitionSection.js';
import { sessionFor } from './session-fixture.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

it('keeps rejected correction text editable and preserves the original Memory without a success message', async () => {
  const session = await sessionFor({ cognitionMemory: {
    outcome: 'ready', enabled: true, adoptionRequired: false, currentCount: 1, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
    items: [{ memoryId: 'memory-p0', content: 'Original preference', epistemicStatus: 'explicit', lifecycle: 'current',
      occurredAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', sourceExplanation: 'Committed user message' }],
  } });
  const reject = vi.fn(async () => ({ outcome: 'rejected' as const, affectedMemoryIds: [], projection: session.getSnapshot().state.cognition.memory! }));
  const projected = new Proxy(session, { get: (target, key) => key === 'correctMemory' ? reject : Reflect.get(target, key, target) });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<AgentCenterCognitionSection session={projected} snapshot={session.getSnapshot()} />));
    const button = (label: string) => [...container.querySelectorAll('button')].find(node => node.textContent === label)!;
    await act(async () => button('Correct').click());
    const draft = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(draft, 'Proposed text');
      draft.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Save correction').click());
    expect(container.textContent).toContain('This correction was not accepted. Your existing memory is unchanged.');
    expect(draft.value).toBe('Proposed text'); expect(container.textContent).toContain('Original preference');
    expect(reject).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
