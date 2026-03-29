import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  localRuntime,
  type GoRuntimeSyncTarget,
  type LocalRuntimeModelLifecycleOperation,
  syncModelInstallToGoRuntime,
  syncModelStartToGoRuntime,
  syncModelStopToGoRuntime,
  syncModelRemoveToGoRuntime,
  type LocalRuntimeInstallAcceptedResponse,
  type LocalRuntimeInstallPlanDescriptor,
  type LocalRuntimeModelRecord,
} from '@runtime/local-runtime';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { createOfflineError, getOfflineCoordinator } from '@runtime/offline';
import { i18n } from '@renderer/i18n';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

export type PendingInstallEntry = {
  accepted: LocalRuntimeInstallAcceptedResponse;
  plan: LocalRuntimeInstallPlanDescriptor;
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
  localModelLifecycleById: Record<string, LocalRuntimeModelLifecycleOperation>;
  localModelLifecycleErrorById: Record<string, string>;
};

export type UseRuntimeConfigModelManagementActionsInput = {
  pendingInstallsRef: MutableRefObject<Map<string, PendingInstallEntry>>;
  setPendingInstallVersion: Dispatch<SetStateAction<number>>;
  refreshLocalSnapshot: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
};

function translateRuntimeLocalText(
  key: string,
  defaultValue: string,
  options?: Record<string, unknown>,
): string {
  if (!i18n.isInitialized) {
    return defaultValue;
  }
  return i18n.t(key, {
    defaultValue,
    ...(options || {}),
  });
}

function toRuntimeConfigLocalModel(
  model: LocalRuntimeModelRecord,
): RuntimeConfigStateV11['local']['models'][number] {
  return {
    localModelId: model.localModelId,
    engine: model.engine || 'llama',
    model: model.modelId,
    endpoint: model.endpoint || '',
    capabilities: model.capabilities.filter(
      (
        capability,
      ): capability is RuntimeConfigStateV11['local']['models'][number]['capabilities'][number] => (
        capability === 'chat'
        || capability === 'image'
        || capability === 'video'
        || capability === 'tts'
        || capability === 'stt'
        || capability === 'embedding'
      ),
    ),
    status: model.status,
    integrityMode: model.integrityMode,
    installedAt: model.installedAt,
    updatedAt: model.updatedAt,
    recommendation: model.recommendation,
  };
}

