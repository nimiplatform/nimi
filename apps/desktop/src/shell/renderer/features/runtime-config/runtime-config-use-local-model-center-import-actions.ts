import { useCallback, useRef, useState } from 'react';
import {
  localRuntime,
  type GgufVariantDescriptor,
  type LocalRuntimeAssetDeclaration,
  type LocalRuntimeCatalogItemDescriptor,
  type LocalRuntimeDownloadProgressEvent,
} from '@runtime/local-runtime';
import { i18n } from '@renderer/i18n';
import type { InstallEngineOption, LocalModelCenterProps } from './runtime-config-model-center-utils';
import { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type UseLocalModelCenterImportActionsInput = {
  getInstallEngine: (item: LocalRuntimeCatalogItemDescriptor) => InstallEngineOption;
  isModMode: boolean;
  onRefreshUnregisteredAssets: () => Promise<void>;
  onRefreshArtifactSections: () => Promise<void>;
  onRefreshVerifiedModels: () => Promise<void>;
  props: LocalModelCenterProps;
};

export function toAssetImportUserMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'Asset import failed');
  const normalized = String(raw || '').trim();
  if (!normalized) {
    return 'Asset import failed';
  }
  const prefixed = normalized.match(/^[A-Z0-9_]+:\s*(.+)$/s);
  return String(prefixed?.[1] || normalized).trim() || 'Asset import failed';
}

