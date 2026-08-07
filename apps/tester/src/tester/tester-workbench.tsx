import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
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
import type { TesterPreferences } from './tester-preferences.js';
import { Imp4AppAccessPanel } from './imp4-app-access-panel.js';
import { testerTestIds } from './tester-test-ids.js';
import { WorkbenchSideNav } from './workbench/workbench-side-nav.js';
import { SectionAITesting } from './workbench/section-ai-testing.js';
import type { WorkbenchView } from './workbench/workbench-context.js';

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

function hasTraceMetadata(result: TesterCapabilityRunResult): boolean {
  if (!result.ok || !result.trace) return false;
  return Boolean(result.trace.traceId || result.trace.simulated);
}

function getResultTraceId(result: TesterCapabilityRunResult): string | undefined {
  return result.ok ? result.trace?.traceId : undefined;
}

export function TesterWorkbench(_props: TesterWorkbenchProps) {
  const rendererHost = useTesterRendererHost();
  const [view, setView] = useState<WorkbenchView>({ kind: 'capability', capabilityId: initialCapabilityId });
  const activeCapabilityId: TesterCapabilityId = view.kind === 'capability' ? view.capabilityId : initialCapabilityId;
  const [summary, setSummary] = useState<TesterAIConfigSummary | null>(null);
  const [history, setHistory] = useState<TesterRunHistory | null>(null);
  const [lastResult, setLastResult] = useState<TesterCapabilityRunResult | null>(null);
  const [historySelectionRequest, setHistorySelectionRequest] = useState<TesterHistorySelectionRequest | null>(null);
  const [preferences] = useState<TesterPreferences>(() => rendererHost.app.projection.preferences());
  const [ecosystemReference, setEcosystemReference] = useState<TesterEcosystemReferenceProjection | null>(
    () => rendererHost.app.projection.ecosystemReference(),
  );

  const capability = useMemo(() => getTesterCapability(activeCapabilityId), [activeCapabilityId]);

  const refreshHistory = useCallback(async () => {
    try {
      const next = await rendererHost.app.projection.runHistory();
      setHistory(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'History load failed.');
      rendererHost.app.commands.runtimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'history-load-failed',
        details: { error: message },
      });
    }
  }, [rendererHost]);

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
    const selectedCapability = testerCapabilities.find((item) => item.id === capabilityId && item.execution === 'runtime-sdk');
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
            : historyResult.ok ? 'ready' : 'unavailable',
        message: historyResult.message,
        createdAt,
        result: createTesterRunHistoryResultSnapshot(historyResult),
        runConfig: runConfig ? { ...runConfig, traceId } : undefined,
      };
      try {
        const next = await rendererHost.app.commands.appendRunHistory(record);
        setHistory(next);
        if (shouldPersistTesterArtifactRecord(historyResult)) {
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
        }
        rendererHost.app.commands.rendererLog({
          level: result.ok ? 'info' : 'warn',
          area: 'tester.capability-run',
          message: result.ok ? 'action:tester-capability-run:recorded' : 'action:tester-capability-run:unavailable',
          flowId,
          traceId,
          details: {
            runId,
            capabilityId: result.capabilityId,
            status: result.ok ? 'ready' : 'unavailable',
            artifactPersisted: shouldPersistTesterArtifactRecord(result),
            traceState: hasTraceMetadata(result) ? 'captured' : 'not-captured',
          },
        });
      } catch (error) {
        rendererHost.app.commands.rendererLog({
          level: 'error',
          area: 'tester.capability-run',
          message: 'action:tester-capability-run:persistence-failed',
          flowId,
          traceId,
          details: {
            runId,
            capabilityId: result.capabilityId,
            error: error instanceof Error ? error.message : String(error || 'History persistence failed.'),
          },
        });
      }
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
          accountSlot={(
            <NimiLabAccountMenu onOpenSettings={() => setView({ kind: 'settings' })} />
          )}
        />
        <div className="workbench__main">
          <Imp4AppAccessPanel />
          <div className="workbench__content">
            {view.kind === 'settings' ? (
              <Suspense fallback={null}>
                <SettingsRoute />
              </Suspense>
            ) : view.kind === 'ui-recipes' ? (
              <Suspense fallback={null}>
                <KitComponentGallery
                  onOpenSection={(target) => {
                    const capabilityId = testerCapabilities.find((item) => item.id === target)?.id ?? initialCapabilityId;
                    setView({ kind: 'capability', capabilityId });
                  }}
                />
              </Suspense>
            ) : (
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
                      <output
                        role="status"
                        data-nimi-semantic-id="tester-ecosystem-reference"
                        data-ecosystem-revision={ecosystemReference.ecosystemRevision}
                        className="workbench-topbar__attachment workbench-topbar__attachment--success"
                      >
                        Ecosystem revision {ecosystemReference.ecosystemRevision}
                      </output>
                    ) : null}
                  </>
                )}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
