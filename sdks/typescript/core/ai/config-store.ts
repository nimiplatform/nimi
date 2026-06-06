import type {
  CreateNimiAIHostSurfaceOptions,
  NimiAIConfig,
  NimiAIConfigStore,
  NimiAIConfigStoreOptions,
  NimiAIConfigSubscriptionRegistry,
  NimiAIHostSurface,
  NimiAIProfile,
  NimiAIProfileApplyOptions,
  NimiAIProfilePreviewOptions,
  NimiAIProfilePreviewResult,
  NimiAIScopeRef,
  NimiAISnapshot,
  NimiAISnapshotStore,
  NimiAISnapshotStoreOptions,
} from './config-types';
import {
  areNimiAIScopeRefsEqual,
  assertNimiAIScopeRef,
  createEmptyNimiAIConfig,
  encodeNimiAIScopeRef,
  parseNimiAIScopeRefKey,
  validateNimiAIConfig,
} from './config-scope';
import {
  diffNimiAIConfigs,
  normalizeNimiAIConfig,
  normalizeNimiAISnapshot,
  parseStoredNimiAIConfig,
  versionNimiAIConfig,
} from './config-state';
import { formNimiRuntimeProfileDescriptor } from './config-runtime-descriptor';
import { previewNimiAIProfileApply, validateNimiAIProfile } from './config-profile';
import {
  aiConfigError,
  cloneJson,
  createHostStorageAccess,
  normalizeText,
  readJsonArray,
  requireNonEmptyText,
} from './config-internal';

export function createNimiAIConfigSubscriptionRegistry(): NimiAIConfigSubscriptionRegistry {
  const subscribers = new Map<string, Set<(config: NimiAIConfig) => void>>();
  return {
    subscribe(scopeRef, callback) {
      const key = encodeNimiAIScopeRef(scopeRef);
      const scoped = subscribers.get(key) ?? new Set();
      scoped.add(callback);
      subscribers.set(key, scoped);
      return () => {
        scoped.delete(callback);
        if (scoped.size === 0) {
          subscribers.delete(key);
        }
      };
    },
    notify(config) {
      for (const callback of subscribers.get(encodeNimiAIScopeRef(config.scopeRef)) ?? []) {
        callback(cloneJson(config) as NimiAIConfig);
      }
    },
  };
}

export function createNimiAIConfigStore(options: NimiAIConfigStoreOptions = {}): NimiAIConfigStore {
  const indexKey = options.indexKey ?? 'nimi:ai-config:index';
  const configKeyForScope = options.configKeyForScope ?? ((scopeKey) => `nimi:ai-config:${scopeKey}`);
  const ephemeral = new Map<string, string>();
  const host = createHostStorageAccess('AIConfig store', options.storage, options.enableEphemeralStore, ephemeral);

  const store: NimiAIConfigStore = {
    has(scopeRef) {
      const scopeKey = encodeNimiAIScopeRef(scopeRef);
      return host.getItem(configKeyForScope(scopeKey)) !== null;
    },
    loadOrNull(scopeRef) {
      const scopeKey = encodeNimiAIScopeRef(scopeRef);
      const raw = host.getItem(configKeyForScope(scopeKey));
      if (raw === null) {
        return null;
      }
      return parseStoredNimiAIConfig(raw, scopeRef);
    },
    load(scopeRef) {
      return store.loadOrNull(scopeRef) ?? createEmptyNimiAIConfig(scopeRef);
    },
    save(config) {
      const validation = validateNimiAIConfig(config);
      if (!validation.valid) {
        throw aiConfigError(
          'SDK_AI_CONFIG_INVALID',
          `AIConfig is invalid: ${validation.errors.join('; ')}`,
          'fix_ai_config_contract',
        );
      }
      const normalized = normalizeNimiAIConfig(config);
      const scopeKey = encodeNimiAIScopeRef(normalized.scopeRef);
      host.setItem(configKeyForScope(scopeKey), JSON.stringify(normalized));
      const keys = new Set(readJsonArray(host.getItem(indexKey)).filter((entry): entry is string => typeof entry === 'string'));
      keys.add(scopeKey);
      host.setItem(indexKey, JSON.stringify([...keys].sort()));
      return normalized;
    },
    listScopeRefs() {
      return readJsonArray(host.getItem(indexKey))
        .filter((entry): entry is string => typeof entry === 'string')
        .map(parseNimiAIScopeRefKey)
        .filter((scopeRef): scopeRef is NimiAIScopeRef => Boolean(scopeRef));
    },
  };
  return store;
}

