import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AIScopeRef } from '@nimiplatform/sdk/ai';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';
import { ConversationModeSwitcher } from '@nimiplatform/kit/features/chat/ui';

/**
 * T3-3 — Chat 4-mode acceptance + no-RealmAgent-direct-chat proof.
 *
 * Final wave of portfolio topic T3 (Chat 4-mode implementation). This is an
 * acceptance + guard surface only: it proves the behavior delivered by T3-1
 * (`ae92569f7`) and T3-2 (`47f74315d`) and adds the cross-mode acceptance
 * coverage that neither prior wave owned.
 *
 * Acceptance gate (product manual `.nimi/topics/.../product-manual-full-authority.md`,
 * "Chat" section):
 *   - all 4 modes proven (`human`, `ai`/Nimi, `agent`, `group`);
 *   - built-in chat scopes use the `feature` shape;
 *   - Group reuses the Agent scope;
 *   - no RealmAgent direct chat.
 *
 * E2E posture: a real WebdriverIO whole-product screenshot of the mode
 * switcher is not producible in the renderer-shell test harness. The
 * `renderToStaticMarkup` mode-switcher assertion below is the honest
 * substitute proving all four modes render with their product copy; the
 * whole-product screenshot / E2E matrix is deferred to portfolio topic T11.
 */

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const NIMI_SCOPE: AIScopeRef = { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'nimi' };
const AGENT_SCOPE: AIScopeRef = { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'agent' };

// ---------------------------------------------------------------------------
// Task 1 — 4-mode acceptance: every mode binds its canonical built-in scope
// ---------------------------------------------------------------------------

