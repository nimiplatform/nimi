import { useCallback, useMemo } from 'react';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  findLocalRuntimeProfileById,
  localRuntime,
  normalizeLocalRuntimeProfilesDeclaration,
  type LocalRuntimeAssetKind,
  type LocalRuntimeCatalogItemDescriptor,
  type LocalRuntimeInstallPayload,
  type LocalRuntimeInstallPlanDescriptor,
  type LocalRuntimeProfileApplyResult,
  type LocalRuntimeProfileDescriptor,
  type LocalRuntimeProfileResolutionPlan,
} from '@runtime/local-runtime';
import { createOfflineError, getOfflineCoordinator } from '@runtime/offline';
import { i18n } from '@renderer/i18n';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';
import { asRecord } from './runtime-config-panel-controller-utils';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import {
  useRuntimeConfigModelManagementActions,
} from './runtime-config-panel-controller-install-actions-models';

type ManifestSummary = {
  id?: string;
  manifest?: Record<string, unknown>;
};

function translateRuntimeLocalText(
  key: string,
  defaultValue: string,
  options?: Record<string, unknown>,
): string {
  if (!i18n.isInitialized) {
    return defaultValue;
  }
  return i18n.t(key, {
    defaultValue,
    ...(options || {}),
  });
}

export type RuntimeConfigInstallActions = {
  installSessionMeta: Map<string, { plan: LocalRuntimeInstallPlanDescriptor; installSource: string }>;
  onDownloadComplete: (
    installSessionId: string,
    success: boolean,
    message?: string,
    localModelId?: string,
    modelId?: string,
  ) => Promise<void>;
  retryInstall: (
    plan: LocalRuntimeInstallPlanDescriptor,
    source: 'catalog' | 'manual' | 'verified',
  ) => void;
  resolveRuntimeProfile: (
    modId: string,
    profileId: string,
    capability?: string,
  ) => Promise<LocalRuntimeProfileResolutionPlan>;
  applyRuntimeProfile: (
    modId: string,
    profileId: string,
    capability?: string,
  ) => Promise<LocalRuntimeProfileApplyResult>;
  installCatalogLocalModel: (
    item: LocalRuntimeCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  installLocalModel: (payload: LocalRuntimeInstallPayload) => Promise<void>;
  installVerifiedLocalModel: (templateId: string) => Promise<void>;
  importLocalModel: () => Promise<void>;
  installVerifiedLocalAsset: (templateId: string) => Promise<void>;
  importLocalAsset: () => Promise<void>;
  scaffoldLocalAssetOrphan: (path: string, kind: LocalRuntimeAssetKind) => Promise<void>;
  importLocalModelFile: (capabilities: string[], engine?: string) => Promise<void>;
  startLocalModel: (localModelId: string) => Promise<void>;
  stopLocalModel: (localModelId: string) => Promise<void>;
  restartLocalModel: (localModelId: string) => Promise<void>;
  removeLocalModel: (localModelId: string) => Promise<void>;
  removeLocalAsset: (localAssetId: string) => Promise<void>;
  localModelLifecycleById: Record<string, string>;
  localModelLifecycleErrorById: Record<string, string>;
};

export type UseRuntimeConfigInstallActionsInput = {
  localManifestSummaries: ManifestSummary[];
  refreshLocalSnapshot: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
};

export function useRuntimeConfigInstallActions(input: UseRuntimeConfigInstallActionsInput): RuntimeConfigInstallActions {
  const { localManifestSummaries, refreshLocalSnapshot, setStatusBanner, updateState } = input;

  const assertRuntimeWriteAllowed = useCallback(() => {
    if (getOfflineCoordinator().getTier() !== 'L2') {
      return;
    }
    throw createOfflineError({
      source: 'runtime',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      message: i18n.isInitialized
        ? i18n.t('runtimeConfig.local.runtimeUnavailableWriteReadOnly', {
          defaultValue: 'Runtime unavailable. Local model writes are disabled in read-only mode.',
        })
        : 'Runtime unavailable. Local model writes are disabled in read-only mode.',
      actionHint: 'retry-runtime-when-online',
    });
  }, []);

  const installSessionMeta = useMemo(() => {
    return new Map<string, { plan: LocalRuntimeInstallPlanDescriptor; installSource: string }>();
  }, []);

  const onDownloadComplete = useCallback(async () => {
    await refreshLocalSnapshot();
  }, [refreshLocalSnapshot]);

  const runInstallPlanLifecycle = useCallback(async (
    plan: LocalRuntimeInstallPlanDescriptor,
    installSource: 'catalog' | 'manual' | 'verified',
  ) => {
    assertRuntimeWriteAllowed();
    const installed = installSource === 'verified'
      ? await localRuntime.installVerifiedAsset({
        templateId: String(plan.templateId || '').trim(),
        endpoint: String(plan.endpoint || '').trim(),
      }, { caller: 'core' })
      : await localRuntime.install({
        modelId: plan.modelId,
        kind: (plan.capabilities.includes('image') ? 'image'
          : plan.capabilities.includes('video') ? 'video'
          : plan.capabilities.includes('tts') ? 'tts'
          : plan.capabilities.includes('stt') ? 'stt'
          : 'chat') as import('@runtime/local-runtime').LocalRuntimeAssetKind,
        repo: plan.repo,
        revision: plan.revision,
        capabilities: plan.capabilities,
        engine: plan.engine,
        entry: plan.entry,
        files: plan.files,
        license: plan.license,
        hashes: plan.hashes,
        endpoint: plan.endpoint,
      }, { caller: 'core' });
    await refreshLocalSnapshot();
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.modelInstalledAndReady',
        'Model installed and ready: {{modelId}}',
        { modelId: installed.assetId || plan.modelId },
      ),
    });
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  const retryInstall = useCallback((plan: LocalRuntimeInstallPlanDescriptor, source: 'catalog' | 'manual' | 'verified') => {
    void runInstallPlanLifecycle(plan, source).catch((error: unknown) => {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.installLifecycleFailed',
          'Install lifecycle failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
    });
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const findManifestProfilesByModId = useCallback((modId: string): LocalRuntimeProfileDescriptor[] => {
    const normalizedModId = String(modId || '').trim();
    if (!normalizedModId) {
      return [];
    }
    const summary = localManifestSummaries.find((item) => String(item.id || '').trim() === normalizedModId) || null;
    if (!summary) {
      return [];
    }
    const manifest = asRecord(summary.manifest);
    const ai = asRecord(manifest.ai);
    return normalizeLocalRuntimeProfilesDeclaration(ai.profiles);
  }, [localManifestSummaries]);

  const resolveRuntimeProfile = useCallback(async (
    modId: string,
    profileId: string,
    capability?: string,
  ): Promise<LocalRuntimeProfileResolutionPlan> => {
    const profiles = findManifestProfilesByModId(modId);
    const profile = findLocalRuntimeProfileById(profiles, profileId);
    if (!profile) {
      throw new Error(`profile missing in manifest: ${modId}/${profileId}`);
    }
    return localRuntime.resolveProfile({
      modId,
      profile,
      capability: String(capability || '').trim() || undefined,
    });
  }, [findManifestProfilesByModId]);

  const applyRuntimeProfile = useCallback(async (
    modId: string,
    profileId: string,
    capability?: string,
  ): Promise<LocalRuntimeProfileApplyResult> => {
    try {
      assertRuntimeWriteAllowed();
      const plan = await resolveRuntimeProfile(modId, profileId, capability);
      const confirmMessage = `Install recommended local profile "${plan.title}" for ${modId}?`;
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(confirmMessage)) {
        throw new Error('LOCAL_AI_PROFILE_INSTALL_DECLINED');
      }
      const result = await localRuntime.applyProfile(plan, { caller: 'core' });
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'success',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.profileAppliedSummary',
          'Installed profile {{profileId}} for {{modId}}: {{modelCount}} runnable asset(s), {{serviceCount}} service(s), {{dependencyAssetCount}} dependency asset(s)',
          {
            modId,
            profileId,
            modelCount: result.executionResult.installedAssets.length,
            serviceCount: result.executionResult.services.length,
            dependencyAssetCount: (result.installedAssets ?? []).length,
          },
        ),
      });
      return result;
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.profileApplyFailed',
          'Profile install failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, resolveRuntimeProfile, setStatusBanner]);

  const installCatalogLocalModel = useCallback(async (
    item: LocalRuntimeCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => {
    try {
      const plan = await localRuntime.resolveInstallPlan({
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
      await runInstallPlanLifecycle(plan, 'catalog');
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Catalog model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const installLocalModel = useCallback(async (payload: LocalRuntimeInstallPayload) => {
    try {
      const resolved = await localRuntime.resolveInstallPlan({
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
      const plan: LocalRuntimeInstallPlanDescriptor = {
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
      await runInstallPlanLifecycle(plan, 'manual');
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
      const plan = await localRuntime.resolveInstallPlan({
        source: 'verified',
        templateId: normalizedTemplateId,
      });
      await runInstallPlanLifecycle(plan, 'verified');
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Verified model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const installVerifiedLocalAsset = useCallback(async (templateId: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      throw new Error('templateId is required');
    }
    try {
      assertRuntimeWriteAllowed();
      const asset = await localRuntime.installVerifiedAsset({
        templateId: normalizedTemplateId,
      }, { caller: 'core' });
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Asset installed: ${asset.assetId}`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Verified asset install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  const importLocalAsset = useCallback(async () => {
    try {
      assertRuntimeWriteAllowed();
      const manifestPath = await localRuntime.pickAssetManifestPath();
      if (!manifestPath) {
        return;
      }
      const imported = await localRuntime.importAsset({ manifestPath }, { caller: 'core' });
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'success',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.assetImported',
          'Asset imported: {{assetId}}',
          { assetId: imported.assetId },
        ),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.assetImportFailedWithReason',
          'Asset import failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  const scaffoldLocalAssetOrphan = useCallback(async (path: string, kind: LocalRuntimeAssetKind) => {
    try {
      assertRuntimeWriteAllowed();
      const imported = await localRuntime.scaffoldOrphanAsset({
        path,
        kind,
      }, { caller: 'core' });
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Asset imported: ${imported.assetId}`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Asset orphan import failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  const modelActions = useRuntimeConfigModelManagementActions({
    refreshLocalSnapshot,
    setStatusBanner,
    updateState,
  });

  return {
    installSessionMeta,
    onDownloadComplete,
    retryInstall,
    resolveRuntimeProfile,
    applyRuntimeProfile,
    installCatalogLocalModel,
    installLocalModel,
    installVerifiedLocalModel,
    installVerifiedLocalAsset,
    importLocalModel: modelActions.importLocalModel,
    importLocalAsset,
    scaffoldLocalAssetOrphan,
    importLocalModelFile: modelActions.importLocalModelFile,
    startLocalModel: modelActions.startLocalModel,
    stopLocalModel: modelActions.stopLocalModel,
    restartLocalModel: modelActions.restartLocalModel,
    removeLocalModel: modelActions.removeLocalModel,
    removeLocalAsset: modelActions.removeLocalAsset,
    localModelLifecycleById: modelActions.localModelLifecycleById,
    localModelLifecycleErrorById: modelActions.localModelLifecycleErrorById,
  };
}
