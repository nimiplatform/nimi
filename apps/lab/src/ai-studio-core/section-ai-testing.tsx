import { Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconButton, LoadingSkeleton, nimiToast, OverlayShell, StatusBadge, Tooltip } from '@nimiplatform/kit/ui';
import { PanelRight, SquarePen } from 'lucide-react';
import { createBrowserDataUrlAttachmentAdapter, useChatComposer, type BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { useAIStudioHost } from './host-context.js';
import type { StudioCapabilityRegistration } from './module-registration.js';
import type { StudioCapabilityRunResult, StudioRuntimeInspection } from './runtime-types.js';
import { getStudioRunIntentLabel, restoreStudioCapabilityRunResult, type StudioRunConfigSnapshot, type StudioRunHistory, type StudioRunHistoryRecord } from './history.js';
import { CapabilityRunHistory, DrawerErrorBoundary, downloadTextFile, resultPlainText, statusForCapability, type CapabilityStatus, type SectionAITestingProps } from './section-ai-testing-surface.js';
import { TextStudioComposer, TextStudioStartState } from './section-ai-testing-composer.js';
import { hasStudioCapabilityRunInput } from './section-ai-testing-input.js';
import { TextStudioResultState } from './section-ai-testing-result.js';
import { canConfigureRunTarget, createRunConfigSnapshot, effectiveTextStudioPromptStyle, textStudioDirectiveForTarget, textStudioRunTargetIntentSummary, textStudioRuntimePrompt, useStudioRunTargetSummary, type TextStudioActiveRun } from './section-ai-testing-run.js';
import { StudioCapabilityParameterContext, StudioHistoryLoadContext, StudioHistoryPanelContext } from './contexts.js';

// Admission pill labels are keyed by the typed status so locale changes do not
// touch the admission state machine in section-ai-testing-admission.ts.
const ADMISSION_STATUS_LABEL_KEY: Partial<Record<CapabilityStatus['label'], string>> = {
  configured: 'StudioShell.statusConfigured',
  blocked: 'StudioShell.statusBlocked',
  'not admitted': 'StudioShell.statusNotAdmitted',
  'SDK gap': 'StudioShell.statusSdkGap',
  checking: 'StudioShell.statusChecking',
};

function TextStudioShell({
  registration,
  registrations,
  runtime,
  lastResult,
  onResult,
  verboseConsole,
  draftPersistence,
  onOpenConfig,
  history,
  historySelectionRequest,
  onSelectHistoryRun,
  headerActions,
}: {
  registration: StudioCapabilityRegistration;
  registrations: readonly StudioCapabilityRegistration[];
  runtime: StudioRuntimeInspection | null;
  lastResult: StudioCapabilityRunResult | null;
  onResult: (result: StudioCapabilityRunResult, prompt: string, runConfig?: StudioRunConfigSnapshot) => StudioRunHistoryRecord | null | Promise<StudioRunHistoryRecord | null>;
  verboseConsole: boolean;
  draftPersistence: boolean;
  onOpenConfig?: () => void;
  history: StudioRunHistory | null;
  historySelectionRequest: { requestId: number; record: StudioRunHistoryRecord } | null;
  onSelectHistoryRun: (record: StudioRunHistoryRecord) => void;
  headerActions?: ReactNode;
}) {
  const rendererHost = useAIStudioHost();
  const t = rendererHost.translate;
  const capability = registration.descriptor;
  const historyLoad = useContext(StudioHistoryLoadContext);
  const parameterStore = useContext(StudioCapabilityParameterContext);
  const ParameterPanel = registration.parameterPanel;
  const profile = registration.profile;
  const preset = registration.preset;
  const [prompt, setPrompt] = useState(() => (
    rendererHost.app.projection.promptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence).prompt ?? preset.prompt
  ));
  const [context, setContext] = useState('');
  const [running, setRunning] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<TextStudioActiveRun | null>(null);
  const [sessionRuns, setSessionRuns] = useState<Record<string, TextStudioActiveRun>>({});
  const historyPanel = useContext(StudioHistoryPanelContext);
  const historyCollapsed = historyPanel?.collapsed ?? true;
  const runSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const expandedHistoryErrorRef = useRef<string | null>(null);
  const attachmentAdapter = useMemo(
    () => createBrowserDataUrlAttachmentAdapter({ idPrefix: 'studio-attachment' }),
    [],
  );
  const composerState = useChatComposer<BrowserDataUrlAttachment>({
    adapter: { submit: async () => {} },
    attachmentAdapter,
    text: prompt,
    onTextChange: updatePrompt,
    disabled: running,
  });
  const hasActiveRun = Boolean(activeRun);
  const currentResult = activeRun
    ? activeRun.result ?? (activeRun.record
      ? restoreStudioCapabilityRunResult(activeRun.record, (id) => (
        registrations.find((item) => item.descriptor.id === id)?.descriptor.label ?? null
      ))
      : null)
    : lastResult?.capabilityId === capability.id ? lastResult : null;
  const headerResult = hasActiveRun ? currentResult : null;
  const runTarget = useStudioRunTargetSummary(registration, runtime);
  const admission = statusForCapability(registration, runTarget, headerResult, t);
  const requiresPrompt = profile.inputKind !== 'none';
  const supportsMedia = profile.supportsAttachments;
  const capabilityParameters = parameterStore?.state[capability.id] ?? registration.parameters.initial();
  const effectiveCapabilityParameters = useMemo(() => registration.parameters.project(
    runTarget.source,
    capabilityParameters,
  ), [capabilityParameters, registration.parameters, runTarget.source]);
  const parameterSummary = registration.parameters.summarize(effectiveCapabilityParameters);
  const hasAlternativeInput = registration.parameters.hasAlternativeInput(capabilityParameters);

  useEffect(() => {
    const error = historyLoad?.error ?? null;
    if (!error) {
      expandedHistoryErrorRef.current = null;
      return;
    }
    if (expandedHistoryErrorRef.current === error) return;
    expandedHistoryErrorRef.current = error;
    historyPanel?.setCollapsed(false);
  }, [historyLoad?.error, historyPanel]);

  function updatePrompt(nextPrompt: string) {
    setPrompt(nextPrompt);
    void rendererHost.app.commands.savePromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, nextPrompt, draftPersistence);
  }

  useEffect(() => {
    abortControllerRef.current?.abort('studio-capability-changed');
    abortControllerRef.current = null;
    const draft = rendererHost.app.projection.promptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence);
    runSeqRef.current += 1;
    setPrompt(draft.prompt ?? preset.prompt);
    setContext('');
    setActiveRun(null);
    setSessionRuns({});
    setRunning(false);
    setCancelRequested(false);
    setStreamingText(null);
  }, [capability.id, draftPersistence, preset, rendererHost]);

  async function run(nextPrompt = prompt, nextContext = context) {
    const displayPrompt = nextPrompt.trim();
    if (!hasStudioCapabilityRunInput({ requiresPrompt, prompt: displayPrompt, hasAlternativeInput })) return;
    if (!runTarget.canDispatch) return;
    const runSeq = runSeqRef.current + 1;
    runSeqRef.current = runSeq;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const startedAt = rendererHost.clock.now();
    const pendingRun: TextStudioActiveRun = {
      id: `pending-${startedAt}`,
      prompt: displayPrompt || preset.prompt,
      context: nextContext.trim(),
      createdAt: new Date(startedAt).toISOString(),
      result: null,
      record: null,
      error: null,
    };
    setActiveRun(pendingRun);
    setRunning(true);
    setCancelRequested(false);
    try {
      let result: StudioCapabilityRunResult;
      try {
        const isStreaming = capability.id === 'chat.stream';
        if (isStreaming) setStreamingText('');
        const directive = textStudioDirectiveForTarget(runTarget, profile);
        result = await rendererHost.sdk.runCapability({
          capabilityId: capability.id,
          prompt: capability.id === 'audio.transcribe'
            ? displayPrompt
            : textStudioRuntimePrompt(displayPrompt, nextContext, directive),
          scenarioId: preset.id,
          onPartial: isStreaming ? setStreamingText : undefined,
          attachments: supportsMedia ? [...composerState.attachments] : undefined,
          parameters: effectiveCapabilityParameters,
          signal: abortController.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || t('NonSuccess.title.runtimeCallFailed'));
        result = {
          ok: false,
          capabilityId: capability.id,
          reason: 'runtime-call-failed',
          message,
          actionHint: t('NonSuccess.hint.runtimeCallFailed'),
          missingSurface: capability.missingSurface,
        };
      }
      const runConfig = createRunConfigSnapshot({
        target: runTarget,
        promptStyle: profile.controls.includes('tone') || profile.controls.includes('length')
          ? effectiveTextStudioPromptStyle(runTarget)
          : null,
        context: nextContext,
        attachmentCount: supportsMedia ? composerState.attachments.length : 0,
        requestParameters: parameterSummary,
      });
      const record = await onResult(result, displayPrompt, runConfig);
      // A result reaches the visible completed stage only after onResult has
      // finished its required custody/history work. Persistence failure throws
      // and is projected by the outer failure path instead of showing success.
      if (runSeq !== runSeqRef.current) return;
      const finishedRun: TextStudioActiveRun = {
        ...pendingRun,
        id: record?.id ?? pendingRun.id,
        createdAt: record?.createdAt ?? pendingRun.createdAt,
        result,
        record,
      };
      setSessionRuns((current) => ({ ...current, [finishedRun.id]: finishedRun }));
      setActiveRun(finishedRun);
    } catch (error) {
      if (runSeq !== runSeqRef.current) return;
      const message = error instanceof Error ? error.message : String(error || 'Runtime call failed.');
      setActiveRun({ ...pendingRun, error: message });
    } finally {
      if (runSeq === runSeqRef.current) {
        if (abortControllerRef.current === abortController) abortControllerRef.current = null;
        setRunning(false);
        setCancelRequested(false);
        setStreamingText(null);
      }
    }
  }

  function handleCopy() {
    if (!currentResult) return;
    const text = resultPlainText(currentResult, t);
    if (!text) return;
    void rendererHost.app.commands.copyText(text)
      .then((result) => {
        if (result.ok) {
          nimiToast.success(t('Common.copied'));
        } else {
          nimiToast.danger(t('Common.copyFailed'));
        }
      })
      .catch(() => {
        nimiToast.danger(t('Common.copyFailed'));
      });
  }

  async function handleDownload() {
    if (!currentResult) return;
    if (currentResult.ok && currentResult.output.kind === 'artifacts') {
      const artifact = currentResult.output.firstArtifact;
      if (artifact?.relativePath) {
        await rendererHost.sdk.revealLocalAppAsset(artifact.relativePath);
      }
      return;
    }
    const stamp = new Date(rendererHost.clock.now()).toISOString().replace(/[:.]/g, '-');
    const text = resultPlainText(currentResult, t);
    if (!text) return;
    await downloadTextFile(rendererHost.app.commands, `${capability.id}-${stamp}.txt`, text);
  }

  // Selecting a history record is a read-only preview: it never writes the
  // composer draft. Reusing a record's prompt is an explicit action instead.
  function selectHistoryRun(record: StudioRunHistoryRecord) {
    const sessionRun = sessionRuns[record.id];
    if (sessionRun) {
      setActiveRun(sessionRun);
      return;
    }
    setActiveRun({
      id: record.id,
      prompt: record.prompt,
      context: record.runConfig?.promptControls.context ?? '',
      createdAt: record.createdAt,
      result: null,
      record,
      error: null,
    });
  }

  function useHistoryRunAsDraft(record: StudioRunHistoryRecord) {
    updatePrompt(record.prompt);
    setContext(record.runConfig?.promptControls.context ?? '');
    setActiveRun(null);
  }

  useEffect(() => {
    const record = historySelectionRequest?.record;
    if (!record || record.capabilityId !== capability.id) return;
    selectHistoryRun(record);
  }, [historySelectionRequest?.requestId, capability.id]);

  const composer = (
    <TextStudioComposer
      registration={registration}
      prompt={prompt}
      context={context}
      intentLabel={textStudioRunTargetIntentSummary(runTarget, t)}
      running={running}
      attachments={composerState.attachments}
      onOpenAttachmentPicker={composerState.openAttachmentPicker}
      onRemoveAttachment={composerState.removeAttachment}
      canDispatch={runTarget.canDispatch}
      canConfigureIntent={canConfigureRunTarget(runTarget)}
      intentConfigurable={capability.execution === 'runtime-sdk'}
      compact={Boolean(activeRun)}
      parameterPanel={parameterStore && capability.execution === 'runtime-sdk' && ParameterPanel ? (
        <ParameterPanel
          capabilityId={capability.id}
          contract={registration.parameters}
          source={runTarget.source}
          parameters={capabilityParameters}
          disabled={running}
          onChange={(next) => parameterStore.setParameters(capability.id, next)}
        />
      ) : undefined}
      parametersActive={Object.keys(parameterSummary).length > 0}
      hasAlternativeInput={hasAlternativeInput}
      onPromptChange={updatePrompt}
      onContextChange={setContext}
      onOpenIntentConfig={onOpenConfig}
      onSubmit={() => void run()}
    />
  );
  const showAdmissionBadge = true;

  function handleHistoryCollapseToggle() {
    historyPanel?.setCollapsed(!historyCollapsed);
  }

  function handleNewRun() {
    setActiveRun(null);
  }

  function handleCancel() {
    if (cancelRequested) return;
    setCancelRequested(true);
    abortControllerRef.current?.abort('studio-user-canceled');
  }

  return (
    <div className={hasActiveRun ? 'studio studio--has-run' : 'studio studio--landing'}>
      <div className="studio__workspace studio__workspace--with-history">
        <div className="studio__primary">
          <header className="studio__head">
            <div className="studio__title">
              {showAdmissionBadge ? (
                <StatusBadge tone={admission.tone} shape="dot">
                  {t(registration.profile.statusLabelKey ?? ADMISSION_STATUS_LABEL_KEY[admission.label] ?? admission.label)}
                </StatusBadge>
              ) : null}
            </div>
            <div className="studio__head-actions">
              {headerActions}
              {hasActiveRun ? (
                <Tooltip content={t('StudioShell.newRun')} placement="bottom">
                  <IconButton
                    type="button"
                    className="studio-history-toggle"
                    aria-label={t('StudioShell.newRun')}
                    onClick={handleNewRun}
                    disabled={running}
                    icon={<SquarePen size={17} strokeWidth={1.8} aria-hidden="true" />}
                  />
                </Tooltip>
              ) : null}
              <Tooltip
                content={historyCollapsed ? t('StudioShell.showHistory') : t('StudioShell.hideHistory')}
                placement="bottom"
              >
                <IconButton
                  type="button"
                  className={historyCollapsed ? 'studio-history-toggle' : 'studio-history-toggle studio-history-toggle--expanded'}
                  aria-label={historyCollapsed ? t('StudioShell.showHistory') : t('StudioShell.hideHistory')}
                  aria-expanded={!historyCollapsed}
                  onClick={handleHistoryCollapseToggle}
                  icon={<PanelRight size={17} strokeWidth={1.8} aria-hidden="true" />}
                />
              </Tooltip>
            </div>
          </header>
          <main className="studio__stage">
            {hasActiveRun && activeRun ? (
              <TextStudioResultState
                registration={registration}
                activeRun={activeRun}
                admission={admission}
                intentLabel={activeRun.record ? getStudioRunIntentLabel(activeRun.record) : runTarget.intentLabel}
                running={running}
                cancelRequested={cancelRequested}
                streamingText={streamingText}
                verboseConsole={verboseConsole}
                composer={composer}
                onCopy={handleCopy}
                onDownload={handleDownload}
                onRegenerate={() => void run(activeRun.prompt, activeRun.context)}
                onCancel={profile.resultKind === 'artifacts' || profile.resultKind === 'transcript' || profile.resultKind === 'voice-asset'
                  ? handleCancel
                  : undefined}
                onUseAsDraft={useHistoryRunAsDraft}
              />
            ) : (
              <TextStudioStartState
                registration={registration}
                composer={composer}
              />
            )}
          </main>
        </div>
        <CapabilityRunHistory
          history={history}
          activeRunId={activeRun?.id ?? null}
          onSelectRun={onSelectHistoryRun}
          collapsed={historyCollapsed}
          currentCapabilityId={capability.id}
          registrations={registrations}
        />
      </div>
    </div>
  );
}

