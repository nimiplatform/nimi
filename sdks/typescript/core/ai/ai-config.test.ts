import assert from 'node:assert/strict';
import test from 'node:test';

import { SchedulingState } from '../../core-generated/runtime-typed-client';
import {
  applyNimiAIProfileToConfig,
  assertNimiAppAIScopeRef,
  assertNimiBuiltInChatAIScopeRef,
  createNimiAIConfigEvidence,
  createNimiAIConfigSubscriptionRegistry,
  buildNimiRuntimeAISchedulingRequest,
  createEmptyNimiAIConfig,
  createNimiAIConfigStore,
  createNimiAIHostSurface,
  createNimiAppAIScopeRef,
  createNimiBuiltInChatAIScopeRef,
  createNimiAIScopeRef,
  createNimiAISnapshotRecord,
  createNimiAISnapshotExecutionId,
  createNimiAISnapshotStore,
  diffNimiAIConfigs,
  createNimiRuntimeAISchedulingClient,
  encodeNimiAIScopeRef,
  ensureNimiAppFirstLaunchAIConfig,
  formNimiRuntimeProfileDescriptor,
  isNimiAppAIScopeRef,
  isNimiBuiltInChatAIScopeRef,
  nimiBuiltInChatAIScopeRefs,
  parseExportedNimiAccountProfileLibraryProfiles,
  parseNimiAccountProfileLibraryIndexEntry,
  parseNimiAccountProfileLibraryOrigin,
  parseNimiAIProfile,
  parseNimiAccountProfileLibraryProjection,
  parseNimiAccountProfileLibraryProfile,
  parseNimiAIScopeRefKey,
  previewNimiAIProfileApply,
  projectNimiAIProfileApply,
  validateNimiAIConfig,
  validateNimiAIConfigTargetRef,
  validateNimiAIProfile,
  versionNimiAIConfig,
  type NimiAIHostStorage,
  type NimiAIProfile,
} from './index';

function createMemoryStorage(): NimiAIHostStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const SCOPE = createNimiAIScopeRef({
  kind: 'app',
  ownerId: 'dev.nimi.wave4',
  surfaceId: 'chat',
});

const READY_PROFILE: NimiAIProfile = {
  profileId: 'profile-chat',
  title: 'Chat profile',
  description: 'Runtime-backed chat profile',
  tags: ['chat'],
  capabilities: {
    'text.generate': {
      targetRef: {
        kind: 'local-runtime',
        targetId: 'runtime-target-chat',
        profileId: 'runtime-profile-chat',
      },
      params: { temperature: 0.2 },
      runtimeDescriptor: {
        executionMode: 'local',
        execution: { backend: 'llama.cpp' },
        model: { family: 'llama' },
      },
    },
  },
};

test('Nimi AI scope keys are explicit and reversible', () => {
  const key = encodeNimiAIScopeRef(SCOPE);

  assert.equal(key, 'app:dev.nimi.wave4:chat');
  assert.deepEqual(parseNimiAIScopeRefKey(key), SCOPE);
  assert.throws(
    () => createNimiAIScopeRef({ kind: 'app', ownerId: '' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_INPUT_INVALID',
  );
});

test('Nimi AI scope and target validation fail closed across admitted families', () => {
  const builtInNimi = createNimiBuiltInChatAIScopeRef('nimi');
  const builtInAgent = createNimiBuiltInChatAIScopeRef('agent');

  assert.deepEqual(nimiBuiltInChatAIScopeRefs(), [builtInNimi, builtInAgent]);
  assert.equal(isNimiBuiltInChatAIScopeRef(builtInNimi), true);
  assert.equal(isNimiBuiltInChatAIScopeRef(SCOPE), false);
  assert.equal(isNimiAppAIScopeRef(SCOPE), true);
  assert.deepEqual(assertNimiAppAIScopeRef(SCOPE), SCOPE);
  assert.deepEqual(assertNimiBuiltInChatAIScopeRef(builtInAgent), builtInAgent);
  assert.equal(parseNimiAIScopeRefKey('app:only-two-parts'), null);
  assert.equal(parseNimiAIScopeRefKey('app:%E0%A4%A:chat'), null);
  assert.throws(
    () => assertNimiBuiltInChatAIScopeRef(SCOPE),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SCOPE_INVALID',
  );
  assert.throws(
    () => assertNimiAppAIScopeRef(builtInNimi),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SCOPE_INVALID',
  );

  assert.deepEqual(validateNimiAIConfigTargetRef({
    kind: 'profile-slice',
    sourceProfileId: 'profile-1',
    sliceId: 'slice-1',
  }, 'target'), []);
  assert.match(validateNimiAIConfigTargetRef({
    kind: 'profile-slice',
    sliceId: '',
  }, 'target').join('\n'), /sourceProfileId is required/u);
  assert.match(validateNimiAIConfigTargetRef({
    kind: 'local-runtime',
  }, 'target').join('\n'), /requires readinessRef or targetId\/profileId/u);
  assert.match(validateNimiAIConfigTargetRef({
    kind: 'cloud-connector',
    connectorId: 'connector-1',
  }, 'target').join('\n'), /providerModelId is required/u);
  assert.match(validateNimiAIConfigTargetRef({
    kind: 'unsupported',
  }, 'target').join('\n'), /not an admitted AIConfig compact ref/u);

  assert.deepEqual(validateNimiAIConfig(null), {
    valid: false,
    errors: ['config must be a non-null object'],
  });
  assert.match(validateNimiAIConfig({
    scopeRef: SCOPE,
    capabilities: { targetRefs: [] },
  }).errors.join('\n'), /capabilities\.targetRefs must be an object/u);
  assert.match(validateNimiAIConfig({
    scopeRef: SCOPE,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'connector-1',
          providerModelId: 'model-1',
          secret: 'forbidden',
        },
      },
    },
  }).errors.join('\n'), /secret is forbidden/u);
});

