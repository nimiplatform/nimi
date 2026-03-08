import { emitRuntimeLog } from '@runtime/telemetry/logger';
import {
  localAiRuntime,
  listGoRuntimeModelsSnapshot,
  reconcileModelsToGoRuntime,
  type LocalAiDependenciesDeclarationDescriptor,
  type LocalAiDependencyDescriptor,
  type LocalAiModelRecord,
  type LocalAiNodeDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiServiceDescriptor,
} from '@runtime/local-ai-runtime';
import type {
  CheckLlmHealthInput,
  ExecuteLocalKernelTurnInput,
  ExecuteLocalKernelTurnResult,
  ProviderHealth,
} from '@runtime/llm-adapter';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import type { RuntimeLlmHealthInput, RuntimeLlmHealthResult } from '@nimiplatform/sdk/mod/types';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import type {
  ModRuntimeDependencySnapshot,
  ModRuntimeResolvedBinding,
} from '@nimiplatform/sdk/mod/runtime';
import type { SpeechSynthesizeOutput } from '@nimiplatform/sdk/runtime';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/mod/runtime-route';
import { getPlatformClient } from '@runtime/platform-client';
import {
  buildRuntimeRequestMetadata,
  ensureRuntimeLocalModelWarm,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  runtimeModMediaCachePut,
  type RuntimeModMediaCachePutInput,
  type RuntimeModMediaCachePutResult,
} from '@runtime/llm-adapter/tauri-bridge';
import { createResolveRuntimeBinding } from './runtime-bootstrap-route-resolvers';
import { loadRuntimeRouteOptions, pickPreferredGoRuntimeModel } from './runtime-bootstrap-route-options';
import type { WireModSdkHostInput } from './runtime-bootstrap-host';
import { ReasonCode } from '@nimiplatform/sdk/types';

type HostCapabilityInput = {
  checkLocalLlmHealth: (input: CheckLlmHealthInput) => Promise<ProviderHealth>;
  executeLocalKernelTurn: (input: ExecuteLocalKernelTurnInput) => Promise<ExecuteLocalKernelTurnResult>;
  withOpenApiContextLock: <T>(context: { realmBaseUrl: string; accessToken?: string; fetchImpl?: typeof fetch }, task: () => Promise<T>) => Promise<T>;
  getRuntimeHookRuntime: () => DesktopHookRuntimeService;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readManifestDependencies(modId: string): LocalAiDependenciesDeclarationDescriptor | null {
  const normalizedModId = String(modId || '').trim();
  if (!normalizedModId) return null;
  const summaries = useAppStore.getState().localManifestSummaries || [];
  const summary = summaries.find((item) => String(item.id || '').trim() === normalizedModId) || null;
  if (!summary) return null;
  const manifest = asRecord(summary.manifest);
  const ai = asRecord(manifest.ai);
  const dependencies = ai.dependencies;
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    return null;
  }
  return dependencies as LocalAiDependenciesDeclarationDescriptor;
}

function normalizeIdentifier(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((item) => String(item || '').trim().length > 0)));
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function encodeBytesBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }
  const globalBuffer = (globalThis as { Buffer?: { from(value: Uint8Array): { toString(format: string): string } } }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(bytes).toString('base64');
  }
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  throw new Error('RUNTIME_MOD_MEDIA_CACHE_BASE64_UNAVAILABLE');
}

function resolveAudioExtensionHint(input: {
  audioFormat?: string;
  mimeType?: string;
}): string | undefined {
  const format = normalizeText(input.audioFormat).toLowerCase();
  if (format === 'mp3') return 'mp3';
  if (format === 'wav') return 'wav';
  if (format === 'pcm') return 'pcm';
  const mimeType = normalizeText(input.mimeType).toLowerCase();
  if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') return 'mp3';
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return 'wav';
  if (mimeType === 'audio/pcm' || mimeType === 'audio/l16') return 'pcm';
  return undefined;
}

function normalizeSpeechArtifactMimeType(value: string | undefined): string | undefined {
  const mimeType = normalizeText(value).toLowerCase();
  if (!mimeType) {
    return undefined;
  }
  if (mimeType === 'audio/mp3') {
    return 'audio/mpeg';
  }
  if (mimeType === 'audio/x-wav') {
    return 'audio/wav';
  }
  if (mimeType === 'audio/x-pcm') {
    return 'audio/pcm';
  }
  return mimeType;
}

async function cacheSpeechArtifactForDesktopPlayback(input: {
  artifact: SpeechSynthesizeOutput['artifacts'][number];
  audioFormat?: string;
  mediaCachePut?: (
    value: RuntimeModMediaCachePutInput,
  ) => Promise<RuntimeModMediaCachePutResult | null>;
}): Promise<SpeechSynthesizeOutput['artifacts'][number]> {
  const bytes = input.artifact.bytes instanceof Uint8Array && input.artifact.bytes.length > 0
    ? input.artifact.bytes
    : null;
  if (!bytes) {
    const mimeType = normalizeSpeechArtifactMimeType(input.artifact.mimeType);
    return mimeType && mimeType !== input.artifact.mimeType
      ? {
        ...input.artifact,
        mimeType,
      }
      : input.artifact;
  }
  const mimeType = normalizeSpeechArtifactMimeType(input.artifact.mimeType);
  const cached = await (input.mediaCachePut || runtimeModMediaCachePut)({
    mediaBase64: encodeBytesBase64(bytes),
    mimeType,
    extensionHint: resolveAudioExtensionHint({
      audioFormat: input.audioFormat,
      mimeType,
    }),
  });
  if (!cached?.uri) {
    return input.artifact;
  }
  return {
    ...input.artifact,
    uri: cached.uri,
    mimeType: normalizeSpeechArtifactMimeType(cached.mimeType)
      || mimeType
      || normalizeSpeechArtifactMimeType(input.artifact.mimeType)
      || input.artifact.mimeType,
  };
}

export async function cacheSpeechArtifactsForDesktopPlayback(input: {
  artifacts: SpeechSynthesizeOutput['artifacts'];
  audioFormat?: string;
  mediaCachePut?: (
    value: RuntimeModMediaCachePutInput,
  ) => Promise<RuntimeModMediaCachePutResult | null>;
}): Promise<SpeechSynthesizeOutput['artifacts']> {
  return Promise.all((input.artifacts || []).map((artifact) => cacheSpeechArtifactForDesktopPlayback({
    artifact,
    audioFormat: input.audioFormat,
    mediaCachePut: input.mediaCachePut,
  })));
}

