import type { DesktopHookRuntimeService } from '@runtime/hook';
import {
  findLocalRuntimeProfileById,
  localRuntime,
} from '@runtime/local-runtime';
import type {
  CheckLlmHealthInput,
  ExecuteLocalKernelTurnInput,
  ExecuteLocalKernelTurnResult,
  ProviderHealth,
} from '@runtime/llm-adapter';
import type {
  AIScopeRef,
  ModRuntimeResolvedBinding,
  ModSdkHost,
  RuntimeCanonicalCapability,
  RuntimeLlmHealthInput,
  RuntimeRouteBinding,
} from '@nimiplatform/sdk/mod';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { readManifestProfiles } from './runtime-bootstrap-host-capabilities-profiles';

type RuntimeClient = ReturnType<typeof import('@nimiplatform/sdk').getPlatformClient>['runtime'];
type DesktopAIConfigService = ReturnType<typeof import('@renderer/app-shell/providers/desktop-ai-config-service').getDesktopAIConfigService>;

type AuthorizeRuntimeCapability = (payload: {
  modId: string;
  capabilityKey: string;
  target?: string;
}) => void;

function toProtoInt64String(value: number | null | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  return String(Math.max(0, Math.trunc(numeric)));
}

function fromProtoInt64String(value: string | number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function buildRuntimeSchedulerCapabilities(input: {
  getRuntimeClient: () => RuntimeClient;
}): ModSdkHost['runtime']['scheduler'] {
  return {
    peek: async (peekInput) => {
      const client = input.getRuntimeClient();
      try {
        const response = await client.ai.peekScheduling({
          appId: String(peekInput.appId || '').trim() || '_default',
          targets: (peekInput.targets || []).map((target) => ({
            capability: String(target.capability || '').trim(),
            modId: String(target.modId || '').trim(),
            profileId: String(target.profileId || '').trim(),
            resourceHint: target.resourceHint ? {
              estimatedVramBytes: toProtoInt64String(target.resourceHint.estimatedVramBytes),
              estimatedRamBytes: toProtoInt64String(target.resourceHint.estimatedRamBytes),
              estimatedDiskBytes: toProtoInt64String(target.resourceHint.estimatedDiskBytes),
              engine: String(target.resourceHint.engine || '').trim(),
            } : undefined,
          })),
        });
        const stateMap: Record<number, string> = {
          0: 'unknown',
          1: 'runnable',
          2: 'queue_required',
          3: 'preemption_risk',
          4: 'slowdown_risk',
          5: 'denied',
          6: 'unknown',
        };
        const toOccupancy = (occ: {
          globalUsed: number;
          globalCap: number;
          appUsed: number;
          appCap: number;
        } | null | undefined) => occ ? {
          globalUsed: occ.globalUsed,
          globalCap: occ.globalCap,
          appUsed: occ.appUsed,
          appCap: occ.appCap,
        } : null;
        const toJudgement = (judgement: {
          state: number;
          detail: string;
          occupancy?: {
            globalUsed: number;
            globalCap: number;
            appUsed: number;
            appCap: number;
          } | null;
          resourceWarnings?: string[];
        } | null | undefined) => judgement ? ({
          state: stateMap[judgement.state] || 'unknown',
          detail: judgement.detail || '',
          occupancy: toOccupancy(judgement.occupancy),
          resourceWarnings: judgement.resourceWarnings || [],
        }) : null;
        const aggregateJudgement = toJudgement(response?.aggregateJudgement);
        if (!aggregateJudgement) {
          return { occupancy: null, aggregateJudgement: null, targetJudgements: [] };
        }
        return {
          occupancy: toOccupancy(response?.occupancy),
          aggregateJudgement,
          targetJudgements: (response?.targetJudgements || []).map((entry) => ({
            target: {
              capability: entry.target?.capability || '',
              modId: entry.target?.modId || null,
              profileId: entry.target?.profileId || null,
              resourceHint: entry.target?.resourceHint ? {
                estimatedVramBytes: fromProtoInt64String(entry.target.resourceHint.estimatedVramBytes),
                estimatedRamBytes: fromProtoInt64String(entry.target.resourceHint.estimatedRamBytes),
                estimatedDiskBytes: fromProtoInt64String(entry.target.resourceHint.estimatedDiskBytes),
                engine: entry.target.resourceHint.engine || null,
              } : null,
            },
            judgement: toJudgement(entry.judgement) || {
              state: 'unknown',
              detail: 'empty target judgement',
              occupancy: null,
              resourceWarnings: [],
            },
          })),
        };
      } catch {
        return {
          occupancy: null,
          aggregateJudgement: null,
          targetJudgements: [],
        };
      }
    },
  };
}

export function buildRuntimeLocalCapabilities(input: {
  authorizeRuntimeCapability: AuthorizeRuntimeCapability;
}): ModSdkHost['runtime']['local'] {
  return {
    listAssets: async ({ modId, ...payload }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.local.assets.list',
      });
      return localRuntime.listAssets(payload);
    },
    listProfiles: async ({ modId }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.local.profiles.list',
      });
      return readManifestProfiles(modId);
    },
    requestProfileInstall: async ({ modId, profileId, capability, confirmMessage, entryOverrides }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.local.profiles.install.request',
      });
      const profiles = readManifestProfiles(modId);
      const profile = findLocalRuntimeProfileById(profiles, profileId);
      if (!profile) {
        return {
          modId,
          profileId: String(profileId || '').trim(),
          accepted: false,
          declined: false,
          warnings: ['profile not found'],
          reasonCode: ReasonCode.LOCAL_AI_PROFILE_NOT_FOUND,
        };
      }
      const message = String(confirmMessage || '').trim()
        || `Install recommended local profile "${profile.title}" for ${modId}?`;
      const accepted = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(message)
        : true;
      if (!accepted) {
        return {
          modId,
          profileId: profile.id,
          accepted: false,
          declined: true,
          warnings: ['user declined local profile install'],
          reasonCode: ReasonCode.LOCAL_AI_PROFILE_INSTALL_DECLINED,
        };
      }
      const plan = await localRuntime.resolveProfile({
        modId,
        profile,
        capability: String(capability || '').trim() || undefined,
        entryOverrides,
      });
      const result = await localRuntime.applyProfile(plan, { caller: 'core' });
      return {
        modId,
        profileId: profile.id,
        accepted: true,
        declined: false,
        warnings: result.warnings,
        reasonCode: result.reasonCode,
      };
    },
    getProfileInstallStatus: async ({ modId, profileId, capability, entryOverrides }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.local.profiles.list',
      });
      const profiles = readManifestProfiles(modId);
      const profile = findLocalRuntimeProfileById(profiles, profileId);
      if (!profile) {
        return {
          modId,
          profileId: String(profileId || '').trim(),
          status: 'missing',
          warnings: ['profile not found'],
          missingEntries: [String(profileId || '').trim()].filter(Boolean),
          updatedAt: new Date().toISOString(),
        };
      }
      return localRuntime.getProfileInstallStatus({
        modId,
        profile,
        capability: String(capability || '').trim() || undefined,
        entryOverrides,
      });
    },
  };
}