export function createNimiAISnapshotStore(options: NimiAISnapshotStoreOptions = {}): NimiAISnapshotStore {
  const indexKey = options.indexKey ?? 'nimi:ai-snapshot:index';
  const snapshotKeyForExecution = options.snapshotKeyForExecution ?? ((executionId) => `nimi:ai-snapshot:${executionId}`);
  const latestKeyForScope = options.latestKeyForScope ?? ((scopeKey) => `nimi:ai-snapshot:latest:${scopeKey}`);
  const maxSnapshots = Number.isInteger(options.maxSnapshots) && Number(options.maxSnapshots) > 0
    ? Number(options.maxSnapshots)
    : null;
  const ephemeral = new Map<string, string>();
  const host = createHostStorageAccess('AISnapshot store', options.storage, options.enableEphemeralStore, ephemeral);
  const store: NimiAISnapshotStore = {
    record(snapshot) {
      const normalized = normalizeNimiAISnapshot(snapshot);
      host.setItem(snapshotKeyForExecution(normalized.executionId), JSON.stringify(normalized));
      const scopeKey = encodeNimiAIScopeRef(normalized.scopeRef);
      host.setItem(latestKeyForScope(scopeKey), normalized.executionId);
      const ids = new Set(readJsonArray(host.getItem(indexKey)).filter((entry): entry is string => typeof entry === 'string'));
      ids.add(normalized.executionId);
      const orderedIds = [...ids].sort();
      const retainedIds = maxSnapshots && orderedIds.length > maxSnapshots
        ? orderedIds.slice(orderedIds.length - maxSnapshots)
        : orderedIds;
      host.setItem(indexKey, JSON.stringify(retainedIds));
      return normalized;
    },
    get(executionId) {
      const raw = host.getItem(snapshotKeyForExecution(requireNonEmptyText(
        executionId,
        'snapshot executionId is required',
        'provide_ai_snapshot_execution_id',
      )));
      return raw === null ? null : normalizeNimiAISnapshot(JSON.parse(raw) as NimiAISnapshot);
    },
    getLatest(scopeRef) {
      const executionId = host.getItem(latestKeyForScope(encodeNimiAIScopeRef(scopeRef)));
      return executionId ? store.get(executionId) : null;
    },
  };
  return store;
}