function mapCanonicalCapabilityToLocalAi(
  capability: RuntimeCanonicalCapability | undefined,
): string | undefined {
  if (!capability) return undefined;
  if (capability === 'text.generate') return 'chat';
  if (capability === 'text.embed') return 'embedding';
  if (capability === 'image.generate') return 'image';
  if (capability === 'video.generate') return 'video';
  if (capability === 'audio.synthesize') return 'tts';
  if (capability === 'audio.transcribe') return 'stt';
  return undefined;
}

function mapLocalAiCapabilityToCanonical(capability: unknown): RuntimeCanonicalCapability | undefined {
  const normalized = String(capability || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'text.generate' || normalized === 'chat') return 'text.generate';
  if (normalized === 'text.embed' || normalized === 'embedding') return 'text.embed';
  if (normalized === 'image.generate' || normalized === 'image') return 'image.generate';
  if (normalized === 'video.generate' || normalized === 'video') return 'video.generate';
  if (normalized === 'audio.synthesize' || normalized === 'tts' || normalized === 'speech.synthesize') return 'audio.synthesize';
  if (normalized === 'audio.transcribe' || normalized === 'stt' || normalized === 'speech.transcribe') return 'audio.transcribe';
  return undefined;
}

function toDependencyEntries(
  dependencies: LocalAiDependencyResolutionPlan['dependencies'],
): ModRuntimeDependencySnapshot['dependencies'] {
  return dependencies.map((item: LocalAiDependencyDescriptor) => ({
    dependencyId: item.dependencyId,
    kind: item.kind,
    capability: mapLocalAiCapabilityToCanonical(item.capability),
    required: item.required,
    selected: item.selected,
    preferred: item.preferred,
    modelId: item.modelId,
    repo: item.repo,
    engine: item.engine,
    serviceId: item.serviceId,
    nodeId: item.nodeId,
    reasonCode: item.reasonCode,
    warnings: Array.isArray(item.warnings) ? item.warnings : [],
  }));
}

function toDependencyEntry(
  item: LocalAiDependencyDescriptor,
  input?: {
    reasonCode?: string;
    warnings?: string[];
  },
): ModRuntimeDependencySnapshot['dependencies'][number] {
  return {
    dependencyId: item.dependencyId,
    kind: item.kind,
    capability: mapLocalAiCapabilityToCanonical(item.capability),
    required: item.required,
    selected: item.selected,
    preferred: item.preferred,
    modelId: item.modelId,
    repo: item.repo,
    engine: item.engine,
    serviceId: item.serviceId,
    nodeId: item.nodeId,
    reasonCode: input?.reasonCode ?? item.reasonCode,
    warnings: input?.warnings ?? (Array.isArray(item.warnings) ? item.warnings : []),
  };
}

type DependencyReadiness = 'ready' | 'degraded' | 'missing';

type DependencyRuntimeAssessment = {
  entry: ModRuntimeDependencySnapshot['dependencies'][number];
  readiness: DependencyReadiness;
  repairActions: ModRuntimeDependencySnapshot['repairActions'];
};

function buildDependencyRepairAction(input: {
  actionId: string;
  dependency: LocalAiDependencyDescriptor;
  reasonCode: string;
  label: string;
}): ModRuntimeDependencySnapshot['repairActions'][number] {
  return {
    actionId: input.actionId,
    label: input.label,
    reasonCode: input.reasonCode,
    dependencyId: input.dependency.dependencyId,
    capability: mapLocalAiCapabilityToCanonical(input.dependency.capability),
  };
}

function dependencyRepairLabel(dep: LocalAiDependencyDescriptor): string {
  if (dep.kind === 'model') {
    const modelId = String(dep.modelId || '').trim() || dep.dependencyId;
    return `Install model ${modelId}`;
  }
  if (dep.kind === 'service') {
    const serviceId = String(dep.serviceId || '').trim() || dep.dependencyId;
    return `Install service ${serviceId}`;
  }
  if (dep.kind === 'node') {
    const nodeId = String(dep.nodeId || '').trim() || dep.dependencyId;
    return `Install node host for ${nodeId}`;
  }
  return `Install dependency ${dep.dependencyId}`;
}

function findModelForDependency(
  dependency: LocalAiDependencyDescriptor,
  models: LocalAiModelRecord[],
): LocalAiModelRecord | null {
  const targetModelId = normalizeIdentifier(dependency.modelId);
  const targetEngine = normalizeIdentifier(dependency.engine);
  return models.find((model) => {
    if (normalizeIdentifier(model.modelId) !== targetModelId || !targetModelId) return false;
    if (!targetEngine) return true;
    return normalizeIdentifier(model.engine) === targetEngine;
  }) || null;
}

function findServiceForDependency(
  dependency: LocalAiDependencyDescriptor,
  services: LocalAiServiceDescriptor[],
): LocalAiServiceDescriptor | null {
  const targetServiceId = normalizeIdentifier(dependency.serviceId);
  if (!targetServiceId) return null;
  return services.find((service) => normalizeIdentifier(service.serviceId) === targetServiceId) || null;
}

function findNodeForDependency(
  dependency: LocalAiDependencyDescriptor,
  nodes: LocalAiNodeDescriptor[],
): LocalAiNodeDescriptor | null {
  const targetNodeId = normalizeIdentifier(dependency.nodeId);
  if (!targetNodeId) return null;
  const targetServiceId = normalizeIdentifier(dependency.serviceId);
  return nodes.find((node) => {
    if (normalizeIdentifier(node.nodeId) !== targetNodeId) return false;
    if (targetServiceId && normalizeIdentifier(node.serviceId) !== targetServiceId) return false;
    return true;
  }) || null;
}

function selectedDependencyInstallAction(
  dependency: LocalAiDependencyDescriptor,
  reasonCode: string,
): ModRuntimeDependencySnapshot['repairActions'][number] {
  return buildDependencyRepairAction({
    actionId: `install:${dependency.dependencyId}`,
    dependency,
    reasonCode,
    label: dependencyRepairLabel(dependency),
  });
}

