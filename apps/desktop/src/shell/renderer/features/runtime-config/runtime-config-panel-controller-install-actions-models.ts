import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  localAiRuntime,
  type GoRuntimeSyncTarget,
  syncModelInstallToGoRuntime,
  syncModelStartToGoRuntime,
  syncModelStopToGoRuntime,
  syncModelRemoveToGoRuntime,
  type LocalAiInstallAcceptedResponse,
  type LocalAiInstallPlanDescriptor,
} from '@runtime/local-ai-runtime';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { createOfflineError, getOfflineCoordinator } from '@runtime/offline';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';

export type PendingInstallEntry = {
  accepted: LocalAiInstallAcceptedResponse;
  plan: LocalAiInstallPlanDescriptor;
  installSource: 'catalog' | 'manual' | 'verified';
};

export type RuntimeConfigModelManagementActions = {
  importLocalModel: () => Promise<void>;
  importLocalModelFile: (capabilities: string[], engine?: string) => Promise<void>;
  startLocalModel: (localModelId: string) => Promise<void>;
  stopLocalModel: (localModelId: string) => Promise<void>;
  restartLocalModel: (localModelId: string) => Promise<void>;
  removeLocalModel: (localModelId: string) => Promise<void>;
  removeLocalArtifact: (localArtifactId: string) => Promise<void>;
};

export type UseRuntimeConfigModelManagementActionsInput = {
  pendingInstallsRef: MutableRefObject<Map<string, PendingInstallEntry>>;
  setPendingInstallVersion: Dispatch<SetStateAction<number>>;
  refreshLocalSnapshot: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
};