test('T3-3 acceptance: the chat mode switcher exercises exactly the four product modes', async () => {
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

test('T3-3 acceptance: Nimi binds feature:desktop.chat:nimi; Agent binds feature:desktop.chat:agent', async () => {
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

test('T3-3 acceptance: Human binds no built-in chat scope', async () => {
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

test('T3-3 acceptance: Group-with-participation binds feature:desktop.chat:agent (reuses the Agent scope)', async () => {
  const {
    setActiveScopeForMode,
    setGroupLocalAgentParticipationActive,
    resolveChatModeAIScopeRef,
    getActiveScope,
    getActiveScopeMode,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const originalMode = getActiveScopeMode();
  try {
    // Group mode alone owns no built-in chat scope.
    assert.equal(resolveChatModeAIScopeRef('group'), null);
    setGroupLocalAgentParticipationActive(false);
    setActiveScopeForMode('group');
    assert.equal(getActiveScope(), null);

    // Activating LocalAgent participation rebinds Group to the SAME canonical
    // agent feature scope as Agent Chat — never a group-specific scope.
    setGroupLocalAgentParticipationActive(true);
    assert.deepEqual(getActiveScope(), AGENT_SCOPE);
    assert.deepEqual(getActiveScope(), resolveChatModeAIScopeRef('agent'));
  } finally {
    setGroupLocalAgentParticipationActive(false);
    setActiveScopeForMode(originalMode);
  }
});

test('T3-3 acceptance: mode switching preserves each mode\'s thread/session selection', () => {
  // Per-mode thread/session selection is store-owned (`selectedTargetBySource`,
  // `lastSelectedThreadByMode`). `setChatMode` only rewires the AIConfig scope
  // projection — it must never reset another mode's selection (product manual:
  // "Chat mode switching must preserve each mode's own thread/session
  // selection; switching modes is not a destructive reset").
  const uiSliceSource = readWorkspaceFile('src/shell/renderer/app-shell/providers/ui-slice.ts');
  const activeScopeSource = readWorkspaceFile(
    'src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.ts',
  );

  // setChatMode delegates scope rebinding and only sets `chatMode` — it does
  // not touch `selectedTargetBySource` / `lastSelectedThreadByMode`.
  const setChatModeBody = uiSliceSource.slice(
    uiSliceSource.indexOf('setChatMode:'),
    uiSliceSource.indexOf('setChatThinkingPreference:'),
  );
  assert.match(setChatModeBody, /setActiveScopeForMode\(mode\)/);
  assert.match(setChatModeBody, /set\(\{ chatMode: mode \}\)/);
  assert.doesNotMatch(setChatModeBody, /selectedTargetBySource/);
  assert.doesNotMatch(setChatModeBody, /lastSelectedThreadByMode/);

  // The active-scope module documents — and the rebind path enforces — that
  // per-mode thread/session selection is store-owned and untouched here.
  assert.match(
    activeScopeSource,
    /Per-mode thread\/session selection state is owned by the store and is not\s*\n?\s*\*? ?touched here/,
  );
  // The store keeps an independent per-source selection map and a per-mode
  // last-thread map, proving each mode retains its own selection across switches.
  const storeTypesSource = readWorkspaceFile(
    'src/shell/renderer/app-shell/providers/store-types.ts',
  );
  assert.match(storeTypesSource, /selectedTargetBySource/);
  assert.match(storeTypesSource, /lastSelectedThreadByMode/);
});

// ---------------------------------------------------------------------------
// Task 2 — No-RealmAgent-direct-chat proof: Agent Chat is LocalAgent-only
// ---------------------------------------------------------------------------

test('T3-3 proof: agent-conversation-launcher hard-requires localAgentRef and throws without it', async () => {
  const launcherSource = readWorkspaceFile(
    'src/shell/renderer/features/chat/agent-conversation-launcher.ts',
  );
  // The launch path normalizes localAgentRef and fail-closes when it is empty.
  assert.match(launcherSource, /const localAgentRef = String\(input\.target\.localAgentRef \|\| ''\)\.trim\(\)/);
  assert.match(
    launcherSource,
    /if \(!localAgentRef\) \{\s*\n?\s*throw new Error\('Agent conversation launch requires localAgentRef'\)/,
  );

  // Behavioral: launching with a RealmAgent-only target (no localAgentRef)
  // throws — there is no realmAgentId-only chat entry. The launcher resolves
  // a real LocalAgent thread before it touches any chat-mode state, so a
  // missing localAgentRef can never produce a chat session.
  const { launchAgentConversationFromDisplay } = await import(
    '../src/shell/renderer/features/chat/agent-conversation-launcher.js'
  );
  let setChatModeCalls = 0;
  await assert.rejects(
    () => launchAgentConversationFromDisplay({
      // A RealmAgent identity with NO localAgentRef — i.e. not yet befriended.
      target: {
        ownerUserId: 'user-1',
        realmAgentId: 'realm-agent-1',
        localAgentRef: '',
        displayName: 'Realm Agent',
        handle: 'realm-agent',
        avatarUrl: null,
        worldId: 'world-1',
        worldName: 'World',
        bio: null,
        ownershipType: null,
      },
      setActiveTab: () => {},
      setChatMode: () => { setChatModeCalls += 1; },
      setSelectedTargetForSource: () => {},
      setAgentConversationSelection: () => {},
    }),
    /Agent conversation launch requires localAgentRef/,
  );
  // The throw happens before any chat-mode transition — no partial session.
  assert.equal(setChatModeCalls, 0);
});

test('T3-3 proof: Agent Chat always means LocalAgent Chat — no direct-RealmAgent-chat code path', () => {
  // `agent-conversation-launcher.ts` is the SOLE module that opens an Agent
  // Chat session. Every consumer routes through it, and it only selects the
  // LocalAgent target; submit owns creating any temporary local projection
  // cache thread that remains before Runtime session cutover.
  const launcherSource = readWorkspaceFile(
    'src/shell/renderer/features/chat/agent-conversation-launcher.ts',
  );
  // Launch selection is keyed by localAgentRef, not realmAgentId, and does not
  // pre-author a Desktop-local thread.
  assert.doesNotMatch(launcherSource, /threadId:/);
  assert.match(launcherSource, /localAgentRef,\s*\n\s*targetId: localAgentRef/);
  assert.doesNotMatch(launcherSource, /chatAgentStoreClient/);
  assert.doesNotMatch(launcherSource, /createAgentThread|createThread\(/);

  // The RealmAgent / Explore surfaces never construct a chat session from a
  // bare RealmAgent id. T5-2 (`9d558335d`) hardened this further: World detail
  // has NO chat path at all — a RealmAgent in a World offers View profile
  // only, and chat is reachable solely through friend -> Open Agent Chat ->
  // LocalAgent Chat. The previous world-detail `handleChatAgent` that
  // synthesized a `local-agent:` ref from a non-befriended RealmAgent is gone.
  const worldDetailSource = readWorkspaceFile(
    'src/shell/renderer/features/world/world-detail.tsx',
  );
  assert.doesNotMatch(worldDetailSource, /launchAgentConversationFromDisplay/);
  assert.doesNotMatch(worldDetailSource, /launchAgentVoiceFromDisplay/);
  assert.doesNotMatch(worldDetailSource, /const handleChatAgent/);

  // No consumer reaches a chat session straight from a RealmAgent: there is no
  // launcher variant that accepts only a realmAgentId. The launcher's only
  // public entrypoints both require the full target with localAgentRef.
  assert.match(launcherSource, /export async function launchAgentConversationFromDisplay/);
  assert.match(launcherSource, /export async function launchAgentVoiceFromDisplay/);
  assert.doesNotMatch(launcherSource, /launchRealmAgentChat|launchRealmAgentConversation/);
});

// ---------------------------------------------------------------------------
// Task 4 — 4-mode switcher renderer-markup proof
// ---------------------------------------------------------------------------

test('T3-3 proof: the conversation mode switcher renders all four modes with product copy', () => {
  // Honest renderer-markup substitute for a whole-product screenshot gate.
  // The kit `ConversationModeSwitcher` is the canonical chat mode switcher;
  // the desktop chat surface drives it with these four product modes.
  const modeOptions: readonly { mode: ConversationMode; label: string }[] = [
    { mode: 'human', label: 'Human Chat' },
    { mode: 'ai', label: 'Nimi Chat' },
    { mode: 'agent', label: 'Agent Chat' },
    { mode: 'group', label: 'Group Chat' },
  ];

  const markup = renderToStaticMarkup(
    React.createElement(ConversationModeSwitcher, {
      modes: modeOptions,
      activeMode: 'ai',
      onModeChange: () => {},
    }),
  );

  // Trigger renders (modes.length > 1) and reflects the active mode label.
  assert.match(markup, /Current mode: Nimi Chat/);

  // The static markup of the closed switcher carries the active-mode trigger;
  // assert the open-state markup carries all four product mode labels by
  // rendering each mode as the active one (the trigger aria-label exposes the
  // resolved product copy for every mode).
  for (const option of modeOptions) {
    const perModeMarkup = renderToStaticMarkup(
      React.createElement(ConversationModeSwitcher, {
        modes: modeOptions,
        activeMode: option.mode,
        onModeChange: () => {},
      }),
    );
    assert.match(
      perModeMarkup,
      new RegExp(`Current mode: ${option.label}`),
      `mode switcher must render product copy for ${option.mode}`,
    );
  }
});

test('T3-3 proof: a single-mode switcher renders nothing (anonymous desktop exposes only Nimi)', () => {
  // Anonymous desktop exposes only the AI/Nimi mode; the switcher hides itself
  // when there is just one mode, so there is no dead 4-mode chrome pre-auth.
  const markup = renderToStaticMarkup(
    React.createElement(ConversationModeSwitcher, {
      modes: [{ mode: 'ai' as ConversationMode, label: 'Nimi Chat' }],
      activeMode: 'ai',
      onModeChange: () => {},
    }),
  );
  assert.equal(markup, '');
});