function assessDependencyRuntimeState(input: {
  dependency: LocalAiDependencyDescriptor;
  models: LocalAiModelRecord[];
  services: LocalAiServiceDescriptor[];
  nodes: LocalAiNodeDescriptor[];
}): DependencyRuntimeAssessment {
  const { dependency, models, services, nodes } = input;
  const warnings = [...(Array.isArray(dependency.warnings) ? dependency.warnings : [])];
  const repairActions: ModRuntimeDependencySnapshot['repairActions'] = [];
  let readiness: DependencyReadiness = 'ready';
  let reasonCode = String(dependency.reasonCode || '').trim() || undefined;

  if (!dependency.selected) {
    if (dependency.required) {
      reasonCode = reasonCode || 'LOCAL_AI_DEPENDENCY_NOT_SELECTED';
      warnings.push('required dependency not selected by resolver');
      readiness = 'missing';
      repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
    }
    return {
      entry: toDependencyEntry(dependency, {
        reasonCode,
        warnings: uniqueStrings(warnings),
      }),
      readiness,
      repairActions,
    };
  }

  if (dependency.kind === 'model') {
    const model = findModelForDependency(dependency, models);
    if (!model || model.status === 'removed') {
      reasonCode = 'LOCAL_AI_DEPENDENCY_MODEL_NOT_INSTALLED';
      warnings.push('selected model dependency is not installed');
      readiness = dependency.required ? 'missing' : 'degraded';
      repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
    } else if (model.status === 'unhealthy') {
      reasonCode = 'LOCAL_AI_DEPENDENCY_MODEL_UNHEALTHY';
      warnings.push('selected model dependency is unhealthy');
      readiness = 'degraded';
      repairActions.push(buildDependencyRepairAction({
        actionId: `fix:model:${dependency.dependencyId}`,
        dependency,
        reasonCode,
        label: `Repair model ${model.modelId}`,
      }));
    } else if (model.status !== 'active') {
      reasonCode = 'LOCAL_AI_DEPENDENCY_MODEL_NOT_ACTIVE';
      warnings.push('selected model dependency is installed but not active');
      readiness = dependency.required ? 'missing' : 'degraded';
      repairActions.push(buildDependencyRepairAction({
        actionId: `start:model:${dependency.dependencyId}`,
        dependency,
        reasonCode,
        label: `Start model ${model.modelId}`,
      }));
    }
  } else if (dependency.kind === 'service') {
    const service = findServiceForDependency(dependency, services);
    if (!service || service.status === 'removed') {
      reasonCode = 'LOCAL_AI_DEPENDENCY_SERVICE_NOT_INSTALLED';
      warnings.push('selected service dependency is not installed');
      readiness = dependency.required ? 'missing' : 'degraded';
      repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
    } else if (service.status === 'unhealthy') {
      reasonCode = 'LOCAL_AI_DEPENDENCY_SERVICE_UNHEALTHY';
      warnings.push('selected service dependency is unhealthy');
      readiness = 'degraded';
      repairActions.push(buildDependencyRepairAction({
        actionId: `fix:service:${dependency.dependencyId}`,
        dependency,
        reasonCode,
        label: `Repair service ${service.serviceId}`,
      }));
    } else if (service.status !== 'active') {
      reasonCode = 'LOCAL_AI_DEPENDENCY_SERVICE_NOT_ACTIVE';
      warnings.push('selected service dependency is installed but not active');
      readiness = dependency.required ? 'missing' : 'degraded';
      repairActions.push(buildDependencyRepairAction({
        actionId: `start:service:${dependency.dependencyId}`,
        dependency,
        reasonCode,
        label: `Start service ${service.serviceId}`,
      }));
    }
  } else if (dependency.kind === 'node') {
    const node = findNodeForDependency(dependency, nodes);
    if (!node) {
      reasonCode = 'LOCAL_AI_DEPENDENCY_NODE_NOT_AVAILABLE';
      warnings.push('selected node dependency is not available in node catalog');
      readiness = dependency.required ? 'missing' : 'degraded';
      repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
    } else {
      const hostService = services.find(
        (service) => normalizeIdentifier(service.serviceId) === normalizeIdentifier(node.serviceId),
      ) || null;
      if (!hostService || hostService.status === 'removed') {
        reasonCode = 'LOCAL_AI_DEPENDENCY_NODE_SERVICE_NOT_INSTALLED';
        warnings.push('node host service is not installed');
        readiness = dependency.required ? 'missing' : 'degraded';
        repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
      } else if (hostService.status === 'unhealthy') {
        reasonCode = 'LOCAL_AI_DEPENDENCY_NODE_SERVICE_UNHEALTHY';
        warnings.push('node host service is unhealthy');
        readiness = 'degraded';
        repairActions.push(buildDependencyRepairAction({
          actionId: `fix:node-host:${dependency.dependencyId}`,
          dependency,
          reasonCode,
          label: `Repair node host ${hostService.serviceId}`,
        }));
      } else if (hostService.status !== 'active') {
        reasonCode = 'LOCAL_AI_DEPENDENCY_NODE_SERVICE_NOT_ACTIVE';
        warnings.push('node host service is installed but not active');
        readiness = dependency.required ? 'missing' : 'degraded';
        repairActions.push(buildDependencyRepairAction({
          actionId: `start:node-host:${dependency.dependencyId}`,
          dependency,
          reasonCode,
          label: `Start node host ${hostService.serviceId}`,
        }));
      }
    }
  }

  return {
    entry: toDependencyEntry(dependency, {
      reasonCode,
      warnings: uniqueStrings(warnings),
    }),
    readiness,
    repairActions,
  };
}

function dedupeRepairActions(
  actions: ModRuntimeDependencySnapshot['repairActions'],
): ModRuntimeDependencySnapshot['repairActions'] {
  const dedupe = new Map<string, ModRuntimeDependencySnapshot['repairActions'][number]>();
  for (const action of actions) {
    const actionId = String(action.actionId || '').trim();
    if (!actionId) continue;
    if (!dedupe.has(actionId)) {
      dedupe.set(actionId, action);
    }
  }
  return Array.from(dedupe.values());
}

function isDependencyRequiredById(
  dependencies: LocalAiDependencyResolutionPlan['dependencies'],
  dependencyId: string | undefined,
): boolean {
  const normalized = normalizeIdentifier(dependencyId);
  if (!normalized) return false;
  return dependencies.some((item) => normalizeIdentifier(item.dependencyId) === normalized && item.required);
}

function buildRepairActionsFromPlan(
  plan: LocalAiDependencyResolutionPlan,
): ModRuntimeDependencySnapshot['repairActions'] {
  const actions: ModRuntimeDependencySnapshot['repairActions'] = [];
  for (const dep of plan.dependencies) {
    if (!dep.required || dep.selected) continue;
    actions.push({
      actionId: `install:${dep.dependencyId}`,
      label: dependencyRepairLabel(dep),
      reasonCode: dep.reasonCode || 'LOCAL_AI_DEPENDENCY_NOT_SELECTED',
      dependencyId: dep.dependencyId,
      capability: mapLocalAiCapabilityToCanonical(dep.capability),
    });
  }
  for (const decision of plan.preflightDecisions) {
    if (decision.ok) continue;
    actions.push({
      actionId: `preflight:${decision.target}:${decision.check}`,
      label: `Resolve preflight: ${decision.check}`,
      reasonCode: decision.reasonCode || 'LOCAL_AI_PREFLIGHT_FAILED',
      dependencyId: decision.dependencyId,
    });
  }
  if (actions.length === 0 && plan.warnings.length > 0) {
    actions.push({
      actionId: 'runtime:review-warnings',
      label: 'Review dependency warnings in Runtime Setup',
      reasonCode: plan.reasonCode || 'LOCAL_AI_DEPENDENCY_WARNING',
    });
  }
  return actions;
}

