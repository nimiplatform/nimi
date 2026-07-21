import { useCallback, useRef, useState } from 'react';
import type {
  NimiRuntimeLocalAssetDeclaration,
  NimiRuntimeLocalAssetRecord,
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalCatalogVariantDescriptor,
  NimiRuntimeLocalTransferProgressEvent,
} from '@nimiplatform/sdk/runtime';
import {
  pickLocalRuntimeAssetDirectory,
  pickLocalRuntimeAssetFile,
  pickLocalRuntimeAssetManifestPath,
} from '../../bridge/runtime-bridge/local-runtime-os-helpers';
import { useTranslation } from 'react-i18next';
import { runtimeConfigLocalModelCenterClient } from './runtime-config-local-model-center-sdk-service';
import {
  basenameFromRuntimePath,
  type LocalModelCenterProps,
} from './runtime-config-model-center-utils';
import { capabilitiesForAssetKind } from './runtime-config-use-local-model-center-helpers.js';
import { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type UseLocalModelCenterImportActionsInput = {
  isProfileTargetMode: boolean;
  onPrepareImportedAssetEnvironment?: (asset: NimiRuntimeLocalAssetRecord) => Promise<void>;
  onRefreshUnregisteredAssets: () => Promise<void>;
  onRefreshAssetSections: () => Promise<void>;
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
  const { t } = useTranslation();
  const [variantPickerItem, setVariantPickerItem] = useState<NimiRuntimeLocalCatalogItemDescriptor | null>(null);
  const [variantList, setVariantList] = useState<NimiRuntimeLocalCatalogVariantDescriptor[]>([]);
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
        void input.onRefreshAssetSections();
        void input.onRefreshUnregisteredAssets();
        void runtimeConfigLocalModelCenterClient.listAssets({ kind: 'image' }).then((assets) => Promise.all(
          assets.map((asset) => input.onPrepareImportedAssetEnvironment?.(asset)),
        ));
      });
      return;
    }
    setAssetImportError(toAssetImportUserMessage(message || 'Import failed'));
    void input.onRefreshUnregisteredAssets();
  }, [input]);

  const handleSettledDownload = useCallback((event: NimiRuntimeLocalTransferProgressEvent) => {
    const orphanPath = Object.entries(assetImportSessionByPathRef.current)
      .find(([, sessionId]) => sessionId === event.installSessionId)?.[0];
    if (orphanPath) {
      handleCompletedAssetImport(orphanPath, event.success, event.message);
    }
    void input.onRefreshVerifiedModels();
  }, [handleCompletedAssetImport, input]);

  const {
    activeDownloads,
    activeImports,
    onPauseDownload,
    onResumeDownload,
    onCancelDownload,
    onDismissSession,
  } = useLocalModelCenterDownloads({
    isProfileTargetMode: input.isProfileTargetMode,
    onDownloadComplete: input.props.onDownloadComplete,
    onProgressSettled: handleSettledDownload,
  });

  const handleImportedAsset = useCallback(async (
    assetPath: string,
    imported: Awaited<ReturnType<typeof runtimeConfigLocalModelCenterClient.importAssetFile>> | {
      scaffolded: true;
      model: Awaited<ReturnType<typeof runtimeConfigLocalModelCenterClient.scaffoldOrphanAsset>>;
    },
  ) => {
    if ('scaffolded' in imported && imported.scaffolded) {
      await input.props.onDiscover();
      await input.onRefreshAssetSections();
      await input.onRefreshUnregisteredAssets();
      return;
    }

    await input.onRefreshAssetSections();
    await input.onRefreshUnregisteredAssets();
    if ('asset' in imported) {
      await input.onPrepareImportedAssetEnvironment?.(imported.asset);
    }
  }, [input]);

  const importManagedModelAssetFromPath = useCallback(async (
    assetPath: string,
    declaration: NimiRuntimeLocalAssetDeclaration,
    endpoint?: string,
  ) => {
    const assetKind = declaration.assetKind;
    if (!assetKind) {
      throw new Error('assetKind is required for asset import');
    }
    const accepted = await runtimeConfigLocalModelCenterClient.scaffoldOrphanAsset({
      path: assetPath,
      kind: assetKind,
      engine: declaration.engine,
      endpoint: String(endpoint || '').trim() || undefined,
    }, { caller: 'core' });
    return { scaffolded: true as const, model: accepted };
  }, []);

  const importAssetFromPath = useCallback(async (
    assetPath: string,
    declaration: NimiRuntimeLocalAssetDeclaration,
    endpoint?: string,
  ) => {
    setImportingAssetPath(assetPath);
    setAssetImportError('');
    try {
      const imported = await importManagedModelAssetFromPath(assetPath, declaration, endpoint);
      await handleImportedAsset(assetPath, imported);
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [handleImportedAsset, importManagedModelAssetFromPath]);

  const importPickedAssetFile = useCallback(async (
    declaration: NimiRuntimeLocalAssetDeclaration,
    endpoint?: string,
  ) => {
    setAssetImportError('');
    const filePath = await pickLocalRuntimeAssetFile();
    if (!filePath) {
      return;
    }
    setImportingAssetPath(filePath);
    try {
      const imported = await runtimeConfigLocalModelCenterClient.importAssetFile({
        filePath,
        declaration,
        endpoint: String(endpoint || '').trim() || undefined,
      }, { caller: 'core' });
      await handleImportedAsset(filePath, imported);
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [handleImportedAsset]);

  const importPickedAssetManifest = useCallback(async (endpoint?: string) => {
    setAssetImportError('');
    const manifestPath = await pickLocalRuntimeAssetManifestPath();
    if (!manifestPath) {
      return;
    }
    const imported = await runtimeConfigLocalModelCenterClient.importAssetManifest(manifestPath, {
      caller: 'core',
      endpoint: String(endpoint || '').trim() || undefined,
    });
    await input.props.onDiscover();
    await input.onRefreshAssetSections();
    await input.onRefreshUnregisteredAssets();
    await input.onPrepareImportedAssetEnvironment?.(imported.asset);
  }, [input]);

  const importPickedAssetDirectory = useCallback(async (
    declaration: NimiRuntimeLocalAssetDeclaration,
    endpoint?: string,
  ) => {
    setAssetImportError('');
    const directoryPath = await pickLocalRuntimeAssetDirectory();
    if (!directoryPath) {
      return;
    }
    setImportingAssetPath(directoryPath);
    try {
      const assetKind = declaration.assetKind;
      if (!assetKind) {
        throw new Error('assetKind is required for bundle import');
      }
      const assetName = basenameFromRuntimePath(directoryPath);
      const imported = await runtimeConfigLocalModelCenterClient.importBundle({
        directoryPath,
        modelName: assetName || undefined,
        capabilities: capabilitiesForAssetKind(assetKind),
        engine: declaration.engine,
        endpoint: String(endpoint || '').trim() || undefined,
      }, { caller: 'core' });
      await input.props.onDiscover();
      await input.onRefreshAssetSections();
      await input.onRefreshUnregisteredAssets();
      return imported;
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [input]);

  const closeVariantPicker = useCallback(() => {
    setVariantPickerItem(null);
    setVariantList([]);
  }, []);

  const toggleVariantPicker = useCallback((item: NimiRuntimeLocalCatalogItemDescriptor) => {
    if (variantPickerItem?.itemId === item.itemId) {
      closeVariantPicker();
      return;
    }
    setVariantPickerItem(item);
    setVariantList([]);
    setVariantError('');
    setLoadingVariants(true);
    void runtimeConfigLocalModelCenterClient.listCatalogVariants(item.repo).then((variants) => {
      setVariantList([...variants]);
      setLoadingVariants(false);
    }).catch((error) => {
      setVariantList([]);
      setVariantError(
        error instanceof Error
          ? error.message
          : String(error || t('runtimeConfig.local.unknownError', {
            defaultValue: 'Unknown error',
          })),
      );
      setLoadingVariants(false);
    });
  }, [closeVariantPicker, t, variantPickerItem?.itemId]);

  const installCatalogVariant = useCallback(async (
    item: NimiRuntimeLocalCatalogItemDescriptor,
    variantFilename: string,
  ) => {
    const selectedVariant = variantList.find((variant) => variant.filename === variantFilename) || null;
    await input.props.onInstallCatalogItem(item, {
      entry: selectedVariant?.entry || variantFilename,
      files: selectedVariant ? [...selectedVariant.files] : [variantFilename],
      capabilities: [String(item.capabilities[0] || 'chat').trim() || 'chat'],
      engine: String(item.engine || '').trim(),
    });
  }, [input, variantList]);

  assetImportSessionByPathRef.current = assetImportSessionByPath;

  return {
    activeDownloads,
    activeImports,
    closeVariantPicker,
    importAssetFromPath,
    importPickedAssetFile,
    importPickedAssetDirectory,
    importPickedAssetManifest,
    assetImportError,
    assetImportSessionByPath,
    importingAssetPath,
    installCatalogVariant,
    loadingVariants,
    onCancelDownload,
    onDismissSession,
    onPauseDownload,
    onResumeDownload,
    toggleVariantPicker,
    variantError,
    variantList,
    variantPickerItem,
  };
}
