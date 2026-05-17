import { NimiAppClient, createNimiAppRegistryTransport } from '@nimiplatform/sdk/app';
import {
  createRuntimeDefaultExperienceTransport,
  resolveDefaultExperienceMaterializationState,
  type RuntimeDefaultExperienceTransportOptions,
} from '@nimiplatform/sdk/scope/default-experience';
import { applyAIProfileToConfig, type AIProfile, type AIScopeRef as DesktopAIScopeRef } from '@nimiplatform/sdk/mod';
import { localRuntime, type LocalRuntimeDeviceProfile, type LocalRuntimeEnvironmentActivationGate } from '@runtime/local-runtime';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import {
  loadPlatformDefaultExperienceAIProfiles,
  loadPlatformDefaultExperienceProfiles,
  loadPlatformNimiAppRegistryRows,
} from '../../../../runtime/platform-catalog/index.js';
import type {
  ApplyResult,
  ColdStartProjection,
  ColdStartState,
  RuntimeAdapter,
  ScopeRef,
} from '../../../../runtime/default-experience-bridge/index.js';

type RuntimeLocalForDefaultExperience = RuntimeDefaultExperienceTransportOptions['localRuntime'];
type SdkLocalDeviceProfile = NonNullable<Awaited<ReturnType<RuntimeLocalForDefaultExperience['collectDeviceProfile']>>['profile']>;
type SdkActivationGate = NonNullable<Awaited<ReturnType<RuntimeLocalForDefaultExperience['resolveLocalEnvironmentActivationGate']>>['gate']>;
type SdkActivationDependency = SdkActivationGate['dependencies'][number];

export interface DesktopDefaultExperienceProjection {
  readonly profileState: ColdStartState;
  readonly materializationState: ColdStartState;
  readonly profileId?: string;
  readonly detail?: string;
}

export interface DesktopHomeLiveBridge {
  readonly defaultExperienceBridge: RuntimeAdapter;
  readonly appClient: NimiAppClient;
  readonly projectDefaultExperience: () => Promise<DesktopDefaultExperienceProjection>;
  readonly applyAgentChatProfile: (
    scopeRef: { readonly kind: 'account' | 'app' | 'workspace' | 'first-run'; readonly scopeId: string },
    profileId: string,
  ) => Promise<{ applied: boolean }>;
}

export function createDesktopHomeLiveBridge(): DesktopHomeLiveBridge {
  const localRuntimeClient = createLocalRuntimeClient();
  const defaultExperienceBridge = createRuntimeDefaultExperienceTransport({
    localRuntime: localRuntimeClient,
    loadProfiles: loadPlatformDefaultExperienceProfiles,
    applyProfile: applyPlatformDefaultExperienceProfile,
  }) satisfies RuntimeAdapter;
  const appClient = new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: loadPlatformNimiAppRegistryRows,
  }));

  return {
    defaultExperienceBridge,
    appClient,
    projectDefaultExperience: async () => {
      try {
        const profile = await defaultExperienceBridge.recommendProfile('first-run');
        const materialization = await resolveDefaultExperienceMaterializationState(localRuntimeClient, profile, {
          consumerId: 'nimi-home-first-run',
        });
        return {
          profileState: 'ready',
          materializationState: canonicalColdStartState(materialization.state),
          profileId: profile.alias,
          detail: materialization.detail,
        };
      } catch (error) {
        return {
          profileState: 'unavailable',
          materializationState: 'unavailable',
          detail: error instanceof Error ? error.message : 'Default Experience bridge unavailable',
        };
      }
    },
    applyAgentChatProfile: (scopeRef, profileId) =>
      applyPlatformDefaultExperienceProfile({ kind: scopeRef.kind, id: scopeRef.scopeId }, profileId)
        .then((result) => ({ applied: result.applied })),
  };
}

function createLocalRuntimeClient(): RuntimeLocalForDefaultExperience {
  return {
    async collectDeviceProfile() {
      return { profile: toSdkDeviceProfile(await localRuntime.collectDeviceProfile()) };
    },
    async resolveLocalEnvironmentActivationGate(request) {
      const gate = await localRuntime.resolveEnvironmentActivationGate({
        consumerId: request.consumerId,
        packId: request.packId,
        runtimeDataRoot: request.runtimeDataRoot,
        assetId: request.assetId,
        localAssetId: request.localAssetId,
        companionAssetId: request.companionAssetId,
        parentAssetId: request.parentAssetId,
      });
      return { gate: toSdkActivationGate(gate) };
    },
  };
}