export function createModAiDependencySnapshotResolver(): (
  input: { modId: string; capability?: RuntimeCanonicalCapability; routeSourceHint?: 'token-api' | 'local-runtime' },
) => Promise<ModRuntimeDependencySnapshot> {
  return async (input) => {
    const modId = String(input.modId || '').trim();
    const capability = input.capability;
    const localAiCapability = mapCanonicalCapabilityToLocalAi(capability);
    const routeSourceHint = input.routeSourceHint;

    // When the caller indicates that the effective route for this capability
    // is token-api, skip LOCAL_AI dependency checks entirely — token-api
    // does not require local models, services, or nodes.
    if (routeSourceHint === 'token-api' && capability) {
      return {
        modId,
        status: 'ready',
        routeSource: 'token-api',
        warnings: [],
        dependencies: [],
        repairActions: [],
        updatedAt: new Date().toISOString(),
      };
    }

    if (!modId) {
      return {
        modId: '',
        status: 'missing',
        routeSource: 'token-api',
        reasonCode: ReasonCode.LOCAL_AI_MOD_ID_REQUIRED,
        warnings: ['modId required'],
        dependencies: [],
        repairActions: [{
          actionId: 'runtime:open-setup',
          label: 'Open Runtime Setup',
          reasonCode: ReasonCode.LOCAL_AI_MOD_ID_REQUIRED,
        }],
        updatedAt: new Date().toISOString(),
      };
    }

    const dependencies = readManifestDependencies(modId);
    if (!dependencies) {
      return {
        modId,
        status: 'missing',
        routeSource: 'token-api',
        reasonCode: ReasonCode.LOCAL_AI_DEPENDENCIES_DECLARATION_MISSING,
        warnings: ['manifest ai.dependencies missing'],
        dependencies: [],
        repairActions: [{
          actionId: 'runtime:open-setup',
          label: 'Open Runtime Setup',
          reasonCode: ReasonCode.LOCAL_AI_DEPENDENCIES_DECLARATION_MISSING,
        }],
        updatedAt: new Date().toISOString(),
      };
    }

    const deviceProfile = await localAiRuntime.collectDeviceProfile();
    const plan = await localAiRuntime.resolveDependencies({
      modId,
      capability: localAiCapability,
      dependencies,
      deviceProfile,
    });

    let models: LocalAiModelRecord[] = [];
    let services: LocalAiServiceDescriptor[] = [];
    let nodes: LocalAiNodeDescriptor[] = [];
    const inventoryWarnings: string[] = [];
    try {
      [models, services, nodes] = await Promise.all([
        localAiRuntime.list(),
        localAiRuntime.listServices(),
        localAiRuntime.listNodesCatalog(localAiCapability ? { capability: localAiCapability } : undefined),
      ]);
    } catch (error) {
      inventoryWarnings.push(
        `runtime inventory unavailable: ${error instanceof Error ? error.message : String(error || '')}`,
      );
    }

    const assessments = plan.dependencies.map((dependency) => assessDependencyRuntimeState({
      dependency,
      models,
      services,
      nodes,
    }));
    const runtimeEntries = assessments.map((item) => item.entry);
    const runtimeRepairActions = assessments.flatMap((item) => item.repairActions);

    const hasMissingRequiredInRuntime = assessments.some(
      (item) => item.readiness === 'missing' && item.entry.required,
    );
    const hasDegradedInRuntime = assessments.some((item) => item.readiness === 'degraded');
    const hasAnySelectedRuntimeDependency = assessments.some(
      (item) => item.entry.selected,
    );
    const hasAnyRuntimeReadySelection = assessments.some(
      (item) => item.entry.selected && item.readiness === 'ready',
    );
    const firstRuntimeReasonCode = assessments.find(
      (item) => item.readiness !== 'ready' && String(item.entry.reasonCode || '').trim().length > 0,
    )?.entry.reasonCode;

    const failedRequiredPreflight = plan.preflightDecisions.find(
      (item) => !item.ok && isDependencyRequiredById(plan.dependencies, item.dependencyId),
    );
    const hasFailedPreflight = plan.preflightDecisions.some((item) => !item.ok);
    const warnings = uniqueStrings([...plan.warnings, ...inventoryWarnings, ...runtimeEntries.flatMap((item) => item.warnings)]);
    const hasMissingRequired = hasMissingRequiredInRuntime || Boolean(failedRequiredPreflight);
    const hasDegraded = hasDegradedInRuntime || hasFailedPreflight || warnings.length > 0;
    const status: ModRuntimeDependencySnapshot['status'] = hasMissingRequired ? 'missing' : (hasDegraded ? 'degraded' : 'ready');
    const routeSource: ModRuntimeDependencySnapshot['routeSource'] = !hasAnySelectedRuntimeDependency
      ? 'token-api'
      : status === 'ready'
        ? 'local-runtime'
        : (hasAnyRuntimeReadySelection ? 'mixed' : 'token-api');
    const repairActions = dedupeRepairActions([
      ...runtimeRepairActions,
      ...buildRepairActionsFromPlan(plan),
    ]);
    const reasonCode = firstRuntimeReasonCode
      || failedRequiredPreflight?.reasonCode
      || plan.preflightDecisions.find((item) => !item.ok)?.reasonCode
      || plan.reasonCode;

    return {
      modId,
      planId: plan.planId,
      status,
      routeSource,
      reasonCode,
      warnings,
      dependencies: runtimeEntries.length > 0 ? runtimeEntries : toDependencyEntries(plan.dependencies),
      repairActions,
      updatedAt: new Date().toISOString(),
    };
  };
}

function getRuntimeFieldsFromStore() {
  const runtime = useAppStore.getState().runtimeFields;
  return {
    provider: runtime.provider,
    runtimeModelType: runtime.runtimeModelType,
    localProviderEndpoint: runtime.localProviderEndpoint,
    localProviderModel: runtime.localProviderModel,
    localOpenAiEndpoint: runtime.localOpenAiEndpoint,
    connectorId: runtime.connectorId,
  };
}

