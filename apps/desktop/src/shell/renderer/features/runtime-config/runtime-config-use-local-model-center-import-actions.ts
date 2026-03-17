import { useCallback, useRef, useState } from 'react';
import {
  localRuntime,
  type GgufVariantDescriptor,
  type LocalRuntimeArtifactKind,
  type LocalRuntimeCatalogItemDescriptor,
  type LocalRuntimeDownloadProgressEvent,
} from '@runtime/local-runtime';
import { i18n } from '@renderer/i18n';
import type { CapabilityOption, InstallEngineOption, LocalModelCenterProps } from './runtime-config-model-center-utils';
import { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type UseLocalModelCenterImportActionsInput = {
  artifactOrphanKinds: Record<string, LocalRuntimeArtifactKind>;
  getInstallEngine: (item: LocalRuntimeCatalogItemDescriptor) => InstallEngineOption;
  getLatestVerifiedCapability: (item: LocalRuntimeCatalogItemDescriptor) => CapabilityOption;
  isModMode: boolean;
  onRefreshAllOrphanFiles: () => Promise<void>;
  onRefreshArtifactSections: () => Promise<void>;
  onRefreshVerifiedModels: () => Promise<void>;
  orphanCapabilities: Record<string, CapabilityOption>;
  props: LocalModelCenterProps;
};

export function useLocalModelCenterImportActions(input: UseLocalModelCenterImportActionsInput) {
  const [variantPickerItem, setVariantPickerItem] = useState<LocalRuntimeCatalogItemDescriptor | null>(null);
  const [variantList, setVariantList] = useState<GgufVariantDescriptor[]>([]);
  const [variantError, setVariantError] = useState('');
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [orphanImportSessionByPath, setOrphanImportSessionByPath] = useState<Record<string, string>>({});
  const orphanImportSessionByPathRef = useRef<Record<string, string>>({});
  const [scaffoldingOrphan, setScaffoldingOrphan] = useState<string | null>(null);
  const [orphanError, setOrphanError] = useState('');
  const [scaffoldingArtifactOrphan, setScaffoldingArtifactOrphan] = useState<string | null>(null);
  const [artifactOrphanError, setArtifactOrphanError] = useState('');

  const handleCompletedOrphanImport = useCallback((orphanPath: string, success: boolean, message?: string) => {
    setOrphanImportSessionByPath((prev) => {
      if (!(orphanPath in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[orphanPath];
      return next;
    });
    if (success) {
      void input.props.onDiscover().finally(() => {
        void input.onRefreshAllOrphanFiles();
      });
      return;
    }
    setOrphanError(message || 'Import failed');
    void input.onRefreshAllOrphanFiles();
  }, [input]);

  const handleSettledDownload = useCallback((event: LocalRuntimeDownloadProgressEvent) => {
    const orphanPath = Object.entries(orphanImportSessionByPathRef.current)
      .find(([, sessionId]) => sessionId === event.installSessionId)?.[0];
    if (orphanPath) {
      handleCompletedOrphanImport(orphanPath, event.success, event.message);
    }
    void input.onRefreshVerifiedModels();
  }, [handleCompletedOrphanImport, input]);

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

  const scaffoldOrphanImport = useCallback((orphanPath: string) => {
    setScaffoldingOrphan(orphanPath);
    setOrphanError('');
    void localRuntime.scaffoldOrphan({
      path: orphanPath,
      capabilities: [input.orphanCapabilities[orphanPath] || 'chat'],
    }).then((accepted) => {
      setOrphanImportSessionByPath((prev) => ({
        ...prev,
        [orphanPath]: accepted.installSessionId,
      }));
      setScaffoldingOrphan(null);
      const currentProgress = getLatestProgressEvent(accepted.installSessionId);
      if (currentProgress?.done) {
        handleCompletedOrphanImport(orphanPath, currentProgress.success, currentProgress.message);
      }
    }).catch((error: unknown) => {
      setScaffoldingOrphan(null);
      setOrphanError(error instanceof Error ? error.message : String(error));
    });
  }, [getLatestProgressEvent, handleCompletedOrphanImport, input.orphanCapabilities]);

  const scaffoldArtifactOrphanImport = useCallback(async (orphanPath: string) => {
    const kind = input.artifactOrphanKinds[orphanPath] || 'vae';
    setScaffoldingArtifactOrphan(orphanPath);
    setArtifactOrphanError('');
    try {
      await input.props.onScaffoldArtifactOrphan(orphanPath, kind);
      await input.onRefreshArtifactSections();
      await input.onRefreshAllOrphanFiles();
    } catch (error: unknown) {
      setArtifactOrphanError(
        error instanceof Error
          ? error.message
          : String(error || i18n.t('runtimeConfig.local.artifactImportFailed', {
            defaultValue: 'Artifact import failed',
          })),
      );
      throw error;
    } finally {
      setScaffoldingArtifactOrphan(null);
    }
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
      capabilities: [input.getLatestVerifiedCapability(item)],
      engine: input.getInstallEngine(item),
    });
  }, [input, variantList]);

  orphanImportSessionByPathRef.current = orphanImportSessionByPath;

  return {
    activeDownloads,
    artifactOrphanError,
    closeVariantPicker,
    installCatalogVariant,
    loadingVariants,
    onCancelDownload,
    onPauseDownload,
    onResumeDownload,
    orphanError,
    orphanImportSessionByPath,
    scaffoldArtifactOrphanImport,
    scaffoldOrphanImport,
    scaffoldingArtifactOrphan,
    scaffoldingOrphan,
    toggleVariantPicker,
    variantError,
    variantList,
    variantPickerItem,
  };
}