export function SectionAITesting({
  registration,
  registrations,
  runtime,
  onResult,
  history,
  lastResult,
  historySelectionRequest,
  onSelectHistoryRun,
  verboseConsole,
  draftPersistence,
  headerActions,
  renderAIConfigPanel,
  rootTestId,
}: SectionAITestingProps) {
  const { translate: t, appTitle } = useAIStudioHost();
  const capability = registration.descriptor;
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div
      className="section-ai-testing"
      data-testid={rootTestId}
      data-config-open={configOpen ? '' : undefined}
    >
      <div className="section-ai-testing__main">
        <TextStudioShell
          registration={registration}
          registrations={registrations}
          runtime={runtime}
          lastResult={lastResult}
          onResult={onResult}
          verboseConsole={verboseConsole}
          draftPersistence={draftPersistence}
          onOpenConfig={renderAIConfigPanel ? () => setConfigOpen(true) : undefined}
          history={history}
          historySelectionRequest={historySelectionRequest}
          onSelectHistoryRun={onSelectHistoryRun}
          headerActions={headerActions}
        />
      </div>

      {renderAIConfigPanel ? <OverlayShell
        open={configOpen}
        kind="drawer"
        size="M"
        title={t('StudioModelConfig.drawerTitle')}
        description={t('StudioModelConfig.drawerDescription', { appTitle })}
        panelClassName="flex flex-col"
        contentClassName="min-h-0 flex-1 overflow-y-auto p-0"
        onClose={() => setConfigOpen(false)}
      >
        <DrawerErrorBoundary onClose={() => setConfigOpen(false)} translate={t}>
          <Suspense fallback={<div className="p-5"><LoadingSkeleton lines={4} label={t('Common.loading')} /></div>}>
            {renderAIConfigPanel({ runtime, capabilityId: capability.capabilityContract ?? capability.id })}
          </Suspense>
        </DrawerErrorBoundary>
      </OverlayShell> : null}
    </div>
  );
}