test('Nimi AI profile validation rejects hidden Runtime/private payloads', () => {
  const validation = validateNimiAIProfile({
    ...READY_PROFILE,
    capabilities: {
      'text.generate': {
        binding: { secret: 'do-not-store' },
      },
    },
  });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /binding is forbidden/);
  assert.match(validation.errors.join('\n'), /secret is forbidden/);
});

test('Nimi AI profile parsing and runtime descriptor projection cover failure boundaries', () => {
  assert.deepEqual(parseNimiAIProfile({
    profileId: 'minimal',
    title: 'Minimal',
    capabilities: {},
  }, { allowMissingOptionalFields: true }), {
    profileId: 'minimal',
    title: 'Minimal',
    description: undefined,
    tags: [],
    capabilities: {},
  });
  assert.throws(
    () => parseNimiAIProfile({
      profileId: 'minimal',
      title: 'Minimal',
      capabilities: {},
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PAYLOAD_INVALID',
  );

  const unsupportedProfile: NimiAIProfile = {
    profileId: 'unsupported',
    title: 'Unsupported',
    capabilities: {
      'text.generate': { contractState: 'unsupported' },
      'image.generate': { contractState: 'proposed' },
      'audio.synthesize': { readinessPolicy: 'optional' },
    },
  };
  const projection = projectNimiAIProfileApply(unsupportedProfile);
  assert.equal(projection.outcome, 'unsupported_no_live_config');
  assert.deepEqual(projection.setupProjection?.reasonCodes, ['product_state_unsupported', 'product_state_proposed']);
  assert.equal(previewNimiAIProfileApply({
    before: null,
    scopeRef: SCOPE,
    profile: {
      profileId: '',
      title: '',
      capabilities: {},
    },
  }).outcome, 'invalid_profile');
  assert.throws(
    () => applyNimiAIProfileToConfig(createEmptyNimiAIConfig(SCOPE), {
      profileId: '',
      title: '',
      capabilities: {},
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_INVALID',
  );

  const cloudProfile: NimiAIProfile = {
    profileId: 'cloud-profile',
    title: 'Cloud Profile',
    capabilities: {
      'text.generate': {
        targetRef: {
          kind: 'cloud-connector',
          connectorId: 'connector-1',
          provider: 'openai-compatible',
          providerModelId: 'model-1',
        },
        runtimeDescriptor: {
          executionMode: 'cloud_connector',
          providerCapability: 'text.generate',
          credentialPolicy: 'managed',
        },
      },
    },
  };
  const descriptor = formNimiRuntimeProfileDescriptor({
    profile: cloudProfile,
    descriptorId: 'descriptor-cloud',
    sourceProfileDigest: 'digest-cloud',
    projectedAt: '2026-06-05T00:00:00.000Z',
    requirementDeclarations: [{
      requirementId: 'req-cloud',
      scopeRef: SCOPE,
      setupProjectionPolicy: 'fail-closed',
      requiredSlices: [{
        requirementSliceId: 'slice-cloud',
        capability: 'text.generate',
        profileSliceRef: 'text-cloud',
        readinessPolicy: 'required',
      }],
      optionalSlices: [{
        requirementSliceId: 'slice-optional-missing',
        capability: 'image.generate',
        profileSliceRef: 'image-missing',
        readinessPolicy: 'optional',
      }],
    }],
  });
  assert.equal(descriptor.capabilitySlices[0]?.executionMode, 'cloud_connector');
  assert.equal(descriptor.capabilitySlices[0]?.provider, 'openai-compatible');
  assert.equal(descriptor.capabilitySlices[0]?.connectorSelector, 'connector-1');
  assert.equal(descriptor.capabilitySlices.length, 1);

  assert.throws(
    () => formNimiRuntimeProfileDescriptor({
      profile: READY_PROFILE,
      descriptorId: '',
      sourceProfileDigest: 'digest',
      requirementDeclarations: [],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_INPUT_INVALID',
  );
  assert.throws(
    () => formNimiRuntimeProfileDescriptor({
      profile: READY_PROFILE,
      descriptorId: 'descriptor-empty',
      sourceProfileDigest: 'digest',
      requirementDeclarations: [],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
  );
  assert.throws(
    () => formNimiRuntimeProfileDescriptor({
      profile: {
        profileId: 'missing-local-fields',
        title: 'Missing local fields',
        capabilities: {
          'text.generate': {
            runtimeDescriptor: {
              executionMode: 'local',
              execution: {},
              model: {},
            },
          },
        },
      },
      descriptorId: 'descriptor-local-invalid',
      sourceProfileDigest: 'digest',
      requirementDeclarations: [{
        requirementId: 'req-local',
        scopeRef: SCOPE,
        setupProjectionPolicy: 'fail-closed',
        requiredSlices: [{
          requirementSliceId: 'slice-local',
          capability: 'text.generate',
          profileSliceRef: 'text-local',
          readinessPolicy: 'required',
        }],
      }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
  );
});

test('Nimi AI host surface previews and applies profiles without implicit storage fallback', async () => {
  const storage = createMemoryStorage();
  const configStore = createNimiAIConfigStore({ storage: () => storage });
  const snapshotStore = createNimiAISnapshotStore({ storage: () => storage });
  const surface = createNimiAIHostSurface({
    profiles: [READY_PROFILE],
    configStore,
    snapshotStore,
    now: () => '2026-06-04T00:00:00.000Z',
  });
  const notifications: string[] = [];
  surface.aiConfig.subscribe(SCOPE, (config) => {
    notifications.push(versionNimiAIConfig(config));
  });

  const preview = await surface.aiProfile.previewApply(SCOPE, 'profile-chat');

  assert.equal(preview.outcome, 'ready_to_apply');
  assert.equal(preview.before, null);
  assert.equal(preview.after?.profileOrigin?.profileId, 'profile-chat');
  assert.equal(configStore.has(SCOPE), false);
  assert.deepEqual(notifications, []);

  const applied = await surface.aiProfile.apply(SCOPE, 'profile-chat', {
    expectedBaseVersion: preview.baseVersion,
  });

  assert.equal(applied.success, true);
  assert.equal(surface.aiConfig.get(SCOPE).profileOrigin?.appliedAt, '2026-06-04T00:00:00.000Z');
  assert.equal(notifications.length, 1);
  assert.deepEqual(surface.aiConfig.listScopes(), [SCOPE]);

  const stale = await surface.aiProfile.apply(SCOPE, 'profile-chat', {
    expectedBaseVersion: preview.baseVersion,
  });
  assert.equal(stale.success, false);
  assert.equal(stale.outcome, 'stale_base');

  const snapshot = createNimiAISnapshotRecord({
    executionId: 'exec-1',
    scopeRef: SCOPE,
    config: surface.aiConfig.get(SCOPE),
    capability: 'text.generate',
    selectedTargetRef: surface.aiConfig.get(SCOPE).capabilities.targetRefs['text.generate'] ?? null,
    createdAt: '2026-06-04T00:00:01.000Z',
  });
  surface.aiSnapshot.record(SCOPE, snapshot);
  assert.equal(surface.aiSnapshot.getLatest(SCOPE)?.executionId, 'exec-1');
  assert.equal(snapshot.configEvidence.capabilityBindingKeys.includes('text.generate'), true);
  assert.equal(snapshot.conversationCapabilitySlice.capability, 'text.generate');
});

test('Nimi AI config store fails closed without host storage or explicit ephemeral mode', () => {
  const store = createNimiAIConfigStore();

  assert.throws(
    () => store.has(SCOPE),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_HOST_STORAGE_REQUIRED',
  );

  const ephemeral = createNimiAIConfigStore({ enableEphemeralStore: true });
  assert.equal(ephemeral.has(SCOPE), false);
  ephemeral.save(createEmptyNimiAIConfig(SCOPE));
  assert.equal(ephemeral.has(SCOPE), true);
});

test('Nimi AI config and snapshot stores validate stored state and host boundaries', () => {
  const storage = createMemoryStorage();
  const store = createNimiAIConfigStore({ storage: () => storage });
  const scopeKey = encodeNimiAIScopeRef(SCOPE);
  const otherScope = createNimiAppAIScopeRef('dev.nimi.other', 'chat');
  storage.values.set(`nimi:ai-config:${scopeKey}`, JSON.stringify(createEmptyNimiAIConfig(otherScope)));
  assert.throws(
    () => store.loadOrNull(SCOPE),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_CONFIG_SCOPE_MISMATCH',
  );

  storage.values.set(`nimi:ai-config:${scopeKey}`, JSON.stringify({
    scopeRef: SCOPE,
    capabilities: { targetRefs: { 'text.generate': { kind: 'unknown' } }, selectedParams: {} },
  }));
  assert.throws(
    () => store.loadOrNull(SCOPE),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_CONFIG_INVALID',
  );
  assert.throws(
    () => store.save({
      scopeRef: SCOPE,
      capabilities: { targetRefs: { 'text.generate': { kind: 'unknown' } }, selectedParams: {} },
      profileOrigin: null,
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_CONFIG_INVALID',
  );

  storage.values.set('nimi:ai-config:index', JSON.stringify([
    scopeKey,
    'not-a-scope',
    encodeNimiAIScopeRef(otherScope),
  ]));
  assert.deepEqual(store.listScopeRefs(), [SCOPE, otherScope]);

  const notifications: string[] = [];
  const registry = createNimiAIConfigSubscriptionRegistry();
  const unsubscribe = registry.subscribe(SCOPE, (config) => {
    notifications.push(versionNimiAIConfig(config));
  });
  const config = applyNimiAIProfileToConfig(createEmptyNimiAIConfig(SCOPE), READY_PROFILE, () => '2026-06-05T00:00:00.000Z');
  registry.notify(config);
  unsubscribe();
  registry.notify(config);
  assert.equal(notifications.length, 1);

  const evidence = createNimiAIConfigEvidence(config);
  assert.deepEqual(evidence.capabilityBindingKeys, ['text.generate']);
  assert.equal(diffNimiAIConfigs(null, null).identical, true);
  assert.equal(createNimiAISnapshotExecutionId(-1).length, 26);

  const snapshotStore = createNimiAISnapshotStore({
    storage: () => storage,
    maxSnapshots: 1,
  });
  const snapshot = createNimiAISnapshotRecord({
    executionId: 'exec-2',
    scopeRef: SCOPE,
    config,
    capability: 'text.generate',
    selectedTargetRef: config.capabilities.targetRefs['text.generate'] ?? null,
    runtimeEvidence: { schedulingJudgement: { state: 'runnable' } },
    createdAt: '2026-06-05T00:00:00.000Z',
  });
  assert.equal(snapshotStore.record(snapshot).runtimeEvidence?.schedulingJudgement?.state, 'runnable');
  assert.equal(snapshotStore.getLatest(SCOPE)?.executionId, 'exec-2');
  assert.throws(
    () => createNimiAISnapshotRecord({
      executionId: 'exec-mismatch',
      scopeRef: otherScope,
      config,
      capability: 'text.generate',
      selectedTargetRef: null,
      createdAt: '2026-06-05T00:00:00.000Z',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SNAPSHOT_SCOPE_MISMATCH',
  );
  assert.throws(
    () => snapshotStore.record({
      ...snapshot,
      conversationCapabilitySlice: {
        ...snapshot.conversationCapabilitySlice,
        executionId: 'other-exec',
      },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SNAPSHOT_EXECUTION_MISMATCH',
  );

  const surface = createNimiAIHostSurface({
    profiles: [READY_PROFILE],
    configStore: createNimiAIConfigStore({ enableEphemeralStore: true }),
  });
  assert.throws(
    () => surface.aiSnapshot.get('exec-1'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SNAPSHOT_STORE_REQUIRED',
  );
});

test('Nimi AI profile apply and runtime descriptor formation fail closed on unresolved slices', async () => {
  const unresolvedProfile: NimiAIProfile = {
    profileId: 'profile-unresolved',
    title: 'Needs setup',
    capabilities: {
      'text.generate': {
        readinessPolicy: 'required',
      },
    },
  };
  const store = createNimiAIConfigStore({ enableEphemeralStore: true });
  const surface = createNimiAIHostSurface({
    profiles: [READY_PROFILE, unresolvedProfile],
    configStore: store,
  });

  const preview = await surface.aiProfile.previewApply(SCOPE, 'profile-unresolved');
  assert.equal(preview.outcome, 'setup_required_no_live_config');
  assert.equal(preview.after, null);

  assert.throws(
    () => applyNimiAIProfileToConfig(createEmptyNimiAIConfig(SCOPE), unresolvedProfile),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_NOT_APPLYABLE',
  );

  const descriptor = await surface.aiProfile.formRuntimeDescriptor({
    profileId: 'profile-chat',
    descriptorId: 'descriptor-1',
    sourceProfileDigest: 'digest-profile-chat',
    projectedAt: '2026-06-04T00:00:00.000Z',
    requirementDeclarations: [{
      requirementId: 'chat-requirement',
      scopeRef: SCOPE,
      setupProjectionPolicy: 'fail-closed',
      requiredSlices: [{
        requirementSliceId: 'slice-text',
        capability: 'text.generate',
        profileSliceRef: 'text-generate-local',
        readinessPolicy: 'required',
      }],
    }],
  });

  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.capabilitySlices[0]?.execution?.backend, 'llama.cpp');
  assert.equal(descriptor.capabilitySlices[0]?.model?.family, 'llama');
});

test('Nimi AI account profile library parsing validates editable profile projections', () => {
  const projection = parseNimiAccountProfileLibraryProjection({
    accountId: 'acct-1',
    libraryRef: 'account-profile-library:acct-1',
    index: {
      schemaVersion: 1,
      accountId: 'acct-1',
      updatedAt: '2026-06-04T00:00:00.000Z',
      entries: [{
        profileId: 'profile-chat',
        title: 'Chat',
        origin: 'user',
        relativePath: 'profiles/chat.json',
        editable: true,
        removable: true,
        updatedAt: '2026-06-04T00:00:00.000Z',
      }],
    },
    profiles: [{
      profileId: 'profile-chat',
      origin: 'user',
      editable: true,
      removable: true,
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
      profile: READY_PROFILE,
    }],
  });

  assert.equal(projection.profiles[0]?.profile.profileId, 'profile-chat');
  assert.equal(parseExportedNimiAccountProfileLibraryProfiles([READY_PROFILE])[0]?.profileId, 'profile-chat');
  assert.throws(
    () => parseNimiAccountProfileLibraryProjection({
      accountId: 'acct-1',
      libraryRef: 'account-profile-library:acct-1',
      index: { entries: [] },
      profiles: [{ profileId: 'default', origin: 'account-default', profile: READY_PROFILE }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_LIBRARY_INVALID',
  );
});

test('Nimi AI account profile library parsers fail closed on invalid origins and exports', () => {
  assert.equal(parseNimiAccountProfileLibraryOrigin(' imported '), 'imported');
  assert.deepEqual(parseNimiAccountProfileLibraryIndexEntry({
    profileId: 'profile-imported',
    title: 'Imported',
    origin: 'imported',
    relativePath: 'profiles/imported.json',
    editable: true,
    removable: false,
    updatedAt: '2026-06-05T00:00:00.000Z',
  }), {
    profileId: 'profile-imported',
    title: 'Imported',
    origin: 'imported',
    relativePath: 'profiles/imported.json',
    editable: true,
    removable: false,
    updatedAt: '2026-06-05T00:00:00.000Z',
  });
  assert.equal(parseNimiAccountProfileLibraryProfile({
    profileId: 'profile-imported',
    origin: 'imported',
    editable: false,
    removable: true,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
    profile: {
      profileId: 'profile-imported',
      title: 'Imported',
      capabilities: {},
    },
  }).profile.profileId, 'profile-imported');
  assert.throws(
    () => parseNimiAccountProfileLibraryOrigin('system-default'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_LIBRARY_INVALID',
  );
  assert.throws(
    () => parseNimiAccountProfileLibraryProfile({
      profileId: 'default',
      origin: 'account-default',
      profile: READY_PROFILE,
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_LIBRARY_INVALID',
  );
  assert.throws(
    () => parseExportedNimiAccountProfileLibraryProfiles({ profile: READY_PROFILE }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_LIBRARY_INVALID',
  );
});

test('Nimi AI first-launch app config initializes through explicit host authorities', async () => {
  const scopeRef = createNimiAppAIScopeRef('dev.nimi.app', 'chat');
  const committed: NimiAIProfile[] = [];
  let stored: ReturnType<typeof createEmptyNimiAIConfig> | null = null;

  const initialized = await ensureNimiAppFirstLaunchAIConfig({
    scopeRef,
    getExistingAppAIConfig: () => stored,
    resolveRecommendedProfile: () => ({ profile: READY_PROFILE, manifestSatisfied: true }),
    resolveAccountDefaultProfile: () => null,
    applyHostAIConfig: (_scope, config) => {
      committed.push(READY_PROFILE);
      stored = config;
      return config;
    },
    validateManifestRequirements: () => [],
    now: () => '2026-06-04T00:00:00.000Z',
  });

  assert.equal(initialized.outcome, 'initialized');
  assert.equal(initialized.outcome === 'initialized' ? initialized.profileSource : '', 'recommended-profile');
  assert.equal(committed.length, 1);

  const already = await ensureNimiAppFirstLaunchAIConfig({
    scopeRef,
    getExistingAppAIConfig: () => stored,
    resolveRecommendedProfile: () => null,
    resolveAccountDefaultProfile: () => READY_PROFILE,
    applyHostAIConfig: (_scope, config) => config,
  });
  assert.equal(already.outcome, 'already-initialized');

  const setupRequired = await ensureNimiAppFirstLaunchAIConfig({
    scopeRef: createNimiAppAIScopeRef('dev.nimi.other', 'chat'),
    getExistingAppAIConfig: () => null,
    resolveRecommendedProfile: () => ({
      profile: {
        profileId: 'needs-setup',
        title: 'Needs setup',
        capabilities: { 'text.generate': { readinessPolicy: 'required' } },
      },
      manifestSatisfied: true,
    }),
    resolveAccountDefaultProfile: () => null,
    applyHostAIConfig: (_scope, config) => config,
  });
  assert.equal(setupRequired.outcome, 'setup-required-no-live-config');
});

test('Nimi AI scheduling projection calls Runtime peekScheduling without embedding live bindings in AIConfig', async () => {
  const config = applyNimiAIProfileToConfig(createEmptyNimiAIConfig(SCOPE), READY_PROFILE);
  const requests: ReturnType<typeof buildNimiRuntimeAISchedulingRequest>[] = [];
  const scheduling = createNimiRuntimeAISchedulingClient({
    appId: 'dev.nimi.wave4',
    config,
    runtime: {
      async peekScheduling(request) {
        requests.push(request);
        return {
          occupancy: { globalUsed: 1, globalCap: 4, appUsed: 1, appCap: 2 },
          aggregateJudgement: {
            state: SchedulingState.RUNNABLE,
            detail: 'ready',
            resourceWarnings: [],
          },
          targetJudgements: [{
            target: request.targets[0],
            judgement: {
              state: SchedulingState.RUNNABLE,
              detail: 'target ready',
              resourceWarnings: [],
            },
          }],
        };
      },
    },
  });

  const projection = await scheduling.peek();

  assert.equal(requests[0]?.targets[0]?.targetId, 'runtime-target-chat');
  assert.equal(requests[0]?.targets[0]?.profileId, 'runtime-profile-chat');
  assert.equal(projection.aggregateJudgement?.state, 'runnable');
  assert.equal(projection.targetJudgements[0]?.target.capability, 'text.generate');

  assert.throws(
    () => buildNimiRuntimeAISchedulingRequest({
      appId: 'dev.nimi.wave4',
      config: {
        ...config,
        capabilities: {
          targetRefs: {
            'text.generate': {
              kind: 'profile-slice',
              sourceProfileId: 'profile-chat',
              sliceId: 'text-generate-local',
            },
          },
          selectedParams: {},
        },
      },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SCHEDULING_TARGET_REQUIRED',
  );
});
