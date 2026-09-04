import { useCallback, useState } from 'react';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import { basenameFromRuntimePath } from './runtime-config-model-center-utils';
import { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type UseLocalModelCenterImportActionsInput = {
  onRefreshAssets: () => Promise<void>;
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
  const localEnvironmentClient = useRuntimeConfigLocalEnvironmentClient();
  const commands = useDesktopRendererCommands();
  const [importingAssetPath, setImportingAssetPath] = useState<string | null>(null);
  const [assetImportError, setAssetImportError] = useState('');

  const dismissAssetImportError = useCallback(() => {
    setAssetImportError('');
  }, []);

  const {
    activeDownloads,
    activeImports,
    terminalDownloads,
    terminalImports,
    onPauseDownload,
    onResumeDownload,
    onCancelDownload,
    onDismissSession,
  } = useLocalModelCenterDownloads({
    onProgressSettled: () => {
      void input.onRefreshAssets();
    },
  });

  const importAssetFromPath = useCallback(async (assetPath: string) => {
    setImportingAssetPath(assetPath);
    setAssetImportError('');
    try {
      const imported = await localEnvironmentClient.importModelAsset({
        sourcePath: assetPath,
        displayName: basenameFromRuntimePath(assetPath) || undefined,
      }, { caller: 'core' });
      await input.onRefreshAssets();
      return imported;
    } catch (error: unknown) {
      setAssetImportError(toAssetImportUserMessage(error));
      throw error;
    } finally {
      setImportingAssetPath(null);
    }
  }, [input.onRefreshAssets, localEnvironmentClient]);

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

  return {
    activeDownloads,
    activeImports,
    terminalDownloads,
    terminalImports,
    importAssetFromPath,
    importPickedAssetFile,
    importPickedAssetDirectory,
    assetImportError,
    dismissAssetImportError,
    importingAssetPath,
    onCancelDownload,
    onDismissSession,
    onPauseDownload,
    onResumeDownload,
  };
}
