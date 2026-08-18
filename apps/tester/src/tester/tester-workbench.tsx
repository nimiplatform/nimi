import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSkeleton, nimiToast, StatusBadge } from '@nimiplatform/kit/ui';
import { useTranslation } from '../shell/i18n/index.js';
import { NimiLabAccountMenu } from '../shell/account/account-panel.js';
import { useTesterRendererHost } from '../renderer/context.js';
import type { TesterEcosystemReferenceProjection } from '../renderer/contract.js';
import { getTesterCapability, testerCapabilities, type TesterCapabilityId } from './tester-capabilities.js';
import {
  cleanupTesterManagedArtifactPaths,
  persistTesterRunHistoryWithArtifactCompensation,
  settleTesterHistorySaveIssueAfterPersistedRun,
  shouldPersistTesterArtifactRecord,
} from './tester-artifact-persistence.js';
import type { TesterImageHistoryRecord } from './tester-image-history.js';
import {
  createTesterRunHistoryResultSnapshot,
  type TesterRunConfigSnapshot,
  type TesterRunHistory,
  type TesterRunHistoryRecord,
} from './tester-history.js';
import type { TesterAIConfigSummary } from './tester-ai-config.js';
import type { TesterCapabilityRunResult } from './tester-runtime.js';
import { capabilityUnavailable } from './tester-unavailable.js';
import {
  clearTesterManagedHistoryScope,
  deleteTesterManagedHistoryRecord,
  reconcileTesterManagedHistoryProjection,
} from './tester-managed-history.js';
import { createTesterCapabilityParameterState } from './tester-capability-parameters.js';
import type { TesterPreferences } from './tester-preferences.js';
import { AppAccessPanel } from './app-access/app-access-panel.js';
import { testerTestIds } from './tester-test-ids.js';
import { WorkbenchSideNav } from './workbench/workbench-side-nav.js';
import { SectionAITesting } from './workbench/section-ai-testing.js';
import { TesterCapabilityParameterContext, TesterHistoryActionsContext, TesterHistoryLoadContext, TesterHistoryPanelContext, type TesterHistoryPanelState, type WorkbenchView } from './workbench/workbench-context.js';

const initialCapabilityId: TesterCapabilityId = 'text.generate';

function restoredInitialCapabilityId(preferences: TesterPreferences): TesterCapabilityId {
  const saved = preferences.lastCapabilityId;
  if (!saved) return initialCapabilityId;
  return testerCapabilities.some((item) => item.id === saved) ? saved as TesterCapabilityId : initialCapabilityId;
}
const SettingsRoute = lazy(async () => ({
  default: (await import('../shell/routes/settings-route.js')).SettingsRoute,
}));
const KitComponentGallery = lazy(async () => ({
  default: (await import('./kit-component-gallery.js')).KitComponentGallery,
}));

type TesterWorkbenchProps = {
  title: string;
};

type TesterHistorySelectionRequest = {
  requestId: number;
  record: TesterRunHistoryRecord;
};

type TesterHistoryIssue =
  | { kind: 'load'; message: string }
  | {
      kind: 'save';
      message: string;
      records: readonly TesterRunHistoryRecord[];
      cleanupPaths: readonly string[];
    };

function hasTraceMetadata(result: TesterCapabilityRunResult): boolean {
  if (!result.ok || !result.trace) return false;
  return Boolean(result.trace.traceId || result.trace.simulated);
}

function getResultTraceId(result: TesterCapabilityRunResult): string | undefined {
  return result.ok ? result.trace?.traceId : undefined;
}

