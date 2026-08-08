import { useCallback, useState } from 'react';
import type {
  NimiRuntimeLocalAssetDeclaration,
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalCatalogVariantDescriptor,
} from '@nimiplatform/sdk/runtime';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useTranslation } from 'react-i18next';
import { useRuntimeConfigLocalAssetAdminClient } from './runtime-config-local-model-center-sdk-service';
import {
  basenameFromRuntimePath,
  type LocalModelCenterProps,
} from './runtime-config-model-center-utils';
import { capabilitiesForAssetKind } from './runtime-config-use-local-model-center-helpers.js';
import { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type UseLocalModelCenterImportActionsInput = {
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
  const runtimeConfigLocalAssetAdminClient = useRuntimeConfigLocalAssetAdminClient();
  const commands = useDesktopRendererCommands();
  const { t } = useTranslation();
  const [variantPickerItem, setVariantPickerItem] = useState<NimiRuntimeLocalCatalogItemDescriptor | null>(null);
  const [variantList, setVariantList] = useState<NimiRuntimeLocalCatalogVariantDescriptor[]>([]);
  const [variantError, setVariantError] = useState('');
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [importingAssetPath, setImportingAssetPath] = useState<string | null>(null);
  const [assetImportError, setAssetImportError] = useState('');

  const {
    activeDownloads,
    activeImports,
    onPauseDownload,
    onResumeDownload,
    onCancelDownload,
    onDismissSession,
  } = useLocalModelCenterDownloads({
    onDownloadComplete: input.props.onDownloadComplete,
    onProgressSettled: () => { void input.onRefreshVerifiedModels(); },
  });

  const handleImportedAsset = useCallback(async (
    imported: Awaited<ReturnType<typeof runtimeConfigLocalAssetAdminClient.importAssetFile>> | {
      scaffolded: true;
      model: Awaited<ReturnType<typeof runtimeConfigLocalAssetAdminClient.scaffoldOrphanAsset>>;
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
  }, [input]);

  const importManagedModelAssetFromPath = useCallback(async (
    assetPath: string,
    declaration: NimiRuntimeLocalAssetDeclaration,
  ) => {
    const assetKind = declaration.assetKind;
    if (!assetKind) {
      throw new Error('assetKind is required for asset import');
    }
    const accepted = await runtimeConfigLocalAssetAdminClient.scaffoldOrphanAsset({
      path: assetPath,
      kind: assetKind,
      engine: declaration.engine,
    }, { caller: 'core' });
    return { scaffolded: true as const, model: accepted };
  }, []);

  const importAssetFromPath = useCallback(async (
    assetPath: string,
    declaration: NimiRuntimeLocalAssetDeclaration,
  ) => {
    setImportingAssetPath(assetPath);
    setAssetImportError('');
    try {
      const imported = await importManagedModelAssetFromPath(assetPath, declaration);
      await handleImportedAsset(imported);
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [handleImportedAsset, importManagedModelAssetFromPath]);

  const importPickedAssetFile = useCallback(async (
    declaration: NimiRuntimeLocalAssetDeclaration,
  ) => {
    setAssetImportError('');
    const filePath = await commands.pickLocalRuntimeAssetFile();
    if (!filePath) {
      return;
    }
    setImportingAssetPath(filePath);
    try {
      const imported = await runtimeConfigLocalAssetAdminClient.importAssetFile({
        filePath,
        declaration,
      }, { caller: 'core' });
      await handleImportedAsset(imported);
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [handleImportedAsset]);

  const importPickedAssetManifest = useCallback(async () => {
    setAssetImportError('');
    const manifestPath = await commands.pickLocalRuntimeAssetManifestPath();
    if (!manifestPath) {
      return;
    }
    const imported = await runtimeConfigLocalAssetAdminClient.importAssetManifest(manifestPath, {
      caller: 'core',
    });
    await input.props.onDiscover();
    await input.onRefreshAssetSections();
    await input.onRefreshUnregisteredAssets();
  }, [input]);

  const importPickedAssetDirectory = useCallback(async (
    declaration: NimiRuntimeLocalAssetDeclaration,
  ) => {
    setAssetImportError('');
    const directoryPath = await commands.pickLocalRuntimeAssetDirectory();
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
      const imported = await runtimeConfigLocalAssetAdminClient.importBundle({
        directoryPath,
        modelName: assetName || undefined,
        capabilities: capabilitiesForAssetKind(assetKind),
        engine: declaration.engine,
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
    void runtimeConfigLocalAssetAdminClient.listCatalogVariants(item.repo).then((variants) => {
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

  return {
    activeDownloads,
    activeImports,
    closeVariantPicker,
    importAssetFromPath,
    importPickedAssetFile,
    importPickedAssetDirectory,
    importPickedAssetManifest,
    assetImportError,
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
