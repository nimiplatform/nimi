import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';

import { createAgentConversationDisplayStore, projectDesktopRuntimePresentationProfile } from '../src/shell/renderer/features/chat/chat-agent-shell-adapter-runtime.js';

test('Desktop preserves the complete canonical presentation profile projection', () => {
  assert.deepEqual(projectDesktopRuntimePresentationProfile({
    status: 'ready',
    presentationRevision: '7',
    backendKind: 'vrm',
    avatarAssetRef: 'avatar:current',
    expressionProfileRef: 'expression:current',
    idlePreset: 'idle:current',
    interactionPolicyRef: 'interaction:current',
    defaultVoiceReference: 'preset_voice_id:serena',
    avatarAutoplay: true,
    backgroundRef: 'background:current',
  }), {
    backendKind: 'vrm',
    avatarAssetRef: 'avatar:current',
    expressionProfileRef: 'expression:current',
    idlePreset: 'idle:current',
    interactionPolicyRef: 'interaction:current',
    defaultVoiceReference: 'preset_voice_id:serena',
    avatarAutoplay: true,
    backgroundAssetRef: 'background:current',
  });
});

test('chat subscribes only to its Session display fields and resets on Session replacement', async () => {
  type DisplaySource = NonNullable<Parameters<typeof createAgentConversationDisplayStore>[0]>;
  type Snapshot = ReturnType<DisplaySource['getSnapshot']> & { error?: string; directoryRevision?: number; reads?: Record<string, 'pending' | 'loaded' | 'failed'> };
  const initial: Snapshot = {
    phase: 'ready',
    state: {
      cognition: { lifecycleStatus: 'active', executionState: 'idle', statusText: 'Ready' },
      appearance: {
        status: 'ready', presentationRevision: '1', backendKind: 'vrm', avatarAssetRef: 'avatar:current',
        expressionProfileRef: 'expression:current', idlePreset: 'idle:current', interactionPolicyRef: 'policy:current',
        defaultVoiceReference: 'preset_voice_id:current', avatarAutoplay: true, backgroundRef: 'background:current',
      },
    },
  };
  const session = (snapshot: Snapshot) => {
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => snapshot,
      subscribe(listener: () => void) { listeners.add(listener); listener(); return () => { listeners.delete(listener); }; },
      publish(next: Snapshot) { snapshot = next; for (const listener of listeners) listener(); },
    };
  };
  const first = session(initial);
  const firstStore = createAgentConversationDisplayStore(first);
  let initialNotifications = 0;
  const stopInitial = firstStore.subscribe(() => { initialNotifications++; });
  assert.equal(initialNotifications, 0, 'a synchronous initial subscription does not invent a display change');
  stopInitial();

  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let renders = 0;
  let latest!: ReturnType<typeof firstStore.getSnapshot>;
  const renderedProjection = () => latest;
  function Parent({ store }: { store: typeof firstStore }) {
    renders++;
    latest = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    return React.createElement('span', null, latest.runtimePresentationProfile?.avatarAssetRef ?? 'no-avatar');
  }
  let fullNotifications = 0;
  const stopFull = first.subscribe(() => { fullNotifications++; });
  try {
    await act(async () => root.render(React.createElement(Parent, { store: firstStore })));
    const firstProjection = latest;
    const before = renders;
    const fullBefore = fullNotifications;
    await act(async () => first.publish({
      ...first.getSnapshot(), error: 'manager-only diagnostic', directoryRevision: 2,
      state: { ...first.getSnapshot().state, appearance: { ...first.getSnapshot().state.appearance,
        presentationRevision: '2', referenceVoice: { phase: 'creating', sampleUrl: null, reason: null, reasonCode: null },
      } },
    }));
    assert.equal(renders, before, 'reference voice, directory and diagnostic updates do not rerender the chat parent');
    assert.equal(fullNotifications, fullBefore + 1, 'the full Session subscriber still receives the update');
    assert.equal(latest, firstProjection);
    assert.ok(Object.isFrozen(latest) && Object.isFrozen(latest.runtimeCommittedStatus) && Object.isFrozen(latest.runtimePresentationProfile));

    for (const [field, value] of Object.entries({ lifecycleStatus: 'awake', executionState: 'thinking', statusText: 'New status' })) {
      const beforeChange = renders;
      const presentation = latest.runtimePresentationProfile;
      await act(async () => first.publish({ ...first.getSnapshot(), state: { ...first.getSnapshot().state,
        cognition: { ...first.getSnapshot().state.cognition, [field]: value },
      } }));
      assert.equal(renders, beforeChange + 1, `${field} is consumed by chat`);
      assert.equal(latest.runtimePresentationProfile, presentation, 'cognition does not churn the presentation object');
    }
    for (const [field, value] of Object.entries({ backendKind: 'live2d', avatarAssetRef: 'avatar:next', expressionProfileRef: 'expression:next',
      idlePreset: 'idle:next', interactionPolicyRef: 'policy:next', defaultVoiceReference: 'preset_voice_id:next', avatarAutoplay: false, backgroundRef: 'background:next' })) {
      const beforeChange = renders;
      const cognition = latest.runtimeCommittedStatus;
      await act(async () => first.publish({ ...first.getSnapshot(), state: { ...first.getSnapshot().state,
        appearance: { ...first.getSnapshot().state.appearance, [field]: value },
      } }));
      assert.equal(renders, beforeChange + 1, `${field} remains part of the complete presentation`);
      assert.equal(latest.runtimeCommittedStatus, cognition, 'presentation does not churn the cognition object');
    }
    await act(async () => first.publish({ ...first.getSnapshot(), phase: 'loading' }));
    assert.equal(latest.runtimeCommittedStatus, null);
    assert.equal(latest.runtimePresentationProfile, firstProjection.runtimePresentationProfile, 'loading preserves this Session initial presentation');
    await act(async () => first.publish({ ...first.getSnapshot(), phase: 'ready', state: { ...first.getSnapshot().state,
      appearance: { ...first.getSnapshot().state.appearance, status: 'loading' },
    } }));
    assert.notEqual(latest.runtimeCommittedStatus, null);
    assert.equal(latest.runtimePresentationProfile, null);

    const second = session(initial);
    const secondStore = createAgentConversationDisplayStore(second);
    assert.notEqual(secondStore.getSnapshot(), firstProjection, 'equal fields in another Session have their own projection');
    assert.notEqual(secondStore.getSnapshot().runtimePresentationProfile, firstProjection.runtimePresentationProfile);
    await act(async () => root.render(React.createElement(Parent, { store: secondStore })));
    const afterReplacement = renders;
    const secondProjection = latest;
    await act(async () => first.publish(initial));
    assert.equal(renders, afterReplacement, 'the previous Session can no longer notify this consumer');
    assert.equal(latest, secondProjection);
    await act(async () => second.publish({ ...initial, state: { ...initial.state,
      cognition: { ...initial.state.cognition, statusText: 'Second Session status' },
    } }));
    assert.equal(renders, afterReplacement + 1);

    const loading = session({ ...initial, phase: 'loading', reads: { appearance: 'pending' },
      state: { ...initial.state, appearance: { status: 'loading' } } });
    const loadingStore = createAgentConversationDisplayStore(loading);
    await act(async () => root.render(React.createElement(Parent, { store: loadingStore })));
    const loadingRenders = renders;
    assert.equal(latest.runtimeCommittedStatus, null);
    assert.equal(latest.runtimePresentationProfile, null, 'another Session never borrows the previous scene');
    await act(async () => loading.publish({ ...initial, phase: 'loading', reads: { appearance: 'loaded' } }));
    assert.equal(renders, loadingRenders, 'partial appearance/reads are for the Center, not the chat scene');
    assert.equal(latest.runtimePresentationProfile, null);
    await act(async () => loading.publish({ ...initial, reads: { appearance: 'loaded' } }));
    assert.equal(renders, loadingRenders + 1, 'the complete initial read updates chat once');
    assert.equal(renderedProjection().runtimePresentationProfile?.avatarAssetRef, 'avatar:current');
    assert.notEqual(latest.runtimeCommittedStatus, null);
  } finally {
    stopFull();
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