export function useLocalModelCenterImportActions(input: UseLocalModelCenterImportActionsInput) {
  const [variantPickerItem, setVariantPickerItem] = useState<LocalRuntimeCatalogItemDescriptor | null>(null);
  const [variantList, setVariantList] = useState<GgufVariantDescriptor[]>([]);
  const [variantError, setVariantError] = useState('');
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [assetImportSessionByPath, setAssetImportSessionByPath] = useState<Record<string, string>>({});
  const assetImportSessionByPathRef = useRef<Record<string, string>>({});
  const [importingAssetPath, setImportingAssetPath] = useState<string | null>(null);
  const [assetImportError, setAssetImportError] = useState('');

  const handleCompletedAssetImport = useCallback((assetPath: string, success: boolean, message?: string) => {
    setAssetImportSessionByPath((prev) => {
      if (!(assetPath in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[assetPath];
      return next;
    });
    if (success) {
      void input.props.onDiscover().finally(() => {
        void input.onRefreshArtifactSections();
        void input.onRefreshUnregisteredAssets();
      });
      return;
    }
    setAssetImportError(toAssetImportUserMessage(message || 'Import failed'));
    void input.onRefreshUnregisteredAssets();
  }, [input]);

  const handleSettledDownload = useCallback((event: LocalRuntimeDownloadProgressEvent) => {
    const orphanPath = Object.entries(assetImportSessionByPathRef.current)
      .find(([, sessionId]) => sessionId === event.installSessionId)?.[0];
    if (orphanPath) {
      handleCompletedAssetImport(orphanPath, event.success, event.message);
    }
    void input.onRefreshVerifiedModels();
  }, [handleCompletedAssetImport, input]);

  const {
    activeDownloads,
    getLatestProgressEvent,
    onPauseDownload,
    onResumeDownload,
    onCancelDownload,
  } = useLocalModelCenterDownloads({
    isModMode: input.isModMode,
    onDownloadComplete: input.props.onDownloadComplete,
    onProgressSettled: handleSettledDownload,
  });

  const handleImportedAsset = useCallback(async (
    assetPath: string,
    imported: Awaited<ReturnType<typeof localRuntime.importAssetFile>> | {
      assetClass: 'model';
      accepted: Awaited<ReturnType<typeof localRuntime.scaffoldOrphan>>;
    },
  ) => {
    if (imported.assetClass === 'model') {
      setAssetImportSessionByPath((prev) => ({
        ...prev,
        [assetPath]: imported.accepted.installSessionId,
      }));
      const currentProgress = getLatestProgressEvent(imported.accepted.installSessionId);
      if (currentProgress?.done) {
        handleCompletedAssetImport(assetPath, currentProgress.success, currentProgress.message);
      }
      return;
    }

    await input.onRefreshArtifactSections();
    await input.onRefreshUnregisteredAssets();
  }, [getLatestProgressEvent, handleCompletedAssetImport, input]);

  const importManagedModelAssetFromPath = useCallback(async (
    assetPath: string,
    declaration: LocalRuntimeAssetDeclaration,
  ) => {
    const modelType = declaration.modelType;
    if (!modelType) {
      throw new Error('modelType is required for main model import');
    }
    const capabilities = modelType === 'embedding'
      ? ['embedding']
      : modelType === 'image'
        ? ['image']
        : modelType === 'video'
          ? ['video']
          : modelType === 'tts'
            ? ['tts']
            : modelType === 'stt'
              ? ['stt']
              : modelType === 'music'
                ? ['music']
                : ['chat'];
    const accepted = await localRuntime.scaffoldOrphan({
      path: assetPath,
      capabilities,
      engine: declaration.engine,
    });
    return { assetClass: 'model' as const, accepted };
  }, []);

  const importAssetFromPath = useCallback(async (assetPath: string, declaration: LocalRuntimeAssetDeclaration) => {
    setImportingAssetPath(assetPath);
    setAssetImportError('');
    try {
      const imported = declaration.assetClass === 'model'
        ? await importManagedModelAssetFromPath(assetPath, declaration)
        : await localRuntime.importAssetFile({
          filePath: assetPath,
          declaration,
        }, { caller: 'core' });
      await handleImportedAsset(assetPath, imported);
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [handleImportedAsset, importManagedModelAssetFromPath]);

  const importPickedAssetFile = useCallback(async (declaration: LocalRuntimeAssetDeclaration) => {
    setAssetImportError('');
    const filePath = await localRuntime.pickModelFile();
    if (!filePath) {
      return;
    }
    setImportingAssetPath(filePath);
    try {
      const imported = await localRuntime.importAssetFile({
        filePath,
        declaration,
      }, { caller: 'core' });
      await handleImportedAsset(filePath, imported);
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [handleImportedAsset]);

  const importPickedAssetManifest = useCallback(async () => {
    setAssetImportError('');
    const manifestPath = await localRuntime.pickAssetManifestPath();
    if (!manifestPath) {
      return;
    }
    const imported = await localRuntime.importAssetManifest(manifestPath, { caller: 'core' });
    await input.props.onDiscover();
    if (imported.assetClass === 'artifact') {
      await input.onRefreshArtifactSections();
    }
    await input.onRefreshUnregisteredAssets();
  }, [input]);

  const closeVariantPicker = useCallback(() => {
    setVariantPickerItem(null);
    setVariantList([]);
  }, []);

  const toggleVariantPicker = useCallback((item: LocalRuntimeCatalogItemDescriptor) => {
    if (variantPickerItem?.itemId === item.itemId) {
      closeVariantPicker();
      return;
    }
    setVariantPickerItem(item);
    setVariantList([]);
    setVariantError('');
    setLoadingVariants(true);
    void localRuntime.listRepoVariants(item.repo).then((variants) => {
      setVariantList(variants);
      setLoadingVariants(false);
    }).catch((error) => {
      setVariantList([]);
      setVariantError(
        error instanceof Error
          ? error.message
          : String(error || i18n.t('runtimeConfig.local.unknownError', {
            defaultValue: 'Unknown error',
          })),
      );
      setLoadingVariants(false);
    });
  }, [closeVariantPicker, variantPickerItem?.itemId]);

  const installCatalogVariant = useCallback(async (
    item: LocalRuntimeCatalogItemDescriptor,
    variantFilename: string,
  ) => {
    const selectedVariant = variantList.find((variant) => variant.filename === variantFilename) || null;
    await input.props.onInstallCatalogItem(item, {
      entry: selectedVariant?.entry || variantFilename,
      files: selectedVariant?.files || [variantFilename],
      capabilities: [String(item.capabilities[0] || 'chat').trim() || 'chat'],
      engine: input.getInstallEngine(item),
    });
  }, [input, variantList]);

  assetImportSessionByPathRef.current = assetImportSessionByPath;

  return {
    activeDownloads,
    closeVariantPicker,
    importAssetFromPath,
    importPickedAssetFile,
    importPickedAssetManifest,
    assetImportError,
    assetImportSessionByPath,
    importingAssetPath,
    installCatalogVariant,
    loadingVariants,
    onCancelDownload,
    onPauseDownload,
    onResumeDownload,
    toggleVariantPicker,
    variantError,
    variantList,
    variantPickerItem,
  };
}
