import { useCallback, useMemo, useRef, useState } from 'react';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  localAiRuntime,
  type GoRuntimeSyncTarget,
  type LocalAiArtifactKind,
  syncModelInstallToGoRuntime,
  syncModelStartToGoRuntime,
  reconcileModelsToGoRuntime,
  type LocalAiDependenciesDeclarationDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiCatalogItemDescriptor,
  type LocalAiInstallPayload,
  type LocalAiInstallPlanDescriptor,
} from '@runtime/local-ai-runtime';
import { createOfflineError, getOfflineCoordinator } from '@runtime/offline';
import type { CapabilityV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
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
  installCatalogLocalModel: (
    item: LocalAiCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  installLocalModel: (payload: LocalAiInstallPayload) => Promise<void>;
  installVerifiedLocalModel: (templateId: string) => Promise<void>;
  importLocalModel: () => Promise<void>;
  installVerifiedLocalArtifact: (templateId: string) => Promise<void>;
  importLocalArtifact: () => Promise<void>;
  scaffoldLocalArtifactOrphan: (path: string, kind: LocalAiArtifactKind) => Promise<void>;
  importLocalModelFile: (capabilities: string[], engine?: string) => Promise<void>;
  startLocalModel: (localModelId: string) => Promise<void>;
  stopLocalModel: (localModelId: string) => Promise<void>;
  restartLocalModel: (localModelId: string) => Promise<void>;
  removeLocalModel: (localModelId: string) => Promise<void>;
  removeLocalArtifact: (localArtifactId: string) => Promise<void>;
};

export type UseRuntimeConfigInstallActionsInput = {
  localManifestSummaries: ManifestSummary[];
  refreshLocalSnapshot: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
};

export function useRuntimeConfigInstallActions(input: UseRuntimeConfigInstallActionsInput): RuntimeConfigInstallActions {
  const { localManifestSummaries, refreshLocalSnapshot, setStatusBanner } = input;

  const pendingInstallsRef = useRef(new Map<string, PendingInstallEntry>());
  const [pendingInstallVersion, setPendingInstallVersion] = useState(0);

  const recordGoRuntimeSyncFailure = useCallback(async (
    eventType: string,
    target: GoRuntimeSyncTarget,
    error: unknown,
  ) => {
    await localAiRuntime.appendAudit({
      eventType,
      modelId: String(target.modelId || '').trim(),
      localModelId: String(target.localModelId || '').trim() || undefined,
      source: 'local',
      reasonCode: ReasonCode.GO_RUNTIME_SYNC_FAILED,
      detail: error instanceof Error ? error.message : String(error || 'unknown sync error'),
      payload: {
        action: eventType,
        engine: String(target.engine || '').trim() || undefined,
      },
    }).catch(() => null);
  }, []);

  const assertRuntimeWriteAllowed = useCallback(() => {
    if (getOfflineCoordinator().getTier() !== 'L2') {
      return;
    }
    throw createOfflineError({
      source: 'runtime',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      message: 'Runtime unavailable. Local model writes are disabled in read-only mode.',
      actionHint: 'retry-runtime-when-online',
    });
  }, []);

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
      await refreshLocalSnapshot();
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
    } catch (localError: unknown) {
      setStatusBanner({
        kind: 'error',
        message: `Post-install failed: ${localError instanceof Error ? localError.message : String(localError || '')}`,
      });
      return;
    }

    try {
      const plan = session?.plan;
      const synced = await syncModelInstallToGoRuntime({
        localModelId: resolvedLocalModelId,
        modelId: resolvedModelId,
        capabilities: plan?.capabilities || capabilities,
        engine: plan?.engine || '',
        entry: plan?.entry || '',
        license: plan?.license || '',
        source: {
          repo: plan?.repo || '',
          revision: plan?.revision || '',
        },
        hashes: plan?.hashes || {},
        endpoint: plan?.endpoint || '',
        status: 'active',
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await syncModelStartToGoRuntime({
        modelId: resolvedModelId,
        engine: plan?.engine || '',
        localModelId: synced.localModelId,
      });

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
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Model installed and ready: ${resolvedModelId}`,
      });
    } catch (postError: unknown) {
      await recordGoRuntimeSyncFailure('runtime_model_sync_failed_after_download', {
        modelId: resolvedModelId || installSessionId,
        engine: session?.plan.engine || '',
        localModelId: resolvedLocalModelId || undefined,
      }, postError);
      setStatusBanner({
        kind: 'error',
        message: `Post-install failed: ${postError instanceof Error ? postError.message : String(postError || '')}`,
      });
    }
  }, [recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner]);

  const runInstallPlanLifecycle = useCallback((plan: LocalAiInstallPlanDescriptor, installSource: 'catalog' | 'manual' | 'verified') => {
    assertRuntimeWriteAllowed();
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
  }, [assertRuntimeWriteAllowed, setStatusBanner]);

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
      assertRuntimeWriteAllowed();
      const plan = await resolveRuntimeDependencies(modId, capability);
      const result = await localAiRuntime.applyDependencies(plan, { caller: 'core' });
      await refreshLocalSnapshot();
      try {
        const fullModels = await localAiRuntime.list();
        await reconcileModelsToGoRuntime(fullModels);
      } catch (syncError) {
        await recordGoRuntimeSyncFailure('runtime_model_sync_failed_after_dependency_apply', {
          modelId: modId,
          engine: 'localai',
        }, syncError);
        setStatusBanner({
          kind: 'warning',
          message: `Dependencies applied, but Go runtime sync failed: ${syncError instanceof Error ? syncError.message : String(syncError || '')}`,
        });
        return;
      }
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
  }, [assertRuntimeWriteAllowed, recordGoRuntimeSyncFailure, refreshLocalSnapshot, resolveRuntimeDependencies, setStatusBanner]);

  const installCatalogLocalModel = useCallback(async (
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

  const installLocalModel = useCallback(async (payload: LocalAiInstallPayload) => {
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

  const installVerifiedLocalModel = useCallback(async (templateId: string) => {
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

  const installVerifiedLocalArtifact = useCallback(async (templateId: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      throw new Error('templateId is required');
    }
    try {
      assertRuntimeWriteAllowed();
      const artifact = await localAiRuntime.installVerifiedArtifact({
        templateId: normalizedTemplateId,
      }, { caller: 'core' });
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Artifact installed: ${artifact.artifactId}`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Verified artifact install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  const importLocalArtifact = useCallback(async () => {
    try {
      assertRuntimeWriteAllowed();
      const manifestPath = await localAiRuntime.pickArtifactManifestPath();
      if (!manifestPath) {
        return;
      }
      const imported = await localAiRuntime.importArtifact({ manifestPath }, { caller: 'core' });
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Artifact imported: ${imported.artifactId}`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Artifact import failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  const scaffoldLocalArtifactOrphan = useCallback(async (path: string, kind: LocalAiArtifactKind) => {
    try {
      assertRuntimeWriteAllowed();
      const scaffolded = await localAiRuntime.scaffoldArtifactOrphan({
        path,
        kind,
      }, { caller: 'core' });
      const imported = await localAiRuntime.importArtifact({
        manifestPath: scaffolded.manifestPath,
      }, { caller: 'core' });
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Artifact imported: ${imported.artifactId}`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Artifact orphan import failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  const modelActions = useRuntimeConfigModelManagementActions({
    pendingInstallsRef,
    setPendingInstallVersion,
    refreshLocalSnapshot,
    setStatusBanner,
  });

  return {
    installSessionMeta,
    onDownloadComplete,
    retryInstall,
    resolveRuntimeDependencies,
    applyRuntimeDependencies,
    installCatalogLocalModel,
    installLocalModel,
    installVerifiedLocalModel,
    installVerifiedLocalArtifact,
    importLocalModel: modelActions.importLocalModel,
    importLocalArtifact,
    scaffoldLocalArtifactOrphan,
    importLocalModelFile: modelActions.importLocalModelFile,
    startLocalModel: modelActions.startLocalModel,
    stopLocalModel: modelActions.stopLocalModel,
    restartLocalModel: modelActions.restartLocalModel,
    removeLocalModel: modelActions.removeLocalModel,
    removeLocalArtifact: modelActions.removeLocalArtifact,
  };
}
