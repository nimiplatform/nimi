import assert from 'node:assert/strict';
import test from 'node:test';

import type { AIConfig, AIProfile, AIScopeRef } from '../../src/mod/runtime/ai-config.js';
import {
  assertAppAIScopeRef,
  createAppAIScopeRef,
  ensureAppFirstLaunchAIConfig,
  isAppAIScopeRef,
  type EnsureAppFirstLaunchAIConfigDeps,
  type ResolvedRecommendedProfile,
} from '../../src/mod/runtime/app-ai-config.js';
import type { NimiError } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECOMMENDED_PROFILE: AIProfile = {
  profileId: 'factory:avatar-recommended',
  title: 'Avatar Recommended',
  description: "The app's declared recommended factory profile.",
  tags: ['factory-ai-profile', 'first-party-app'],
  capabilities: {
    'text.generate': { binding: null, params: { temperature: 0.4 } },
  },
};

const ACCOUNT_DEFAULT_PROFILE: AIProfile = {
  profileId: 'default',
  title: 'Account Default Profile',
  description: 'The account-scoped local AI profile library default.',
  tags: ['account-default'],
  capabilities: {
    'text.generate': { binding: null },
  },
};

const APP_SCOPE: AIScopeRef = { kind: 'app', ownerId: 'nimi.avatar' };

type DepsHarness = {
  deps: EnsureAppFirstLaunchAIConfigDeps;
  store: Map<string, AIConfig>;
  /** Number of host apply commits. */
  applyCount(): number;
};

function scopeKey(ref: AIScopeRef): string {
  return `${ref.kind}:${ref.ownerId}:${ref.surfaceId ?? ''}`;
}

/** Build a deps object backed by a single mutable in-memory config store. */
function makeDeps(overrides: Partial<EnsureAppFirstLaunchAIConfigDeps> = {}): DepsHarness {
  const store = new Map<string, AIConfig>();
  let applyCalls = 0;
  const deps: EnsureAppFirstLaunchAIConfigDeps = {
    scopeRef: APP_SCOPE,
    getExistingAppAIConfig: (ref) => store.get(scopeKey(ref)) ?? null,
    resolveRecommendedProfile: (): ResolvedRecommendedProfile | null => ({
      profile: RECOMMENDED_PROFILE,
      manifestSatisfied: true,
    }),
    resolveAccountDefaultProfile: () => ACCOUNT_DEFAULT_PROFILE,
    applyHostAiConfig: (ref, config) => {
      applyCalls += 1;
      const committed: AIConfig = { ...config, scopeRef: ref };
      store.set(scopeKey(ref), committed);
      return committed;
    },
    ...overrides,
  };
  return { deps, store, applyCount: () => applyCalls };
}

// ---------------------------------------------------------------------------
// P-AISC-007 app-launch scope factory
// ---------------------------------------------------------------------------

test('createAppAIScopeRef produces the canonical app shape with and without a surfaceId', () => {
  assert.deepEqual(createAppAIScopeRef('nimi.avatar'), {
    kind: 'app',
    ownerId: 'nimi.avatar',
  });
  assert.deepEqual(createAppAIScopeRef('nimi.avatar', 'companion'), {
    kind: 'app',
    ownerId: 'nimi.avatar',
    surfaceId: 'companion',
  });
});

test('createAppAIScopeRef fails closed on an empty appId or a blank surfaceId', () => {
  assert.throws(() => createAppAIScopeRef(''), /admitted Nimi App app_id/);
  assert.throws(() => createAppAIScopeRef('nimi.avatar', '  '), /non-empty/);
});

test('isAppAIScopeRef rejects non-app and malformed scopes', () => {
  assert.ok(isAppAIScopeRef({ kind: 'app', ownerId: 'nimi.avatar' }));
  assert.ok(!isAppAIScopeRef(null));
  assert.ok(!isAppAIScopeRef({ kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'nimi' }));
  assert.ok(!isAppAIScopeRef({ kind: 'app', ownerId: '' }));
});