export function buildRuntimeAIConfigCapabilities(input: {
  authorizeRuntimeCapability: AuthorizeRuntimeCapability;
  desktopAIConfigService: DesktopAIConfigService;
  isCanonicalModAIScopeRef: (scopeRef: AIScopeRef | null | undefined, modId: string) => boolean;
  toCanonicalModScopeRef: (scopeRef: AIScopeRef | null | undefined, modId: string) => AIScopeRef;
}): ModSdkHost['runtime']['aiConfig'] {
  return {
    get: ({ modId, scopeRef }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-config.get',
      });
      return input.desktopAIConfigService.aiConfig.get(input.toCanonicalModScopeRef(scopeRef, modId));
    },
    update: ({ modId, scopeRef, config }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-config.update',
      });
      const canonicalScopeRef = input.toCanonicalModScopeRef(scopeRef, modId);
      input.desktopAIConfigService.aiConfig.update(canonicalScopeRef, {
        ...config,
        scopeRef: canonicalScopeRef,
      });
    },
    listScopes: ({ modId }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-config.list.scopes',
      });
      return input.desktopAIConfigService.aiConfig.listScopes().filter((scopeRef) =>
        input.isCanonicalModAIScopeRef(scopeRef, modId));
    },
    probe: async ({ modId, scopeRef }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-config.probe',
      });
      return input.desktopAIConfigService.aiConfig.probe(input.toCanonicalModScopeRef(scopeRef, modId));
    },
    probeFeasibility: async ({ modId, scopeRef }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-config.probe.feasibility',
      });
      return input.desktopAIConfigService.aiConfig.probeFeasibility(
        input.toCanonicalModScopeRef(scopeRef, modId),
      );
    },
    probeSchedulingTarget: async ({ modId, scopeRef, target }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-config.probe.scheduling.target',
      });
      return input.desktopAIConfigService.aiConfig.probeSchedulingTarget(
        input.toCanonicalModScopeRef(scopeRef, modId),
        target,
      );
    },
    subscribe: ({ modId, scopeRef, callback }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-config.subscribe',
      });
      return input.desktopAIConfigService.aiConfig.subscribe(
        input.toCanonicalModScopeRef(scopeRef, modId),
        callback,
      );
    },
  };
}

