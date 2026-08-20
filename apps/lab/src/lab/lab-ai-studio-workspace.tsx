import { useMemo, type ComponentProps } from 'react';

import {
  AIStudioWorkspace,
  studioCapabilityResultHasTrace,
  studioCapabilityResultTraceId,
  type AIStudioHistoryProjection,
  type AIStudioHistoryRepository,
  type AIStudioWorkspaceController,
  type StudioCapabilityRunResult,
  type StudioRunHistory,
  type StudioRunHistoryRecord,
} from '../ai-studio-core/index.js';
import { useLabRendererHost } from '../renderer/context.js';
import {
  cleanupLabManagedArtifactPaths,
  persistLabRunHistoryWithArtifactCompensation,
  shouldPersistLabArtifactRecord,
} from './lab-artifact-persistence.js';
import type { LabImageHistoryRecord } from './lab-image-history.js';
import {
  clearLabManagedHistoryScope,
  deleteLabManagedHistoryRecord,
  reconcileLabManagedHistoryProjection,
} from './lab-managed-history.js';
import { LabAIStudioAdapter } from './lab-ai-studio-adapter.js';

export function useLabAIStudioHistoryRepository(): AIStudioHistoryRepository {
  const rendererHost = useLabRendererHost();
  return useMemo(() => {
    const managedHistoryPort = {
      loadRunHistory: () => rendererHost.app.projection.runHistory(),
      loadImageHistory: () => rendererHost.app.projection.imageHistory(),
      removeAsset: (relativePath: string) => rendererHost.sdk.storage.assets.remove(relativePath),
      removeRunHistory: (runId: string) => rendererHost.app.commands.removeRunHistory(runId),
      removeImageHistory: (runId: string) => rendererHost.app.commands.removeImageHistory(runId),
      clearRunHistory: (capabilityId?: string) => rendererHost.app.commands.clearRunHistory(capabilityId ? { capabilityId } : {}),
      clearImageHistory: (capabilityId?: string) => rendererHost.app.commands.clearImageHistory(capabilityId ? { capabilityId } : {}),
    };

    const reconcile = (
      runHistory: StudioRunHistory,
      imageHistory: readonly LabImageHistoryRecord[],
    ) => reconcileLabManagedHistoryProjection(
      runHistory,
      imageHistory,
      (relativePath) => rendererHost.sdk.storage.assets.stat(relativePath),
    );

    const loadImageHistory = async (): Promise<readonly LabImageHistoryRecord[]> => {
      try {
        return await rendererHost.app.projection.imageHistory();
      } catch (error) {
        void rendererHost.app.commands.runtimeLog({
          level: 'warn',
          area: 'lab-history',
          message: 'image-history-load-failed',
          details: { error: errorMessage(error, 'Image history load failed.') },
        });
        return [];
      }
    };

    const loadProjection = async (
      runHistory?: StudioRunHistory,
      imageHistory?: readonly LabImageHistoryRecord[],
    ): Promise<AIStudioHistoryProjection> => {
      const runs = runHistory ?? await rendererHost.app.projection.runHistory();
      const images = imageHistory ?? await loadImageHistory();
      const projection = await reconcile(runs, images);
      return { runHistory: projection.runHistory, mediaHistory: projection.imageHistory };
    };

    const logRecordedResult = (
      result: StudioCapabilityRunResult,
      record: StudioRunHistoryRecord,
      artifactPersisted: boolean,
    ) => {
      const traceId = studioCapabilityResultTraceId(result);
      void rendererHost.app.commands.rendererLog({
        level: result.ok ? 'info' : 'warn',
        area: 'lab.capability-run',
        message: result.ok
          ? 'action:lab-capability-run:recorded'
          : record.status === 'failed'
            ? 'action:lab-capability-run:failed'
            : record.status === 'canceled'
              ? 'action:lab-capability-run:canceled'
              : record.status === 'timed-out'
                ? 'action:lab-capability-run:timed-out'
                : 'action:lab-capability-run:unavailable',
        flowId: rendererHost.scope.globalName(`lab-capability-run-${record.id}`),
        traceId,
        details: {
          runId: record.id,
          capabilityId: result.capabilityId,
          status: record.status,
          artifactPersisted,
          traceState: studioCapabilityResultHasTrace(result) ? 'captured' : 'not-captured',
        },
      });
    };

    return {
      async load() {
        try {
          return await loadProjection();
        } catch (error) {
          void rendererHost.app.commands.runtimeLog({
            level: 'warn',
            area: 'lab-history',
            message: 'history-load-failed',
            details: { error: errorMessage(error, 'History load failed.') },
          });
          throw error;
        }
      },
      async persist({ result, record }) {
        const persisted = await persistLabRunHistoryWithArtifactCompensation(
          result,
          () => rendererHost.app.commands.appendRunHistory(record),
          (relativePath) => rendererHost.sdk.storage.assets.remove(relativePath),
        );
        if (!persisted.ok) {
          void rendererHost.app.commands.rendererLog({
            level: 'error',
            area: 'lab.capability-run',
            message: 'action:lab-capability-run:history-persistence-failed',
            flowId: rendererHost.scope.globalName(`lab-capability-run-${record.id}`),
            traceId: studioCapabilityResultTraceId(result),
            details: {
              runId: record.id,
              capabilityId: result.capabilityId,
              error: persisted.message,
              managedArtifactCleanup: persisted.managedArtifactCleanup,
              remainingCleanupPaths: persisted.remainingCleanupPaths,
            },
          });
          return {
            ok: false as const,
            message: persisted.message,
            retryRecord: !shouldPersistLabArtifactRecord(result),
            remainingCleanupPaths: persisted.remainingCleanupPaths,
            ...(persisted.displayFailure ? { displayFailure: persisted.displayFailure } : {}),
          };
        }

        let imageHistory = await loadImageHistory();
        let artifactPersisted = false;
        if (shouldPersistLabArtifactRecord(result)) {
          try {
            for (const [index, artifact] of result.output.artifacts.entries()) {
              imageHistory = await rendererHost.app.commands.appendImageHistory({
                id: index === 0 ? record.id : `${record.id}:${index}`,
                runId: record.id,
                kind: 'runtime-media',
                capabilityId: result.capabilityId,
                capabilityLabel: result.capabilityLabel,
                title: artifact.displayName || artifact.relativePath || result.output.jobId || result.capabilityLabel,
                status: 'ready',
                createdAt: record.createdAt,
                artifactCount: result.output.artifactCount,
                artifactLabel: artifact.displayName || artifact.relativePath,
                relativePath: artifact.relativePath,
                mediaType: artifact.mediaType,
                sizeBytes: artifact.sizeBytes,
                sha256: artifact.sha256,
                jobId: result.output.jobId,
                jobState: result.output.jobState,
                message: result.message,
                traceState: studioCapabilityResultHasTrace(result) ? 'captured' : 'not-captured',
                traceId: studioCapabilityResultTraceId(result),
              });
            }
            artifactPersisted = true;
          } catch (error) {
            void rendererHost.app.commands.rendererLog({
              level: 'error',
              area: 'lab.capability-run',
              message: 'action:lab-capability-run:artifact-index-persistence-failed',
              flowId: rendererHost.scope.globalName(`lab-capability-run-${record.id}`),
              traceId: studioCapabilityResultTraceId(result),
              details: {
                runId: record.id,
                capabilityId: result.capabilityId,
                error: errorMessage(error, 'Artifact index persistence failed.'),
              },
            });
            imageHistory = await loadImageHistory();
          }
        }
        const projection = await loadProjection(persisted.value, imageHistory);
        logRecordedResult(result, record, artifactPersisted);
        return { ok: true as const, projection };
      },
      async appendRecord(record) {
        return loadProjection(await rendererHost.app.commands.appendRunHistory(record));
      },
      cleanupArtifacts: (relativePaths) => cleanupLabManagedArtifactPaths(
        relativePaths,
        (relativePath) => rendererHost.sdk.storage.assets.remove(relativePath),
      ),
      async remove(recordId, deleteAssets) {
        let outcome;
        try {
          outcome = await deleteLabManagedHistoryRecord(managedHistoryPort, recordId, deleteAssets);
        } catch (error) {
          void rendererHost.app.commands.runtimeLog({
            level: 'warn',
            area: 'lab-history',
            message: 'history-remove-failed',
            details: { recordId, error: errorMessage(error, 'History remove failed.') },
          });
          throw error;
        }
        for (const issue of outcome.issues) {
          void rendererHost.app.commands.runtimeLog({
            level: 'warn',
            area: 'lab-history',
            message: issue.step === 'asset' ? 'history-remove-asset-failed' : 'history-remove-failed',
            details: { recordId: issue.runId, error: issue.message },
          });
        }
        return {
          completed: outcome.completed,
          skipped: outcome.skipped,
          failed: outcome.failed,
          projection: await loadProjection(outcome.runHistory, outcome.imageHistory),
          issues: outcome.issues,
        };
      },
      async clear(capabilityId, deleteAssets) {
        let outcome;
        try {
          outcome = await clearLabManagedHistoryScope(managedHistoryPort, capabilityId, deleteAssets);
        } catch (error) {
          void rendererHost.app.commands.runtimeLog({
            level: 'warn',
            area: 'lab-history',
            message: 'history-clear-failed',
            details: { capabilityId, error: errorMessage(error, 'History clear failed.') },
          });
          throw error;
        }
        for (const issue of outcome.issues) {
          void rendererHost.app.commands.runtimeLog({
            level: 'warn',
            area: 'lab-history',
            message: issue.step === 'asset' ? 'history-clear-asset-skipped' : 'history-clear-record-failed',
            details: { runId: issue.runId, error: issue.message },
          });
        }
        return {
          completed: outcome.completed,
          skipped: outcome.skipped,
          failed: outcome.failed,
          projection: await loadProjection(outcome.runHistory, outcome.imageHistory),
          issues: outcome.issues,
        };
      },
      nextIdentity: () => rendererHost.app.commands.nextRunIdentity(),
      statusForResult: (result) => result.capabilityId === 'world.generate' && result.ok
        ? 'local-fixture'
        : undefined,
      loadPanelPreferences: () => ({ ...rendererHost.app.projection.preferences().historyPanel }),
      savePanelPreferences: async (historyPanel) => {
        const preferences = rendererHost.app.projection.preferences();
        try {
          await rendererHost.app.commands.savePreferences({ ...preferences, historyPanel });
        } catch (error) {
          void rendererHost.app.commands.runtimeLog({
            level: 'warn',
            area: 'lab-preferences',
            message: 'preferences-save-failed',
            details: { error: errorMessage(error, 'Preferences save failed.') },
          });
        }
      },
    };
  }, [rendererHost]);
}

export function LabAIStudioWorkspace({
  controller,
  ...props
}: Omit<ComponentProps<typeof AIStudioWorkspace>, 'controller'> & {
  readonly controller: AIStudioWorkspaceController;
}) {
  return (
    <LabAIStudioAdapter>
      <AIStudioWorkspace {...props} controller={controller} />
    </LabAIStudioAdapter>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}
