import {
  localAiRuntime,
  type LocalAiDependenciesDeclarationDescriptor,
  type LocalAiDependencyDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiModelRecord,
  type LocalAiNodeDescriptor,
  type LocalAiServiceDescriptor,
} from '@runtime/local-ai-runtime';
import type { SpeechSynthesizeOutput } from '@nimiplatform/sdk/runtime';
import type { ModRuntimeDependencySnapshot } from '@nimiplatform/sdk/mod/runtime';
import type { RuntimeCanonicalCapability } from '@nimiplatform/sdk/mod/runtime-route';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  runtimeModMediaCachePut,
  type RuntimeModMediaCachePutInput,
  type RuntimeModMediaCachePutResult,
} from '@runtime/llm-adapter/tauri-bridge';

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
  input: { modId: string; capability?: RuntimeCanonicalCapability; routeSourceHint?: 'cloud' | 'local' },
) => Promise<ModRuntimeDependencySnapshot> {
  return async (input) => {
    const modId = String(input.modId || '').trim();
    const capability = input.capability;
    const localAiCapability = mapCanonicalCapabilityToLocalAi(capability);
    const routeSourceHint = input.routeSourceHint;

    if (routeSourceHint === 'cloud' && capability) {
      return {
        modId,
        status: 'ready',
        routeSource: 'cloud',
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
        routeSource: 'cloud',
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
        routeSource: 'cloud',
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
      // Keep inventory reads serialized to avoid spiking the runtime bridge with
      // three concurrent IPC calls every time mods refresh dependency status.
      models = await localAiRuntime.list();
      services = await localAiRuntime.listServices();
      nodes = await localAiRuntime.listNodesCatalog(
        localAiCapability ? { capability: localAiCapability } : undefined,
      );
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
    const hasAnySelectedRuntimeDependency = assessments.some((item) => item.entry.selected);
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
      ? 'cloud'
      : status === 'ready'
        ? 'local'
        : (hasAnyRuntimeReadySelection ? 'mixed' : 'cloud');
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