export function buildRuntimeAISnapshotCapabilities(input: {
  authorizeRuntimeCapability: AuthorizeRuntimeCapability;
  desktopAIConfigService: DesktopAIConfigService;
  invalidSnapshotAccessError: (modId: string, executionId: string) => Error;
  toCanonicalModScopeRef: (scopeRef: AIScopeRef | null | undefined, modId: string) => AIScopeRef;
  isCanonicalModAIScopeRef: (scopeRef: AIScopeRef | null | undefined, modId: string) => boolean;
}): ModSdkHost['runtime']['aiSnapshot'] {
  return {
    record: ({ modId, scopeRef, snapshot }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-snapshot.record',
      });
      const canonicalScopeRef = input.toCanonicalModScopeRef(scopeRef, modId);
      input.desktopAIConfigService.aiSnapshot.record(canonicalScopeRef, {
        ...snapshot,
        scopeRef: canonicalScopeRef,
      });
    },
    get: ({ modId, executionId }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-snapshot.get',
      });
      const snapshot = input.desktopAIConfigService.aiSnapshot.get(executionId);
      if (!snapshot) {
        return null;
      }
      if (!input.isCanonicalModAIScopeRef(snapshot.scopeRef, modId)) {
        throw input.invalidSnapshotAccessError(modId, executionId);
      }
      return snapshot;
    },
    getLatest: ({ modId, scopeRef }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.ai-snapshot.get.latest',
      });
      return input.desktopAIConfigService.aiSnapshot.getLatest(
        input.toCanonicalModScopeRef(scopeRef, modId),
      );
    },
  };
}

export function buildRuntimeVoiceCapabilities(input: {
  authorizeRuntimeCapability: AuthorizeRuntimeCapability;
  getRuntimeClient: () => RuntimeClient;
  requireModel: (value: string | null | undefined, errorCode: string) => string;
  resolveRuntimeRoute: (payload: {
    modId: string;
    capability: RuntimeCanonicalCapability;
    binding?: RuntimeRouteBinding;
  }) => Promise<ModRuntimeResolvedBinding>;
}): ModSdkHost['runtime']['voice'] {
  return {
    getAsset: async ({ modId, request }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.voice.get.asset',
      });
      return input.getRuntimeClient().ai.getVoiceAsset(request);
    },
    listAssets: async ({ modId, request }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.voice.list.assets',
      });
      return input.getRuntimeClient().ai.listVoiceAssets(request);
    },
    deleteAsset: async ({ modId, request }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.voice.delete.asset',
      });
      return input.getRuntimeClient().ai.deleteVoiceAsset(request);
    },
    listPresetVoices: async ({ modId, binding, modelId, connectorId, ...request }) => {
      input.authorizeRuntimeCapability({
        modId,
        capabilityKey: 'runtime.voice.list.preset.voices',
      });
      const resolved = await input.resolveRuntimeRoute({
        modId,
        capability: 'audio.synthesize',
        binding,
      });
      return input.getRuntimeClient().ai.listPresetVoices({
        ...request,
        modelId: input.requireModel(modelId || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
        connectorId: connectorId || resolved.connectorId || '',
      });
    },
  };
}

export function buildRuntimeCompatibilityAdapters(input: {
  checkLocalLlmHealth: (input: CheckLlmHealthInput) => Promise<ProviderHealth>;
  executeLocalKernelTurn: (input: ExecuteLocalKernelTurnInput) => Promise<ExecuteLocalKernelTurnResult>;
  getRuntimeHookRuntime: () => DesktopHookRuntimeService;
  toHealthInput: (payload: RuntimeLlmHealthInput) => CheckLlmHealthInput | null;
  toKernelTurnInput: (payload: Parameters<ModSdkHost['runtime']['executeLocalKernelTurn']>[0]) => ExecuteLocalKernelTurnInput | null;
  withOpenApiContextLock: HostCapabilityInput['withOpenApiContextLock'];
}): Pick<
  ModSdkHost['runtime'],
  'checkLocalLlmHealth' | 'executeLocalKernelTurn' | 'withOpenApiContextLock' | 'getRuntimeHookRuntime'
> {
  return {
    checkLocalLlmHealth: async (payload) => {
      const resolvedInput = input.toHealthInput(payload);
      if (!resolvedInput) {
        return {
          healthy: false,
          status: 'unavailable',
          detail: 'Runtime provider is missing',
        };
      }
      return input.checkLocalLlmHealth(resolvedInput);
    },
    executeLocalKernelTurn: async (payload) => {
      const resolvedInput = input.toKernelTurnInput(payload);
      if (!resolvedInput) {
        return {
          error: 'RUNTIME_PROVIDER_MISSING',
          detail: 'Runtime provider is missing',
        };
      }
      return input.executeLocalKernelTurn(resolvedInput);
    },
    withOpenApiContextLock: (context, task) => input.withOpenApiContextLock(context, task),
    getRuntimeHookRuntime: () => input.getRuntimeHookRuntime(),
  };
}

type HostCapabilityInput = {
  withOpenApiContextLock: <T>(
    context: { realmBaseUrl: string; accessToken?: string; fetchImpl?: typeof fetch },
    task: () => Promise<T>,
  ) => Promise<T>;
};
