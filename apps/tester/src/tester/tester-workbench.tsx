import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSkeleton, StatusBadge } from '@nimiplatform/kit/ui';
import { useTranslation } from '../shell/i18n/index.js';
import { NimiLabAccountMenu } from '../shell/account/account-panel.js';
import { useTesterRendererHost } from '../renderer/context.js';
import type { TesterEcosystemReferenceProjection } from '../renderer/contract.js';
import { getTesterCapability, testerCapabilities, type TesterCapabilityId } from './tester-capabilities.js';
import { shouldPersistTesterArtifactRecord } from './tester-artifact-persistence.js';
import {
  createTesterRunHistoryResultSnapshot,
  type TesterRunConfigSnapshot,
  type TesterRunHistory,
  type TesterRunHistoryRecord,
} from './tester-history.js';
import type { TesterAIConfigSummary } from './tester-ai-config.js';
import type { TesterCapabilityRunResult } from './tester-runtime.js';
import { createTesterCapabilityParameterState } from './tester-capability-parameters.js';
import type { TesterPreferences } from './tester-preferences.js';
import { AppAccessPanel } from './app-access/app-access-panel.js';
import { testerTestIds } from './tester-test-ids.js';
import { WorkbenchSideNav } from './workbench/workbench-side-nav.js';
import { SectionAITesting } from './workbench/section-ai-testing.js';
import { TesterCapabilityParameterContext, TesterHistoryLoadContext, type WorkbenchView } from './workbench/workbench-context.js';

const initialCapabilityId: TesterCapabilityId = 'text.generate';
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
  | { kind: 'save'; message: string; records: readonly TesterRunHistoryRecord[] };

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
  const [view, setView] = useState<WorkbenchView>({ kind: 'capability', capabilityId: initialCapabilityId });
  const activeCapabilityId: TesterCapabilityId = view.kind === 'capability' ? view.capabilityId : initialCapabilityId;
  const [summary, setSummary] = useState<TesterAIConfigSummary | null>(null);
  const [history, setHistory] = useState<TesterRunHistory | null>(null);
  const [historyIssue, setHistoryIssue] = useState<TesterHistoryIssue | null>(null);
  const [lastResult, setLastResult] = useState<TesterCapabilityRunResult | null>(null);
  const [capabilityParameters, setCapabilityParameters] = useState(createTesterCapabilityParameterState);
  const [historySelectionRequest, setHistorySelectionRequest] = useState<TesterHistorySelectionRequest | null>(null);
  const [preferences] = useState<TesterPreferences>(() => rendererHost.app.projection.preferences());
  const [ecosystemReference, setEcosystemReference] = useState<TesterEcosystemReferenceProjection | null>(
    () => rendererHost.app.projection.ecosystemReference(),
  );

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
    try {
      const next = await rendererHost.app.projection.runHistory();
      setHistory(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'History load failed.');
      setHistoryIssue({ kind: 'load', message });
      void rendererHost.app.commands.runtimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'history-load-failed',
        details: { error: message },
      });
    }
  }, [rendererHost]);

  const retryHistory = useCallback(async () => {
    const pending = historyIssue?.kind === 'save' ? historyIssue.records : null;
    if (!pending) {
      await refreshHistory();
      return;
    }
    setHistoryIssue(null);
    let completed = 0;
    try {
      let next: TesterRunHistory | null = null;
      for (const record of pending) {
        next = await rendererHost.app.commands.appendRunHistory(record);
        completed += 1;
      }
      if (next) setHistory(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'History persistence failed.');
      const remaining = pending.slice(completed);
      setHistoryIssue((current) => {
        const merged = new Map<string, TesterRunHistoryRecord>();
        for (const record of remaining) merged.set(record.id, record);
        if (current?.kind === 'save') {
          for (const record of current.records) merged.set(record.id, record);
        }
        return { kind: 'save', message, records: [...merged.values()] };
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
    if (!selectedCapability) return;
    setView({ kind: 'capability', capabilityId: selectedCapability.id });
    setHistorySelectionRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      record,
    }));
  }, []);

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
              : historyResult.reason === 'runtime-call-failed' ? 'failed' : 'unavailable',
        message: historyResult.message,
        createdAt,
        result: createTesterRunHistoryResultSnapshot(historyResult),
        runConfig: runConfig ? { ...runConfig, traceId } : undefined,
      };
      try {
        const next = await rendererHost.app.commands.appendRunHistory(record);
        setHistory(next);
        setHistoryIssue((current) => {
          if (!current || current.kind === 'load') return null;
          const remaining = current.records.filter((pending) => pending.id !== record.id);
          return remaining.length > 0 ? { ...current, records: remaining } : null;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'History persistence failed.');
        setHistoryIssue((current) => {
          const records = current?.kind === 'save'
            ? [...current.records.filter((pending) => pending.id !== record.id), record]
            : [record];
          return { kind: 'save', message, records };
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
            error: message,
          },
        });
        return record;
      }

      let artifactPersisted = false;
      if (shouldPersistTesterArtifactRecord(historyResult)) {
        try {
          const firstArtifact = historyResult.output.firstArtifact;
          await rendererHost.app.commands.appendImageHistory({
            id: runId,
            runId,
            kind: 'runtime-media',
            capabilityId: historyResult.capabilityId,
            capabilityLabel: historyResult.capabilityLabel,
            title: firstArtifact?.displayName || firstArtifact?.artifactId || historyResult.output.jobId || historyResult.capabilityLabel,
            status: 'ready',
            createdAt,
            artifactCount: historyResult.output.artifactCount,
            artifactLabel: firstArtifact?.displayName || firstArtifact?.artifactId,
            mimeType: firstArtifact?.mimeType,
            url: firstArtifact?.url && !firstArtifact.url.startsWith('data:') ? firstArtifact.url : undefined,
            jobId: historyResult.output.jobId,
            jobState: historyResult.output.jobState,
            message: historyResult.message,
            traceState: hasTraceMetadata(result) ? 'captured' : 'not-captured',
            traceId,
          });
          artifactPersisted = true;
        } catch (error) {
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
          onSelectCapability={(id) => setView({ kind: 'capability', capabilityId: id })}
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
                    setView({ kind: 'capability', capabilityId });
                  }}
                />
              </Suspense>
            ) : (
              <TesterCapabilityParameterContext.Provider value={capabilityParameterStore}>
                <TesterHistoryLoadContext.Provider value={historyLoadState}>
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
                </TesterHistoryLoadContext.Provider>
              </TesterCapabilityParameterContext.Provider>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
