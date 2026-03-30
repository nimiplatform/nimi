import { useCallback, useRef, useState } from 'react';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  localRuntime,
  type LocalRuntimeModelLifecycleOperation,
  type LocalRuntimeModelRecord,
} from '@runtime/local-runtime';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { createOfflineError, getOfflineCoordinator } from '@runtime/offline';
import { i18n } from '@renderer/i18n';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

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

  const queueLifecycleReconcile = useCallback((localModelId: string, epoch: number) => {
    setLifecycleState(localModelId, 'syncing', '', epoch);
    void refreshLocalSnapshot()
      .then(() => {
        setLifecycleState(localModelId, 'idle', '', epoch);
      })
      .catch((error: unknown) => {
        setLifecycleState(
          localModelId,
          'error',
          error instanceof Error ? error.message : String(error || ''),
          epoch,
        );
      });
  }, [refreshLocalSnapshot, setLifecycleState]);

  const importLocalModel = useCallback(async () => {
    try {
      assertRuntimeWriteAllowed();
      const manifestPath = await localRuntime.pickManifestPath();
      if (!manifestPath) {
        return;
      }
      await localRuntime.import({ manifestPath }, { caller: 'core' });
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
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner]);

  const importLocalModelFile = useCallback(async (capabilities: string[], engine?: string) => {
    try {
      assertRuntimeWriteAllowed();
      const filePath = await localRuntime.pickModelFile();
      if (!filePath) {
        return;
      }
      const imported = await localRuntime.importFile({
        filePath,
        capabilities,
        engine: engine || undefined,
      }, { caller: 'core' });
      applyLocalModelSnapshotToState(updateState, imported);
      await refreshLocalSnapshot();

      setStatusBanner({
        kind: 'success',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.modelFileImported',
          'Model file imported: {{modelId}}',
          { modelId: imported.modelId },
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
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner, updateState]);

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
    queueLifecycleReconcile(localModelId, epoch);
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.modelStarted',
        'Model started: {{localModelId}}',
        { localModelId },
      ),
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
    queueLifecycleReconcile(localModelId, epoch);
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.modelStopped',
        'Model stopped: {{localModelId}}',
        { localModelId },
      ),
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
      const startedModel = await localRuntime.start(localModelId, { caller: 'core' });
      applyLocalModelSnapshotToState(updateState, startedModel);
      queueLifecycleReconcile(localModelId, epoch);
      setStatusBanner({
        kind: 'success',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.modelRestarted',
          'Model restarted: {{localModelId}}',
          { localModelId },
        ),
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
    applyLocalModelSnapshotToState(updateState, model);
    await refreshLocalSnapshot();
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.modelRemoved',
        'Model removed: {{localModelId}}',
        { localModelId },
      ),
    });
  }, [assertRuntimeWriteAllowed, refreshLocalSnapshot, setStatusBanner, updateState]);

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