async function applyPlatformDefaultExperienceProfile(scopeRef: ScopeRef, profileId: string): Promise<ApplyResult> {
  const profile = findPlatformAIProfile(profileId);
  if (!profile) {
    return { applied: false, profileId, scope: scopeRef };
  }
  const aiScopeRef = toDesktopAIScopeRef(scopeRef);
  const service = getDesktopAIConfigService();
  const baseConfig = service.aiConfig.get(aiScopeRef);
  service.aiConfig.update(aiScopeRef, applyAIProfileToConfig(baseConfig, profile));
  return { applied: true, profileId, scope: scopeRef };
}

function findPlatformAIProfile(profileId: string): AIProfile | null {
  return loadPlatformDefaultExperienceAIProfiles().find((profile) => profile.profileId === profileId) ?? null;
}

function toDesktopAIScopeRef(scopeRef: ScopeRef): DesktopAIScopeRef {
  if (scopeRef.kind === 'app') {
    return { kind: 'app', ownerId: scopeRef.id };
  }
  return { kind: 'feature', ownerId: 'nimi.home', surfaceId: scopeRef.id };
}

function toSdkDeviceProfile(profile: LocalRuntimeDeviceProfile): SdkLocalDeviceProfile {
  return {
    os: profile.os,
    arch: profile.arch,
    gpu: {
      available: profile.gpu.available,
      vendor: profile.gpu.vendor ?? '',
      model: profile.gpu.model ?? '',
      totalVramBytes: String(profile.gpu.totalVramBytes ?? 0),
      availableVramBytes: String(profile.gpu.availableVramBytes ?? 0),
      memoryModel: gpuMemoryModel(profile.gpu.memoryModel),
    },
    python: {
      available: profile.python.available,
      version: profile.python.version ?? '',
    },
    npu: {
      available: profile.npu.available,
      ready: profile.npu.ready,
      vendor: profile.npu.vendor ?? '',
      runtime: profile.npu.runtime ?? '',
      detail: profile.npu.detail ?? '',
    },
    diskFreeBytes: String(profile.diskFreeBytes),
    ports: profile.ports.map((port) => ({ port: port.port, available: port.available })),
    totalRamBytes: String(profile.totalRamBytes),
    availableRamBytes: String(profile.availableRamBytes),
  };
}

function gpuMemoryModel(model: LocalRuntimeDeviceProfile['gpu']['memoryModel']): NonNullable<SdkLocalDeviceProfile['gpu']>['memoryModel'] {
  if (model === 'discrete') return 1;
  if (model === 'unified') return 2;
  return 0;
}

function toSdkActivationGate(gate: LocalRuntimeEnvironmentActivationGate): SdkActivationGate {
  return {
    consumerId: gate.consumerId,
    packId: gate.packId,
    state: gate.state,
    reasonCode: gate.reasonCode ?? '',
    detail: gate.detail ?? '',
    blockingDependencies: gate.blockingDependencies.map(toSdkActivationDependency),
    dependencies: gate.dependencies.map(toSdkActivationDependency),
  };
}

function toSdkActivationDependency(dependency: LocalRuntimeEnvironmentActivationGate['dependencies'][number]): SdkActivationDependency {
  return {
    dependencyFamily: dependency.dependencyFamily,
    dependencyId: dependency.dependencyId,
    required: dependency.required,
    state: dependency.state,
    sourceKind: dependency.sourceKind,
    confirmationRequired: dependency.confirmationRequired,
    selectedSourceRecordId: dependency.selectedSourceRecordId ?? '',
    environmentKey: dependency.environmentKey,
    canonicalRoot: dependency.canonicalRoot ?? '',
    reasonCode: dependency.reasonCode ?? '',
    detail: dependency.detail ?? '',
  };
}

function canonicalColdStartState(state: string | undefined): ColdStartState {
  switch (state) {
    case 'ready':
    case 'setup-required':
    case 'needs-confirmation':
    case 'in-progress':
    case 'failed':
    case 'unsupported':
    case 'stale-projection':
    case 'unavailable':
      return state;
    default:
      return 'unavailable';
  }
}
