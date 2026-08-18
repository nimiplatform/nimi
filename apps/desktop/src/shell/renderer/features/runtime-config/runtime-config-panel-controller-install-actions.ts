import { useCallback } from 'react';
import {
  createOfflineNimiError as createOfflineError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import {
  type NimiRuntimeLocalCatalogItemDescriptor,
  type NimiRuntimeLocalInstallPlanDescriptor,
} from '@nimiplatform/sdk/runtime';
import { useTranslation } from 'react-i18next';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export type RuntimeConfigInstallActions = {
  installCatalogLocalModel: (
    item: NimiRuntimeLocalCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      hashes?: Record<string, string>;
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  installResolvedModelPlan: (plan: NimiRuntimeLocalInstallPlanDescriptor) => Promise<void>;
  installCatalogModelAsset: (templateId: string) => Promise<void>;
};

export type UseRuntimeConfigInstallActionsInput = {
  setStatusBanner: SetRuntimeConfigBanner;
};

export function useRuntimeConfigInstallActions(input: UseRuntimeConfigInstallActionsInput): RuntimeConfigInstallActions {
  const localEnvironmentClient = useRuntimeConfigLocalEnvironmentClient();
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const { setStatusBanner } = input;
  const translateRuntimeLocalText = useCallback((
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>,
  ) => String(t(key, { defaultValue, ...(options || {}) })), [t]);

  const assertRuntimeWriteAllowed = useCallback(() => {
    if (bindings.sdk.offline.getTier() !== 'L2') {
      return;
    }
    throw createOfflineError({
      source: 'runtime',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      message: t('runtimeConfig.local.runtimeUnavailableWriteReadOnly', {
        defaultValue: 'Runtime unavailable. Local model writes are disabled in read-only mode.',
      }),
      actionHint: 'retry-runtime-when-online',
    });
  }, [bindings.sdk.offline, t]);

  const runInstallPlanLifecycle = useCallback(async (
    plan: NimiRuntimeLocalInstallPlanDescriptor,
  ) => {
    assertRuntimeWriteAllowed();
    const installLabel = String(plan.entry || plan.modelId || plan.templateId || 'model asset').trim();
    const repo = String(plan.repo || '').trim();
    const revision = String(plan.revision || '').trim();
    const sourceLabel = repo ? ` from ${repo}${revision ? `@${revision}` : ''}` : '';
    const confirmed = bindings.app.commands.confirmRuntimeProfileInstall(
      `Download and install "${installLabel}"${sourceLabel}? No download starts until you confirm.`,
    );
    if (!confirmed) {
      return;
    }
    const asset = await localEnvironmentClient.install(plan.planId, { caller: 'core' });
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.assetInstalled',
        'Asset installed: {{assetId}}',
        { assetId: asset.modelAssetId || plan.modelId },
      ),
    });
  }, [assertRuntimeWriteAllowed, setStatusBanner]);

  const installCatalogLocalModel = useCallback(async (
    item: NimiRuntimeLocalCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      hashes?: Record<string, string>;
      capabilities?: string[];
      engine?: string;
    },
  ) => {
    try {
      const plan = await localEnvironmentClient.resolveInstallPlan({
        itemId: item.itemId,
        source: item.source,
        templateId: item.templateId,
        modelId: item.modelId,
        repo: item.repo,
        revision: item.revision,
        entry: options?.entry,
        files: options?.files,
        hashes: options?.hashes,
        capabilities: options?.capabilities,
        engine: options?.engine,
      });
      await runInstallPlanLifecycle(plan);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Catalog model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const installResolvedModelPlan = useCallback(async (plan: NimiRuntimeLocalInstallPlanDescriptor) => {
    try {
      await runInstallPlanLifecycle(plan);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Catalog model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  const installCatalogModelAsset = useCallback(async (templateId: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      throw new Error('templateId is required');
    }
    try {
      const plan = await localEnvironmentClient.resolveInstallPlan({
        templateId: normalizedTemplateId,
      });
      await runInstallPlanLifecycle(plan);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Catalog ModelAsset install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  return {
    installCatalogLocalModel,
    installResolvedModelPlan,
    installCatalogModelAsset,
  };
}
