import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { useTranslation } from 'react-i18next';

import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import { useLocalModelCenterImportActions } from './runtime-config-use-local-model-center-import-actions';

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
  const [modelAssets, setModelAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [loadingInstalledAssets, setLoadingInstalledAssets] = useState(false);
  const [runtimeInventoryErrors, setRuntimeInventoryErrors] = useState<RuntimeInventoryErrors>({});
  const [assetBusy, setAssetBusy] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const installedAssetsRequestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  const setRuntimeInventoryError = useCallback((slot: RuntimeInventoryErrorSlot, message: string) => {
    setRuntimeInventoryErrors((current) => {
      const next = { ...current };
      if (message) next[slot] = message;
      else delete next[slot];
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!showImportMenu) return undefined;
    return bindings.app.events.subscribeDocumentMouseDown((event) => {
      if (importMenuRef.current && !importMenuRef.current.contains(event.target as Node)) {
        setShowImportMenu(false);
      }
    });
  }, [bindings.app.events, showImportMenu]);

  const refreshInstalledAssets = useCallback(async () => {
    const requestId = ++installedAssetsRequestSeqRef.current;
    setLoadingInstalledAssets(true);
    try {
      const rows = await localEnvironmentClient.listModelAssets();
      if (!mountedRef.current || requestId !== installedAssetsRequestSeqRef.current) return;
      setModelAssets([...rows]);
      setRuntimeInventoryError('model-assets', '');
    } catch (error) {
      if (!mountedRef.current || requestId !== installedAssetsRequestSeqRef.current) return;
      setRuntimeInventoryError(
        'model-assets',
        runtimeInventoryErrorMessage(error, 'Runtime ModelAsset inventory failed.'),
      );
    } finally {
      if (mountedRef.current && requestId === installedAssetsRequestSeqRef.current) {
        setLoadingInstalledAssets(false);
      }
    }
  }, [localEnvironmentClient, setRuntimeInventoryError]);

  useEffect(() => {
    void refreshInstalledAssets();
  }, [refreshInstalledAssets]);

  const importActions = useLocalModelCenterImportActions({
    onRefreshAssets: refreshInstalledAssets,
  });

  const inspectInstalledAssetRemoval = useCallback(async (modelAssetId: string) => {
    setAssetBusy(true);
    try {
      const inspection = await localEnvironmentClient.inspectModelAssetRemoval(modelAssetId);
      return [...inspection.referencingLoadoutIds];
    } catch (error) {
      setRuntimeInventoryError(
        'model-asset-action',
        runtimeInventoryErrorMessage(error, 'Runtime ModelAsset reference inspection failed.'),
      );
      throw error;
    } finally {
      setAssetBusy(false);
    }
  }, [localEnvironmentClient, setRuntimeInventoryError]);

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
    activeImports: importActions.activeImports,
    terminalDownloads: importActions.terminalDownloads,
    terminalImports: importActions.terminalImports,
    assetBusy,
    assetImportError: importActions.assetImportError,
    dismissAssetImportError: importActions.dismissAssetImportError,
    importMenuRef,
    loadingInstalledAssets,
    modelAssets,
    onCancelDownload: importActions.onCancelDownload,
    onDismissSession: importActions.onDismissSession,
    onPauseDownload: importActions.onPauseDownload,
    onResumeDownload: importActions.onResumeDownload,
    refreshInstalledAssets,
    removeInstalledAsset,
    inspectInstalledAssetRemoval,
    runtimeInventoryError: runtimeInventoryErrorFromSlots(runtimeInventoryErrors),
    setShowImportMenu,
    showImportMenu,
    importPickedAssetFile: importActions.importPickedAssetFile,
    importPickedAssetDirectory: importActions.importPickedAssetDirectory,
  };
}