function toResolvedBinding(
  capability: RuntimeCanonicalCapability,
  resolved: Awaited<ReturnType<ReturnType<typeof createResolveRuntimeBinding>>>,
): ModRuntimeResolvedBinding {
  return {
    capability,
    source: resolved.source,
    provider: String(resolved.provider || '').trim(),
    model: String(resolved.model || '').trim(),
    modelId: 'modelId' in resolved ? String(resolved.modelId || '').trim() || undefined : undefined,
    connectorId: String(resolved.connectorId || '').trim(),
    endpoint: String(resolved.endpoint || '').trim() || undefined,
    localModelId: 'localModelId' in resolved ? String(resolved.localModelId || '').trim() || undefined : undefined,
    engine: 'engine' in resolved ? String(resolved.engine || '').trim() || undefined : undefined,
    adapter: String(resolved.adapter || '').trim() || undefined,
    localProviderEndpoint: 'localProviderEndpoint' in resolved ? String(resolved.localProviderEndpoint || '').trim() || undefined : undefined,
    localOpenAiEndpoint: String(resolved.localOpenAiEndpoint || '').trim() || undefined,
    goRuntimeLocalModelId: 'goRuntimeLocalModelId' in resolved
      ? String(resolved.goRuntimeLocalModelId || '').trim() || undefined
      : undefined,
    goRuntimeStatus: 'goRuntimeStatus' in resolved
      ? String(resolved.goRuntimeStatus || '').trim() || undefined
      : undefined,
  };
}

function hydrateTokenApiRouteBindingFromOptions(
  binding: RuntimeRouteBinding,
  options: RuntimeRouteOptionsSnapshot,
): RuntimeRouteBinding {
  if (binding.source !== 'token-api') {
    return binding;
  }
  const connectorId = String(binding.connectorId || '').trim();
  const selected = options.selected.source === 'token-api' ? options.selected : null;
  const connector = options.connectors.find((item) => item.id === connectorId) || null;

  if (!connectorId && selected) {
    return {
      ...selected,
      model: String(binding.model || selected.model || '').trim(),
    };
  }
  if (!connector) {
    return binding;
  }
  return {
    ...binding,
    provider: String(binding.provider || connector.provider || '').trim() || undefined,
  };
}

export function hydrateLocalRuntimeRouteBindingFromOptions(
  binding: RuntimeRouteBinding,
  options: RuntimeRouteOptionsSnapshot,
): RuntimeRouteBinding {
  if (binding.source !== 'local-runtime') {
    return binding;
  }
  const selected = options.selected.source === 'local-runtime' ? options.selected : null;
  const targetLocalModelId = String(binding.localModelId || '').trim();
  const targetModelId = String(binding.modelId || binding.model || '').trim().replace(/^(localai|nexa|local)\//i, '');
  const targetEngine = String(binding.engine || binding.provider || '').trim().toLowerCase();
  const localModel = options.localRuntime.models.find((item) => (
    (targetLocalModelId && String(item.localModelId || '').trim() === targetLocalModelId)
    || (
      String(item.modelId || item.model || '').trim() === targetModelId
      && (!targetEngine || String(item.engine || item.provider || '').trim().toLowerCase() === targetEngine)
    )
  )) || null;

  if (!localModel && selected) {
    return {
      ...selected,
      model: String(binding.model || binding.modelId || selected.model || '').trim(),
      modelId: String(binding.modelId || selected.modelId || selected.model || '').trim() || undefined,
      localModelId: String(binding.localModelId || selected.localModelId || '').trim() || undefined,
      engine: String(binding.engine || selected.engine || '').trim() || undefined,
      provider: String(binding.provider || selected.provider || '').trim() || undefined,
    };
  }
  if (!localModel) {
    return binding;
  }
  const bindingGoRuntimeStatus = String(binding.goRuntimeStatus || '').trim().toLowerCase();
  const localModelGoRuntimeStatus = String(localModel.goRuntimeStatus || '').trim().toLowerCase();
  const clearStaleBindingGoRuntime = bindingGoRuntimeStatus === 'removed' && !localModelGoRuntimeStatus;
  const preferLocalModelGoRuntime = Boolean(localModelGoRuntimeStatus)
    && (
      !bindingGoRuntimeStatus
      || bindingGoRuntimeStatus === 'removed'
      || bindingGoRuntimeStatus !== localModelGoRuntimeStatus
    );
  return {
    ...binding,
    model: String(binding.model || binding.modelId || localModel.modelId || localModel.model || '').trim(),
    modelId: String(binding.modelId || localModel.modelId || localModel.model || '').trim() || undefined,
    localModelId: String(binding.localModelId || localModel.localModelId || '').trim() || undefined,
    engine: String(binding.engine || localModel.engine || '').trim() || undefined,
    provider: String(binding.provider || localModel.provider || localModel.engine || '').trim() || undefined,
    adapter: String(binding.adapter || localModel.adapter || '').trim() || undefined,
    providerHints: binding.providerHints || localModel.providerHints,
    endpoint: String(binding.endpoint || localModel.endpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(
      (clearStaleBindingGoRuntime
        ? ''
        : (preferLocalModelGoRuntime ? localModel.goRuntimeLocalModelId : binding.goRuntimeLocalModelId))
      || localModel.goRuntimeLocalModelId
      || (clearStaleBindingGoRuntime ? '' : binding.goRuntimeLocalModelId)
      || '',
    ).trim() || undefined,
    goRuntimeStatus: String(
      (clearStaleBindingGoRuntime
        ? ''
        : (preferLocalModelGoRuntime ? localModel.goRuntimeStatus : binding.goRuntimeStatus))
      || localModel.goRuntimeStatus
      || (clearStaleBindingGoRuntime ? '' : binding.goRuntimeStatus)
      || '',
    ).trim() || undefined,
  };
}

function localModelStatusPriority(status: string): number {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'active') return 0;
  if (normalized === 'unhealthy') return 1;
  if (normalized === 'installed') return 2;
  if (normalized === 'removed') return 3;
  return 4;
}

function normalizeLocalRuntimeModelRoot(value: unknown): string {
  const trimmed = String(value || '').trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('localai/')) return trimmed.slice('localai/'.length).trim();
  if (lower.startsWith('nexa/')) return trimmed.slice('nexa/'.length).trim();
  if (lower.startsWith('local/')) return trimmed.slice('local/'.length).trim();
  return trimmed;
}

function normalizeLocalRuntimeEngine(value: unknown): string {
  return String(value || '').trim().toLowerCase() === 'nexa' ? 'nexa' : 'localai';
}

