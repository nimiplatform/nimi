import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';

test('voice playback survives equivalent snapshots and fences late audio after a scope change', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  const players: TestAudio[] = [];
  class TestAudio {
    src: string;
    ended = false;
    currentTime = 0;
    duration = 10;
    ontimeupdate: (() => void) | null = null;
    onloadedmetadata: (() => void) | null = null;
    pauses = 0;
    onplay: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onended: (() => void) | null = null;
    constructor(src: string) { this.src = src; players.push(this); }
    async play() { this.onloadedmetadata?.(); this.onplay?.(); }
    pause() { this.pauses += 1; this.onpause?.(); }
    finish() { this.ended = true; this.onended?.(); }
  }
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, Node: dom.window.Node,
    Audio: TestAudio, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AgentManualVoicePlaybackButton } = await import('../src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.js');
  const node = dom.window.document.createElement('div'); dom.window.document.body.append(node);
  const root = createRoot(node);
  const ready = { status: 'ready', voiceId: 'voice-1', turnId: 'turn-1', messageId: 'message-1', artifactId: 'audio-1' };
  let deferred = false;
  let resolveOld!: (value: typeof ready) => void;
  let renders = 0, reads = 0;
  let unavailable = false;
  const requestIds: string[] = [];
  const bindings = { sdk: { conversation: () => ({
    renderVoice: async (request: { requestId: string }) => { renders += 1; requestIds.push(request.requestId); if (unavailable) return {status:'unavailable'}; return deferred ? new Promise(resolve => { resolveOld = resolve; }) : ready; },
    readArtifact: async () => { reads += 1; return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' }; },
  }) } } as unknown as DesktopCanonicalRendererBindings;
  const render = async (anchor = 'anchor-1', voice: Record<string, unknown> = {}) => {
    const message = { id: 'message-1', sessionId: anchor, targetId: 'agent', source: 'agent', role: 'assistant',
      text: 'Saved text', kind: 'text', status: 'complete', createdAt: '',
      metadata: { canonicalTurnId: 'turn-1', canonicalConversationAnchorId: anchor, canonicalPartial: false, ...voice },
    } as ConversationCanonicalMessage;
    const target = { agentHandle: 'agent_ref_test', displayName: 'Partner' } as AgentLocalTargetSnapshot;
    await act(async () => root.render(<DesktopRendererBindingProvider bindings={bindings}>
      <AgentManualVoicePlaybackButton message={message} activeTarget={target} activeConversationAnchorId={anchor}
        playLabel="Play" stopLabel="Stop" renderingLabel="Preparing" unavailableLabel="Unavailable" errorLabel="Failed" retryLabel="Retry voice" pauseLabel="Pause" resumeLabel="Resume" progressLabel="Position" settingsLabel="Settings" settingsHint="Check model and voice" />
    </DesktopRendererBindingProvider>));
  };
  try {
    await render();
    await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
    assert.equal(node.querySelector('button')?.getAttribute('aria-label'), 'Pause');
    await render(); // Fresh equivalent message/target objects from a canonical snapshot.
    assert.equal(players[0]?.pauses, 0);
    assert.equal(players.length, 1);
    players[0]!.currentTime = 4;
    await act(async () => players[0]!.ontimeupdate?.());
    await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
    assert.equal(node.querySelector('button')?.getAttribute('aria-label'), 'Resume');
    await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
    assert.equal(players.length,1,'resume keeps the same audio');
    assert.equal(players[0]?.currentTime,4,'resume preserves playback position');
    assert.equal(reads,1,'resume does not read or synthesize again');
    await act(async () => players[0]!.finish());
    assert.equal(node.querySelector('button')?.getAttribute('aria-label'), 'Play');
    deferred = true;
    await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
    await render('anchor-2');
    await act(async () => resolveOld(ready));
    assert.equal(players.length, 1, 'old scope must not start another audio player');
    assert.equal(reads, 1, 'old scope must not read an artifact after it is retired');
    assert.equal(renders, 2);
    assert.equal(node.querySelector('button')?.getAttribute('aria-label'), 'Play');
    deferred = false;
    unavailable = true;
    await render('anchor-2', {canonicalVoiceState:'failed'});
    assert.equal(node.querySelector('button')?.getAttribute('aria-label'), 'Retry voice');
    await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
    assert.equal(node.querySelector('button')?.getAttribute('aria-label'), 'Retry voice');
    unavailable = false;
    await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
    assert.equal(node.querySelector('button')?.getAttribute('aria-label'), 'Pause');
    assert.equal(new Set(requestIds).size,requestIds.length,'only explicit new clicks create distinct requests');
    await act(async () => players.at(-1)!.finish());
    const previousRenders=renders;
    await render('anchor-2',{canonicalVoiceState:'ready',canonicalVoiceArtifactId:'audio-1',canonicalTurnStatus:'active'});
    await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
    assert.equal(renders,previousRenders,'saved ready voice uses readArtifact even while other media are active');
    assert.equal(node.querySelectorAll('input[type=range]').length,1,'one shared progress control');
    assert.equal(node.querySelectorAll('button').length,2,'one pause/resume control and its local stop');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
