import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { AIScopeRef } from '@nimiplatform/sdk/ai';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';

const NIMI_SCOPE: AIScopeRef = { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'nimi' };

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('the desktop-owned chat layout preserves a full-height chain for every mode', () => {
  const panelStackSource = readDesktopFile(
    'src/shell/renderer/app-shell/layouts/main-layout-panel-stack.tsx',
  );
  const chatPageSource = readDesktopFile(
    'src/shell/renderer/features/chat/chat-page.tsx',
  );
  const canonicalFrameSource = readDesktopFile(
    'src/shell/renderer/features/chat/chat-canonical-mode-frame.tsx',
  );
  const rendererFactorySource = readDesktopFile(
    'src/shell/renderer/renderer/factory.tsx',
  );
  const rendererStylesSource = readDesktopFile(
    'src/shell/renderer/styles.css',
  );

  assert.match(
    rendererFactorySource,
    /data-nimi-semantic-id="desktop-main-content"\s+className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"/u,
  );
  assert.match(
    rendererStylesSource,
    /:scope\[data-nimi-semantic-id="desktop-main-root"\]\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;/su,
  );
  assert.match(
    rendererStylesSource,
    /:scope \[data-nimi-semantic-id="desktop-main-content"\]\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 0%;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su,
  );
  assert.match(
    panelStackSource,
    /<MotionPanelFrame panelId="chat" className="flex h-full min-h-0 flex-1">/u,
  );
  assert.match(
    chatPageSource,
    /data-chat-page-layout="split" className="relative flex h-full min-h-0 min-w-0 flex-1"/u,
  );
  assert.match(
    canonicalFrameSource,
    /cn\('flex h-full min-h-0 min-w-0 flex-1', props\.className\)/u,
  );
  assert.match(
    canonicalFrameSource,
    /<CanonicalConversationShell[\s\S]*className="h-full min-h-0 flex-1"/u,
  );
});

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

test('Nimi binds feature:desktop.chat:nimi; Agent binds no Desktop-owned chat scope', async () => {
  const {
    resolveChatModeAIScopeRef,
    setActiveScopeForMode,
    getActiveScope,
    getActiveScopeMode,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const originalMode = getActiveScopeMode();
  try {
    // Static resolution — the Nimi built-in chat scope uses the canonical
    // `feature` shape; Agent chat binds no Desktop-owned scope (P-AISC-006):
    // the Runtime projects the selected LocalAgent's local-agent scope instead.
    assert.deepEqual(resolveChatModeAIScopeRef('ai'), NIMI_SCOPE);
    assert.equal(resolveChatModeAIScopeRef('agent'), null);
    assert.equal(NIMI_SCOPE.kind, 'feature');

    // Live switch — entering Nimi mode rebinds the active scope to the
    // canonical built-in feature scope, never the generic app:desktop:chat;
    // entering Agent mode clears the Desktop-owned active scope.
    setActiveScopeForMode('ai');
    assert.deepEqual(getActiveScope(), NIMI_SCOPE);
    setActiveScopeForMode('agent');
    assert.equal(getActiveScope(), null);
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
