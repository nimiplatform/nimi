import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import type { AIScopeRef } from '@nimiplatform/sdk/ai';

/**
 * Phase 5: Multi-scope contract tests.
 *
 * Verifies:
 * - Scope-keyed persistence (P-AISC-001, P-AISC-003)
 * - Multi-scope config isolation (no inheritance)
 * - Multi-scope subscribe behavior (S-AICONF-006)
 * - Multi-scope snapshot latest lookup
 * - listScopes returns real scope list
 */

// ---------------------------------------------------------------------------
// Source-level structural tests (no DOM / localStorage needed)
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const storageSource = readSource('src/shell/renderer/app-shell/providers/desktop-ai-config-storage.ts');
const serviceSource = readSource('src/shell/renderer/app-shell/providers/desktop-ai-config-service.ts');
const snapshotStoreSource = readSource('src/shell/renderer/app-shell/providers/desktop-ai-config-snapshot-store.ts');
const runtimeSliceSource = readSource('src/shell/renderer/app-shell/providers/runtime-slice.ts');
const activeScopeSource = readSource('src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.ts');

test('multi-scope: persistence layer uses scope-keyed storage keys', () => {
  // Scope index key
  assert.match(storageSource, /nimi\.ai-config\.scope-index\.v2/);
  // Per-scope key prefix
  assert.match(storageSource, /nimi\.ai-config\.scope\./);
  // Multi-scope API functions exist
  assert.match(storageSource, /function loadAIConfigForScope\(/);
  assert.match(storageSource, /function persistAIConfigForScope\(/);
  assert.match(storageSource, /function listPersistedScopeKeys\(/);
  assert.match(storageSource, /function parseScopeKey\(/);
  assert.match(storageSource, /function scopeKeyFromRef\(/);
});

test('multi-scope: persistence layer has no legacy migration or compat shim (hard cut)', () => {
  assert.doesNotMatch(storageSource, /LEGACY_SINGLE_KEY/);
  assert.doesNotMatch(storageSource, /migrateLegacySingleKey/);
  assert.doesNotMatch(storageSource, /function loadAIConfig\(/);
  assert.doesNotMatch(storageSource, /function persistAIConfig\(/);
  assert.doesNotMatch(storageSource, /nimi\.ai-config\.v1/);
});

test('multi-scope: shared Desktop host service maintains config by scope map', () => {
  // configByScope map for multi-scope state
  assert.match(serviceSource, /configByScope/);
  assert.match(serviceSource, /new Map/);
  // get reads from scope map
  assert.match(serviceSource, /function getConfigForScope\(/);
  // commitConfig writes to scope map
  assert.match(serviceSource, /configByScope\.set\(key, config\)/);
  // listScopes iterates the map
  assert.match(serviceSource, /configByScope\.keys\(\)/);
});

test('multi-scope: read fallback does not mark a scope as initialized', () => {
  assert.match(serviceSource, /materializedScopeKeys/);
  assert.match(serviceSource, /materializedScopeKeys\.add\(key\)/);
  assert.match(serviceSource, /materializedScopeKeys\.has\(key\)/);
  assert.doesNotMatch(serviceSource, /scopeHasPersistedConfig[\s\S]{0,220}configByScope\.has\(key\)/);
});

test('multi-scope: shared Desktop host service listScopes returns real scope refs from map', () => {
  // listScopes must iterate configByScope, not return hardcoded single scope
  assert.match(serviceSource, /listScopes\(\): AIScopeRef\[\]/);
  assert.match(serviceSource, /for \(const key of configByScope\.keys\(\)\)/);
  assert.match(serviceSource, /parseScopeKey\(key\)/);
});

test('multi-scope: shared Desktop host service subscribe is scoped (S-AICONF-006)', () => {
  // Subscription keyed by scope
  assert.match(serviceSource, /createAIConfigSubscriptionRegistry/);
  assert.match(serviceSource, /resolveScopeKey: \(config\) => scopeKey\(config\.scopeRef\)/);
  assert.match(serviceSource, /configSubscriptions\.subscribe\(scopeKey\(scopeRef\), callback\)/);
  assert.doesNotMatch(serviceSource, /from '\.\/desktop-ai-config-subscriptions\.js'/);
});

test('multi-scope: runtime-slice dynamically checks the mode-aware active chat scope for store sync', () => {
  // Uses getActiveScope() dynamically, not a fixed capture at bootstrap
  assert.match(runtimeSliceSource, /getActiveScope\(\)/);
  // Store-sync filter guards against a null active scope (Human/Group mode)
  assert.match(runtimeSliceSource, /const activeScope = getActiveScope\(\)/);
  assert.match(runtimeSliceSource, /scopeKeyFromRef\(activeScope\)/);
  assert.match(runtimeSliceSource, /getDesktopAIConfigService\(\)\.aiConfig\.get\(initialActiveScope\)/);
  // No fixed activeScopeKey const
  assert.doesNotMatch(runtimeSliceSource, /const activeScopeKey\b/);
});

test('multi-scope: snapshot getLatest is scope-keyed', () => {
  assert.match(snapshotStoreSource, /createScopedAISnapshotStore/);
  assert.match(snapshotStoreSource, /@nimiplatform\/kit\/core\/storage-json/);
  assert.match(serviceSource, /snapshotStore\.record\(snapshot\)/);
  assert.match(serviceSource, /snapshotStore\.getLatest\(scopeRef\)/);
});

test('multi-scope: no implicit scope inheritance (P-AISC-003)', () => {
  // getConfigForScope delegates to loadAIConfigForScope which creates empty config for unknown scope
  assert.match(serviceSource, /loadAIConfigForScope/);
  // No runtime fallback chain between scopes (doc comments about the rule are fine)
  assert.doesNotMatch(serviceSource, /fallbackScope|parentScope|inheritFrom/i);
});

// ---------------------------------------------------------------------------
// Scope key utility tests
// ---------------------------------------------------------------------------

test('multi-scope: scopeKeyFromRef produces correct keys', async () => {
  const { scopeKeyFromRef } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  assert.equal(scopeKeyFromRef({ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }), 'app:desktop:chat');
  assert.equal(scopeKeyFromRef({ kind: 'app', ownerId: 'my-app' }), 'app:my-app:');
  assert.equal(scopeKeyFromRef({ kind: 'feature', ownerId: 'x', surfaceId: 'y' }), 'feature:x:y');
});

test('multi-scope: parseScopeKey round-trips with scopeKeyFromRef', async () => {
  const { scopeKeyFromRef, parseScopeKey } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  const ref: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };
  const key = scopeKeyFromRef(ref);
  const parsed = parseScopeKey(key);
  assert.ok(parsed);
  assert.equal(parsed.kind, 'app');
  assert.equal(parsed.ownerId, 'desktop');
  assert.equal(parsed.surfaceId, 'chat');
});

test('multi-scope: parseScopeKey handles scope without surfaceId', async () => {
  const { parseScopeKey } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  const parsed = parseScopeKey('app:my-app:');
  assert.ok(parsed);
  assert.equal(parsed.kind, 'app');
  assert.equal(parsed.ownerId, 'my-app');
  assert.equal(parsed.surfaceId, undefined);
});

test('multi-scope: scope keys round-trip app owner ids with colons', async () => {
  const { scopeKeyFromRef, parseScopeKey } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  const ref: AIScopeRef = {
    kind: 'app',
    ownerId: 'core:runtime',
    surfaceId: 'launcher',
  };
  const key = scopeKeyFromRef(ref);
  assert.equal(key, 'app:core%3Aruntime:launcher');
  assert.deepEqual(parseScopeKey(key), ref);
});

test('multi-scope: parseScopeKey rejects invalid keys', async () => {
  const { parseScopeKey } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  assert.equal(parseScopeKey(''), null);
  assert.equal(parseScopeKey('single'), null);
  assert.equal(parseScopeKey('app:broken%ZZ:launcher'), null);
});

// ---------------------------------------------------------------------------
// T3-1: Mode-aware built-in chat scope orchestration structural tests
// ---------------------------------------------------------------------------

const projectionSource = readSource('src/shell/renderer/features/chat/conversation-capability-projection.ts');

test('T3-1: active-scope module exports mode-aware orchestration API', () => {
  assert.match(activeScopeSource, /export function resolveChatModeAIScopeRef\(mode: ConversationMode\): AIScopeRef \| null/);
  assert.match(activeScopeSource, /export function getActiveScope\(\): AIScopeRef \| null/);
  assert.match(activeScopeSource, /export function setActiveScopeForMode\(mode: ConversationMode\): void/);
  assert.match(activeScopeSource, /export function onActiveScopeChange\(/);
});

test('T3-1: active-scope module hard-cuts the generic chat scope', () => {
  // No generic app:desktop:chat scope anywhere in the chat live path module
  assert.doesNotMatch(activeScopeSource, /createDefaultAIScopeRef/);
  assert.doesNotMatch(activeScopeSource, /DEFAULT_SCOPE/);
  // Mode resolution uses the canonical built-in chat scope factory
  assert.match(activeScopeSource, /createBuiltInChatAIScopeRef\('nimi'\)/);
  assert.match(activeScopeSource, /createBuiltInChatAIScopeRef\('agent'\)/);
});

test('T3-1: setActiveScopeForMode pushes new config to app store and notifies listeners', () => {
  // Pushes config for the new scope to store when the scope is non-null
  assert.match(activeScopeSource, /pushDesktopAIConfigToBoundStore\(nextScopeRef\)/);
  // Notifies listeners
  assert.match(activeScopeSource, /for \(const listener of activeScopeListeners\)/);
});

test('T3-1: chat-mode store transition rebinds the active built-in chat scope', () => {
  const uiSliceSource = readSource('src/shell/renderer/app-shell/providers/ui-slice.ts');
  assert.match(uiSliceSource, /setActiveScopeForMode/);
  assert.match(uiSliceSource, /setChatMode: \(mode\) => \{/);
});

test('T3-1: projection subscription follows the mode-aware active chat scope', () => {
  // Uses getActiveScope, never the generic default scope
  assert.match(projectionSource, /getActiveScope/);
  assert.doesNotMatch(projectionSource, /createDefaultAIScopeRef/);
  // Rebinds on chat-mode scope change
  assert.match(projectionSource, /onActiveScopeChange/);
  assert.match(projectionSource, /bindSubscriptionForScope/);
  // Skips binding when no built-in chat scope is active (Human/Group)
  assert.match(projectionSource, /if \(!scopeRef\) \{\s*return;/);
});

test('T3-1: projection rebind triggers immediate refresh on scope switch', () => {
  // onActiveScopeChange callback triggers refresh
  assert.match(projectionSource, /void refreshConversationCapabilityProjections\(\)/);
});

test('T3-1: resolveChatModeAIScopeRef binds each mode to its canonical built-in scope', async () => {
  const {
    resolveChatModeAIScopeRef,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  assert.deepEqual(resolveChatModeAIScopeRef('ai'), {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'nimi',
  });
  assert.deepEqual(resolveChatModeAIScopeRef('agent'), {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'agent',
  });
  // Human and Group bind no built-in chat AIConfig scope (T3-2 owns Group reuse)
  assert.equal(resolveChatModeAIScopeRef('human'), null);
  assert.equal(resolveChatModeAIScopeRef('group'), null);
});

test('T3-1: setActiveScopeForMode switches the active scope per mode and notifies once per change', async () => {
  const {
    getActiveScope,
    getActiveScopeMode,
    setActiveScopeForMode,
    onActiveScopeChange,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const originalMode = getActiveScopeMode();
  const notifications: (AIScopeRef | null)[] = [];
  const unsubscribe = onActiveScopeChange((scopeRef: AIScopeRef | null) => {
    notifications.push(scopeRef);
  });

  try {
    // Default chat mode is `ai` -> Nimi built-in chat scope
    assert.deepEqual(getActiveScope(), {
      kind: 'feature',
      ownerId: 'desktop.chat',
      surfaceId: 'nimi',
    });

    // Switch to Agent rebinds to the agent built-in chat scope
    setActiveScopeForMode('agent');
    assert.deepEqual(getActiveScope(), {
      kind: 'feature',
      ownerId: 'desktop.chat',
      surfaceId: 'agent',
    });
    // Idempotent within the same mode — no duplicate notification
    setActiveScopeForMode('agent');
    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0], {
      kind: 'feature',
      ownerId: 'desktop.chat',
      surfaceId: 'agent',
    });

    // Switch to Human clears the active built-in chat scope
    setActiveScopeForMode('human');
    assert.equal(getActiveScope(), null);
    assert.equal(notifications.length, 2);
    assert.equal(notifications[1], null);
  } finally {
    unsubscribe();
    setActiveScopeForMode(originalMode);
  }
});

// ---------------------------------------------------------------------------
// T3-2: Group LocalAgent participation reuses the agent scope
// ---------------------------------------------------------------------------

const groupAdapterSource = readSource('src/shell/renderer/features/chat/chat-group-adapter.tsx');

test('T3-2: active-scope module resolves Group participation to the agent scope, never a group-specific scope', () => {
  // Group participation resolution exists and reuses createBuiltInChatAIScopeRef('agent')
  assert.match(
    activeScopeSource,
    /export function resolveGroupLocalAgentParticipationAIScopeRef\(/,
  );
  assert.match(
    activeScopeSource,
    /export function setGroupLocalAgentParticipationActive\(active: boolean\): void/,
  );
  assert.match(activeScopeSource, /createBuiltInChatAIScopeRef\('agent'\)/);
  // No group-specific scope is ever constructed: the only surfaceIds the chat
  // active-scope module mints are the canonical built-in 'nimi' / 'agent'.
  assert.doesNotMatch(activeScopeSource, /surfaceId:\s*['"`]group['"`]/);
  assert.doesNotMatch(activeScopeSource, /createBuiltInChatAIScopeRef\('group'\)/);
  // No generic / default scope leaks into the Group path.
  assert.doesNotMatch(activeScopeSource, /createDefaultAIScopeRef/);
});

test('T3-2: group adapter binds participation to the shared agent scope, never constructs an AIScopeRef', () => {
  // The adapter drives participation through the shared module entrypoint.
  assert.match(groupAdapterSource, /setGroupLocalAgentParticipationActive/);
  assert.match(groupAdapterSource, /hasInvokableGroupLocalAgentParticipation/);
  // The group adapter must not construct any AIScopeRef itself — scope identity
  // is owned entirely by the shared active-scope module.
  assert.doesNotMatch(groupAdapterSource, /createBuiltInChatAIScopeRef/);
  assert.doesNotMatch(groupAdapterSource, /createDefaultAIScopeRef/);
  assert.doesNotMatch(groupAdapterSource, /kind:\s*['"`]feature['"`]/);
});

test('T3-2: resolveGroupLocalAgentParticipationAIScopeRef resolves exactly the agent feature scope or null', async () => {
  const {
    resolveGroupLocalAgentParticipationAIScopeRef,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  // Active LocalAgent participation reuses the SAME canonical agent scope as
  // Agent Chat — feature:desktop.chat:agent.
  assert.deepEqual(resolveGroupLocalAgentParticipationAIScopeRef(true), {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'agent',
  });
  // No LocalAgent participation -> no built-in chat scope.
  assert.equal(resolveGroupLocalAgentParticipationAIScopeRef(false), null);
});

test('T3-2: Group mode resolves the agent scope only when LocalAgent participation is active', async () => {
  const {
    getActiveScope,
    getActiveScopeMode,
    setActiveScopeForMode,
    setGroupLocalAgentParticipationActive,
    resolveChatModeAIScopeRef,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const originalMode = getActiveScopeMode();
  const AGENT_SCOPE: AIScopeRef = {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'agent',
  };

  try {
    // Group mode alone (no participation) binds no built-in chat scope.
    assert.equal(resolveChatModeAIScopeRef('group'), null);
    setGroupLocalAgentParticipationActive(false);
    setActiveScopeForMode('group');
    assert.equal(getActiveScope(), null);

    // Activating LocalAgent participation rebinds Group to the canonical agent
    // scope — identical to Agent Chat, never a group-specific scope.
    setGroupLocalAgentParticipationActive(true);
    assert.deepEqual(getActiveScope(), AGENT_SCOPE);
    assert.deepEqual(getActiveScope(), resolveChatModeAIScopeRef('agent'));

    // Clearing participation drops the scope again.
    setGroupLocalAgentParticipationActive(false);
    assert.equal(getActiveScope(), null);

    // Leaving Group clears participation so a later mode never inherits the
    // group's agent-scope binding.
    setGroupLocalAgentParticipationActive(true);
    assert.deepEqual(getActiveScope(), AGENT_SCOPE);
    setActiveScopeForMode('human');
    assert.equal(getActiveScope(), null);
    // Returning to Group must start fail-closed (no stale participation).
    setActiveScopeForMode('group');
    assert.equal(getActiveScope(), null);
  } finally {
    setGroupLocalAgentParticipationActive(false);
    setActiveScopeForMode(originalMode);
  }
});
