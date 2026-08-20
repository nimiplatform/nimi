import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { nimiToast } from '@nimiplatform/kit/ui';

import {
  StudioCapabilityParameterContext,
  StudioHistoryActionsContext,
  StudioHistoryLoadContext,
  StudioHistoryPanelContext,
  type StudioCapabilityParameterStore,
  type StudioHistoryActions,
  type StudioHistoryLoadState,
  type StudioHistoryPanelScope,
  type StudioHistoryPanelState,
  type StudioMediaHistoryRecord,
} from './contexts.js';
import {
  createStudioRunHistoryRecord,
  type StudioRunConfigSnapshot,
  type StudioRunHistory,
  type StudioRunHistoryRecord,
} from './history.js';
import type { StudioCapabilityRegistration } from './module-registration.js';
import { createStudioNonSuccess } from './non-success-presentation.js';
import type { StudioParameterState } from './parameters.js';
import type { StudioCapabilityRunResult, StudioRuntimeInspection } from './runtime-types.js';
import { SectionAITesting } from './section-ai-testing.js';
import type { StudioAIConfigPanelRenderInput } from './section-ai-testing-surface.js';
import type { StudioTranslate } from './non-success-presentation.js';

export type AIStudioHistoryProjection = {
  readonly runHistory: StudioRunHistory;
  readonly mediaHistory: readonly StudioMediaHistoryRecord[];
};

export type AIStudioHistoryPersistOutcome =
  | { readonly ok: true; readonly projection: AIStudioHistoryProjection }
  | {
      readonly ok: false;
      readonly message: string;
      readonly retryRecord: boolean;
      readonly remainingCleanupPaths: readonly string[];
      readonly displayFailure?: { readonly reason: 'runtime-call-failed'; readonly message: string };
    };

export type AIStudioHistoryMutationIssue = {
  readonly runId: string;
  readonly step: 'asset' | 'history';
  readonly message: string;
};

export type AIStudioHistoryMutationOutcome = {
  readonly completed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly projection: AIStudioHistoryProjection;
  readonly issues: readonly AIStudioHistoryMutationIssue[];
};

export type AIStudioArtifactCleanupOutcome = {
  readonly failures: readonly string[];
  readonly remainingCleanupPaths: readonly string[];
};

export type AIStudioHistoryPanelPreferences = {
  readonly collapsed: boolean;
  readonly scope: StudioHistoryPanelScope;
  readonly hideFailures: boolean;
};

export type AIStudioHistoryRepository = {
  readonly load: () => Promise<AIStudioHistoryProjection>;
  readonly persist: (input: {
    readonly result: StudioCapabilityRunResult;
    readonly record: StudioRunHistoryRecord;
  }) => Promise<AIStudioHistoryPersistOutcome>;
  readonly appendRecord: (record: StudioRunHistoryRecord) => Promise<AIStudioHistoryProjection>;
  readonly cleanupArtifacts: (relativePaths: readonly string[]) => Promise<AIStudioArtifactCleanupOutcome>;
  readonly remove: (recordId: string, deleteAssets: boolean) => Promise<AIStudioHistoryMutationOutcome>;
  readonly clear: (capabilityId: string | null, deleteAssets: boolean) => Promise<AIStudioHistoryMutationOutcome>;
  readonly nextIdentity: () => Promise<{ readonly runId: string; readonly createdAt: string }>;
  readonly statusForResult?: (result: StudioCapabilityRunResult) => string | undefined;
  readonly loadPanelPreferences: () => AIStudioHistoryPanelPreferences;
  readonly savePanelPreferences: (preferences: AIStudioHistoryPanelPreferences) => void | Promise<void>;
};

export type AIStudioWorkspaceProps = {
  readonly registration: StudioCapabilityRegistration;
  readonly registrations: readonly StudioCapabilityRegistration[];
  readonly runtime: StudioRuntimeInspection | null;
  readonly controller: AIStudioWorkspaceController;
  readonly renderAIConfigPanel: (input: StudioAIConfigPanelRenderInput) => ReactNode;
  readonly verboseConsole?: boolean;
  readonly draftPersistence?: boolean;
  readonly headerActions?: ReactNode;
  readonly rootTestId?: string;
};

export type AIStudioWorkspaceControllerOptions = {
  readonly historyRepository: AIStudioHistoryRepository;
  readonly registrations: readonly StudioCapabilityRegistration[];
  readonly onSelectCapability: (capabilityId: string) => void;
  readonly translate: StudioTranslate;
};

