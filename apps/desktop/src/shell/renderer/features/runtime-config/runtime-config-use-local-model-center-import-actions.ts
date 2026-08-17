import { useCallback, useState } from 'react';
import type {
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
import { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type UseLocalModelCenterImportActionsInput = {
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
    onProgressSettled: () => {
      void input.onRefreshVerifiedModels();
      void input.onRefreshAssetSections();
    },
  });

  const importAssetFromPath = useCallback(async (assetPath: string) => {
    setImportingAssetPath(assetPath);
    setAssetImportError('');
    try {
      const imported = await runtimeConfigLocalAssetAdminClient.importModelAsset({
        sourcePath: assetPath,
        displayName: basenameFromRuntimePath(assetPath) || undefined,
      }, { caller: 'core' });
      await input.onRefreshAssetSections();
      return imported;
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [input.onRefreshAssetSections, runtimeConfigLocalAssetAdminClient]);

  const importPickedAssetFile = useCallback(async () => {
    setAssetImportError('');
    const filePath = await commands.pickLocalRuntimeAssetFile();
    if (!filePath) return;
    return importAssetFromPath(filePath);
  }, [commands, importAssetFromPath]);

  const importPickedAssetDirectory = useCallback(async () => {
    setAssetImportError('');
    const directoryPath = await commands.pickLocalRuntimeAssetDirectory();
    if (!directoryPath) return;
    return importAssetFromPath(directoryPath);
  }, [commands, importAssetFromPath]);

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
    const entry = selectedVariant?.entry || variantFilename;
    await input.props.onInstallCatalogItem(item, {
      entry,
      files: selectedVariant ? [...selectedVariant.files] : [variantFilename],
      hashes: selectedVariant?.sha256 ? { [entry]: selectedVariant.sha256 } : undefined,
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
