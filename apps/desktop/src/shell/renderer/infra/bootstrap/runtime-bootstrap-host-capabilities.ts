import { emitRuntimeLog } from '@runtime/telemetry/logger';
import {
  localAiRuntime,
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
import type { AiRuntimeDependencySnapshot } from '@nimiplatform/sdk/mod/ai';
import type { RuntimeLlmHealthInput, RuntimeLlmHealthResult } from '@nimiplatform/sdk/mod/types';
import { createResolveRouteBinding } from './runtime-bootstrap-route-resolvers';
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

function toDependencyEntries(
  dependencies: LocalAiDependencyResolutionPlan['dependencies'],
): AiRuntimeDependencySnapshot['dependencies'] {
  return dependencies.map((item: LocalAiDependencyDescriptor) => ({
    dependencyId: item.dependencyId,
    kind: item.kind,
    capability: item.capability,
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

type DependencyReadiness = 'ready' | 'degraded' | 'missing';

type DependencyRuntimeAssessment = {
  entry: AiRuntimeDependencySnapshot['dependencies'][number];
  readiness: DependencyReadiness;
  repairActions: AiRuntimeDependencySnapshot['repairActions'];
};

function buildDependencyRepairAction(input: {
  actionId: string;
  dependency: LocalAiDependencyDescriptor;
  reasonCode: string;
  label: string;
}): AiRuntimeDependencySnapshot['repairActions'][number] {
  return {
    actionId: input.actionId,
    label: input.label,
    reasonCode: input.reasonCode,
    dependencyId: input.dependency.dependencyId,
    capability: input.dependency.capability,
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
): AiRuntimeDependencySnapshot['repairActions'][number] {
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
  const repairActions: AiRuntimeDependencySnapshot['repairActions'] = [];
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
      entry: {
        ...dependency,
        reasonCode,
        warnings: uniqueStrings(warnings),
      },
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
    entry: {
      ...dependency,
      reasonCode,
      warnings: uniqueStrings(warnings),
    },
    readiness,
    repairActions,
  };
}

function dedupeRepairActions(
  actions: AiRuntimeDependencySnapshot['repairActions'],
): AiRuntimeDependencySnapshot['repairActions'] {
  const dedupe = new Map<string, AiRuntimeDependencySnapshot['repairActions'][number]>();
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
): AiRuntimeDependencySnapshot['repairActions'] {
  const actions: AiRuntimeDependencySnapshot['repairActions'] = [];
  for (const dep of plan.dependencies) {
    if (!dep.required || dep.selected) continue;
    actions.push({
      actionId: `install:${dep.dependencyId}`,
      label: dependencyRepairLabel(dep),
      reasonCode: dep.reasonCode || 'LOCAL_AI_DEPENDENCY_NOT_SELECTED',
      dependencyId: dep.dependencyId,
      capability: dep.capability,
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
  input: { modId: string; capability?: string; routeSourceHint?: 'token-api' | 'local-runtime' },
) => Promise<AiRuntimeDependencySnapshot> {
  return async (input) => {
    const modId = String(input.modId || '').trim();
    const capability = String(input.capability || '').trim() || undefined;
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
      capability,
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
        localAiRuntime.listNodesCatalog(capability ? { capability } : undefined),
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
    const status: AiRuntimeDependencySnapshot['status'] = hasMissingRequired ? 'missing' : (hasDegraded ? 'degraded' : 'ready');
    const routeSource: AiRuntimeDependencySnapshot['routeSource'] = !hasAnySelectedRuntimeDependency
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
    credentialRefId: runtime.credentialRefId,
  };
}

export function buildRuntimeHostCapabilities(input: HostCapabilityInput): WireModSdkHostInput {
  const hookRuntime = input.getRuntimeHookRuntime();
  hookRuntime.setModAiDependencySnapshotResolver(createModAiDependencySnapshotResolver());

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
      credentialRefId: payload.credentialRefId || runtime.credentialRefId,
    };
  };

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
      credentialRefId: payload.credentialRefId || runtime.credentialRefId,
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
      resolveRouteBinding: createResolveRouteBinding(() => getRuntimeFieldsFromStore()),
      getModAiDependencySnapshot: (payload) => hookRuntime.getModAiDependencySnapshot(payload),
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
