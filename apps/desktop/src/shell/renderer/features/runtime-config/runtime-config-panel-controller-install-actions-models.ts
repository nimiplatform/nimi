import { useCallback, useRef, useState } from 'react';
import {
  isNimiRuntimeLocalRunnableAssetKindId,
  nimiRuntimeLocalRunnableAssetKindForCapabilities,
} from '@nimiplatform/sdk/runtime';
import {
  createOfflineNimiError as createOfflineError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import type { NimiRuntimeLocalAssetRecord } from '@nimiplatform/sdk/runtime';
import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';
import { useRuntimeConfigLocalAssetAdminClient } from './runtime-config-local-model-center-sdk-service';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useTranslation } from 'react-i18next';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

export type RuntimeConfigModelManagementActions = {
  importLocalModel: () => Promise<void>;
  importLocalModelFile: (capabilities: string[], engine?: string) => Promise<void>;
  startLocalModel: (localModelId: string) => Promise<void>;
  stopLocalModel: (localModelId: string) => Promise<void>;
  restartLocalModel: (localModelId: string) => Promise<void>;
  removeLocalModel: (localModelId: string) => Promise<void>;
  removeLocalAsset: (localAssetId: string) => Promise<void>;
  localModelLifecycleById: Record<string, string>;
  localModelLifecycleErrorById: Record<string, string>;
};

export type UseRuntimeConfigModelManagementActionsInput = {
  refreshLocalSnapshot: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
};

function toRuntimeConfigLocalModel(
  model: NimiRuntimeLocalAssetRecord,
): RuntimeConfigStateV11['local']['models'][number] {
  return {
    localModelId: model.localAssetId || '',
    engine: model.engine || '',
    model: model.assetId || '',
    endpoint: '',
    capabilities: (model.capabilities || []).filter(isNimiRuntimeLocalRunnableAssetKindId),
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
  model: NimiRuntimeLocalAssetRecord,
): void {
  updateState((prev) => {
    const nextModel = toRuntimeConfigLocalModel(model);
    const modelLocalId = model.localAssetId || '';
    const nextModels = prev.local.models
      .filter((entry) => entry.localModelId !== modelLocalId)
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
  const runtimeConfigLocalAssetAdminClient = useRuntimeConfigLocalAssetAdminClient();
  const bindings = useDesktopRendererBindings();
  const { t } = useTranslation();
  const translateRuntimeLocalText = useCallback((
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>,
  ) => String(t(key, { defaultValue, ...(options || {}) })), [t]);
  const {
    refreshLocalSnapshot,
    setStatusBanner,
    updateState,
  } = input;
  const [localModelLifecycleById, setLocalModelLifecycleById] = useState<Record<string, string>>({});
  const [localModelLifecycleErrorById, setLocalModelLifecycleErrorById] = useState<Record<string, string>>({});
  const lifecycleEpochRef = useRef<Record<string, number>>({});

  const assertRuntimeWriteAllowed = useCallback(() => {
    if (bindings.sdk.offline.getTier() !== 'L2') {
      return;
    }
    throw createOfflineError({
      source: 'runtime',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      message: t('runtimeConfig.local.runtimeUnavailableWriteReadOnly', {
        defaultValue: 'Runtime unavailable. Local model writes are disabled in read-only mode.',
      }),
      actionHint: 'retry-runtime-when-online',
    });
  }, [bindings.sdk.offline, t]);

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
    state: string,
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
      const manifestPath = await bindings.app.commands.pickLocalRuntimeAssetManifestPath();
      if (!manifestPath) {
        return;
      }
      await runtimeConfigLocalAssetAdminClient.importAsset({ manifestPath }, { caller: 'core' });
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
      const filePath = await bindings.app.commands.pickLocalRuntimeAssetFile();
      if (!filePath) {
        return;
      }
      const kind = nimiRuntimeLocalRunnableAssetKindForCapabilities(capabilities);
      if (!kind) {
        throw new Error('Local model file import requires one explicit canonical asset kind.');
      }
      const asset = await runtimeConfigLocalAssetAdminClient.importFile({
        filePath,
        kind,
        engine: engine || undefined,
      }, { caller: 'core' });

      setStatusBanner({
        kind: 'success',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.assetImported',
          'Asset imported: {{assetId}}',
          { assetId: asset.assetId },
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
        'Starting local asset: {{localModelId}}',
        { localModelId },
      ),
    });
    const model = await runtimeConfigLocalAssetAdminClient.start(localModelId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.startModelFailed',
        'Start asset failed: {{message}}',
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
        'Asset started: {{localModelId}}',
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
        'Stopping local asset: {{localModelId}}',
        { localModelId },
      ),
    });
    const model = await runtimeConfigLocalAssetAdminClient.stop(localModelId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.stopModelFailed',
        'Stop asset failed: {{message}}',
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
        'Asset stopped: {{localModelId}}',
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
        'Restarting local asset: {{localModelId}}',
        { localModelId },
      ),
    });
    try {
      await runtimeConfigLocalAssetAdminClient.stop(localModelId, { caller: 'core' }).catch((stopErr) => {
        emitRuntimeLog({
          level: 'error',
          area: 'local-ai',
          message: 'action:restartLocalModel:stop-phase-failed',
          details: { localModelId, error: stopErr instanceof Error ? stopErr.message : String(stopErr) },
        });
        throw stopErr;
      });
      const startedModel = await runtimeConfigLocalAssetAdminClient.start(localModelId, { caller: 'core' });
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
    const removed = await runtimeConfigLocalAssetAdminClient.remove(localModelId, { caller: 'core' }).catch((error) => {
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
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.modelRemoved',
        'Model removed: {{localModelId}}',
        { localModelId: removed.localAssetId || localModelId },
      ),
    });
  }, [assertRuntimeWriteAllowed, setStatusBanner]);

  const removeLocalAsset = useCallback(async (localAssetId: string) => {
    assertRuntimeWriteAllowed();
    const removed = await runtimeConfigLocalAssetAdminClient.remove(localAssetId, { caller: 'core' }).catch((error) => {
      setStatusBanner({
        kind: 'error',
        message: translateRuntimeLocalText(
          'runtimeConfig.local.removeAssetFailed',
          'Remove asset failed: {{message}}',
          { message: error instanceof Error ? error.message : String(error || '') },
        ),
      });
      throw error;
    });
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.assetRemoved',
        'Asset removed: {{assetId}}',
        { assetId: removed.localAssetId || localAssetId },
      ),
    });
  }, [assertRuntimeWriteAllowed, setStatusBanner]);

  return {
    importLocalModel,
    importLocalModelFile,
    startLocalModel,
    stopLocalModel,
    restartLocalModel,
    removeLocalModel,
    removeLocalAsset,
    localModelLifecycleById,
    localModelLifecycleErrorById,
  };
}