function timestampRank(value?: string): number {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function applyLocalModelSnapshotToState(
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void,
  model: LocalRuntimeModelRecord,
): void {
  updateState((prev) => {
    const nextModel = toRuntimeConfigLocalModel(model);
    const nextModels = prev.local.models
      .filter((entry) => entry.localModelId !== model.localModelId)
      .concat(model.status === 'removed' ? [] : [nextModel])
      .sort((left, right) => {
        const leftRank = timestampRank(left.installedAt) || timestampRank(left.updatedAt);
        const rightRank = timestampRank(right.installedAt) || timestampRank(right.updatedAt);
        if (leftRank !== rightRank) {
          return rightRank - leftRank;
        }
        return String(right.localModelId || '').localeCompare(String(left.localModelId || ''));
      });
    return {
      ...prev,
      local: {
        ...prev.local,
        models: nextModels,
      },
    };
  });
}

export function useRuntimeConfigModelManagementActions(
  input: UseRuntimeConfigModelManagementActionsInput,
): RuntimeConfigModelManagementActions {
  const {
    pendingInstallsRef,
    setPendingInstallVersion,
    refreshLocalSnapshot,
    setStatusBanner,
    updateState,
  } = input;
  const [localModelLifecycleById, setLocalModelLifecycleById] = useState<Record<string, LocalRuntimeModelLifecycleOperation>>({});
  const [localModelLifecycleErrorById, setLocalModelLifecycleErrorById] = useState<Record<string, string>>({});
  const lifecycleEpochRef = useRef<Record<string, number>>({});

  const assertRuntimeWriteAllowed = useCallback(() => {
    if (getOfflineCoordinator().getTier() !== 'L2') {
      return;
    }
    throw createOfflineError({
      source: 'runtime',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      message: i18n.isInitialized
        ? i18n.t('runtimeConfig.local.runtimeUnavailableWriteReadOnly', {
          defaultValue: 'Runtime unavailable. Local model writes are disabled in read-only mode.',
        })
        : 'Runtime unavailable. Local model writes are disabled in read-only mode.',
      actionHint: 'retry-runtime-when-online',
    });
  }, []);

  const recordGoRuntimeSyncFailure = useCallback(async (
    eventType: string,
    target: GoRuntimeSyncTarget,
    error: unknown,
  ) => {
    await localRuntime.appendAudit({
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

  const nextLifecycleEpoch = useCallback((localModelId: string): number => {
    const current = lifecycleEpochRef.current[localModelId] || 0;
    const next = current + 1;
    lifecycleEpochRef.current[localModelId] = next;
    return next;
  }, []);

  const isCurrentLifecycleEpoch = useCallback((localModelId: string, epoch: number): boolean => (
    lifecycleEpochRef.current[localModelId] === epoch
  ), []);

  const setLifecycleState = useCallback((
    localModelId: string,
    state: LocalRuntimeModelLifecycleOperation,
    error = '',
    epoch?: number,
  ) => {
    if (typeof epoch === 'number' && !isCurrentLifecycleEpoch(localModelId, epoch)) {
      return;
    }
    setLocalModelLifecycleById((prev) => ({ ...prev, [localModelId]: state }));
    setLocalModelLifecycleErrorById((prev) => ({ ...prev, [localModelId]: error }));
  }, [isCurrentLifecycleEpoch]);

  const queueLifecycleReconcile = useCallback((
    input: {
      localModelId: string;
      epoch: number;
      syncFailureEventType: string;
      syncFailureTarget: GoRuntimeSyncTarget;
      syncFailureBannerKey: string;
      syncFailureBannerDefault: string;
      runSync: () => Promise<void>;
    },
  ) => {
    void (async () => {
      try {
        await input.runSync();
        await refreshLocalSnapshot();
        if (!isCurrentLifecycleEpoch(input.localModelId, input.epoch)) {
          return;
        }
        setLifecycleState(input.localModelId, 'idle', '', input.epoch);
      } catch (error) {
        await recordGoRuntimeSyncFailure(
          input.syncFailureEventType,
          input.syncFailureTarget,
          error,
        );
        await refreshLocalSnapshot().catch(() => undefined);
        if (!isCurrentLifecycleEpoch(input.localModelId, input.epoch)) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error || '');
        setLifecycleState(input.localModelId, 'error', message, input.epoch);
        setStatusBanner({
          kind: 'warning',
          message: translateRuntimeLocalText(
            input.syncFailureBannerKey,
            input.syncFailureBannerDefault,
            { message },
          ),
        });
      }
    })();
  }, [
    isCurrentLifecycleEpoch,
    recordGoRuntimeSyncFailure,
    refreshLocalSnapshot,
    setLifecycleState,
    setStatusBanner,
  ]);

  const importLocalModel = useCallback(async () => {
    try {
      assertRuntimeWriteAllowed();
      const manifestPath = await localRuntime.pickManifestPath();
      if (!manifestPath) {
        return;
      }
      const imported = await localRuntime.import({ manifestPath }, { caller: 'core' });
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
        message: translateRuntimeLocalText(
          'runtimeConfig.local.localModelImported',
          'Local model imported: {{manifestPath}}',
          { manifestPath },
        ),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.localModelImportFailed',
          'Local model import failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner]);

  const importLocalModelFile = useCallback(async (capabilities: string[], engine?: string) => {
    try {
      assertRuntimeWriteAllowed();
      const filePath = await localRuntime.pickModelFile();
      if (!filePath) {
        return;
      }
      const accepted = await localRuntime.importFile({
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
        } as LocalRuntimeInstallPlanDescriptor,
        installSource: 'manual',
      });
      setPendingInstallVersion((version) => version + 1);

      setStatusBanner({
        kind: 'info',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.fileImportStarted',
          'File import started: {{modelId}}. Progress will appear below.',
          { modelId: accepted.modelId },
        ),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.modelFileImportFailed',
          'Model file import failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, pendingInstallsRef, setPendingInstallVersion, setStatusBanner]);

  const startLocalModel = useCallback(async (localModelId: string) => {
    assertRuntimeWriteAllowed();
    const epoch = nextLifecycleEpoch(localModelId);
    setLifecycleState(localModelId, 'starting', '', epoch);
    setStatusBanner({
      kind: 'info',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.startModelPending',
        'Starting local model: {{localModelId}}',
        { localModelId },
      ),
    });
    const model = await localRuntime.start(localModelId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.startModelFailed',
          'Start model failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      setLifecycleState(
        localModelId,
        'error',
        error instanceof Error ? error.message : String(error || ''),
        epoch,
      );
      throw error;
    });
    applyLocalModelSnapshotToState(updateState, model);
    setLifecycleState(localModelId, 'syncing', '', epoch);
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.modelStarted',
        'Model started: {{localModelId}}',
        { localModelId },
      ),
    });
    queueLifecycleReconcile({
      localModelId,
      epoch,
      syncFailureEventType: 'runtime_model_sync_failed_after_start',
      syncFailureTarget: {
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      },
      syncFailureBannerKey: 'runtimeConfig.local.modelStartedSyncFailed',
      syncFailureBannerDefault: 'Model started locally, but Go runtime sync failed: {{message}}',
      runSync: async () => {
        await syncModelStartToGoRuntime({
          modelId: model.modelId || localModelId,
          engine: model.engine,
          localModelId,
        });
      },
    });
  }, [
    assertRuntimeWriteAllowed,
    nextLifecycleEpoch,
    queueLifecycleReconcile,
    setLifecycleState,
    setStatusBanner,
    updateState,
  ]);

  const stopLocalModel = useCallback(async (localModelId: string) => {
    assertRuntimeWriteAllowed();
    const epoch = nextLifecycleEpoch(localModelId);
    setLifecycleState(localModelId, 'stopping', '', epoch);
    setStatusBanner({
      kind: 'info',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.stopModelPending',
        'Stopping local model: {{localModelId}}',
        { localModelId },
      ),
    });
    const model = await localRuntime.stop(localModelId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.stopModelFailed',
          'Stop model failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      setLifecycleState(
        localModelId,
        'error',
        error instanceof Error ? error.message : String(error || ''),
        epoch,
      );
      throw error;
    });
    applyLocalModelSnapshotToState(updateState, model);
    setLifecycleState(localModelId, 'syncing', '', epoch);
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.modelStopped',
        'Model stopped: {{localModelId}}',
        { localModelId },
      ),
    });
    queueLifecycleReconcile({
      localModelId,
      epoch,
      syncFailureEventType: 'runtime_model_sync_failed_after_stop',
      syncFailureTarget: {
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      },
      syncFailureBannerKey: 'runtimeConfig.local.modelStoppedSyncFailed',
      syncFailureBannerDefault: 'Model stopped locally, but Go runtime sync failed: {{message}}',
      runSync: async () => {
        await syncModelStopToGoRuntime({
          modelId: model.modelId || localModelId,
          engine: model.engine,
          localModelId,
        });
      },
    });
  }, [
    assertRuntimeWriteAllowed,
    nextLifecycleEpoch,
    queueLifecycleReconcile,
    setLifecycleState,
    setStatusBanner,
    updateState,
  ]);

  const restartLocalModel = useCallback(async (localModelId: string) => {
    assertRuntimeWriteAllowed();
    const epoch = nextLifecycleEpoch(localModelId);
    setLifecycleState(localModelId, 'restarting', '', epoch);
    setStatusBanner({
      kind: 'info',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.restartModelPending',
        'Restarting local model: {{localModelId}}',
        { localModelId },
      ),
    });
    let stoppedModel: Awaited<ReturnType<typeof localRuntime.stop>> | null = null;
    let resolvedModelId = localModelId;
    try {
      stoppedModel = await localRuntime.stop(localModelId, { caller: 'core' }).catch((stopErr) => {
        emitRuntimeLog({
          level: 'warn',
          area: 'local-ai',
          message: 'action:restartLocalModel:stop-phase-failed',
          details: { localModelId, error: stopErr instanceof Error ? stopErr.message : String(stopErr) },
        });
        return null;
      });
      resolvedModelId = stoppedModel?.modelId || localModelId;
      const startedModel = await localRuntime.start(localModelId, { caller: 'core' });
      applyLocalModelSnapshotToState(updateState, startedModel);
      setLifecycleState(localModelId, 'syncing', '', epoch);
      setStatusBanner({
        kind: 'success',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.modelRestarted',
          'Model restarted: {{localModelId}}',
          { localModelId },
        ),
      });
      queueLifecycleReconcile({
        localModelId,
        epoch,
        syncFailureEventType: 'runtime_model_sync_failed_after_restart',
        syncFailureTarget: {
          modelId: startedModel.modelId || resolvedModelId,
          engine: startedModel.engine || stoppedModel?.engine || '',
          localModelId,
        },
        syncFailureBannerKey: 'runtimeConfig.local.modelRestartedSyncFailed',
        syncFailureBannerDefault: 'Model restarted locally, but Go runtime sync failed: {{message}}',
        runSync: async () => {
          if (stoppedModel) {
            await syncModelStopToGoRuntime({
              modelId: resolvedModelId,
              engine: stoppedModel.engine,
              localModelId,
            }).catch((syncErr) => {
              emitRuntimeLog({
                level: 'warn',
                area: 'local-ai',
                message: 'action:restartLocalModel:sync-stop-failed',
                details: { localModelId, error: syncErr instanceof Error ? syncErr.message : String(syncErr) },
              });
            });
          }
          await syncModelStartToGoRuntime({
            modelId: startedModel.modelId || resolvedModelId,
            engine: startedModel.engine,
            localModelId,
          });
        },
      });
    } catch (error) {
      if (stoppedModel) {
        applyLocalModelSnapshotToState(updateState, stoppedModel);
      }
      setLifecycleState(
        localModelId,
        'error',
        error instanceof Error ? error.message : String(error || ''),
        epoch,
      );
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.restartModelFailed',
          'Restart model failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      throw error;
    }
  }, [
    assertRuntimeWriteAllowed,
    nextLifecycleEpoch,
    queueLifecycleReconcile,
    setLifecycleState,
    setStatusBanner,
    updateState,
  ]);

  const removeLocalModel = useCallback(async (localModelId: string) => {
    assertRuntimeWriteAllowed();
    const model = await localRuntime.remove(localModelId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.removeModelFailed',
          'Remove model failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
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
      setStatusBanner({
        kind: 'success',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.modelRemoved',
          'Model removed: {{localModelId}}',
          { localModelId },
        ),
      });
    } catch (error) {
      await recordGoRuntimeSyncFailure('runtime_model_sync_failed_after_remove', {
        modelId: model.modelId || localModelId,
        engine: model.engine,
        localModelId,
      }, error);
      await refreshLocalSnapshot();
      setStatusBanner({
        kind: 'warning',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.modelRemovedSyncFailed',
          'Model removed locally, but Go runtime sync failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      throw error;
    }
  }, [assertRuntimeWriteAllowed, recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner]);

  const removeLocalArtifact = useCallback(async (localArtifactId: string) => {
    assertRuntimeWriteAllowed();
    const artifact = await localRuntime.removeArtifact(localArtifactId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.removeArtifactFailed',
          'Remove artifact failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      throw error;
    });
    await refreshLocalSnapshot();
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.artifactRemoved',
        'Artifact removed: {{artifactId}}',
        { artifactId: artifact.artifactId },
      ),
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
    localModelLifecycleById,
    localModelLifecycleErrorById,
  };
}
