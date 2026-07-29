import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAIProfile,
} from '@nimiplatform/sdk/ai';
import type { NimiError } from '@nimiplatform/sdk/types';

/**
 * T4-W3 — per-app first-launch AIConfig initialization (S-AICONF-009).
 *
 * Exercises the Desktop host wiring `ensureAppFirstLaunchAIConfig`, which binds
 * the host-agnostic SDK helper to the Desktop host AIConfig persistence
 * (`commitConfig` write path + scope-keyed localStorage). The Account Default
 * Profile resolver is injected so the test does not need an Electron host; the
 * persistence + never-overwrite + fail-closed behavior is real.
 */

// ---------------------------------------------------------------------------
// localStorage shim — the Desktop host AIConfig persistence is scope-keyed
// localStorage (desktop-ai-config-storage.ts, S-AICONF-005 host-local).
// ---------------------------------------------------------------------------

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => map.set(key, String(value)),
  } as Storage;
}

const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installFreshStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorage(),
    configurable: true,
    writable: true,
  });
}

test.afterEach(() => {
  if (previousLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_DEFAULT_PROFILE: NimiAIProfile = {
  profileId: 'default',
  title: 'Account Default Profile',
  description: 'Account-scoped local AI profile library default.',
  tags: ['account-default'],
  capabilities: {
    'text.generate': {
      targetRef: {
        kind: 'local-runtime',
        version: 'v2',
        readinessRef: 'readiness:account-default:text',
      },
    },
  },
};

function requirementDeclarations(appId: string): readonly NimiAICapabilityRequirementDeclaration[] {
  return [{
    requirementId: `${appId}.chat.requirements`,
    scopeRef: { kind: 'app', ownerId: appId },
    requiredSlices: [{
      requirementSliceId: 'chat.text.generate',
      capability: 'text.generate',
      profileSliceRef: 'capabilities.text.generate',
      readinessPolicy: 'required',
    }],
    setupProjectionPolicy: 'setup-required',
  }];
}

async function loadService() {
  // Dynamic import after the storage shim is installed — the service module
  // hydrates persisted scopes lazily, not at import time.
  return import('../src/shell/renderer/app-shell/providers/desktop-ai-config-service.js');
}

/** A unique app id per test so the service's process-wide scope map is clean. */
let appIdCounter = 0;
function freshAppId(): string {
  appIdCounter += 1;
  return `nimi.test-app-${appIdCounter}`;
}

// ---------------------------------------------------------------------------
// First-launch initialization (S-AICONF-009)
// ---------------------------------------------------------------------------

test('desktop first launch initializes the app scope from the Account Default Profile', async () => {
  installFreshStorage();
  const { ensureAppFirstLaunchAIConfig, getDesktopAIConfigService } = await loadService();
  const appId = freshAppId();

  const result = await ensureAppFirstLaunchAIConfig(
    {
      appId,
      requirementDeclarations: requirementDeclarations(appId),
    },
    {
      resolveAccountDefaultProfile: () => ACCOUNT_DEFAULT_PROFILE,
    },
  );

  assert.equal(result.outcome, 'initialized');
  if (result.outcome !== 'initialized') return;
  assert.equal(result.profileSource, 'account-default-profile');
  assert.equal(result.config.scopeRef.kind, 'app');
  assert.equal(result.config.scopeRef.ownerId, appId);

  // The config is persisted under the canonical app scope and readable back.
  const persisted = getDesktopAIConfigService().aiConfig.get({ kind: 'app', ownerId: appId });
  assert.equal(persisted.profileOrigin?.profileId, ACCOUNT_DEFAULT_PROFILE.profileId);
});

test('desktop first launch fails closed when the Account Default Profile does not resolve', async () => {
  installFreshStorage();
  const { ensureAppFirstLaunchAIConfig, getDesktopAIConfigService } = await loadService();
  const appId = freshAppId();

  await assert.rejects(
    () =>
      ensureAppFirstLaunchAIConfig(
        { appId, requirementDeclarations: requirementDeclarations(appId) },
        {
          resolveAccountDefaultProfile: () => null,
        },
      ),
    (error: unknown) => {
      assert.equal((error as NimiError).reasonCode, 'SDK_AI_CONFIG_INIT_PROFILE_UNRESOLVED');
      return true;
    },
  );

  // No synthesized config was persisted — the scope has no profile origin.
  const config = getDesktopAIConfigService().aiConfig.get({ kind: 'app', ownerId: appId });
  assert.equal(config.profileOrigin, null);
});

test('desktop never overwrites an existing per-app AIConfig on a later launch', async () => {
  installFreshStorage();
  const { ensureAppFirstLaunchAIConfig } = await loadService();
  const appId = freshAppId();

  const first = await ensureAppFirstLaunchAIConfig(
    {
      appId,
      requirementDeclarations: requirementDeclarations(appId),
    },
    {
      resolveAccountDefaultProfile: () => ACCOUNT_DEFAULT_PROFILE,
    },
  );
  assert.equal(first.outcome, 'initialized');

  // A changed Account Default Profile cannot re-initialize the existing scope.
  const changedDefault: NimiAIProfile = { ...ACCOUNT_DEFAULT_PROFILE, profileId: 'default-v2' };
  const second = await ensureAppFirstLaunchAIConfig(
    {
      appId,
      requirementDeclarations: requirementDeclarations(appId),
    },
    {
      resolveAccountDefaultProfile: () => changedDefault,
    },
  );

  assert.equal(second.outcome, 'already-initialized');
  if (second.outcome !== 'already-initialized') return;
  // The config is still the first-launch config — untouched.
  assert.equal(second.config.profileOrigin?.profileId, ACCOUNT_DEFAULT_PROFILE.profileId);
});

test('desktop unmet manifest requirements surface a typed setup/repair plan', async () => {
  installFreshStorage();
  const { ensureAppFirstLaunchAIConfig } = await loadService();
  const appId = freshAppId();

  const result = await ensureAppFirstLaunchAIConfig(
    {
      appId,
      requirementDeclarations: requirementDeclarations(appId),
      validateManifestRequirements: () => [
        { requirementId: 'local-pack.text', detail: 'local text pack not installed' },
      ],
    },
    {
      resolveAccountDefaultProfile: () => ACCOUNT_DEFAULT_PROFILE,
    },
  );

  assert.equal(result.outcome, 'setup-required-no-live-config');
  if (result.outcome !== 'setup-required-no-live-config') return;
  assert.ok(result.setupRepairPlan);
  assert.equal(result.setupRepairPlan?.unmetRequirements[0]?.requirementId, 'local-pack.text');
  assert.equal(result.config, null);
  assert.equal(result.profileId, ACCOUNT_DEFAULT_PROFILE.profileId);
});

test('desktop first-launch init builds the canonical P-AISC-007 app scope and rejects a blank app id', async () => {
  installFreshStorage();
  const { ensureAppFirstLaunchAIConfig } = await loadService();

  await assert.rejects(
    () =>
      ensureAppFirstLaunchAIConfig(
        { appId: '   ', requirementDeclarations: [] },
        {
          resolveAccountDefaultProfile: () => ACCOUNT_DEFAULT_PROFILE,
        },
      ),
    (error: unknown) => {
      assert.equal((error as NimiError).reasonCode, 'SDK_AI_INPUT_INVALID');
      return true;
    },
  );
});
