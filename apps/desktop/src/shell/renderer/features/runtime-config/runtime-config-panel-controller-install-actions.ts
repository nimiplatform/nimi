import { useCallback, useMemo, useRef, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiDependenciesDeclarationDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiCatalogItemDescriptor,
  type LocalAiInstallPayload,
  type LocalAiInstallPlanDescriptor,
} from '@runtime/local-ai-runtime';
import type { CapabilityV11 } from '@renderer/features/runtime-config/state/types';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';
import { asRecord } from './runtime-config-panel-controller-utils';
import {
  useRuntimeConfigModelManagementActions,
  type PendingInstallEntry,
} from './runtime-config-panel-controller-install-actions-models';

type ManifestSummary = {
  id?: string;
  manifest?: Record<string, unknown>;
};

export type RuntimeConfigInstallActions = {
  installSessionMeta: Map<string, { plan: LocalAiInstallPlanDescriptor; installSource: string }>;
  onDownloadComplete: (
    installSessionId: string,
    success: boolean,
    message?: string,
    localModelId?: string,
    modelId?: string,
  ) => Promise<void>;
  retryInstall: (
    plan: LocalAiInstallPlanDescriptor,
    source: 'catalog' | 'manual' | 'verified',
  ) => void;
  resolveRuntimeDependencies: (
    modId: string,
    capability?: CapabilityV11 | string,
  ) => Promise<LocalAiDependencyResolutionPlan>;
  applyRuntimeDependencies: (
    modId: string,
    capability?: CapabilityV11 | string,
  ) => Promise<void>;
  installCatalogLocalRuntimeModel: (
    item: LocalAiCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  installLocalRuntimeModel: (payload: LocalAiInstallPayload) => Promise<void>;
  installVerifiedLocalRuntimeModel: (templateId: string) => Promise<void>;
  importLocalRuntimeModel: () => Promise<void>;
  importLocalRuntimeModelFile: (capabilities: string[], engine?: string) => Promise<void>;
  startLocalRuntimeModel: (localModelId: string) => Promise<void>;
  stopLocalRuntimeModel: (localModelId: string) => Promise<void>;
  restartLocalRuntimeModel: (localModelId: string) => Promise<void>;
  removeLocalRuntimeModel: (localModelId: string) => Promise<void>;
};

export type UseRuntimeConfigInstallActionsInput = {
  localManifestSummaries: ManifestSummary[];
  refreshLocalRuntimeSnapshot: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
};

export function useRuntimeConfigInstallActions(input: UseRuntimeConfigInstallActionsInput): RuntimeConfigInstallActions {
  const { localManifestSummaries, refreshLocalRuntimeSnapshot, setStatusBanner } = input;

  const pendingInstallsRef = useRef(new Map<string, PendingInstallEntry>());
  const [pendingInstallVersion, setPendingInstallVersion] = useState(0);

  const installSessionMeta = useMemo(() => {
    const meta = new Map<string, { plan: LocalAiInstallPlanDescriptor; installSource: string }>();
    for (const [sessionId, entry] of pendingInstallsRef.current) {
      meta.set(sessionId, { plan: entry.plan, installSource: entry.installSource });
    }
    return meta;
  }, [pendingInstallVersion]);

  const onDownloadComplete = useCallback(async (installSessionId: string, success: boolean, message?: string, localModelId?: string, modelId?: string) => {
    const session = pendingInstallsRef.current.get(installSessionId);

    if (!success) {
      setStatusBanner({
        kind: 'error',
        message: `Download failed: ${message || 'unknown error'}`,
      });
      return;
    }

    if (session) {
      pendingInstallsRef.current.delete(installSessionId);
      setPendingInstallVersion((version) => version + 1);
    }

    const resolvedLocalModelId = String(session?.accepted.localModelId || localModelId || '').trim();
    const resolvedModelId = String(session?.accepted.modelId || modelId || '').trim();
    if (!resolvedLocalModelId || !resolvedModelId) {
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: 'Model download completed' });
      return;
    }

    const installSource = session?.installSource || 'resume';
    const capabilities = session?.plan.capabilities || [];
    try {
      await localAiRuntime.start(resolvedLocalModelId, { caller: 'core' });
      const healthRows = await localAiRuntime.health(resolvedLocalModelId);
      const targetHealth = healthRows.find((item) => item.localModelId === resolvedLocalModelId)
        || healthRows[0]
        || null;
      if (targetHealth?.status === 'unhealthy') {
        throw new Error(targetHealth.detail || 'local runtime model unhealthy');
      }
      await localAiRuntime.appendAudit({
        eventType: 'runtime_model_ready_after_install',
        modelId: resolvedModelId,
        localModelId: resolvedLocalModelId,
        payload: {
          source: installSource,
          capabilities,
          localModelId: resolvedLocalModelId,
        },
      });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Model installed and ready: ${resolvedModelId}`,
      });
    } catch (postError: unknown) {
      setStatusBanner({
        kind: 'error',
        message: `Post-install failed: ${postError instanceof Error ? postError.message : String(postError || '')}`,
      });
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const runInstallPlanLifecycle = useCallback((plan: LocalAiInstallPlanDescriptor, installSource: 'catalog' | 'manual' | 'verified') => {
    localAiRuntime.install({
      modelId: plan.modelId,
      repo: plan.repo,
      revision: plan.revision,
      capabilities: plan.capabilities,
      engine: plan.engine,
      entry: plan.entry,
      files: plan.files,
      license: plan.license,
      hashes: plan.hashes,
      endpoint: plan.endpoint,
    }, { caller: 'core' })
      .then((accepted) => {
        pendingInstallsRef.current.set(accepted.installSessionId, {
          accepted,
          plan,
          installSource,
        });
        setPendingInstallVersion((version) => version + 1);
      })
      .catch((error: unknown) => {
        setStatusBanner({
          kind: 'error',
          message: `Install lifecycle failed: ${error instanceof Error ? error.message : String(error || '')}`,
        });
      });
  }, [setStatusBanner]);

  const retryInstall = useCallback((plan: LocalAiInstallPlanDescriptor, source: 'catalog' | 'manual' | 'verified') => {
    runInstallPlanLifecycle(plan, source);
    setStatusBanner({
      kind: 'info',
      message: `Retrying install: ${plan.modelId}. Download progress will appear below.`,
    });
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const findManifestDependenciesByModId = useCallback((modId: string): LocalAiDependenciesDeclarationDescriptor | null => {
    const normalizedModId = String(modId || '').trim();
    if (!normalizedModId) {
      return null;
    }
    const summary = localManifestSummaries.find((item) => String(item.id || '').trim() === normalizedModId) || null;
    if (!summary) {
      return null;
    }
    const manifest = asRecord(summary.manifest);
    const ai = asRecord(manifest.ai);
    const dependencies = ai.dependencies;
    if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      return dependencies as LocalAiDependenciesDeclarationDescriptor;
    }
    return null;
  }, [localManifestSummaries]);

  const resolveRuntimeDependencies = useCallback(async (
    modId: string,
    capability?: CapabilityV11 | string,
  ): Promise<LocalAiDependencyResolutionPlan> => {
    const dependencies = findManifestDependenciesByModId(modId);
    if (!dependencies) {
      throw new Error(`dependencies missing in manifest: ${modId}`);
    }
    const deviceProfile = await localAiRuntime.collectDeviceProfile();
    return localAiRuntime.resolveDependencies({
      modId,
      capability: String(capability || '').trim() || undefined,
      dependencies,
      deviceProfile,
    });
  }, [findManifestDependenciesByModId]);

  const applyRuntimeDependencies = useCallback(async (
    modId: string,
    capability?: CapabilityV11 | string,
  ) => {
    try {
      const plan = await resolveRuntimeDependencies(modId, capability);
      const result = await localAiRuntime.applyDependencies(plan, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Dependencies applied for ${modId}: ${result.installedModels.length} model(s), ${result.services.length} service(s)`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Dependency apply failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, resolveRuntimeDependencies, setStatusBanner]);

  const installCatalogLocalRuntimeModel = useCallback(async (
    item: LocalAiCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => {
    try {
      const plan = await localAiRuntime.resolveInstallPlan({
        itemId: item.itemId,
        source: item.source,
        templateId: item.templateId,
        modelId: item.modelId,
        repo: item.repo,
        revision: item.revision,
        entry: options?.entry,
        files: options?.files,
        capabilities: options?.capabilities,
        engine: options?.engine,
      });
      runInstallPlanLifecycle(plan, 'catalog');
      setStatusBanner({
        kind: 'info',
        message: `Catalog model install started: ${plan.modelId}. Download progress will appear below.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Catalog model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const installLocalRuntimeModel = useCallback(async (payload: LocalAiInstallPayload) => {
    try {
      const resolved = await localAiRuntime.resolveInstallPlan({
        source: 'huggingface',
        modelId: payload.modelId,
        repo: payload.repo,
        revision: payload.revision,
        capabilities: payload.capabilities,
        engine: payload.engine,
        entry: payload.entry,
        files: payload.files,
        license: payload.license,
        hashes: payload.hashes,
        endpoint: payload.endpoint,
      });
      const plan: LocalAiInstallPlanDescriptor = {
        ...resolved,
        modelId: String(payload.modelId || '').trim() || resolved.modelId,
        repo: String(payload.repo || '').trim() || resolved.repo,
        revision: String(payload.revision || '').trim() || resolved.revision,
        capabilities: payload.capabilities && payload.capabilities.length > 0
          ? payload.capabilities
          : resolved.capabilities,
        engine: String(payload.engine || '').trim() || resolved.engine,
        entry: String(payload.entry || '').trim() || resolved.entry,
        files: payload.files && payload.files.length > 0 ? payload.files : resolved.files,
        license: String(payload.license || '').trim() || resolved.license,
        hashes: payload.hashes && Object.keys(payload.hashes).length > 0 ? payload.hashes : resolved.hashes,
        endpoint: String(payload.endpoint || '').trim() || resolved.endpoint,
      };
      runInstallPlanLifecycle(plan, 'manual');
      setStatusBanner({
        kind: 'info',
        message: `Local model install started: ${plan.modelId}. Download progress will appear below.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Local model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const installVerifiedLocalRuntimeModel = useCallback(async (templateId: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      throw new Error('templateId is required');
    }
    try {
      const plan = await localAiRuntime.resolveInstallPlan({
        source: 'verified',
        templateId: normalizedTemplateId,
      });
      runInstallPlanLifecycle(plan, 'verified');
      setStatusBanner({
        kind: 'info',
        message: `Verified model install started: ${plan.modelId}. Download progress will appear below.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Verified model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const modelActions = useRuntimeConfigModelManagementActions({
    pendingInstallsRef,
    setPendingInstallVersion,
    refreshLocalRuntimeSnapshot,
    setStatusBanner,
  });

  return {
    installSessionMeta,
    onDownloadComplete,
    retryInstall,
    resolveRuntimeDependencies,
    applyRuntimeDependencies,
    installCatalogLocalRuntimeModel,
    installLocalRuntimeModel,
    installVerifiedLocalRuntimeModel,
    importLocalRuntimeModel: modelActions.importLocalRuntimeModel,
    importLocalRuntimeModelFile: modelActions.importLocalRuntimeModelFile,
    startLocalRuntimeModel: modelActions.startLocalRuntimeModel,
    stopLocalRuntimeModel: modelActions.stopLocalRuntimeModel,
    restartLocalRuntimeModel: modelActions.restartLocalRuntimeModel,
    removeLocalRuntimeModel: modelActions.removeLocalRuntimeModel,
  };
}