export function TesterWorkbench(_props: TesterWorkbenchProps) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<TesterPreferences>(() => rendererHost.app.projection.preferences());
  const [view, setView] = useState<WorkbenchView>(() => ({
    kind: 'capability',
    capabilityId: restoredInitialCapabilityId(rendererHost.app.projection.preferences()),
  }));
  const activeCapabilityId: TesterCapabilityId = view.kind === 'capability' ? view.capabilityId : initialCapabilityId;
  const [summary, setSummary] = useState<TesterAIConfigSummary | null>(null);
  const [history, setHistory] = useState<TesterRunHistory | null>(null);
  const [imageHistory, setImageHistory] = useState<readonly TesterImageHistoryRecord[]>([]);
  const [historyIssue, setHistoryIssue] = useState<TesterHistoryIssue | null>(null);
  const [lastResult, setLastResult] = useState<TesterCapabilityRunResult | null>(null);
  const [capabilityParameters, setCapabilityParameters] = useState(createTesterCapabilityParameterState);
  const [historySelectionRequest, setHistorySelectionRequest] = useState<TesterHistorySelectionRequest | null>(null);
  const [ecosystemReference, setEcosystemReference] = useState<TesterEcosystemReferenceProjection | null>(
    () => rendererHost.app.projection.ecosystemReference(),
  );
  const managedHistoryPort = useMemo(() => ({
    loadRunHistory: () => rendererHost.app.projection.runHistory(),
    loadImageHistory: () => rendererHost.app.projection.imageHistory(),
    removeAsset: (relativePath: string) => rendererHost.sdk.storage.assets.remove(relativePath),
    removeRunHistory: (runId: string) => rendererHost.app.commands.removeRunHistory(runId),
    removeImageHistory: (runId: string) => rendererHost.app.commands.removeImageHistory(runId),
    clearRunHistory: (capabilityId?: string) => rendererHost.app.commands.clearRunHistory(capabilityId ? { capabilityId } : {}),
    clearImageHistory: (capabilityId?: string) => rendererHost.app.commands.clearImageHistory(capabilityId ? { capabilityId } : {}),
  }), [rendererHost]);
  const reconcileManagedHistory = useCallback((
    runHistory: TesterRunHistory,
    storedImageHistory: readonly TesterImageHistoryRecord[],
  ) => reconcileTesterManagedHistoryProjection(
    runHistory,
    storedImageHistory,
    (relativePath) => rendererHost.sdk.storage.assets.stat(relativePath),
  ), [rendererHost]);

  const updatePreferences = useCallback((patch: Partial<TesterPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      void rendererHost.app.commands.savePreferences(next).catch((error: unknown) => {
        void rendererHost.app.commands.runtimeLog({
          level: 'warn',
          area: 'tester-preferences',
          message: 'preferences-save-failed',
          details: { error: error instanceof Error ? error.message : String(error || 'Preferences save failed.') },
        });
      });
      return next;
    });
  }, [rendererHost]);

  const selectCapabilityView = useCallback((capabilityId: TesterCapabilityId) => {
    setView({ kind: 'capability', capabilityId });
    updatePreferences({ lastCapabilityId: capabilityId });
  }, [updatePreferences]);

  const historyPanelState = useMemo<TesterHistoryPanelState>(() => ({
    collapsed: preferences.historyPanel.collapsed,
    scope: preferences.historyPanel.scope,
    hideFailures: preferences.historyPanel.hideFailures,
    imageRecords: imageHistory,
    setCollapsed: (collapsed) => updatePreferences({ historyPanel: { ...preferences.historyPanel, collapsed } }),
    setScope: (scope) => updatePreferences({ historyPanel: { ...preferences.historyPanel, scope } }),
    setHideFailures: (hideFailures) => updatePreferences({ historyPanel: { ...preferences.historyPanel, hideFailures } }),
  }), [imageHistory, preferences.historyPanel, updatePreferences]);

  const capability = useMemo(() => getTesterCapability(activeCapabilityId), [activeCapabilityId]);
  const capabilityParameterStore = useMemo(() => ({
    state: capabilityParameters,
    setParameters: <TCapabilityId extends TesterCapabilityId,>(
      capabilityId: TCapabilityId,
      parameters: typeof capabilityParameters[TCapabilityId],
    ) => setCapabilityParameters((current) => ({ ...current, [capabilityId]: parameters })),
  }), [capabilityParameters]);

  const refreshHistory = useCallback(async () => {
    setHistoryIssue(null);
    let nextRunHistory: TesterRunHistory;
    try {
      nextRunHistory = await rendererHost.app.projection.runHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'History load failed.');
      setHistoryIssue({ kind: 'load', message });
      void rendererHost.app.commands.runtimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'history-load-failed',
        details: { error: message },
      });
      return;
    }
    let storedImageHistory: readonly TesterImageHistoryRecord[] = [];
    try {
      storedImageHistory = await rendererHost.app.projection.imageHistory();
    } catch (error) {
      void rendererHost.app.commands.runtimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'image-history-load-failed',
        details: { error: error instanceof Error ? error.message : String(error || 'Image history load failed.') },
      });
    }
    const projection = await reconcileManagedHistory(nextRunHistory, storedImageHistory);
    setHistory(projection.runHistory);
    setImageHistory(projection.imageHistory);
  }, [reconcileManagedHistory, rendererHost]);

  const removeHistoryRecord = useCallback(async (recordId: string, deleteAsset = false) => {
    try {
      const outcome = await deleteTesterManagedHistoryRecord(managedHistoryPort, recordId, deleteAsset);
      const projection = await reconcileManagedHistory(outcome.runHistory, outcome.imageHistory);
      setHistory(projection.runHistory);
      setImageHistory(projection.imageHistory);
      if (outcome.skipped > 0) {
        nimiToast.danger(t('History.deleteAssetFailed'));
      } else if (outcome.failed > 0) {
        nimiToast.danger(t('History.deleteFailed'));
      } else {
        nimiToast.success(t(deleteAsset ? 'History.deletedRecordAndAsset' : 'History.deletedRecordOnly'));
      }
      for (const issue of outcome.issues) {
        void rendererHost.app.commands.runtimeLog({
          level: 'warn',
          area: 'tester-history',
          message: issue.step === 'asset' ? 'history-remove-asset-failed' : 'history-remove-failed',
          details: { recordId: issue.runId, error: issue.message },
        });
      }
    } catch (error) {
      await refreshHistory();
      nimiToast.danger(t('History.deleteFailed'));
      void rendererHost.app.commands.runtimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'history-remove-failed',
        details: { recordId, error: error instanceof Error ? error.message : String(error || 'History remove failed.') },
      });
    }
  }, [managedHistoryPort, reconcileManagedHistory, refreshHistory, rendererHost, t]);

  const clearHistoryScope = useCallback(async (capabilityId: string | null, deleteAssets: boolean) => {
    try {
      const outcome = await clearTesterManagedHistoryScope(managedHistoryPort, capabilityId, deleteAssets);
      const projection = await reconcileManagedHistory(outcome.runHistory, outcome.imageHistory);
      setHistory(projection.runHistory);
      setImageHistory(projection.imageHistory);
      for (const issue of outcome.issues) {
        void rendererHost.app.commands.runtimeLog({
          level: 'warn',
          area: 'tester-history',
          message: issue.step === 'asset' ? 'history-clear-asset-skipped' : 'history-clear-record-failed',
          details: { runId: issue.runId, error: issue.message },
        });
      }
      nimiToast.success(deleteAssets
        ? t('History.clearOutcome', { completed: outcome.completed, skipped: outcome.skipped, failed: outcome.failed })
        : t('History.clearedRecordsOnly'));
    } catch (error) {
      await refreshHistory();
      nimiToast.danger(t('History.clearFailed'));
      void rendererHost.app.commands.runtimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'history-clear-failed',
        details: { capabilityId, error: error instanceof Error ? error.message : String(error || 'History clear failed.') },
      });
    }
  }, [managedHistoryPort, reconcileManagedHistory, refreshHistory, rendererHost, t]);

  const historyActions = useMemo(() => ({
    removeRecord: removeHistoryRecord,
    clearScope: clearHistoryScope,
  }), [removeHistoryRecord, clearHistoryScope]);

  const retryHistory = useCallback(async () => {
    const pending = historyIssue?.kind === 'save' ? historyIssue.records : null;
    const pendingCleanupPaths = historyIssue?.kind === 'save' ? historyIssue.cleanupPaths : null;
    if (!pending) {
      await refreshHistory();
      return;
    }
    setHistoryIssue(null);
    const cleanup = await cleanupTesterManagedArtifactPaths(
      pendingCleanupPaths ?? [],
      (relativePath) => rendererHost.sdk.storage.assets.remove(relativePath),
    );
    const remainingCleanupPaths = cleanup.remainingCleanupPaths;
    const retryErrors = [...cleanup.failures];
    let completed = 0;
    let next: TesterRunHistory | null = null;
    for (const record of pending) {
      try {
        next = await rendererHost.app.commands.appendRunHistory(record);
        completed += 1;
      } catch (error) {
        retryErrors.push(error instanceof Error ? error.message : String(error || 'History persistence failed.'));
        break;
      }
    }
    if (next) setHistory(next);
    const remaining = pending.slice(completed);
    if (retryErrors.length > 0 || remaining.length > 0 || remainingCleanupPaths.length > 0) {
      const message = retryErrors.join(' ') || 'History persistence retry is incomplete.';
      setHistoryIssue((current) => {
        const merged = new Map<string, TesterRunHistoryRecord>();
        for (const record of remaining) merged.set(record.id, record);
        if (current?.kind === 'save') {
          for (const record of current.records) merged.set(record.id, record);
        }
        const cleanupPaths = [...new Set([
          ...remainingCleanupPaths,
          ...(current?.kind === 'save' ? current.cleanupPaths : []),
        ])];
        return { kind: 'save', message, records: [...merged.values()], cleanupPaths };
      });
    }
  }, [historyIssue, refreshHistory, rendererHost]);

  const historyLoadState = useMemo(() => ({
    title: t(historyIssue?.kind === 'save' ? 'History.saveFailedTitle' : 'History.loadFailedTitle'),
    error: historyIssue?.message ?? null,
    retry: () => { void retryHistory(); },
  }), [historyIssue, retryHistory, t]);

  const refreshSummary = useCallback(async () => {
    try {
      const next = await rendererHost.app.projection.aiConfigSummary();
      setSummary(next);
    } catch (error) {
      setSummary({
        runtime: {
          status: 'unavailable',
          mode: 'unknown',
          detail: error instanceof Error ? error.message : String(error || 'Runtime inspection failed.'),
        },
      });
    }
  }, [rendererHost]);

  useEffect(() => {
    void refreshSummary();
    void refreshHistory();
  }, [refreshSummary, refreshHistory, rendererHost]);

  useEffect(() => rendererHost.app.events.subscribe(
    'tester.ecosystem.reference-updated',
    (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const reference = payload as Partial<TesterEcosystemReferenceProjection>;
      if (!Number.isSafeInteger(reference.ecosystemRevision)) return;
      setEcosystemReference(reference as TesterEcosystemReferenceProjection);
    },
  ), [rendererHost]);

  const handleSelectHistoryRun = useCallback((record: TesterRunHistoryRecord) => {
    const capabilityId = record.capabilityId as TesterCapabilityId;
    const selectedCapability = testerCapabilities.find((item) => (
      item.id === capabilityId
      && (item.execution === 'runtime-sdk' || item.execution === 'standalone-tauri')
    ));
    if (!selectedCapability) {
      nimiToast.warning(t('History.unsupportedCapability'));
      return;
    }
    selectCapabilityView(selectedCapability.id);
    setHistorySelectionRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      record,
    }));
  }, [selectCapabilityView, t]);

  const handleCapabilityResult = useCallback(
    async (
      result: TesterCapabilityRunResult,
      prompt: string,
      runConfig?: TesterRunConfigSnapshot,
    ): Promise<TesterRunHistoryRecord> => {
      setLastResult(result);
      const identity = await rendererHost.app.commands.nextRunIdentity();
      const runId = identity.runId;
      const flowId = rendererHost.scope.globalName(`tester-capability-run-${runId}`);
      const traceId = getResultTraceId(result);
      const createdAt = identity.createdAt;
      const historyResult = result;
      const record: TesterRunHistoryRecord = {
        id: runId,
        capabilityId: historyResult.capabilityId,
        prompt,
        status: historyResult.capabilityId === 'world.generate' && historyResult.ok
          ? 'local-fixture'
          : historyResult.ok && historyResult.trace?.simulated
            ? 'simulated'
            : historyResult.ok
              ? 'ready'
              : historyResult.reason === 'runtime-canceled'
                ? 'canceled'
                : historyResult.reason === 'runtime-call-failed' ? 'failed' : 'unavailable',
        message: historyResult.message,
        createdAt,
        result: createTesterRunHistoryResultSnapshot(historyResult),
        runConfig: runConfig ? { ...runConfig, traceId } : undefined,
      };
      const persistedRun = await persistTesterRunHistoryWithArtifactCompensation(
        historyResult,
        () => rendererHost.app.commands.appendRunHistory(record),
        (relativePath) => rendererHost.sdk.storage.assets.remove(relativePath),
      );
      if (persistedRun.ok) {
        setHistory(persistedRun.value);
        setHistoryIssue((current) => {
          if (!current || current.kind === 'load') return null;
          const remaining = settleTesterHistorySaveIssueAfterPersistedRun(current, record.id);
          return remaining ? { kind: 'save', ...remaining } : null;
        });
      } else {
        const managedArtifactResult = shouldPersistTesterArtifactRecord(historyResult);
        if (persistedRun.displayFailure) {
          setLastResult(capabilityUnavailable(
            getTesterCapability(historyResult.capabilityId as TesterCapabilityId),
            persistedRun.displayFailure.reason,
            persistedRun.displayFailure.message,
          ));
        }
        setHistoryIssue((current) => {
          const previous = current?.kind === 'save'
            ? current.records.filter((pending) => pending.id !== record.id)
            : [];
          const records = managedArtifactResult ? previous : [...previous, record];
          const cleanupPaths = [...new Set([
            ...(current?.kind === 'save' ? current.cleanupPaths : []),
            ...persistedRun.remainingCleanupPaths,
          ])];
          return { kind: 'save', message: persistedRun.message, records, cleanupPaths };
        });
        void rendererHost.app.commands.rendererLog({
          level: 'error',
          area: 'tester.capability-run',
          message: 'action:tester-capability-run:history-persistence-failed',
          flowId,
          traceId,
          details: {
            runId,
            capabilityId: result.capabilityId,
            error: persistedRun.message,
            managedArtifactCleanup: persistedRun.managedArtifactCleanup,
            remainingCleanupPaths: persistedRun.remainingCleanupPaths,
          },
        });
        throw new Error(persistedRun.message);
      }

      let artifactPersisted = false;
      if (shouldPersistTesterArtifactRecord(historyResult)) {
        try {
          let nextImageHistory = imageHistory;
          for (const [index, artifact] of historyResult.output.artifacts.entries()) {
            nextImageHistory = await rendererHost.app.commands.appendImageHistory({
              id: index === 0 ? runId : `${runId}:${index}`,
              runId,
              kind: 'runtime-media',
              capabilityId: historyResult.capabilityId,
              capabilityLabel: historyResult.capabilityLabel,
              title: artifact.displayName || artifact.relativePath || historyResult.output.jobId || historyResult.capabilityLabel,
              status: 'ready',
              createdAt,
              artifactCount: historyResult.output.artifactCount,
              artifactLabel: artifact.displayName || artifact.relativePath,
              relativePath: artifact.relativePath,
              mediaType: artifact.mediaType,
              sizeBytes: artifact.sizeBytes,
              sha256: artifact.sha256,
              jobId: historyResult.output.jobId,
              jobState: historyResult.output.jobState,
              message: historyResult.message,
              traceState: hasTraceMetadata(result) ? 'captured' : 'not-captured',
              traceId,
            });
          }
          setImageHistory(nextImageHistory);
          artifactPersisted = true;
        } catch (error) {
          let storedImageHistory: readonly TesterImageHistoryRecord[] = [];
          try {
            storedImageHistory = await rendererHost.app.projection.imageHistory();
          } catch {
            // Canonical run history below remains sufficient to derive every artifact row.
          }
          const projection = await reconcileTesterManagedHistoryProjection(
            persistedRun.value,
            storedImageHistory,
            (relativePath) => rendererHost.sdk.storage.assets.stat(relativePath),
          );
          setHistory(projection.runHistory);
          setImageHistory(projection.imageHistory);
          void rendererHost.app.commands.rendererLog({
            level: 'error',
            area: 'tester.capability-run',
            message: 'action:tester-capability-run:artifact-index-persistence-failed',
            flowId,
            traceId,
            details: {
              runId,
              capabilityId: result.capabilityId,
              error: error instanceof Error ? error.message : String(error || 'Artifact index persistence failed.'),
            },
          });
        }
      }

      void rendererHost.app.commands.rendererLog({
        level: result.ok ? 'info' : 'warn',
        area: 'tester.capability-run',
        message: result.ok
          ? 'action:tester-capability-run:recorded'
          : record.status === 'failed'
            ? 'action:tester-capability-run:failed'
            : record.status === 'canceled'
              ? 'action:tester-capability-run:canceled'
            : 'action:tester-capability-run:unavailable',
        flowId,
        traceId,
        details: {
          runId,
          capabilityId: result.capabilityId,
          status: record.status,
          artifactPersisted,
          traceState: hasTraceMetadata(result) ? 'captured' : 'not-captured',
        },
      });
      return record;
    },
    [rendererHost],
  );

  return (
    <main className="workbench" data-testid={testerTestIds.root}>
      <div className="workbench__body">
        <WorkbenchSideNav
          view={view}
          onSelectCapability={selectCapabilityView}
          onSelectRecipes={() => setView({ kind: 'ui-recipes' })}
          onSelectAppAccess={() => setView({ kind: 'app-access' })}
          accountSlot={(
            <NimiLabAccountMenu onOpenSettings={() => setView({ kind: 'settings' })} />
          )}
        />
        <div className="workbench__main">
          <div className="workbench__content">
            {view.kind === 'settings' ? (
              <Suspense fallback={(
                <div className="flex h-full items-center justify-center p-6">
                  <LoadingSkeleton lines={4} className="w-full max-w-md" />
                </div>
              )}>
                <SettingsRoute />
              </Suspense>
            ) : view.kind === 'app-access' ? (
              <AppAccessPanel />
            ) : view.kind === 'ui-recipes' ? (
              <Suspense fallback={(
                <div className="flex h-full items-center justify-center p-6">
                  <LoadingSkeleton lines={4} className="w-full max-w-md" />
                </div>
              )}>
                <KitComponentGallery
                  onOpenSection={(target) => {
                    const capabilityId = testerCapabilities.find((item) => item.id === target)?.id ?? initialCapabilityId;
                    selectCapabilityView(capabilityId);
                  }}
                />
              </Suspense>
            ) : (
              <TesterCapabilityParameterContext.Provider value={capabilityParameterStore}>
                <TesterHistoryLoadContext.Provider value={historyLoadState}>
                  <TesterHistoryActionsContext.Provider value={historyActions}>
                    <TesterHistoryPanelContext.Provider value={historyPanelState}>
                      <SectionAITesting
                      capability={capability}
                      onResult={handleCapabilityResult}
                      summary={summary}
                      history={history}
                      lastResult={lastResult}
                      historySelectionRequest={historySelectionRequest}
                      onSelectHistoryRun={handleSelectHistoryRun}
                      verboseConsole={preferences.verboseConsole}
                      draftPersistence={preferences.draftPersistence}
                      headerActions={(
                        <>
                          {ecosystemReference ? (
                            <StatusBadge
                              tone="success"
                              shape="dot"
                              data-nimi-semantic-id="tester-ecosystem-reference"
                              data-ecosystem-revision={ecosystemReference.ecosystemRevision}
                            >
                              {t('WorkbenchTop.ecosystemRevision', { revision: ecosystemReference.ecosystemRevision })}
                            </StatusBadge>
                          ) : null}
                        </>
                      )}
                      />
                    </TesterHistoryPanelContext.Provider>
                  </TesterHistoryActionsContext.Provider>
                </TesterHistoryLoadContext.Provider>
              </TesterCapabilityParameterContext.Provider>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
