import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

// Unread partner history is a loading state and a failed read is a failure
// with a retry; neither may fall back to the first-meeting introduction.
test('partner history reports loading, then a retryable failure, then the read history', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient } = await import('@tanstack/react-query');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AgentVisibleProjectionProvider } = await import('../src/shell/renderer/features/chat/chat-agent-visible-projection-context.js');
  const { createAgentVisibleProjectionStore } = await import('../src/shell/renderer/features/chat/chat-agent-visible-projection-store.js');
  const { useAgentRuntimeSessionSnapshotHydration } = await import('../src/shell/renderer/features/chat/chat-agent-shell-adapter-session-snapshot.js');

  let releaseSnapshot: ((outcome: 'fail' | 'read') => void) | undefined;
  let snapshotReads = 0;
  const conversation = {
    subscribe: async () => ({
      cancel: async () => undefined,
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>(() => undefined) }),
    }),
    snapshot: () => {
      snapshotReads += 1;
      return new Promise((resolve, reject) => {
        releaseSnapshot = (outcome) => (outcome === 'fail'
          ? reject(new Error('conversation read failed'))
          : resolve({ conversationAnchorId: 'anchor-1', throughSequence: '0', truncatedBefore: null, turns: [], messages: [], actions: [], voices: [] }));
      });
    },
    readArtifact: async () => { throw new Error('unused'); },
  };
  const bindings = { sdk: { conversation: () => conversation }, clock: { now: () => 0 } } as never;
  const thread = {
    id: 'thread-anchor-1',
    title: 'Agent A',
    updatedAtMs: 0,
    lastMessageAtMs: null,
    targetSnapshot: { agentHandle: 'agent-a', conversationAnchorId: 'anchor-1', displayName: 'Agent A' },
  } as never;
  let state: { loading: boolean; error: Error | null; retry: () => void } | undefined;
  const queryClient = new QueryClient();
  const buildHostErrorDetails = () => ({});
  function Probe() {
    state = useAgentRuntimeSessionSnapshotHydration({
      activeAgentHandle: 'agent-a',
      activeConversationAnchorId: 'anchor-1',
      authStatus: 'authenticated',
      buildHostErrorDetails,
      queryClient,
      selectedThreadRecord: thread,
      submittingThreadId: null,
    });
    return null;
  }
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        <DesktopRendererBindingProvider bindings={bindings}>
          <AgentVisibleProjectionProvider store={createAgentVisibleProjectionStore()}><Probe /></AgentVisibleProjectionProvider>
        </DesktopRendererBindingProvider>,
      );
    });
    await settle();
    assert.equal(state?.loading, true, 'unread history must be loading, not a first meeting');
    assert.equal(state?.error, null);

    await act(async () => { releaseSnapshot?.('fail'); });
    await settle();
    assert.equal(state?.loading, false);
    assert.match(String(state?.error?.message), /conversation read failed/u);

    await act(async () => { state?.retry(); });
    await settle();
    assert.equal(snapshotReads, 2, 'retry reads the history again');
    assert.equal(state?.loading, true);
    await act(async () => { releaseSnapshot?.('read'); });
    await settle();
    assert.equal(state?.loading, false);
    assert.equal(state?.error, null);
  } finally {
    await act(async () => { root.unmount(); });
    queryClient.clear();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  }
});