export function createNimiAIHostSurface(options: CreateNimiAIHostSurfaceOptions): NimiAIHostSurface {
  const profiles = new Map(options.profiles.map((profile) => [profile.profileId, profile]));
  for (const profile of profiles.values()) {
    const validation = validateNimiAIProfile(profile);
    if (!validation.valid) {
      throw aiConfigError(
        'SDK_AI_PROFILE_INVALID',
        `AI profile ${profile.profileId || '<unknown>'} is invalid: ${validation.errors.join('; ')}`,
        'fix_ai_profile_catalog',
      );
    }
  }
  const subscriptions = options.subscriptions ?? createNimiAIConfigSubscriptionRegistry();
  const now = options.now ?? (() => new Date().toISOString());
  const snapshotStore = options.snapshotStore;

  async function resolveProfile(profileId: string): Promise<NimiAIProfile | null> {
    const normalized = normalizeText(profileId);
    return normalized ? cloneJson(profiles.get(normalized) ?? null) as NimiAIProfile | null : null;
  }

  async function previewApply(
    scopeRef: NimiAIScopeRef,
    profileId: string,
    previewOptions: NimiAIProfilePreviewOptions,
  ): Promise<NimiAIProfilePreviewResult> {
    const profile = await resolveProfile(profileId);
    if (!profile) {
      return missingHostProfilePreview(scopeRef, options.configStore.loadOrNull(scopeRef), profileId);
    }
    return previewNimiAIProfileApply({
      before: options.configStore.loadOrNull(scopeRef),
      scopeRef,
      profile,
      requirementDeclarations: previewOptions.requirementDeclarations,
      now,
    });
  }

  return {
    aiProfile: {
      async list() {
        return [...profiles.values()].map((profile) => cloneJson(profile) as NimiAIProfile);
      },
      get: resolveProfile,
      validate: validateNimiAIProfile,
      previewApply,
      async apply(scopeRef, profileId, applyOptions: NimiAIProfileApplyOptions) {
        const preview = await previewApply(scopeRef, profileId, {
          requirementDeclarations: applyOptions.requirementDeclarations,
        });
        if (preview.outcome !== 'ready_to_apply' || !preview.after) {
          return {
            success: false,
            config: null,
            failureReason: preview.outcome,
            outcome: preview.outcome,
            setupProjection: preview.setupProjection,
            probeWarnings: preview.probeWarnings,
          };
        }
        if (applyOptions.expectedBaseVersion && applyOptions.expectedBaseVersion !== preview.baseVersion) {
          return {
            success: false,
            config: null,
            failureReason: 'stale_base',
            outcome: 'stale_base',
            probeWarnings: [],
          };
        }
        const saved = options.configStore.save(preview.after);
        subscriptions.notify(saved);
        return {
          success: true,
          config: saved,
          failureReason: null,
          outcome: 'ready_to_apply',
          probeWarnings: [],
        };
      },
      async formRuntimeDescriptor(input) {
        const profile = await resolveProfile(input.profileId);
        if (!profile) {
          throw aiConfigError('SDK_AI_PROFILE_NOT_FOUND', `AI profile not found: ${input.profileId}`, 'select_existing_ai_profile');
        }
        return formNimiRuntimeProfileDescriptor({
          profile,
          requirementDeclarations: input.requirementDeclarations,
          descriptorId: input.descriptorId,
          sourceProfileDigest: input.sourceProfileDigest,
          projectedAt: input.projectedAt,
        });
      },
    },
    aiConfig: {
      get(scopeRef) {
        return options.configStore.load(scopeRef);
      },
      update(scopeRef, config) {
        if (!areNimiAIScopeRefsEqual(assertNimiAIScopeRef(scopeRef), assertNimiAIScopeRef(config.scopeRef))) {
          throw aiConfigError('SDK_AI_CONFIG_SCOPE_MISMATCH', 'AIConfig scopeRef must match update scopeRef', 'use_matching_ai_scope_ref');
        }
        const saved = options.configStore.save(config);
        subscriptions.notify(saved);
        return saved;
      },
      listScopes() {
        return options.configStore.listScopeRefs();
      },
      subscribe(scopeRef, callback) {
        return subscriptions.subscribe(scopeRef, callback);
      },
    },
    aiSnapshot: {
      record(scopeRef, snapshot) {
        if (!snapshotStore) {
          throw aiConfigError('SDK_AI_SNAPSHOT_STORE_REQUIRED', 'AISnapshot record requires explicit host snapshot store', 'provide_ai_snapshot_store');
        }
        if (!areNimiAIScopeRefsEqual(scopeRef, snapshot.scopeRef)) {
          throw aiConfigError('SDK_AI_SNAPSHOT_SCOPE_MISMATCH', 'AISnapshot scopeRef must match record scopeRef', 'use_matching_ai_snapshot_scope');
        }
        return snapshotStore.record(snapshot);
      },
      get(executionId) {
        if (!snapshotStore) {
          throw aiConfigError('SDK_AI_SNAPSHOT_STORE_REQUIRED', 'AISnapshot get requires explicit host snapshot store', 'provide_ai_snapshot_store');
        }
        return snapshotStore.get(executionId);
      },
      getLatest(scopeRef) {
        if (!snapshotStore) {
          throw aiConfigError('SDK_AI_SNAPSHOT_STORE_REQUIRED', 'AISnapshot getLatest requires explicit host snapshot store', 'provide_ai_snapshot_store');
        }
        return snapshotStore.getLatest(scopeRef);
      },
    },
  };
}

function missingHostProfilePreview(
  scopeRef: NimiAIScopeRef,
  before: NimiAIConfig | null,
  profileId: string,
): NimiAIProfilePreviewResult {
  return {
    before,
    after: null,
    outcome: 'invalid_profile',
    diff: diffNimiAIConfigs(before, null),
    baseVersion: versionNimiAIConfig(before ?? createEmptyNimiAIConfig(scopeRef)),
    probeWarnings: [`AI profile not found: ${profileId}`],
  };
}