test('assertAppAIScopeRef rejects an omitted or generic-default scope', () => {
  assert.throws(() => assertAppAIScopeRef(null), /required and must be provided explicitly/);
  // The retired generic chat default app scope is not a canonical app-launch scope.
  assert.throws(
    () => assertAppAIScopeRef({ kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'nimi' }),
    /must be \{ kind: 'app'/,
  );
});

// ---------------------------------------------------------------------------
// S-AICONF-009 — first-launch initialization
// ---------------------------------------------------------------------------

test('first launch initializes from the recommended profile when declared + manifest-satisfied', async () => {
  const harness = makeDeps();
  const result = await ensureAppFirstLaunchAIConfig(harness.deps);

  assert.equal(result.outcome, 'initialized');
  if (result.outcome !== 'initialized') return;
  assert.equal(result.profileSource, 'recommended-profile');
  assert.equal(result.profileId, RECOMMENDED_PROFILE.profileId);
  assert.equal(result.config.scopeRef.kind, 'app');
  assert.equal(result.config.scopeRef.ownerId, 'nimi.avatar');
  assert.equal(result.config.profileOrigin?.profileId, RECOMMENDED_PROFILE.profileId);
  assert.equal(result.setupRepairPlan, null);
});

test('first launch falls back to the Account Default Profile when the recommended profile is undeclared', async () => {
  const harness = makeDeps({
    resolveRecommendedProfile: () => null,
  });
  const result = await ensureAppFirstLaunchAIConfig(harness.deps);

  assert.equal(result.outcome, 'initialized');
  if (result.outcome !== 'initialized') return;
  assert.equal(result.profileSource, 'account-default-profile');
  assert.equal(result.profileId, ACCOUNT_DEFAULT_PROFILE.profileId);
});

test('first launch falls back to the Account Default Profile when the recommended profile manifest is not satisfied', async () => {
  const harness = makeDeps({
    resolveRecommendedProfile: () => ({
      profile: RECOMMENDED_PROFILE,
      manifestSatisfied: false,
    }),
  });
  const result = await ensureAppFirstLaunchAIConfig(harness.deps);

  assert.equal(result.outcome, 'initialized');
  if (result.outcome !== 'initialized') return;
  assert.equal(result.profileSource, 'account-default-profile');
});

test('initialization fails closed when neither a recommended nor a Default Profile resolves', async () => {
  const harness = makeDeps({
    resolveRecommendedProfile: () => null,
    resolveAccountDefaultProfile: () => null,
  });
  await assert.rejects(
    () => ensureAppFirstLaunchAIConfig(harness.deps),
    (error: unknown) => {
      const nimiError = error as NimiError;
      assert.equal(nimiError.reasonCode, 'SDK_APP_AI_CONFIG_INIT_PROFILE_UNRESOLVED');
      return true;
    },
  );
  // No synthesized config was written.
  assert.equal(harness.store.size, 0);
  assert.equal(harness.applyCount(), 0);
});

test('an existing per-app AIConfig is never overwritten on a later launch', async () => {
  const harness = makeDeps();
  // First launch initializes the scope.
  const first = await ensureAppFirstLaunchAIConfig(harness.deps);
  assert.equal(first.outcome, 'initialized');
  const applyCallsAfterFirst = harness.applyCount();

  // A later launch — even with a CHANGED recommended profile — must not
  // re-initialize or overwrite the existing config.
  const changedRecommended: AIProfile = {
    ...RECOMMENDED_PROFILE,
    profileId: 'factory:changed-recommendation',
  };
  const second = await ensureAppFirstLaunchAIConfig({
    ...harness.deps,
    resolveRecommendedProfile: () => ({ profile: changedRecommended, manifestSatisfied: true }),
  });

  assert.equal(second.outcome, 'already-initialized');
  if (second.outcome !== 'already-initialized') return;
  // The config is the one from the first launch — unchanged.
  assert.equal(second.config.profileOrigin?.profileId, RECOMMENDED_PROFILE.profileId);
  // No second apply happened.
  assert.equal(harness.applyCount(), applyCallsAfterFirst);
});

test('a changed Account Default Profile does not re-initialize an existing app scope', async () => {
  const harness = makeDeps({ resolveRecommendedProfile: () => null });
  const first = await ensureAppFirstLaunchAIConfig(harness.deps);
  assert.equal(first.outcome, 'initialized');

  const changedDefault: AIProfile = { ...ACCOUNT_DEFAULT_PROFILE, profileId: 'default-v2' };
  const second = await ensureAppFirstLaunchAIConfig({
    ...harness.deps,
    resolveRecommendedProfile: () => null,
    resolveAccountDefaultProfile: () => changedDefault,
  });
  assert.equal(second.outcome, 'already-initialized');
});

test('unmet manifest requirements surface a typed setup/repair plan, not a mutated config', async () => {
  const harness = makeDeps({
    validateManifestRequirements: () => [
      { requirementId: 'local-pack.text-generate', detail: 'local text-generate pack not installed' },
    ],
  });
  const result = await ensureAppFirstLaunchAIConfig(harness.deps);

  assert.equal(result.outcome, 'initialized');
  if (result.outcome !== 'initialized') return;
  assert.ok(result.setupRepairPlan);
  assert.equal(result.setupRepairPlan?.unmetRequirements.length, 1);
  assert.equal(
    result.setupRepairPlan?.unmetRequirements[0]?.requirementId,
    'local-pack.text-generate',
  );
  // The materialized config still carries the chosen profile origin verbatim —
  // it was NOT mutated to force the manifest check to pass.
  assert.equal(result.config.profileOrigin?.profileId, RECOMMENDED_PROFILE.profileId);
});

test('a manifest check that finds everything satisfied yields a null setup/repair plan', async () => {
  const harness = makeDeps({
    validateManifestRequirements: () => [],
  });
  const result = await ensureAppFirstLaunchAIConfig(harness.deps);
  assert.equal(result.outcome, 'initialized');
  if (result.outcome !== 'initialized') return;
  assert.equal(result.setupRepairPlan, null);
});

test('ensureAppFirstLaunchAIConfig fails closed when the host apply authority rejects', async () => {
  const harness = makeDeps({
    applyHostAiConfig: () => {
      throw new Error('host persistence offline');
    },
  });
  await assert.rejects(
    () => ensureAppFirstLaunchAIConfig(harness.deps),
    (error: unknown) => {
      const nimiError = error as NimiError;
      assert.equal(nimiError.reasonCode, 'SDK_APP_AI_CONFIG_INIT_APPLY_FAILED');
      return true;
    },
  );
});

test('ensureAppFirstLaunchAIConfig requires a canonical app scope', async () => {
  const harness = makeDeps();
  await assert.rejects(
    () => ensureAppFirstLaunchAIConfig({
      ...harness.deps,
      scopeRef: { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'nimi' },
    }),
    (error: unknown) => {
      const nimiError = error as NimiError;
      assert.equal(nimiError.reasonCode, 'SDK_APP_AI_CONFIG_SCOPE_INVALID');
      return true;
    },
  );
});