export function useRuntimeConfigModelManagementActions(
  input: UseRuntimeConfigModelManagementActionsInput,
): RuntimeConfigModelManagementActions {
  const {
    pendingInstallsRef,
    setPendingInstallVersion,
    refreshLocalSnapshot,
    setStatusBanner,
  } = input;

  const assertRuntimeWriteAllowed = useCallback(() => {
    if (getOfflineCoordinator().getTier() !== 'L2') {
      return;
    }
    throw createOfflineError({
      source: 'runtime',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      message: 'Runtime unavailable. Local model writes are disabled in read-only mode.',
      actionHint: 'retry-runtime-when-online',
    });
  }, []);

  const recordGoRuntimeSyncFailure = useCallback(async (
    eventType: string,
    target: GoRuntimeSyncTarget,
    error: unknown,
  ) => {
    await localAiRuntime.appendAudit({
      eventType,
      modelId: String(target.modelId || '').trim(),
      localModelId: String(target.localModelId || '').trim() || undefined,
      source: 'local',
      reasonCode: ReasonCode.GO_RUNTIME_SYNC_FAILED,
      detail: error instanceof Error ? error.message : String(error || 'unknown sync error'),
      payload: {
        action: eventType,
        engine: String(target.engine || '').trim() || undefined,
      },
    }).catch((auditErr) => {
      emitRuntimeLog({
        level: 'warn',
        area: 'local-ai',
        message: 'action:appendAudit:failed',
        details: { eventType, error: auditErr instanceof Error ? auditErr.message : String(auditErr) },
      });
    });
  }, []);

  const importLocalModel = useCallback(async () => {
    try {
      assertRuntimeWriteAllowed();
      const manifestPath = await localAiRuntime.pickManifestPath();
      if (!manifestPath) {
        return;
      }
      const imported = await localAiRuntime.import({ manifestPath }, { caller: 'core' });
      try {
        const synced = await syncModelInstallToGoRuntime(imported);
        if (imported.status === 'active') {
          await syncModelStartToGoRuntime({
            modelId: imported.modelId,
            engine: imported.engine,
            localModelId: synced.localModelId,
          });
        }
      } catch (syncError) {
        await recordGoRuntimeSyncFailure('runtime_model_sync_failed_after_import', {
          modelId: imported.modelId,
          engine: imported.engine,
          localModelId: imported.localModelId,
        }, syncError);
        await refreshLocalSnapshot();
        setStatusBanner({
          kind: 'warning',
          message: `Local model imported, but Go runtime sync failed: ${syncError instanceof Error ? syncError.message : String(syncError || '')}`,
        });
        throw syncError;
      }
      await refreshLocalSnapshot();
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
  }, [assertRuntimeWriteAllowed, recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner]);

  const importLocalModelFile = useCallback(async (capabilities: string[], engine?: string) => {
    try {
      assertRuntimeWriteAllowed();
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
  }, [assertRuntimeWriteAllowed, pendingInstallsRef, setPendingInstallVersion, setStatusBanner]);

  const startLocalModel = useCallback(async (localModelId: string) => {
    assertRuntimeWriteAllowed();
    const model = await localAiRuntime.start(localModelId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: `Start model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    });
    try {
      await syncModelStartToGoRuntime({
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      });
      await refreshLocalSnapshot();
      setStatusBanner({ kind: 'success', message: `Model started: ${localModelId}` });
    } catch (error) {
      await recordGoRuntimeSyncFailure('runtime_model_sync_failed_after_start', {
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      }, error);
      setStatusBanner({
        kind: 'warning',
        message: `Model started locally, but Go runtime sync failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner]);

  const stopLocalModel = useCallback(async (localModelId: string) => {
    assertRuntimeWriteAllowed();
    const model = await localAiRuntime.stop(localModelId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: `Stop model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    });
    try {
      await syncModelStopToGoRuntime({
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      });
      await refreshLocalSnapshot();
      setStatusBanner({ kind: 'success', message: `Model stopped: ${localModelId}` });
    } catch (error) {
      await recordGoRuntimeSyncFailure('runtime_model_sync_failed_after_stop', {
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      }, error);
      setStatusBanner({
        kind: 'warning',
        message: `Model stopped locally, but Go runtime sync failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner]);

  const restartLocalModel = useCallback(async (localModelId: string) => {
    assertRuntimeWriteAllowed();
    let stoppedModel: Awaited<ReturnType<typeof localAiRuntime.stop>> | null = null;
    let resolvedModelId = localModelId;
    try {
      stoppedModel = await localAiRuntime.stop(localModelId, { caller: 'core' }).catch((stopErr) => {
        emitRuntimeLog({
          level: 'warn',
          area: 'local-ai',
          message: 'action:restartLocalModel:stop-phase-failed',
          details: { localModelId, error: stopErr instanceof Error ? stopErr.message : String(stopErr) },
        });
        return null;
      });
      resolvedModelId = stoppedModel?.modelId || localModelId;
      await syncModelStopToGoRuntime({
        modelId: resolvedModelId,
        engine: stoppedModel?.engine,
        localModelId,
      }).catch((syncErr) => {
        emitRuntimeLog({
          level: 'warn',
          area: 'local-ai',
          message: 'action:restartLocalModel:sync-stop-failed',
          details: { localModelId, error: syncErr instanceof Error ? syncErr.message : String(syncErr) },
        });
      });
      const startedModel = await localAiRuntime.start(localModelId, { caller: 'core' });
      await syncModelStartToGoRuntime({
        modelId: startedModel.modelId || resolvedModelId,
        engine: startedModel.engine,
        localModelId,
      });
      await refreshLocalSnapshot();
      setStatusBanner({ kind: 'success', message: `Model restarted: ${localModelId}` });
    } catch (error) {
      await recordGoRuntimeSyncFailure('runtime_model_sync_failed_after_restart', {
        modelId: resolvedModelId,
        engine: stoppedModel?.engine || '',
        localModelId,
      }, error);
      setStatusBanner({
        kind: 'warning',
        message: `Model restarted locally, but Go runtime sync failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner]);

  const removeLocalModel = useCallback(async (localModelId: string) => {
    assertRuntimeWriteAllowed();
    const model = await localAiRuntime.remove(localModelId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: `Remove model failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    });
    try {
      await syncModelRemoveToGoRuntime({
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      });
      await refreshLocalSnapshot();
      setStatusBanner({ kind: 'success', message: `Model removed: ${localModelId}` });
    } catch (error) {
      await recordGoRuntimeSyncFailure('runtime_model_sync_failed_after_remove', {
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      }, error);
      setStatusBanner({
        kind: 'warning',
        message: `Model removed locally, but Go runtime sync failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner]);

  const removeLocalArtifact = useCallback(async (localArtifactId: string) => {
    assertRuntimeWriteAllowed();
    const artifact = await localAiRuntime.removeArtifact(localArtifactId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: `Remove artifact failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    });
    await refreshLocalSnapshot();
    setStatusBanner({
      kind: 'success',
      message: `Artifact removed: ${artifact.artifactId}`,
    });
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  return {
    importLocalModel,
    importLocalModelFile,
    startLocalModel,
    stopLocalModel,
    restartLocalModel,
    removeLocalModel,
    removeLocalArtifact,
  };
}
