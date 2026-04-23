import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import type { AIScopeRef } from '@nimiplatform/sdk/mod';

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

test('multi-scope: shared Desktop host service listScopes returns real scope refs from map', () => {
  // listScopes must iterate configByScope, not return hardcoded single scope
  assert.match(serviceSource, /listScopes\(\): AIScopeRef\[\]/);
  assert.match(serviceSource, /for \(const key of configByScope\.keys\(\)\)/);
  assert.match(serviceSource, /parseScopeKey\(key\)/);
});

test('multi-scope: shared Desktop host service subscribe is scoped (S-AICONF-006)', () => {
  // Subscription keyed by scope
  assert.match(serviceSource, /scopeKey: scopeKey\(scopeRef\)/);
  // Notification filters by scope key
  assert.match(serviceSource, /if \(sub\.scopeKey === key\)/);
});

test('multi-scope: runtime-slice dynamically checks active scope for store sync (Phase 6)', () => {
  // Uses getActiveScope() dynamically, not a fixed capture at bootstrap
  assert.match(runtimeSliceSource, /getActiveScope\(\)/);
  assert.match(runtimeSliceSource, /scopeKeyFromRef\(getActiveScope\(\)\)/);
  assert.match(runtimeSliceSource, /getDesktopAIConfigService\(\)\.aiConfig\.get\(getActiveScope\(\)\)/);
  // No fixed activeScopeKey const
  assert.doesNotMatch(runtimeSliceSource, /const activeScopeKey\b/);
});

test('multi-scope: snapshot getLatest is scope-keyed', () => {
  // byScopeKey map tracks latest per scope
  assert.match(serviceSource, /byScopeKey\.set\(scopeKey\(snapshot\.scopeRef\), snapshot\)/);
  assert.match(serviceSource, /byScopeKey\.get\(scopeKey\(scopeRef\)\)/);
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
  assert.equal(scopeKeyFromRef({ kind: 'mod', ownerId: 'my-mod' }), 'mod:my-mod:');
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
  const parsed = parseScopeKey('mod:my-mod:');
  assert.ok(parsed);
  assert.equal(parsed.kind, 'mod');
  assert.equal(parsed.ownerId, 'my-mod');
  assert.equal(parsed.surfaceId, undefined);
});

test('multi-scope: scope keys round-trip canonical mod owner ids with colons', async () => {
  const { scopeKeyFromRef, parseScopeKey } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  const ref: AIScopeRef = {
    kind: 'mod',
    ownerId: 'core:runtime',
    surfaceId: 'workspace',
  };
  const key = scopeKeyFromRef(ref);
  assert.equal(key, 'mod:core%3Aruntime:workspace');
  assert.deepEqual(parseScopeKey(key), ref);
});

test('multi-scope: parseScopeKey rejects invalid keys', async () => {
  const { parseScopeKey } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  assert.equal(parseScopeKey(''), null);
  assert.equal(parseScopeKey('single'), null);
  assert.equal(parseScopeKey('mod:broken%ZZ:workspace'), null);
});

// ---------------------------------------------------------------------------
// Phase 6: Active scope orchestration structural tests
// ---------------------------------------------------------------------------

const projectionSource = readSource('src/shell/renderer/features/chat/conversation-capability-projection.ts');

test('Phase 6: surface exports active scope orchestration API', () => {
  assert.match(activeScopeSource, /export function getActiveScope\(\): AIScopeRef/);
  assert.match(activeScopeSource, /export function setActiveScope\(scopeRef: AIScopeRef\): void/);
  assert.match(activeScopeSource, /export function onActiveScopeChange\(/);
});

test('Phase 6: setActiveScope pushes new config to app store and notifies listeners', () => {
  // Pushes config for new scope to store
  assert.match(activeScopeSource, /pushDesktopAIConfigToBoundStore\(scopeRef\)/);
  // Notifies listeners
  assert.match(activeScopeSource, /for \(const listener of activeScopeListeners\)/);
});

test('Phase 6: projection subscription follows active scope, not hardcoded default', () => {
  // Uses getActiveScope, not createDefaultAIScopeRef
  assert.match(projectionSource, /getActiveScope/);
  assert.doesNotMatch(projectionSource, /createDefaultAIScopeRef/);
  // Rebinds on scope change
  assert.match(projectionSource, /onActiveScopeChange/);
  assert.match(projectionSource, /bindSubscriptionForScope/);
});

test('Phase 6: projection rebind triggers immediate refresh on scope switch', () => {
  // onActiveScopeChange callback triggers refresh
  assert.match(projectionSource, /void refreshConversationCapabilityProjections\(\)/);
});

test('Phase 6: active scope helper switches current scope and notifies listeners once per change', async () => {
  const {
    getActiveScope,
    setActiveScope,
    onActiveScopeChange,
  } = await import('../src/shell/renderer/features/chat/chat-shared-active-ai-config-scope.js');

  const originalScope = getActiveScope();
  const nextScope: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'alt-chat' };
  const notifications: AIScopeRef[] = [];
  const unsubscribe = onActiveScopeChange((scopeRef: AIScopeRef) => {
    notifications.push(scopeRef);
  });

  try {
    setActiveScope(nextScope);
    assert.deepEqual(getActiveScope(), nextScope);
    setActiveScope(nextScope);
    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0], nextScope);
  } finally {
    unsubscribe();
    setActiveScope(originalScope);
  }
});
