import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  localAiRuntime,
  type LocalAiInstallAcceptedResponse,
  type LocalAiInstallPlanDescriptor,
} from '@runtime/local-ai-runtime';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';

export type PendingInstallEntry = {
  accepted: LocalAiInstallAcceptedResponse;
  plan: LocalAiInstallPlanDescriptor;
  installSource: 'catalog' | 'manual' | 'verified';
};

export type RuntimeConfigModelManagementActions = {
  importLocalRuntimeModel: () => Promise<void>;
  importLocalRuntimeModelFile: (capabilities: string[], engine?: string) => Promise<void>;
  startLocalRuntimeModel: (localModelId: string) => Promise<void>;
  stopLocalRuntimeModel: (localModelId: string) => Promise<void>;
  restartLocalRuntimeModel: (localModelId: string) => Promise<void>;
  removeLocalRuntimeModel: (localModelId: string) => Promise<void>;
};

export type UseRuntimeConfigModelManagementActionsInput = {
  pendingInstallsRef: MutableRefObject<Map<string, PendingInstallEntry>>;
  setPendingInstallVersion: Dispatch<SetStateAction<number>>;
  refreshLocalRuntimeSnapshot: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
};

export function useRuntimeConfigModelManagementActions(
  input: UseRuntimeConfigModelManagementActionsInput,
): RuntimeConfigModelManagementActions {
  const {
    pendingInstallsRef,
    setPendingInstallVersion,
    refreshLocalRuntimeSnapshot,
    setStatusBanner,
  } = input;

  const importLocalRuntimeModel = useCallback(async () => {
    try {
      const manifestPath = await localAiRuntime.pickManifestPath();
      if (!manifestPath) {
        return;
      }
      await localAiRuntime.import({ manifestPath }, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({
        kind: 'success',
        message: `Local model imported: ${manifestPath}`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Local model import failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const importLocalRuntimeModelFile = useCallback(async (capabilities: string[], engine?: string) => {
    try {
      const filePath = await localAiRuntime.pickModelFile();
      if (!filePath) {
        return;
      }
      const accepted = await localAiRuntime.importFile({
        filePath,
        capabilities,
        engine: engine || undefined,
      }, { caller: 'core' });

      pendingInstallsRef.current.set(accepted.installSessionId, {
        accepted,
        plan: {
          planId: accepted.installSessionId,
          itemId: accepted.modelId,
          source: 'huggingface',
          modelId: accepted.modelId,
          repo: '',
          revision: '',
          capabilities,
          engine: engine || '',
          engineRuntimeMode: 'supervised',
          installKind: 'file-import',
          installAvailable: true,
          entry: '',
          files: [],
          license: '',
          hashes: {},
          endpoint: '',
          warnings: [],
        } as LocalAiInstallPlanDescriptor,
        installSource: 'manual',
      });
      setPendingInstallVersion((version) => version + 1);

      setStatusBanner({
        kind: 'info',
        message: `File import started: ${accepted.modelId}. Progress will appear below.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Model file import failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [pendingInstallsRef, setPendingInstallVersion, setStatusBanner]);

  const startLocalRuntimeModel = useCallback(async (localModelId: string) => {
    try {
      await localAiRuntime.start(localModelId, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: `Model started: ${localModelId}` });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Start model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const stopLocalRuntimeModel = useCallback(async (localModelId: string) => {
    try {
      await localAiRuntime.stop(localModelId, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: `Model stopped: ${localModelId}` });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Stop model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const restartLocalRuntimeModel = useCallback(async (localModelId: string) => {
    try {
      await localAiRuntime.stop(localModelId, { caller: 'core' }).catch(() => null);
      await localAiRuntime.start(localModelId, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: `Model restarted: ${localModelId}` });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Restart model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  const removeLocalRuntimeModel = useCallback(async (localModelId: string) => {
    try {
      await localAiRuntime.remove(localModelId, { caller: 'core' });
      await refreshLocalRuntimeSnapshot();
      setStatusBanner({ kind: 'success', message: `Model removed: ${localModelId}` });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Remove model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [refreshLocalRuntimeSnapshot, setStatusBanner]);

  return {
    importLocalRuntimeModel,
    importLocalRuntimeModelFile,
    startLocalRuntimeModel,
    stopLocalRuntimeModel,
    restartLocalRuntimeModel,
    removeLocalRuntimeModel,
  };
}
