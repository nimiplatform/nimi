import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRuntimeInstalledAssets } from './use-runtime-model-library.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import { useLocalModelCenterImportActions } from './runtime-config-use-local-model-center-import-actions';
import {
  describeModelAssetRemovalImpact,
  type LocalModelAssetRemovalImpact,
} from './runtime-config-local-model-center-remove-dialog';

type RuntimeInventoryErrorSlot = 'model-assets' | 'model-asset-action';
type RuntimeInventoryErrors = Partial<Record<RuntimeInventoryErrorSlot, string>>;

export function runtimeInventoryErrorFromSlots(errors: RuntimeInventoryErrors): string {
  return errors['model-asset-action'] || errors['model-assets'] || '';
}

function runtimeInventoryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}

export function useLocalModelCenterRuntimeState() {
  const localEnvironmentClient = useRuntimeConfigLocalEnvironmentClient();
  const bindings = useDesktopRendererBindings();
  const { t } = useTranslation();
  const installedAssets = useRuntimeInstalledAssets();
  const refreshInstalledAssets = installedAssets.refreshAfterMutation;
  const [runtimeInventoryErrors, setRuntimeInventoryErrors] = useState<RuntimeInventoryErrors>({});
  const [assetBusy, setAssetBusy] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);

  const setRuntimeInventoryError = useCallback((slot: RuntimeInventoryErrorSlot, message: string) => {
    setRuntimeInventoryErrors((current) => {
      const next = { ...current };
      if (message) next[slot] = message;
      else delete next[slot];
      return next;
    });
  }, []);

  const importActions = useLocalModelCenterImportActions({
    onRefreshAssets: refreshInstalledAssets,
  });

  const inspectInstalledAssetRemoval = useCallback(async (modelAssetId: string): Promise<LocalModelAssetRemovalImpact> => {
    setAssetBusy(true);
    try {
      // The Loadout aggregate only decorates the dialog with names; when it is
      // unreadable the referencing ids are still counted so removal stays possible.
      const [inspection, aggregate] = await Promise.all([
        localEnvironmentClient.inspectModelAssetRemoval(modelAssetId),
        bindings.sdk.machineProduct().local.loadouts.get().catch(() => null),
      ]);
      return describeModelAssetRemovalImpact(inspection.referencingLoadoutIds, aggregate);
    } catch (error) {
      setRuntimeInventoryError(
        'model-asset-action',
        runtimeInventoryErrorMessage(error, 'Runtime ModelAsset reference inspection failed.'),
      );
      throw error;
    } finally {
      setAssetBusy(false);
    }
  }, [bindings.sdk, localEnvironmentClient, setRuntimeInventoryError]);

  const removeInstalledAsset = useCallback(async (modelAssetId: string) => {
    setAssetBusy(true);
    try {
      const removal = await localEnvironmentClient.removeModelAsset(modelAssetId, { caller: 'core' });
      setRuntimeInventoryError('model-asset-action', removal.cleanupPending
        ? t('runtimeConfig.localModelCenter.cleanupPending', {
          defaultValue: 'The model was removed; some files are pending cleanup and will retry automatically.',
        })
        : '');
      await refreshInstalledAssets();
    } catch (error) {
      setRuntimeInventoryError(
        'model-asset-action',
        runtimeInventoryErrorMessage(error, 'Runtime ModelAsset removal failed.'),
      );
      throw error;
    } finally {
      setAssetBusy(false);
    }
  }, [localEnvironmentClient, refreshInstalledAssets, setRuntimeInventoryError, t]);

  return {
    activeDownloads: importActions.activeDownloads,
    observedAtBySessionId: importActions.observedAtBySessionId,
    activeImports: importActions.activeImports,
    terminalDownloads: importActions.terminalDownloads,
    terminalImports: importActions.terminalImports,
    assetBusy,
    assetImportError: importActions.assetImportError,
    dismissAssetImportError: importActions.dismissAssetImportError,
    importMenuRef,
    loadingInstalledAssets: installedAssets.isFetching,
    modelAssets: installedAssets.data ?? [],
    onCancelDownload: importActions.onCancelDownload,
    onDismissSession: importActions.onDismissSession,
    onPauseDownload: importActions.onPauseDownload,
    onResumeDownload: importActions.onResumeDownload,
    refreshInstalledAssets,
    removeInstalledAsset,
    inspectInstalledAssetRemoval,
    runtimeInventoryError: runtimeInventoryErrorFromSlots({
      ...runtimeInventoryErrors,
      ...(installedAssets.error ? { 'model-assets': runtimeInventoryErrorMessage(installedAssets.error, 'Runtime ModelAsset inventory failed.') } : {}),
    }),
    setShowImportMenu,
    showImportMenu,
    importPickedAssetFile: importActions.importPickedAssetFile,
    importPickedAssetDirectory: importActions.importPickedAssetDirectory,
  };
}
