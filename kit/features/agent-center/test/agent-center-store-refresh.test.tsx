import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { useAgentCenterStore } from '../src/store.js';
import type { AgentCenterSession } from '../src/types.js';
import { sessionFor } from './session-fixture.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let session: AgentCenterSession | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  session?.dispose();
  container?.remove();
  root = null;
  container = null;
  session = null;
});

it('keeps the canonical session receiver and performs a new read for every explicit retry', async () => {
  // This fixture constructs the real ManagerSession, including its private
  // lifecycle fields. Only its owner transport is local to the unit test.
  const owner = { runtimeError: 'RUNTIME_UNAVAILABLE' as string | null };
  const currentSession = await sessionFor(owner);
  session = currentSession;
  const view: { store?: ReturnType<typeof useAgentCenterStore> } = {};
  function Harness() {
    view.store = useAgentCenterStore(currentSession);
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<Harness />));
  expect(view.store?.snapshot.phase).toBe('degraded');

  owner.runtimeError = null;
  await act(async () => { await view.store!.refresh(); });
  expect(view.store?.snapshot.phase).toBe('ready');
  expect(view.store?.snapshot.error).toBeNull();

  owner.runtimeError = 'RUNTIME_UNAVAILABLE';
  await act(async () => { await view.store!.refresh(); });
  expect(view.store?.snapshot.phase).toBe('degraded');
  expect(view.store?.snapshot.error).toContain('RUNTIME_UNAVAILABLE');

  await act(async () => currentSession.invalidate());
  await expect(view.store!.refresh()).rejects.toThrow(/invalidated/u);
});
