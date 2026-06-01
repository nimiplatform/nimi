import { useCallback, useEffect, useMemo, useState } from 'react';
import './tester-workbench.css';
import { createRendererFlowId, emitRuntimeLog, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { createNimiClientId } from '@nimiplatform/sdk/runtime';
import { requestWithRetry } from '@nimiplatform/sdk/types';
import { getTesterCapability, testerCapabilities, type TesterCapabilityId } from './tester-capabilities.js';
import { shouldPersistTesterArtifactRecord } from './tester-artifact-persistence.js';
import { appendTesterRunHistory, loadTesterRunHistory, type TesterRunHistory } from './tester-history.js';
import { appendTesterImageHistoryRecord } from './tester-image-history.js';
import { loadTesterAIConfigSummary, type TesterAIConfigSummary } from './tester-ai-config.js';
import type { TesterCapabilityRunResult } from './tester-runtime.js';
import {
  loadTesterPreferences,
  resetTesterPreferences,
  saveTesterPreferences,
  type TesterPreferences,
  type TesterPreferenceStoreStatus,
} from './tester-preferences.js';
import { testerTestIds } from './tester-test-ids.js';
import { appId } from '../shell/auth/runtime-platform.js';
import { WorkbenchSideNav } from './workbench/workbench-side-nav.js';
import { SectionAITesting } from './workbench/section-ai-testing.js';
import type { WorkbenchView } from './workbench/workbench-context.js';
import { KitComponentGallery } from './kit-component-gallery.js';

const APP_VERSION = '0.1.0-dev';
const initialCapabilityId: TesterCapabilityId = 'text.generate';

type TesterWorkbenchProps = {
  title: string;
};

function makeRecordId() {
  return createNimiClientId('run');
}

function hasTraceMetadata(result: TesterCapabilityRunResult): boolean {
  if (!result.ok || !result.trace) return false;
  return Boolean(result.trace.traceId || result.trace.modelResolved || result.trace.routeDecision);
}

function getResultTraceId(result: TesterCapabilityRunResult): string | undefined {
  return result.ok ? result.trace?.traceId : undefined;
}

export function TesterWorkbench(_props: TesterWorkbenchProps) {
  const [view, setView] = useState<WorkbenchView>({ kind: 'capability', capabilityId: initialCapabilityId });
  const activeCapabilityId: TesterCapabilityId = view.kind === 'capability' ? view.capabilityId : initialCapabilityId;
  const [summary, setSummary] = useState<TesterAIConfigSummary | null>(null);
  const [history, setHistory] = useState<TesterRunHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TesterCapabilityRunResult | null>(null);
  const [preferenceState, setPreferenceState] = useState<{
    preferences: TesterPreferences;
    status: TesterPreferenceStoreStatus;
  }>(() => loadTesterPreferences());

  const capability = useMemo(() => getTesterCapability(activeCapabilityId), [activeCapabilityId]);

  const refreshHistory = useCallback(async () => {
    try {
      const next = await requestWithRetry({
        executor: loadTesterRunHistory,
        options: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 50 },
      });
      setHistory(next);
      setHistoryError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'History load failed.');
      setHistoryError(message);
      emitRuntimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'history-load-failed',
        details: { error: message },
      });
    }
  }, []);

  const refreshSummary = useCallback(async () => {
    try {
      const next = await loadTesterAIConfigSummary();
      setSummary(next);
    } catch (error) {
      setSummary({
        runtime: {
          status: 'unavailable',
          mode: 'unknown',
          detail: error instanceof Error ? error.message : String(error || 'Runtime inspection failed.'),
        },
        schedulingOwner: 'runtime',
        providerCatalogSurface: 'runtimeAdmin.listConnectors/listConnectorModels',
        appLocalProviderDefaults: false,
      });
    }
  }, []);

  useEffect(() => {
    void refreshSummary();
    void refreshHistory();
  }, [refreshSummary, refreshHistory]);

  const handleCaptureEvidence = useCallback(() => {
    if (typeof window === 'undefined') return;
    void window.print();
  }, []);

  const handlePreferenceChange = useCallback((patch: Partial<Omit<TesterPreferences, 'schemaVersion'>>) => {
    setPreferenceState((current) => saveTesterPreferences({
      ...current.preferences,
      ...patch,
    }));
  }, []);

  const handleResetPreferences = useCallback(() => {
    setPreferenceState(resetTesterPreferences());
  }, []);

  const handleCapabilityResult = useCallback(
    async (result: TesterCapabilityRunResult, prompt: string) => {
      setLastResult(result);
      const runId = makeRecordId();
      const flowId = createRendererFlowId('tester-capability-run');
      const traceId = getResultTraceId(result);
      const createdAt = new Date().toISOString();
      try {
        const next = await appendTesterRunHistory({
          id: runId,
          capabilityId: result.capabilityId,
          prompt,
          status: result.capabilityId === 'world.generate' && result.ok ? 'local-fixture' : result.ok ? 'ready' : 'unavailable',
          message: result.message,
          createdAt,
        });
        setHistory(next);
        setHistoryError(null);
        if (shouldPersistTesterArtifactRecord(result)) {
          const firstArtifact = result.output.firstArtifact;
          await appendTesterImageHistoryRecord({
            id: runId,
            runId,
            kind: 'runtime-media',
            capabilityId: result.capabilityId,
            capabilityLabel: result.capabilityLabel,
            title: firstArtifact?.displayName || firstArtifact?.artifactId || result.output.jobId || result.capabilityLabel,
            status: 'ready',
            createdAt,
            artifactCount: result.output.artifactCount,
            artifactLabel: firstArtifact?.displayName || firstArtifact?.artifactId,
            mimeType: firstArtifact?.mimeType,
            url: firstArtifact?.url,
            jobId: result.output.jobId,
            jobState: result.output.jobState,
            message: result.message,
            traceState: hasTraceMetadata(result) ? 'captured' : 'not-captured',
            traceId,
          });
        }
        logRendererEvent({
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
        logRendererEvent({
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
        setHistoryError(error instanceof Error ? error.message : String(error || 'History persistence failed.'));
      }
      if (preferenceState.preferences.evidenceCaptureMode === 'after-run') {
        handleCaptureEvidence();
      }
    },
    [handleCaptureEvidence, preferenceState.preferences.evidenceCaptureMode],
  );

  return (
    <main className="workbench" data-testid={testerTestIds.root}>
      <WorkbenchSideNav
        view={view}
        onSelectCapability={(id) => setView({ kind: 'capability', capabilityId: id })}
        onSelectRecipes={() => setView({ kind: 'ui-recipes' })}
        appId={appId}
        appVersion={APP_VERSION}
      />
      <div className="workbench__main">
        <div className="workbench__content">
          {view.kind === 'ui-recipes' ? (
            <KitComponentGallery
              onOpenSection={(target) => {
                const capabilityId = testerCapabilities.find((item) => item.id === target)?.id ?? initialCapabilityId;
                setView({ kind: 'capability', capabilityId });
              }}
            />
          ) : (
            <SectionAITesting
              capability={capability}
              onResult={handleCapabilityResult}
              onSelectCapability={(id) => setView({ kind: 'capability', capabilityId: id })}
              summary={summary}
              history={history}
              lastResult={lastResult}
              verboseConsole={preferenceState.preferences.verboseConsole}
              draftPersistence={preferenceState.preferences.draftPersistence}
            />
          )}
        </div>
      </div>
    </main>
  );
}