function pickDesktopLocalRuntimeModel(
  models: LocalAiModelRecord[],
  resolved: ModRuntimeResolvedBinding,
): LocalAiModelRecord | null {
  const targetLocalModelId = String(resolved.localModelId || '').trim();
  const targetModelId = normalizeLocalRuntimeModelRoot(resolved.modelId || resolved.model);
  const targetEngine = normalizeLocalRuntimeEngine(resolved.engine || resolved.provider || '');
  const candidates = models
    .filter((model) => model.status !== 'removed')
    .filter((model) => (
      (targetLocalModelId && String(model.localModelId || '').trim() === targetLocalModelId)
      || (
        normalizeLocalRuntimeModelRoot(model.modelId) === targetModelId
        && normalizeLocalRuntimeEngine(model.engine) === targetEngine
      )
    ))
    .sort((left, right) => {
      const priorityDelta = localModelStatusPriority(left.status) - localModelStatusPriority(right.status);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return String(left.localModelId || '').localeCompare(String(right.localModelId || ''));
    });
  return candidates[0] || null;
}

async function ensureResolvedLocalRuntimeModelAvailable(
  resolved: ModRuntimeResolvedBinding,
): Promise<ModRuntimeResolvedBinding> {
  if (resolved.source !== 'local-runtime') {
    return resolved;
  }
  const desktopModels = await localAiRuntime.list();
  const desktopModel = pickDesktopLocalRuntimeModel(desktopModels, resolved);
  if (!desktopModel) {
    return resolved;
  }

  const goRuntimeStatus = String(resolved.goRuntimeStatus || '').trim().toLowerCase();
  const needsRepair = !String(resolved.goRuntimeLocalModelId || '').trim() || goRuntimeStatus === 'removed';
  if (!needsRepair) {
    return resolved;
  }

  await reconcileModelsToGoRuntime([desktopModel]);
  const goRuntimeModels = await listGoRuntimeModelsSnapshot();
  const repaired = pickPreferredGoRuntimeModel(goRuntimeModels, desktopModel.modelId, desktopModel.engine);

  return {
    ...resolved,
    localModelId: String(resolved.localModelId || desktopModel.localModelId || '').trim() || undefined,
    endpoint: String(resolved.endpoint || desktopModel.endpoint || '').trim() || undefined,
    localProviderEndpoint: String(resolved.localProviderEndpoint || desktopModel.endpoint || resolved.endpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(repaired?.localModelId || '').trim() || undefined,
    goRuntimeStatus: String(repaired?.status || '').trim() || undefined,
  };
}

function toRouteHealthResult(
  result: RuntimeLlmHealthResult,
  provider: string,
  source: 'local-runtime' | 'token-api',
): RuntimeLlmHealthResult & {
  provider: string;
  reasonCode: string;
  actionHint: 'none' | 'install-local-model' | 'switch-to-token-api' | 'verify-connector' | 'retry';
} {
  const status = String(result.status || '').trim().toLowerCase();
  const reasonCode = status === 'healthy'
    ? 'RUNTIME_ROUTE_HEALTHY'
    : status === 'degraded'
      ? 'RUNTIME_ROUTE_DEGRADED'
      : 'RUNTIME_ROUTE_UNAVAILABLE';
  const actionHint = status === 'healthy'
    ? 'none'
    : source === 'local-runtime'
      ? (status === 'degraded' ? 'install-local-model' : 'switch-to-token-api')
      : (status === 'degraded' ? 'retry' : 'verify-connector');
  return {
    ...result,
    healthy: status === 'healthy' || status === 'degraded',
    provider,
    reasonCode,
    actionHint,
  };
}

function requireModel(model: unknown, reasonCode: string): string {
  const normalized = String(model || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: 'runtime model is required',
      reasonCode,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  return normalized;
}

export function buildRuntimeHostCapabilities(input: HostCapabilityInput): WireModSdkHostInput {
  const hookRuntime = input.getRuntimeHookRuntime();
  hookRuntime.setModAiDependencySnapshotResolver(createModAiDependencySnapshotResolver());
  const resolveRuntimeBinding = createResolveRuntimeBinding(() => getRuntimeFieldsFromStore());
  const authorizeRuntimeCapability = (payload: {
    modId: string;
    capabilityKey: string;
    target?: string;
  }) => {
    hookRuntime.authorizeRuntimeCapability({
      modId: payload.modId,
      capabilityKey: payload.capabilityKey,
      target: payload.target,
    });
  };

  const toHealthInput = (payload: RuntimeLlmHealthInput): CheckLlmHealthInput | null => {
    const runtime = getRuntimeFieldsFromStore();
    const provider = String(payload.provider || runtime.provider || '').trim();
    if (!provider) {
      return null;
    }
    return {
      provider,
      localProviderEndpoint: payload.localProviderEndpoint || runtime.localProviderEndpoint,
      localProviderModel: payload.localProviderModel || runtime.localProviderModel,
      localOpenAiEndpoint: payload.localOpenAiEndpoint || runtime.localOpenAiEndpoint,
      connectorId: payload.connectorId || runtime.connectorId,
    };
  };

  const resolveRuntimeRoute = async (payload: {
    modId: string;
    capability: RuntimeCanonicalCapability;
    binding?: RuntimeRouteBinding;
  }): Promise<ModRuntimeResolvedBinding> => {
    let effectiveBinding = payload.binding;
    const hasModel = Boolean(String(effectiveBinding?.model || effectiveBinding?.localModelId || '').trim());
    const localGoRuntimeStatus = String(effectiveBinding?.goRuntimeStatus || '').trim().toLowerCase();
    const needsLocalRuntimeHydration = effectiveBinding?.source === 'local-runtime'
      && (
        !String(effectiveBinding.localModelId || '').trim()
        || !String(effectiveBinding.engine || '').trim()
        || !String(effectiveBinding.adapter || '').trim()
        || localGoRuntimeStatus === 'removed'
      );
    const needsTokenApiHydration = effectiveBinding?.source === 'token-api'
      && (
        !String(effectiveBinding.connectorId || '').trim()
        || !String(effectiveBinding.provider || '').trim()
      );
    let options: RuntimeRouteOptionsSnapshot | null = null;
    if (!effectiveBinding || !hasModel || needsTokenApiHydration || needsLocalRuntimeHydration) {
      options = await loadRuntimeRouteOptions({
        capability: payload.capability,
        modId: payload.modId,
      });
    }
    if (!effectiveBinding || !hasModel) {
      effectiveBinding = options?.selected;
    } else if (options && effectiveBinding.source === 'local-runtime') {
      effectiveBinding = hydrateLocalRuntimeRouteBindingFromOptions(effectiveBinding, options);
    } else if (options && effectiveBinding.source === 'token-api') {
      effectiveBinding = hydrateTokenApiRouteBindingFromOptions(effectiveBinding, options);
    }
    const resolved = await resolveRuntimeBinding({
      modId: payload.modId,
      binding: effectiveBinding,
    });
    return toResolvedBinding(payload.capability, resolved);
  };

  const buildMetadata = async (inputValue: {
    source: 'local-runtime' | 'token-api';
    connectorId?: string;
    endpoint?: string;
  }): Promise<Record<string, string>> => buildRuntimeRequestMetadata({
    source: inputValue.source,
    connectorId: inputValue.connectorId,
    providerEndpoint: inputValue.endpoint,
  });

  const getRuntimeClient = () => getPlatformClient().runtime;

  const toKernelTurnInput = (
    payload: WireModSdkHostInput['runtime']['executeLocalKernelTurn'] extends (input: infer T) => Promise<unknown>
      ? T
      : never,
  ): ExecuteLocalKernelTurnInput | null => {
    const runtime = getRuntimeFieldsFromStore();
    const provider = String(payload.provider || runtime.provider || '').trim();
    if (!provider) {
      return null;
    }
    return {
      requestId: String(payload.requestId || ''),
      sessionId: String(payload.sessionId || ''),
      turnIndex: Number(payload.turnIndex || 0),
      mode: payload.mode || 'SCENE_TURN',
      userInputText: String(payload.userInputText || ''),
      provider,
      worldId: payload.worldId,
      agentId: payload.agentId,
      localProviderEndpoint: payload.localProviderEndpoint || runtime.localProviderEndpoint,
      localProviderModel: payload.localProviderModel || runtime.localProviderModel,
      localOpenAiEndpoint: payload.localOpenAiEndpoint || runtime.localOpenAiEndpoint,
      connectorId: payload.connectorId || runtime.connectorId,
    };
  };

  return {
    runtime: {
      checkLocalLlmHealth: async (payload: RuntimeLlmHealthInput): Promise<RuntimeLlmHealthResult> => {
        const resolvedInput = toHealthInput(payload);
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
        const resolvedInput = toKernelTurnInput(payload);
        if (!resolvedInput) {
          return {
            error: 'RUNTIME_PROVIDER_MISSING',
            detail: 'Runtime provider is missing',
          };
        }
        return input.executeLocalKernelTurn(resolvedInput);
      },
      withOpenApiContextLock: <T>(
        context: { realmBaseUrl: string; accessToken?: string; fetchImpl?: typeof fetch },
        task: () => Promise<T>,
      ) => input.withOpenApiContextLock<T>(context, task),
      getRuntimeHookRuntime: () => hookRuntime,
      getModAiDependencySnapshot: (payload) => hookRuntime.getModAiDependencySnapshot(payload),
      route: {
        listOptions: async ({ capability, modId }) => {
          authorizeRuntimeCapability({
            modId,
            capabilityKey: 'runtime.route.list.options',
          });
          return loadRuntimeRouteOptions({ capability, modId });
        },
        resolve: async ({ capability, modId, binding }) => {
          authorizeRuntimeCapability({
            modId,
            capabilityKey: 'runtime.route.resolve',
          });
          return resolveRuntimeRoute({ capability, modId, binding });
        },
        checkHealth: async ({ capability, modId, binding }) => {
          authorizeRuntimeCapability({
            modId,
            capabilityKey: 'runtime.route.check.health',
          });
          const resolved = await resolveRuntimeRoute({ capability, modId, binding });
          const result = await input.checkLocalLlmHealth({
            provider: resolved.provider,
            localProviderEndpoint: resolved.localProviderEndpoint || resolved.endpoint,
            localProviderModel: resolved.model,
            localOpenAiEndpoint: resolved.localOpenAiEndpoint || resolved.endpoint,
            connectorId: resolved.connectorId,
          });
          return toRouteHealthResult(result, resolved.provider, resolved.source);
        },
      },
      localRuntime: {
        listArtifacts: async ({ modId, ...payload }) => {
          authorizeRuntimeCapability({
            modId,
            capabilityKey: 'runtime.local.artifacts.list',
          });
          return localAiRuntime.listArtifacts(payload);
        },
      },
      ai: {
        text: {
          generate: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.ai.text.generate',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'text.generate',
              binding,
            });
            const model = requireModel(request.model || resolved.model, 'MOD_RUNTIME_TEXT_MODEL_REQUIRED');
            await ensureRuntimeLocalModelWarm({
              modId,
              source: resolved.source,
              modelId: model,
              localModelId: resolved.localModelId || undefined,
              goRuntimeLocalModelId: resolved.goRuntimeLocalModelId || undefined,
              engine: resolved.engine || resolved.provider || undefined,
              endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint || undefined,
              timeoutMs: Number(request.timeoutMs || 0) || undefined,
            });
            return getRuntimeClient().ai.text.generate({
              ...request,
              model,
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
          },
          stream: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.ai.text.stream',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'text.generate',
              binding,
            });
            const model = requireModel(request.model || resolved.model, 'MOD_RUNTIME_TEXT_MODEL_REQUIRED');
            await ensureRuntimeLocalModelWarm({
              modId,
              source: resolved.source,
              modelId: model,
              localModelId: resolved.localModelId || undefined,
              goRuntimeLocalModelId: resolved.goRuntimeLocalModelId || undefined,
              engine: resolved.engine || resolved.provider || undefined,
              endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint || undefined,
              timeoutMs: Number(request.timeoutMs || 0) || undefined,
            });
            return getRuntimeClient().ai.text.stream({
              ...request,
              model,
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
          },
        },
        embedding: {
          generate: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.ai.embedding.generate',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'text.embed',
              binding,
            });
            return getRuntimeClient().ai.embedding.generate({
              ...request,
              model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_EMBEDDING_MODEL_REQUIRED'),
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
          },
        },
      },
      media: {
        image: {
          generate: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.image.generate',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'image.generate',
              binding,
            });
            const preparedResolved = await ensureResolvedLocalRuntimeModelAvailable(resolved);
            const model = requireModel(request.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED');
            return getRuntimeClient().media.image.generate({
              ...request,
              model,
              route: preparedResolved.source,
              fallback: 'deny',
              connectorId: preparedResolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: preparedResolved.source,
                  connectorId: preparedResolved.connectorId || undefined,
                  endpoint: preparedResolved.localProviderEndpoint || preparedResolved.localOpenAiEndpoint || preparedResolved.endpoint,
                })),
              },
            });
          },
          stream: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.image.stream',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'image.generate',
              binding,
            });
            const preparedResolved = await ensureResolvedLocalRuntimeModelAvailable(resolved);
            const model = requireModel(request.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED');
            return getRuntimeClient().media.image.stream({
              ...request,
              model,
              route: preparedResolved.source,
              fallback: 'deny',
              connectorId: preparedResolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: preparedResolved.source,
                  connectorId: preparedResolved.connectorId || undefined,
                  endpoint: preparedResolved.localProviderEndpoint || preparedResolved.localOpenAiEndpoint || preparedResolved.endpoint,
                })),
              },
            });
          },
        },
        video: {
          generate: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.video.generate',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'video.generate',
              binding,
            });
            return getRuntimeClient().media.video.generate({
              ...request,
              model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
          },
          stream: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.video.stream',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'video.generate',
              binding,
            });
            return getRuntimeClient().media.video.stream({
              ...request,
              model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
          },
        },
        tts: {
          synthesize: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.tts.synthesize',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'audio.synthesize',
              binding,
            });
            const response = await getRuntimeClient().media.tts.synthesize({
              ...request,
              model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
            return {
              ...response,
              artifacts: await cacheSpeechArtifactsForDesktopPlayback({
                artifacts: response.artifacts,
                audioFormat: request.audioFormat,
              }),
            };
          },
          stream: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.tts.stream',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'audio.synthesize',
              binding,
            });
            return getRuntimeClient().media.tts.stream({
              ...request,
              model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
          },
          listVoices: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.tts.list.voices',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'audio.synthesize',
              binding,
            });
            return getRuntimeClient().media.tts.listVoices({
              ...request,
              model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
          },
        },
        stt: {
          transcribe: async (payload) => {
            const { modId, binding, ...request } = payload;
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.stt.transcribe',
            });
            const resolved = await resolveRuntimeRoute({
              modId,
              capability: 'audio.transcribe',
              binding,
            });
            return getRuntimeClient().media.stt.transcribe({
              ...request,
              model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_STT_MODEL_REQUIRED'),
              route: resolved.source,
              fallback: 'deny',
              connectorId: resolved.connectorId || undefined,
              metadata: {
                ...(request.metadata || {}),
                ...(await buildMetadata({
                  source: resolved.source,
                  connectorId: resolved.connectorId || undefined,
                  endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                })),
              },
            });
          },
        },
        jobs: {
          submit: async ({ modId, ...payload }) => {
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.jobs.submit',
            });
            const binding = payload.input.binding;
            const capability = payload.modal === 'video'
              ? 'video.generate'
              : payload.modal === 'tts'
                ? 'audio.synthesize'
                : payload.modal === 'stt'
                  ? 'audio.transcribe'
                  : 'image.generate';
            const resolved = await resolveRuntimeRoute({
              modId,
              capability,
              binding,
            });
            const preparedResolved = payload.modal === 'image'
              ? await ensureResolvedLocalRuntimeModelAvailable(resolved)
              : resolved;
            const metadata = {
              ...(payload.input.metadata || {}),
              ...(await buildMetadata({
                source: preparedResolved.source,
                connectorId: preparedResolved.connectorId || undefined,
                endpoint: preparedResolved.localProviderEndpoint || preparedResolved.localOpenAiEndpoint || preparedResolved.endpoint,
              })),
            };
            if (payload.modal === 'image') {
              const model = requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED');
              return getRuntimeClient().media.jobs.submit({
                modal: 'image',
                input: {
                  ...payload.input,
                  model,
                  route: preparedResolved.source,
                  fallback: 'deny',
                  connectorId: preparedResolved.connectorId || undefined,
                  metadata,
                },
              });
            }
            if (payload.modal === 'video') {
              return getRuntimeClient().media.jobs.submit({
                modal: 'video',
                input: {
                  ...payload.input,
                  model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
                  route: preparedResolved.source,
                  fallback: 'deny',
                  connectorId: preparedResolved.connectorId || undefined,
                  metadata,
                },
              });
            }
            if (payload.modal === 'tts') {
              return getRuntimeClient().media.jobs.submit({
                modal: 'tts',
                input: {
                  ...payload.input,
                  model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
                  route: preparedResolved.source,
                  fallback: 'deny',
                  connectorId: preparedResolved.connectorId || undefined,
                  metadata,
                },
              });
            }
            return getRuntimeClient().media.jobs.submit({
              modal: 'stt',
              input: {
                ...payload.input,
                model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_STT_MODEL_REQUIRED'),
                route: preparedResolved.source,
                fallback: 'deny',
                connectorId: preparedResolved.connectorId || undefined,
                metadata,
              },
            });
          },
          get: async ({ modId, jobId }) => {
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.jobs.get',
            });
            return getRuntimeClient().media.jobs.get(jobId);
          },
          cancel: async ({ modId, jobId, reason }) => {
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.jobs.cancel',
            });
            return getRuntimeClient().media.jobs.cancel({ jobId, reason });
          },
          subscribe: async ({ modId, jobId }) => {
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.jobs.subscribe',
            });
            return getRuntimeClient().media.jobs.subscribe(jobId);
          },
          getArtifacts: async ({ modId, jobId }) => {
            authorizeRuntimeCapability({
              modId,
              capabilityKey: 'runtime.media.jobs.get.artifacts',
            });
            return getRuntimeClient().media.jobs.getArtifacts(jobId);
          },
        },
      },
      voice: {
        getAsset: async ({ modId, request }) => {
          authorizeRuntimeCapability({
            modId,
            capabilityKey: 'runtime.voice.get.asset',
          });
          return getRuntimeClient().ai.getVoiceAsset(request);
        },
        listAssets: async ({ modId, request }) => {
          authorizeRuntimeCapability({
            modId,
            capabilityKey: 'runtime.voice.list.assets',
          });
          return getRuntimeClient().ai.listVoiceAssets(request);
        },
        deleteAsset: async ({ modId, request }) => {
          authorizeRuntimeCapability({
            modId,
            capabilityKey: 'runtime.voice.delete.asset',
          });
          return getRuntimeClient().ai.deleteVoiceAsset(request);
        },
        listPresetVoices: async ({ modId, binding, modelId, connectorId, ...request }) => {
          authorizeRuntimeCapability({
            modId,
            capabilityKey: 'runtime.voice.list.preset.voices',
          });
          const resolved = await resolveRuntimeRoute({
            modId,
            capability: 'audio.synthesize',
            binding,
          });
          return getRuntimeClient().ai.listPresetVoices({
            ...request,
            modelId: requireModel(modelId || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
            connectorId: connectorId || resolved.connectorId || '',
          });
        },
      },
    },
    ui: {
      useAppStore: <T>(selector: (state: unknown) => T): T =>
        useAppStore((state) => selector(state)),
      SlotHost: SlotHost as any,
      useUiExtensionContext,
    },
    logging: {
      emitRuntimeLog,
      createRendererFlowId,
      logRendererEvent,
    },
  };
}
