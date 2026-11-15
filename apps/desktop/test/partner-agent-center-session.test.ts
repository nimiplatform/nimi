import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';

import { useDesktopAgentCenterSession } from '../src/shell/renderer/features/agents/agent-center-session.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { RuntimeAccountAuthProjection } from '../src/shell/renderer/app-shell/providers/store-types.js';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import type { NimiLocalAppAgentConfigureClient } from '@nimiplatform/sdk/app';
import type { AgentCenterSession } from '@nimiplatform/kit/features/agent-center';
import { testManagerActionAvailability } from '../../../kit/features/agent-center/test/session-fixture.js';

test('Home keeps its real Manager Session across continuous Account refresh without retrying failed preview', async () => {
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React,
    IS_REACT_ACT_ENVIRONMENT: true,
    __NIMI_ELECTRON_TEST__: { invoke: async () => { throw new Error('Unexpected Shell mutation'); } },
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const unused = async (): Promise<never> => { throw new Error('Unexpected owner mutation'); };
  // Script only the owner/Host replies; the hook constructs and subscribes to
  // the production nominal Manager Session, including its automatic first read.
  const configure: NimiLocalAppAgentConfigureClient = {
    manager: { async snapshot() {
      return {
        lifecycleStatus: 'active', executionState: 'idle', statusText: 'Ready', currentEmotion: '',
        source: null, context: null, conversationContext: null,
        life: { activities: [], revision: '1', current: null, recent: [], future: [], nextCheckAt: null, waitReason: '' },
        actionAvailability: testManagerActionAvailability(),
      };
    } },
    sharedAIConfig: {
      async get() { return { config: null, revision: '0', effectiveSelections: [], participation: [] }; },
      overwrite: unused,
      async listOptions(query) {
        if (query.kind === 'voice-assets') return { kind: 'voice-assets', options: [], truncated: false };
        if (query.kind === 'preset-voices') return { kind: 'preset-voices', options: [], truncated: false };
        throw new Error('Unexpected options read');
      },
    },
    autonomy: {
      async snapshot() {
        return { enabled: false, autonomyRevision: '1', usedTokensInWindow: 0, budgetExhausted: false,
          config: { mode: 'off', freeContactEnabled: false, quietHours: null, maxFreeContactsPerDay: 3,
            dailyTokenBudget: 0, maxBackgroundOutputTokens: 0 } };
      },
      update: unused,
    },
    presentation: {
      async snapshot() {
        return { presentationRevision: '8', previousProfile: null, resourcePackSelection: null,
          defaultVoiceReference: '', avatarAutoplay: false,
          profile: { revision: '8', backendKind: 'live2d', avatarAssetRef: 'avatar:committed', expressionProfileRef: '',
            idlePreset: '', interactionPolicyRef: '', defaultVoiceReference: '', avatarAutoplay: false, backgroundAssetRef: '' } };
      },
      readAsset: unused, commit: unused,
    },
    memory: {
      async inspect() {
        return { outcome: 'unconfigured', enabled: false, adoptionRequired: true, items: [],
          currentCount: 0, supersededCount: 0, forgottenCount: 0, nextPageToken: null };
      },
      correct: unused, forget: unused, setEnabled: unused, deleteAll: unused,
    },
    conversationContext: { update: unused },
  };
  let creations = 0;
  let previewCalls = 0;
  const product = {
    agentConfigure: configure,
    agents: { getIntroduction: async () => ({ voiceSampleUrl: null }) },
    aiConfig: { get: async () => ({ config: null, revision: '0', effectiveSelections: [] }) },
  };
  const bindings = {
    sdk: { appProduct() { creations++; return product; } },
    app: { commands: { avatarHandoff: { async preview(input: { avatarAssetRef: string; backendKind: 'live2d' | 'vrm' }) {
      previewCalls++;
      return { state: 'unavailable', tier: 'avatar_preview_service', avatarAssetRef: input.avatarAssetRef,
        backendKind: input.backendKind, previewMaterialRef: null, previewImageRef: null,
        reason: 'Preview timed out.', warnings: [] };
    } } } },
  } as unknown as DesktopCanonicalRendererBindings;
  const target: AgentLocalTargetSnapshot = {
    agentHandle: `agent_ref_${'a'.repeat(43)}`, conversationAnchorId: 'anchor-current', displayName: 'Partner',
    handle: '', avatarUrl: null, worldId: null, worldName: null, bio: null, ownershipType: null,
    greeting: null, builtinDocsContext: null,
  };
  let latest: AgentCenterSession | null = null;
  const subscribeEmpty = () => () => {};
  const readEmpty = () => null;
  function Harness() {
    latest = useDesktopAgentCenterSession(target);
    useSyncExternalStore(latest?.subscribe ?? subscribeEmpty, latest?.getSnapshot ?? readEmpty, readEmpty);
    return null;
  }
  const current = () => latest;
  let sequence = 0;
  const auth = (patch: Partial<RuntimeAccountAuthProjection> = {}): RuntimeAccountAuthProjection => ({
    status: 'authenticated', sequence: String(++sequence), reasonCode: 0, accountReasonCode: 0,
    authorizationRevision: 'revision-A', user: { id: 'account-A', realmEnvironmentId: 'realm-A', displayName: 'User' },
    ...patch,
  });
  const projectAuth = (projection: RuntimeAccountAuthProjection) => store.getState().applyRuntimeAccountProjection(projection);
  const settle = async () => {
    for (let count = 0; current()?.getSnapshot().phase === 'loading' && count < 20; count++) {
      await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
    }
    assert.equal(current()?.getSnapshot().phase, 'ready');
  };
  try {
    projectAuth(auth({ status: 'refresh-pending' }));
    await act(async () => root.render(React.createElement(AppStoreProvider, { store },
      React.createElement(DesktopRendererBindingProvider, { bindings }, React.createElement(Harness)))));
    assert.equal(current(), null, 'pending refresh cannot create a Session before authenticated admission');
    assert.equal(creations, 0);

    await act(async () => projectAuth(auth()));
    await settle();
    const first = current()!;
    assert.equal(first.getSnapshot().state.appearance.renderState, 'unavailable');
    assert.equal(creations, 1);
    assert.equal(previewCalls, 1);
    for (const status of ['refresh-pending', 'authenticated', 'authenticated'] as const) {
      await act(async () => projectAuth(auth({ status, user: { id: 'account-A', realmEnvironmentId: 'realm-A', displayName: 'Updated name' } })));
      assert.equal(current(), first);
      assert.equal(first.getSnapshot().phase, 'ready');
      assert.equal(creations, 1);
      assert.equal(previewCalls, 1, 'a continuous refresh must not automatically retry the failed tuple');
    }
    await act(async () => { await first.refresh(); });
    assert.equal(previewCalls, 2, 'an explicit fresh read remains available; there is no failure cache');

    await act(async () => projectAuth(auth({ status: 'refresh-pending', authorizationRevision: 'revision-B' })));
    assert.equal(current(), null);
    await assert.rejects(first.refresh(), /invalidated/u);
    await act(async () => projectAuth(auth({ authorizationRevision: 'revision-B' })));
    await settle();
    const revised = current()!;
    assert.notEqual(revised, first);
    assert.equal(creations, 2);

    await act(async () => projectAuth(auth({ authorizationRevision: 'revision-B', user: { id: 'account-B', realmEnvironmentId: 'realm-A' } })));
    await settle();
    const changedAccount = current()!;
    assert.notEqual(changedAccount, revised);
    await assert.rejects(revised.refresh(), /invalidated/u);
    await act(async () => projectAuth(auth({ authorizationRevision: 'revision-B', user: { id: 'account-B', realmEnvironmentId: 'realm-B' } })));
    await settle();
    const changedRealm = current()!;
    assert.notEqual(changedRealm, changedAccount);
    await assert.rejects(changedAccount.refresh(), /invalidated/u);

    await act(async () => {
      store.getState().clearAuthSession();
      projectAuth(auth({ authorizationRevision: 'revision-B', user: { id: 'account-B', realmEnvironmentId: 'realm-B' } }));
    });
    await settle();
    assert.notEqual(current(), changedRealm, 'a batched sign-out/sign-in never revives the old Session');
    await assert.rejects(changedRealm.refresh(), /invalidated/u);
    const beforeSignOut = current()!;
    await act(async () => store.getState().clearAuthSession());
    assert.equal(current(), null);
    await assert.rejects(beforeSignOut.refresh(), /invalidated/u);
    assert.equal(creations, 5);
    assert.equal(previewCalls, 6);
  } finally {
    await act(async () => root.unmount());
    store.navigation.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
