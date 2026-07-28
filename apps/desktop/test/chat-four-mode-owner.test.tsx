import assert from 'node:assert/strict';
import test from 'node:test';

import type { AIScopeRef } from '@nimiplatform/sdk/ai';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';

const NIMI_SCOPE: AIScopeRef = { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'nimi' };
const AGENT_SCOPE: AIScopeRef = { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'agent' };

test('the chat mode switcher exercises exactly the four product modes', async () => {
  const {
    setActiveScopeForMode,
    getActiveScopeMode,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const FOUR_MODES: readonly ConversationMode[] = ['human', 'ai', 'agent', 'group'];
  const originalMode = getActiveScopeMode();
  try {
    // Each of the four product modes is an accepted switcher input; switching
    // never throws and the active-scope module tracks the selected mode.
    for (const mode of FOUR_MODES) {
      setActiveScopeForMode(mode);
      assert.equal(getActiveScopeMode(), mode);
    }
  } finally {
    setActiveScopeForMode(originalMode);
  }
});

test('Nimi binds feature:desktop.chat:nimi; Agent binds feature:desktop.chat:agent', async () => {
  const {
    resolveChatModeAIScopeRef,
    setActiveScopeForMode,
    getActiveScope,
    getActiveScopeMode,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const originalMode = getActiveScopeMode();
  try {
    // Static resolution — built-in chat scopes use the canonical `feature` shape.
    assert.deepEqual(resolveChatModeAIScopeRef('ai'), NIMI_SCOPE);
    assert.deepEqual(resolveChatModeAIScopeRef('agent'), AGENT_SCOPE);
    assert.equal(NIMI_SCOPE.kind, 'feature');
    assert.equal(AGENT_SCOPE.kind, 'feature');

    // Live switch — entering Nimi/Agent mode rebinds the active scope to the
    // canonical built-in feature scope, never the generic app:desktop:chat.
    setActiveScopeForMode('ai');
    assert.deepEqual(getActiveScope(), NIMI_SCOPE);
    setActiveScopeForMode('agent');
    assert.deepEqual(getActiveScope(), AGENT_SCOPE);
  } finally {
    setActiveScopeForMode(originalMode);
  }
});

test('Human binds no built-in chat scope', async () => {
  const {
    resolveChatModeAIScopeRef,
    setActiveScopeForMode,
    getActiveScope,
    getActiveScopeMode,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const originalMode = getActiveScopeMode();
  try {
    assert.equal(resolveChatModeAIScopeRef('human'), null);
    setActiveScopeForMode('human');
    // Human is a Realm-owned thread surface — it binds no built-in chat
    // AIConfig scope, and specifically not the generic app:desktop:chat scope.
    assert.equal(getActiveScope(), null);
  } finally {
    setActiveScopeForMode(originalMode);
  }
});

test('Group binds no built-in chat scope', async () => {
  const {
    setActiveScopeForMode,
    resolveChatModeAIScopeRef,
    getActiveScope,
    getActiveScopeMode,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const originalMode = getActiveScopeMode();
  try {
    assert.equal(resolveChatModeAIScopeRef('group'), null);
    setActiveScopeForMode('group');
    assert.equal(getActiveScope(), null);
  } finally {
    setActiveScopeForMode(originalMode);
  }
});

test('agent-conversation-launcher requires localAgentRef and throws without it', async () => {
  const { launchAgentConversationFromDisplay } = await import(
    '../src/shell/renderer/features/chat/agent-conversation-launcher.js'
  );
  let setChatModeCalls = 0;
  await assert.rejects(
    () => launchAgentConversationFromDisplay({
      target: {
        ownerUserId: 'user-1',
        runtimeSourceRef: 'runtime-source-1',
        localAgentRef: '',
        displayName: 'Runtime Source',
        handle: 'runtime-source',
        avatarUrl: null,
        worldId: 'world-1',
        worldName: 'World',
        bio: null,
        ownershipType: null,
        greeting: null,
        builtinDocsContext: null,
      },
      setActiveTab: () => {},
      setChatMode: () => { setChatModeCalls += 1; },
      setSelectedTargetForSource: () => {},
      setAgentConversationSelection: () => {},
      setAgentConversationTargetSnapshot: () => {},
    }),
    /Agent conversation launch requires localAgentRef/,
  );
  assert.equal(setChatModeCalls, 0);
});

test('agent conversation launcher can prefill composer without authoring a thread', async () => {
  const { launchAgentConversationFromDisplay } = await import(
    '../src/shell/renderer/features/chat/agent-conversation-launcher.js'
  );
  const observedEffects = new Set<string>();
  let pendingPrefill: { localAgentRef: string; text: string } | null = null;

  await launchAgentConversationFromDisplay({
    target: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source-1',
      localAgentRef: 'local-agent:user-1:agent-7',
      displayName: 'Runtime Source',
      handle: 'runtime-source',
      avatarUrl: null,
      worldId: 'world-1',
      worldName: 'World',
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
    initialComposerText: '  他为什么被称为阳明学派思想家与朝廷重臣？  ',
    setPendingAgentComposerPrefill: (input) => {
      observedEffects.add('prefill');
      pendingPrefill = input;
    },
    setActiveTab: () => { observedEffects.add('tab'); },
    setChatMode: () => { observedEffects.add('mode'); },
    setSelectedTargetForSource: () => { observedEffects.add('target'); },
    setAgentConversationSelection: () => { observedEffects.add('selection'); },
    setAgentConversationTargetSnapshot: () => { observedEffects.add('snapshot'); },
  });

  assert.deepEqual(pendingPrefill, {
    localAgentRef: 'local-agent:user-1:agent-7',
    text: '他为什么被称为阳明学派思想家与朝廷重臣？',
  });
  assert.deepEqual(
    observedEffects,
    new Set(['snapshot', 'target', 'selection', 'prefill', 'mode', 'tab']),
  );
});
