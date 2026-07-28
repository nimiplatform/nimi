import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiAIHostStorage, NimiAIScopeRef } from '@nimiplatform/sdk/ai';

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

const AI_CONFIG_SCOPE_INDEX_KEY = 'nimi.ai-config.scope-index.v2';
const AI_CONFIG_SCOPE_PREFIX = 'nimi.ai-config.scope.';
const AI_CONFIG_SCOPE_SUFFIX = '.v2';

class MemoryHostStorage implements NimiAIHostStorage {
  readonly values = new Map<string, string>();

  constructor(entries: readonly (readonly [string, string])[] = []) {
    for (const [key, value] of entries) {
      this.values.set(key, value);
    }
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function desktopAIConfigStorageKey(scopeKey: string): string {
  return `${AI_CONFIG_SCOPE_PREFIX}${scopeKey}${AI_CONFIG_SCOPE_SUFFIX}`;
}

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
  const ref: NimiAIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };
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
  const ref: NimiAIScopeRef = {
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

test('multi-scope: storage repair leaves valid v2 AIConfig active', async () => {
  const { repairDesktopAIConfigStorage } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  const scopeRef: NimiAIScopeRef = {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'nimi',
  };
  const scopeKey = 'feature:desktop.chat:nimi';
  const configKey = desktopAIConfigStorageKey(scopeKey);
  const validConfig = {
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          readinessRef: 'local-runtime:profile-binding:chat-text',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };
  const storage = new MemoryHostStorage([
    [AI_CONFIG_SCOPE_INDEX_KEY, JSON.stringify([scopeKey])],
    [configKey, JSON.stringify(validConfig)],
  ]);

  const result = repairDesktopAIConfigStorage(storage, {
    now: () => '2026-06-26T00:00:00.000Z',
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.quarantined, 0);
  assert.equal(storage.getItem(configKey), JSON.stringify(validConfig));
  assert.deepEqual(JSON.parse(storage.getItem(AI_CONFIG_SCOPE_INDEX_KEY) ?? '[]'), [scopeKey]);
});

test('multi-scope: storage repair quarantines retired persisted target refs and clears active index', async () => {
  const { repairDesktopAIConfigStorage } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
  );
  const scopeRef: NimiAIScopeRef = {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'nimi',
  };
  const scopeKey = 'feature:desktop.chat:nimi';
  const configKey = desktopAIConfigStorageKey(scopeKey);
  const retiredConfig = {
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          targetId: 'local-import-qwen3-4b-q4-k-m',
          profileId: 'builtin-qwen3-text',
        },
        'image.generate': {
          kind: 'local-runtime',
          targetId: 'local-import-z-image-turbo-q4-k',
          profileId: 'builtin-z-image-turbo',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };
  const storage = new MemoryHostStorage([
    [AI_CONFIG_SCOPE_INDEX_KEY, JSON.stringify([scopeKey])],
    [configKey, JSON.stringify(retiredConfig)],
  ]);

  const result = repairDesktopAIConfigStorage(storage, {
    now: () => '2026-06-26T00:00:00.000Z',
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.quarantined, 1);
  assert.equal(storage.getItem(configKey), null);
  assert.deepEqual(JSON.parse(storage.getItem(AI_CONFIG_SCOPE_INDEX_KEY) ?? '[]'), []);

  const quarantineEntries = [...storage.values.entries()]
    .filter(([key]) => key.startsWith('nimi.ai-config.quarantine.'));
  assert.equal(quarantineEntries.length, 1);
  const rawQuarantine = quarantineEntries[0]?.[1];
  assert.ok(rawQuarantine);
  const quarantine = JSON.parse(rawQuarantine) as {
    scopeKey: string;
    originalKey: string;
    quarantinedAt: string;
    reasonCode: string;
    raw: string;
  };
  assert.equal(quarantine.scopeKey, scopeKey);
  assert.equal(quarantine.originalKey, configKey);
  assert.equal(quarantine.quarantinedAt, '2026-06-26T00:00:00.000Z');
  assert.equal(quarantine.reasonCode, 'DESKTOP_AI_CONFIG_STORE_INVALID');
  assert.equal(quarantine.raw, JSON.stringify(retiredConfig));
});

test('multi-scope: loadAIConfigForScope repairs retired stored config before SDK validation', async () => {
  const scopeRef: NimiAIScopeRef = {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'agent',
  };
  const scopeKey = 'feature:desktop.chat:agent';
  const configKey = desktopAIConfigStorageKey(scopeKey);
  const storage = new MemoryHostStorage([
    [AI_CONFIG_SCOPE_INDEX_KEY, JSON.stringify([scopeKey])],
    [configKey, JSON.stringify({
      scopeRef,
      capabilities: {
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            targetId: 'local-import-qwen3-4b-q4-k-m',
            profileId: 'builtin-qwen3-text',
          },
        },
        selectedParams: {},
      },
      profileOrigin: null,
    })],
  ]);
  const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  try {
    const { loadAIConfigForScope } = await import(
      '../src/shell/renderer/app-shell/providers/desktop-ai-config-storage.js'
    );
    const loaded = loadAIConfigForScope(scopeRef);
    assert.deepEqual(loaded, {
      scopeRef,
      capabilities: {
        targetRefs: {},
        selectedParams: {},
      },
      profileOrigin: null,
    });
    assert.equal(storage.getItem(configKey), null);
    assert.deepEqual(JSON.parse(storage.getItem(AI_CONFIG_SCOPE_INDEX_KEY) ?? '[]'), []);
  } finally {
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
});

// ---------------------------------------------------------------------------
// T3-1: Mode-aware built-in chat scope orchestration behavior
// ---------------------------------------------------------------------------

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
  const notifications: (NimiAIScopeRef | null)[] = [];
  const unsubscribe = onActiveScopeChange((scopeRef: NimiAIScopeRef | null) => {
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
