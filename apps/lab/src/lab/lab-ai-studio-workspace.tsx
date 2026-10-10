import { worldTourRecoveryReferences } from './world-tour/world-tour-runtime.js';
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
import type { LabCanonicalRendererBindings } from '../renderer/contract.js';
import { studioResultAssetPaths, studioResultAssetReferences } from '../ai-studio-core/managed-result-references.js';
import { studioJobRecoveryCapabilities, readStudioJobRecovery, forgetStudioJobRecovery, type StudioJobRecoveryCapability } from '../ai-studio-core/job-recovery.js';
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
  withLabManagedHistoryOperation,
} from './lab-managed-history.js';
import { LabAIStudioAdapter } from './lab-ai-studio-adapter.js';

export function createLabAIStudioHistoryRepository(rendererHost: LabCanonicalRendererBindings): AIStudioHistoryRepository {
    const loadRecoveryReferences = async () => {
      const references = [...await worldTourRecoveryReferences(rendererHost.sdk.localAppClient.storage)];
      for (const capability of studioJobRecoveryCapabilities) {
        for (const entry of await readStudioJobRecovery(rendererHost.sdk.localAppClient.storage, capability)) {
          references.push({ id: entry.clientSubmissionId, capabilityId: capability,
            jobId: entry.result?.ok && 'jobId' in entry.result ? entry.result.jobId : entry.jobId,
            complete: Boolean(entry.result?.ok), artifactPaths: [...new Set([
              ...studioResultAssetPaths(entry.result),
              ...(entry.details?.sourceImage ? [entry.details.sourceImage.relativePath] : []),
              ...(entry.sourceAudio ? [entry.sourceAudio.relativePath] : []),
              ...(entry.targetAudio ? [entry.targetAudio.relativePath] : []),
            ])] });
        }
      }
      return references;
    };
    const managedHistoryPort = {
      loadRunHistory: () => rendererHost.app.projection.runHistory(),
      loadImageHistory: () => rendererHost.app.projection.imageHistory(),
      removeAsset: (relativePath: string) => rendererHost.sdk.storage.assets.remove(relativePath),
      removeRunHistory: (runId: string) => rendererHost.app.commands.removeRunHistory(runId),
      removeImageHistory: (runId: string) => rendererHost.app.commands.removeImageHistory(runId),
      loadRecoveryReferences,
      forgetRecoveryReference: (reference: { id: string; capabilityId: string }) => forgetStudioJobRecovery(
        rendererHost.sdk.localAppClient.storage, reference.id, reference.capabilityId as StudioJobRecoveryCapability),
      projectHistory: (runs: StudioRunHistory, images: readonly LabImageHistoryRecord[]) => reconcile(runs, images),
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
        throw error;
      }
    };

    const loadProjection = async (
      runHistory?: StudioRunHistory,
      imageHistory?: readonly LabImageHistoryRecord[],
      repairRecordId?: string,
    ): Promise<AIStudioHistoryProjection> => {
      const runs = runHistory ?? await rendererHost.app.projection.runHistory();
      const images = imageHistory ?? await loadImageHistory();
      const projection = await reconcile(runs, images);
      // Main history is authoritative. Rebuild missing secondary rows from its
      // complete result instead of treating a failed media append as data loss.
      const savedIds = new Set(images.map(row => row.id));
      for (const row of projection.imageHistory) if (repairRecordId && (row.runId || row.id) === repairRecordId && !savedIds.has(row.id)) {
        await rendererHost.app.commands.appendImageHistory(row);
      }
      return { runHistory: projection.runHistory, mediaHistory: projection.imageHistory };
    };

    const retainedAssetPaths = async () => {
      const [runs, images, recovery] = await Promise.all([
        rendererHost.app.projection.runHistory(), loadImageHistory(), loadRecoveryReferences(),
      ]);
      return new Set([...Object.values(runs).flat().flatMap(record => studioResultAssetPaths(record.result)),
        ...images.flatMap(row => row.relativePath ? [row.relativePath] : []), ...recovery.flatMap(item => item.artifactPaths)]);
    };
    const verifyRecordAssets = async (record: StudioRunHistoryRecord) => {
      for (const reference of studioResultAssetReferences(record.result)) {
        const actual = await rendererHost.sdk.storage.assets.stat(reference.relativePath as string);
        if ((reference.sha256 !== undefined && reference.sha256 !== actual.sha256)
          || (reference.sizeBytes !== undefined && reference.sizeBytes !== actual.sizeBytes)
          || (reference.mediaType !== undefined && reference.mediaType !== actual.mediaType)) throw new Error('Saved result custody has changed');
      }
    };
    const matchingRecord = (runs: StudioRunHistory, record: StudioRunHistoryRecord) => Object.values(runs).flat().find(existing =>
      existing.id === record.id || (existing.capabilityId === record.capabilityId && existing.result?.ok && record.result?.ok
        && 'jobId' in existing.result && 'jobId' in record.result && existing.result.jobId === record.result.jobId));

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
        return withLabManagedHistoryOperation(async () => {
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
        });
      },
      async persist({ result, record }) {
        return withLabManagedHistoryOperation(async () => {
        const priorRuns = await rendererHost.app.projection.runHistory();
        const existing = matchingRecord(priorRuns, record);
        if (existing) {
          await verifyRecordAssets(existing);
          return { ok: true as const, record: existing, projection: await loadProjection(priorRuns, undefined, existing.id) };
        }
        await verifyRecordAssets(record);
        const protectedPaths = await retainedAssetPaths();
        const persisted = await persistLabRunHistoryWithArtifactCompensation(
          result,
          () => rendererHost.app.commands.appendRunHistory(record),
          async (relativePath) => { if (!protectedPaths.has(relativePath)) await rendererHost.sdk.storage.assets.remove(relativePath); },
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
            retryRecord: persisted.managedArtifactCleanup === 'not-required',
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
            throw error;
          }
        }
        const projection = await loadProjection(persisted.value, imageHistory, record.id);
        logRecordedResult(result, record, artifactPersisted);
        return { ok: true as const, projection, record };
        });
      },
      async appendRecord(record) {
        return withLabManagedHistoryOperation(async () => {
          const existing = matchingRecord(await rendererHost.app.projection.runHistory(), record);
          await verifyRecordAssets(existing ?? record);
          return loadProjection(existing ? undefined : await rendererHost.app.commands.appendRunHistory(record), undefined, existing?.id ?? record.id);
        });
      },
      cleanupArtifacts: (relativePaths) => withLabManagedHistoryOperation(async () => {
        const protectedPaths = await retainedAssetPaths();
        return cleanupLabManagedArtifactPaths(relativePaths.filter(path => !protectedPaths.has(path)),
          (relativePath) => rendererHost.sdk.storage.assets.remove(relativePath));
      }),
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
          projection: { runHistory: outcome.runHistory, mediaHistory: outcome.imageHistory },
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
          projection: { runHistory: outcome.runHistory, mediaHistory: outcome.imageHistory },
          issues: outcome.issues,
        };
      },
      nextIdentity: () => rendererHost.app.commands.nextRunIdentity(),
      // A Session its owner ended is recorded as failed; the summary still
      // keeps what was observed. Every other status follows the typed result.
      statusForResult: (result) => result.ok && result.output.kind === 'session' && result.output.ending === 'terminated'
        ? 'failed'
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
}

export function useLabAIStudioHistoryRepository(): AIStudioHistoryRepository {
  const rendererHost = useLabRendererHost();
  return useMemo(() => createLabAIStudioHistoryRepository(rendererHost), [rendererHost]);
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