export type AIStudioWorkspaceController = {
  readonly parameterStore: StudioCapabilityParameterStore;
  readonly historyLoadState: StudioHistoryLoadState;
  readonly historyActions: StudioHistoryActions;
  readonly historyPanelState: StudioHistoryPanelState;
  readonly handleResult: (
    result: StudioCapabilityRunResult,
    prompt: string,
    runConfig?: StudioRunConfigSnapshot,
  ) => Promise<StudioRunHistoryRecord>;
  readonly history: StudioRunHistory | null;
  readonly lastResult: StudioCapabilityRunResult | null;
  readonly historySelectionRequest: { readonly requestId: number; readonly record: StudioRunHistoryRecord } | null;
  readonly selectHistoryRun: (record: StudioRunHistoryRecord) => void;
};

type AIStudioHistoryIssue =
  | { readonly kind: 'load'; readonly message: string }
  | {
      readonly kind: 'save';
      readonly message: string;
      readonly records: readonly StudioRunHistoryRecord[];
      readonly cleanupPaths: readonly string[];
    };

export function useAIStudioWorkspaceController({
  historyRepository,
  registrations,
  onSelectCapability,
  translate,
}: AIStudioWorkspaceControllerOptions): AIStudioWorkspaceController {
  const [projection, setProjection] = useState<AIStudioHistoryProjection | null>(null);
  const [historyIssue, setHistoryIssue] = useState<AIStudioHistoryIssue | null>(null);
  const [lastResult, setLastResult] = useState<StudioCapabilityRunResult | null>(null);
  const [historySelectionRequest, setHistorySelectionRequest] = useState<{
    requestId: number;
    record: StudioRunHistoryRecord;
  } | null>(null);
  const [parameters, setParameters] = useState<StudioParameterState>(() => Object.freeze(Object.fromEntries(
    registrations.map((entry) => [entry.descriptor.id, entry.parameters.initial()]),
  )));
  const [historyPanel, setHistoryPanel] = useState<AIStudioHistoryPanelPreferences>(
    historyRepository.loadPanelPreferences,
  );

  const refreshHistory = useCallback(async () => {
    try {
      setProjection(await historyRepository.load());
      setHistoryIssue(null);
    } catch (error) {
      setHistoryIssue({ kind: 'load', message: errorMessage(error, 'History load failed.') });
    }
  }, [historyRepository]);

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  const parameterStore = useMemo(() => ({
    state: parameters,
    setParameters: (capabilityId: string, value: Readonly<Record<string, unknown>>) => {
      setParameters((current) => ({ ...current, [capabilityId]: value }));
    },
  }), [parameters]);

  const updateHistoryPanel = useCallback((patch: Partial<AIStudioHistoryPanelPreferences>) => {
    setHistoryPanel((current) => {
      const next = { ...current, ...patch };
      void Promise.resolve(historyRepository.savePanelPreferences(next));
      return next;
    });
  }, [historyRepository]);

  const historyActions = useMemo(() => ({
    removeRecord: async (recordId: string, deleteAssets = false) => {
      try {
        const outcome = await historyRepository.remove(recordId, deleteAssets);
        setProjection(outcome.projection);
        if (outcome.skipped > 0) nimiToast.danger(translate('History.deleteAssetFailed'));
        else if (outcome.failed > 0) nimiToast.danger(translate('History.deleteFailed'));
        else nimiToast.success(translate(deleteAssets ? 'History.deletedRecordAndAsset' : 'History.deletedRecordOnly'));
      } catch {
        await refreshHistory();
        nimiToast.danger(translate('History.deleteFailed'));
      }
    },
    clearScope: async (capabilityId: string | null, deleteAssets: boolean) => {
      try {
        const outcome = await historyRepository.clear(capabilityId, deleteAssets);
        setProjection(outcome.projection);
        nimiToast.success(deleteAssets
          ? translate('History.clearOutcome', {
              completed: outcome.completed,
              skipped: outcome.skipped,
              failed: outcome.failed,
            })
          : translate('History.clearedRecordsOnly'));
      } catch {
        await refreshHistory();
        nimiToast.danger(translate('History.clearFailed'));
      }
    },
  }), [historyRepository, refreshHistory, translate]);

  const historyPanelState = useMemo(() => ({
    ...historyPanel,
    imageRecords: projection?.mediaHistory ?? [],
    setCollapsed: (collapsed: boolean) => updateHistoryPanel({ collapsed }),
    setScope: (scope: StudioHistoryPanelScope) => updateHistoryPanel({ scope }),
    setHideFailures: (hideFailures: boolean) => updateHistoryPanel({ hideFailures }),
  }), [historyPanel, projection?.mediaHistory, updateHistoryPanel]);

  const handleResult = useCallback(async (
    result: StudioCapabilityRunResult,
    prompt: string,
    runConfig?: StudioRunConfigSnapshot,
  ) => {
    setLastResult(result);
    const identity = await historyRepository.nextIdentity();
    const status = historyRepository.statusForResult?.(result);
    const record = createStudioRunHistoryRecord({
      result,
      prompt,
      runId: identity.runId,
      createdAt: identity.createdAt,
      runConfig,
      ...(status ? { status } : {}),
    });
    let outcome: AIStudioHistoryPersistOutcome;
    try {
      outcome = await historyRepository.persist({ result, record });
    } catch (error) {
      const message = errorMessage(error, 'History persistence failed.');
      setHistoryIssue({ kind: 'save', message, records: [record], cleanupPaths: [] });
      throw new Error(message);
    }
    if (outcome.ok) {
      setProjection(outcome.projection);
      setHistoryIssue((current) => {
        if (!current || current.kind === 'load') return null;
        const records = current.records.filter((pending) => pending.id !== record.id);
        return records.length === 0 && current.cleanupPaths.length === 0
          ? null
          : { ...current, records };
      });
      return record;
    }
    if (outcome.displayFailure) {
      const capability = registrations.find((item) => item.descriptor.id === result.capabilityId)?.descriptor;
      if (capability) {
        setLastResult(createStudioNonSuccess(
          capability,
          outcome.displayFailure.reason,
          outcome.displayFailure.message,
          translate,
        ));
      }
    }
    setHistoryIssue((current) => ({
      kind: 'save',
      message: outcome.message,
      records: outcome.retryRecord
        ? [...(current?.kind === 'save' ? current.records.filter((item) => item.id !== record.id) : []), record]
        : current?.kind === 'save' ? current.records : [],
      cleanupPaths: [...new Set([
        ...(current?.kind === 'save' ? current.cleanupPaths : []),
        ...outcome.remainingCleanupPaths,
      ])],
    }));
    throw new Error(outcome.message);
  }, [historyRepository, registrations, translate]);

  const retryHistory = useCallback(async () => {
    const issue = historyIssue;
    if (!issue || issue.kind === 'load') {
      await refreshHistory();
      return;
    }
    setHistoryIssue(null);
    const cleanup = await historyRepository.cleanupArtifacts(issue.cleanupPaths);
    const retryErrors = [...cleanup.failures];
    let completed = 0;
    let nextProjection: AIStudioHistoryProjection | null = null;
    for (const record of issue.records) {
      try {
        nextProjection = await historyRepository.appendRecord(record);
        completed += 1;
      } catch (error) {
        retryErrors.push(errorMessage(error, 'History persistence failed.'));
        break;
      }
    }
    if (nextProjection) setProjection(nextProjection);
    const records = issue.records.slice(completed);
    if (retryErrors.length || records.length || cleanup.remainingCleanupPaths.length) {
      setHistoryIssue({
        kind: 'save',
        message: retryErrors.join(' ') || 'History persistence retry is incomplete.',
        records,
        cleanupPaths: cleanup.remainingCleanupPaths,
      });
    }
  }, [historyIssue, historyRepository, refreshHistory]);

  const selectHistoryRun = useCallback((record: StudioRunHistoryRecord) => {
    if (!registrations.some((entry) => entry.descriptor.id === record.capabilityId)) {
      nimiToast.warning(translate('History.unsupportedCapability'));
      return;
    }
    onSelectCapability(record.capabilityId);
    setHistorySelectionRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      record,
    }));
  }, [onSelectCapability, registrations, translate]);

  return {
    parameterStore,
    historyLoadState: {
      title: translate(historyIssue?.kind === 'save' ? 'History.saveFailedTitle' : 'History.loadFailedTitle'),
      error: historyIssue?.message ?? null,
      retry: () => { void retryHistory(); },
    },
    historyActions,
    historyPanelState,
    handleResult,
    history: projection?.runHistory ?? null,
    lastResult,
    historySelectionRequest,
    selectHistoryRun,
  };
}

