import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('Home evicts revoked projection and media, then restores only from a new subscription and snapshot', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient } = await import('@tanstack/react-query');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AgentVisibleProjectionProvider } = await import('../src/shell/renderer/features/chat/chat-agent-visible-projection-context.js');
  const { createAgentVisibleProjectionStore } = await import('../src/shell/renderer/features/chat/chat-agent-visible-projection-store.js');
  const { useAgentRuntimeSessionSnapshotHydration } = await import('../src/shell/renderer/features/chat/chat-agent-shell-adapter-session-snapshot.js');
  const { bundleQueryKey } = await import('../src/shell/renderer/features/chat/chat-agent-shell-core.js');
  const snapshot = (text: string) => ({ conversationAnchorId: 'anchor', throughSequence: '2', truncatedBefore: false,
    state: { textTurnId: null, freeContactEnabled: false, maxFollowUpTurns: 8, pendingFollowUp: null }, turns: [], actions: [], voices: [],
    messages: [{ messageId: 'body', turnId: 'turn', role: 'assistant', partial: false, quote: null, parts: [{ kind: 'text', text }] },
      { messageId: 'image', turnId: 'turn', role: 'assistant', partial: false, quote: null, parts: [{ kind: 'artifact-ref', artifactId: 'artifact', mediaKind: 'image', mimeType: 'image/png', displayName: null }] }] });
  let reads = 0, subscriptions = 0, cancellations = 0, restored = 0;
  let releaseFresh!: (value: unknown) => void;
  let releaseArtifact!: (value: unknown) => void;
  const conversation = {
    subscribe: async () => {
      subscriptions++; let stop!: () => void; const stopped = new Promise<void>(resolve => { stop = resolve; });
      return { cancel: async () => { cancellations++; stop(); }, [Symbol.asyncIterator]() {
        return { async next() { await stopped; return { done: true as const, value: undefined }; } };
      } };
    },
    snapshot: () => ++reads === 1 ? Promise.resolve(snapshot('private old body')) : new Promise(resolve => { releaseFresh = resolve; }),
    readArtifact: () => new Promise(resolve => { releaseArtifact = resolve; }),
  };
  const bindings = { sdk: { conversation: () => conversation }, clock: { now: () => 0 } } as never;
  const thread = { id: 'thread', title: 'Agent', updatedAtMs: 0, lastMessageAtMs: null,
    targetSnapshot: { agentHandle: 'agent', conversationAnchorId: 'anchor', displayName: 'Agent' } } as never;
  const queryClient = new QueryClient(); const visible = createAgentVisibleProjectionStore();
  let state: ReturnType<typeof useAgentRuntimeSessionSnapshotHydration> | undefined;
  let buildHostErrorDetails = () => ({});
  const onAccessRestored = () => { restored++; };
  function Probe() { state = useAgentRuntimeSessionSnapshotHydration({ activeAgentHandle: 'agent', activeConversationAnchorId: 'anchor', authStatus: 'authenticated', buildHostErrorDetails, queryClient, selectedThreadRecord: thread, onAccessRestored }); return null; }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = () => <DesktopRendererBindingProvider bindings={bindings}><AgentVisibleProjectionProvider store={visible}><Probe /></AgentVisibleProjectionProvider></DesktopRendererBindingProvider>;
  const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  try {
    await act(async () => { root.render(render()); }); await tick();
    assert.equal(visible.get('thread')?.messages[0]?.contentText, 'private old body');
    assert.ok(queryClient.getQueryData(bundleQueryKey('thread')));
    assert.equal(restored, 1);
    const retiredMedia = state?.mediaReader;
    await act(async () => { state?.invalidateAccess(Object.assign(new Error('access revoked'), { reasonCode: 'LOCAL_APP_ACCESS_DENIED' })); });
    await tick();
    assert.equal(visible.get('thread'), null);
    assert.equal(queryClient.getQueryData(bundleQueryKey('thread')), undefined);
    assert.equal(state?.mediaReader, null);
    assert.equal(state?.controlState, null);
    assert.equal(cancellations, 1);
    await act(async () => { releaseArtifact({ artifactId: 'artifact', bytes: new Uint8Array([1]), mimeType: 'image/png', byteLength: 1 }); }); await tick();
    assert.equal(retiredMedia?.get('artifact').mediaUrl, null);
    assert.equal(visible.get('thread'), null);
    buildHostErrorDetails = () => ({ rerender: true });
    await act(async () => { root.render(render()); }); await tick();
    assert.equal(subscriptions, 1, 'same-scope props rerender is not an explicit access refresh');
    await act(async () => { state?.retry(); }); await tick();
    assert.equal(subscriptions, 2);
    assert.equal(restored, 1, 'new subscription alone cannot unlock revoked content');
    await act(async () => { releaseFresh(snapshot('fresh authorized body')); }); await tick();
    assert.equal(restored, 2);
    assert.equal(visible.get('thread')?.messages[0]?.contentText, 'fresh authorized body');
    assert.equal(state?.error, null);
  } finally {
    await act(async () => { root.unmount(); }); queryClient.clear(); visible.dispose();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
    dom.window.close();
  }
});