export function AIStudioWorkspace({
  registration,
  registrations,
  runtime,
  controller,
  renderAIConfigPanel,
  verboseConsole = false,
  draftPersistence = true,
  headerActions,
  rootTestId,
}: AIStudioWorkspaceProps) {
  return (
    <StudioCapabilityParameterContext.Provider value={controller.parameterStore}>
      <StudioHistoryLoadContext.Provider value={controller.historyLoadState}>
        <StudioHistoryActionsContext.Provider value={controller.historyActions}>
          <StudioHistoryPanelContext.Provider value={controller.historyPanelState}>
            <SectionAITesting
              registration={registration}
              registrations={registrations}
              runtime={runtime}
              onResult={controller.handleResult}
              history={controller.history}
              lastResult={controller.lastResult}
              historySelectionRequest={controller.historySelectionRequest}
              onSelectHistoryRun={controller.selectHistoryRun}
              verboseConsole={verboseConsole}
              draftPersistence={draftPersistence}
              headerActions={headerActions}
              renderAIConfigPanel={renderAIConfigPanel}
              rootTestId={rootTestId}
            />
          </StudioHistoryPanelContext.Provider>
        </StudioHistoryActionsContext.Provider>
      </StudioHistoryLoadContext.Provider>
    </StudioCapabilityParameterContext.Provider>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}
