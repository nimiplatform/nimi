import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  OverlayShell,
  SelectField,
  StatusBadge,
  TextareaField,
  Toggle,
} from '@nimiplatform/kit/ui';
import { createBrowserAgentRealtimeHostMediaPort } from '@nimiplatform/kit/features/agent-realtime';
import { createNimiClientId } from '@nimiplatform/sdk';

import type { AIStudioWorkspaceController } from '../../ai-studio-core/workspace.js';
import type { StudioCapabilityRunResult, StudioRuntimeInspection } from '../../ai-studio-core/runtime-types.js';
import { createRunConfigSnapshot, useStudioRunTargetSummary } from '../../ai-studio-core/section-ai-testing-run.js';
import { studioNonSuccessDiagnostics } from '../../ai-studio-core/runtime.js';
import { notifyStudioAIConfigChanged } from '../../ai-studio-core/ai-config.js';
import { SessionSummaryView } from '../../ai-studio-core/section-ai-testing-session-result.js';
import { KnownJobNotice } from '../../ai-studio-core/section-ai-testing-output.js';
import { formatStudioRunHistoryTimestamp, restoreStudioCapabilityRunResult, type StudioRunHistoryRecord } from '../../ai-studio-core/history.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { LabAIStudioAdapter } from '../lab-ai-studio-adapter.js';
import { capabilityNonSuccess } from '../lab-non-success.js';
import { labAiRealtimeCapability } from './capability-test-registrations.js';
import {
  LAB_AI_REALTIME_INPUT_AUDIO,
  createLabRealtimeController,
  labRealtimeSessionSummary,
  type LabRealtimeController,
  type LabRealtimeOwnerControl,
  type LabRealtimeState,
} from './ai-realtime-session.js';

const LabAiConfigSettingsPanel = lazy(async () => ({
  default: (await import('../workbench/lab-ai-config-settings-panel.js')).LabAiConfigSettingsPanel,
}));

type Capture = { readonly inputTrackId: string; readonly utteranceId: string; readonly stop: () => Promise<void> };

export function LabAiRealtimePage(props: {
  readonly controller: AIStudioWorkspaceController;
  readonly runtime: StudioRuntimeInspection | null;
}) {
  return (
    <LabAIStudioAdapter>
      <LabAiRealtimeSurface {...props} />
    </LabAIStudioAdapter>
  );
}

function LabAiRealtimeSurface({
  controller: workspace,
  runtime,
}: {
  readonly controller: AIStudioWorkspaceController;
  readonly runtime: StudioRuntimeInspection | null;
}) {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const registration = labAiRealtimeCapability;
  const runTarget = useStudioRunTargetSummary(registration, runtime);
  const media = useMemo(() => createBrowserAgentRealtimeHostMediaPort(), []);
  const [instruction, setInstruction] = useState('You are a concise assistant for a Nimi Lab Realtime test.');
  const [turnDetection, setTurnDetection] = useState<'server-vad' | 'manual'>('manual');
  const [audioOutputEnabled, setAudioOutputEnabled] = useState(false);
  const [text, setText] = useState('Say hello in one short sentence.');
  const [state, setState] = useState<LabRealtimeState>({ phase: 'idle', tracks: [], transcripts: [], log: [], observed: {} });
  const [capture, setCapture] = useState<Capture | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [recorded, setRecorded] = useState<StudioCapabilityRunResult | null>(null);
  const [reviewed, setReviewed] = useState<StudioRunHistoryRecord | null>(null);
  // Recorded Sessions are reviewed read-only; a closed Session is never reopened.
  const recentSessions = useMemo(() => [...(workspace.history?.['realtime.interact'] ?? [])]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5), [workspace.history]);
  useEffect(() => {
    const record = workspace.historySelectionRequest?.record;
    if (record?.capabilityId === 'realtime.interact') setReviewed(record);
  }, [workspace.historySelectionRequest?.requestId]);
  const reviewedResult = reviewed ? restoreStudioCapabilityRunResult(reviewed, () => registration.descriptor.label) : null;
  const sessionRef = useRef<LabRealtimeController | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const recordedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ runTarget, workspace, t, turnDetection, audioOutputEnabled });
  latest.current = { runTarget, workspace, t, turnDetection, audioOutputEnabled };

  const record = (result: StudioCapabilityRunResult) => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    setRecorded(result);
    const current = latest.current;
    const runConfig = createRunConfigSnapshot({
      target: current.runTarget,
      context: '',
      attachmentCount: 0,
      requestParameters: {
        turnDetection: current.turnDetection,
        audioOutputEnabled: current.audioOutputEnabled,
        inputAudio: current.t('CapabilityTests.aiRealtime.inputFormatValue'),
      },
    });
    const observed = result.ok && result.output.kind === 'session' ? result.output.observed : {};
    const prompt = current.t('CapabilityTests.aiRealtime.historyPrompt', {
      texts: observed['text-input'] ?? 0,
      frames: observed['audio-frame-input'] ?? 0,
    });
    void current.workspace.handleResult(result, prompt, runConfig).catch((error: unknown) => {
      setNotice(current.t('CapabilityTests.common.recordFailed', { detail: error instanceof Error ? error.message : String(error) }));
    });
  };

  const recordSummary = (session: LabRealtimeController) => {
    const summary = labRealtimeSessionSummary(session.getState());
    record({
      ok: true,
      capabilityId: registration.descriptor.id,
      capabilityLabel: registration.descriptor.label,
      message: t(summary.ending === 'closed' ? 'CapabilityTests.aiRealtime.closedMessage' : 'CapabilityTests.aiRealtime.terminatedMessage', { reason: summary.terminalReason }),
      output: { kind: 'session', ...summary },
    });
  };

  // An owner-ended Session is recorded with its terminal reason.
  useEffect(() => {
    const session = sessionRef.current;
    if (state.phase === 'terminated' && session && state.scope) {
      void stopCapture();
      recordSummary(session);
    }
  }, [state.phase]);

  // Leaving the page stops capture, playback and the Session.
  useEffect(() => () => {
    void captureRef.current?.stop().catch(() => undefined);
    captureRef.current = null;
    const session = sessionRef.current;
    if (session && (session.getState().phase === 'open' || session.getState().phase === 'opening')) {
      void session.close().then(() => recordSummary(session), () => recordSummary(session));
    }
    void media.playback.close().catch(() => undefined);
  }, []);

  const phase = state.phase;
  const open = phase === 'open';

  async function openSession() {
    setBusy(true);
    setNotice('');
    recordedRef.current = false;
    setRecorded(null);
    const session = createLabRealtimeController({
      client: rendererHost.sdk.localAppClient.ai.realtime,
      now: () => new Date(),
      createId: (prefix) => createNimiClientId(prefix),
      onState: setState,
      ...(audioOutputEnabled ? { playback: media.playback } : {}),
    });
    sessionRef.current = session;
    try {
      await session.open({ instruction, turnDetection, audioOutputEnabled });
    } catch (error) {
      record(capabilityNonSuccess(registration.descriptor, 'runtime-call-failed', error instanceof Error ? error.message : String(error), studioNonSuccessDiagnostics(error)));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function startCapture() {
    const session = sessionRef.current;
    if (!session || !open || captureRef.current) return;
    const started = await media.microphone.beginCapture({
      format: state.negotiatedInputAudio ?? LAB_AI_REALTIME_INPUT_AUDIO,
      onFrame: async (frame) => {
        const active = captureRef.current;
        if (!active) return;
        await session.appendAudioFrame({ inputTrackId: active.inputTrackId, utteranceId: active.utteranceId, frameSequence: frame.frameSequence, frame: frame.frame })
          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      },
      onCaptureEnded: async (reason) => {
        captureRef.current = null;
        setCapture(null);
        setNotice(t('CapabilityTests.aiRealtime.captureEnded', { reason }));
      },
    });
    if (started.status !== 'ready') {
      setNotice(t(started.status === 'permission-denied' ? 'CapabilityTests.aiRealtime.micDenied' : 'CapabilityTests.aiRealtime.micUnavailable'));
      return;
    }
    captureRef.current = started.capture;
    setCapture(started.capture);
  }

  async function stopCapture() {
    const active = captureRef.current;
    captureRef.current = null;
    setCapture(null);
    await active?.stop();
  }

  async function closeSession() {
    const session = sessionRef.current;
    if (!session) return;
    await stopCapture().catch(() => undefined);
    try {
      await session.close();
    } finally {
      recordSummary(session);
    }
  }

  const control = (kind: LabRealtimeOwnerControl) => run(() => sessionRef.current!.ownerControl(kind));
  const activeTracks = state.tracks.filter((track) => track.lifecycle === 'active');

  return (
    <div ref={rootRef} className="lab-realtime" data-testid="lab-ai-realtime">
      <header className="lab-realtime__head">
        <div>
          <h1>{t('CapabilityTests.aiRealtime.title')}</h1>
          <p>{t('CapabilityTests.aiRealtime.intro')}</p>
        </div>
        <div className="lab-realtime__head-actions">
          <StatusBadge tone={runTarget.canDispatch ? 'success' : 'warning'} shape="dot">{runTarget.intentLabel}</StatusBadge>
          <Button type="button" size="sm" tone="secondary" onClick={() => setConfigOpen(true)}>{t('CapabilityTests.aiRealtime.configure')}</Button>
        </div>
      </header>
      {runTarget.source === 'local' ? <InlineAlert tone="info">{t('CapabilityTests.aiRealtime.localRouteNote')}</InlineAlert> : null}
      {!runTarget.canDispatch ? <InlineAlert tone="warning">{runTarget.detail}</InlineAlert> : null}

      <section className="lab-realtime__card" aria-label={t('CapabilityTests.aiRealtime.openSection')}>
        <TextareaField rows={2} value={instruction} disabled={phase !== 'idle' && phase !== 'closed' && phase !== 'terminated'} aria-label={t('CapabilityTests.aiRealtime.instruction')} onChange={(event) => setInstruction(event.currentTarget.value)} />
        <div className="lab-realtime__row">
          <SelectField
            value={turnDetection}
            disabled={phase === 'open' || phase === 'opening'}
            aria-label={t('CapabilityTests.aiRealtime.turnDetection')}
            options={[
              { value: 'manual', label: t('CapabilityTests.aiRealtime.manual') },
              { value: 'server-vad', label: t('CapabilityTests.aiRealtime.serverVad') },
            ]}
            onValueChange={(value) => setTurnDetection(value === 'server-vad' ? 'server-vad' : 'manual')}
          />
          <label className="lab-realtime__toggle">
            <Toggle checked={audioOutputEnabled} disabled={phase === 'open' || phase === 'opening'} onValueChange={setAudioOutputEnabled} ariaLabel={t('CapabilityTests.aiRealtime.audioOutput')} />
            <span>{t('CapabilityTests.aiRealtime.audioOutput')}</span>
          </label>
          <span className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.inputFormat')}</span>
        </div>
        <div className="lab-realtime__row">
          <Button type="button" size="sm" tone="primary" disabled={busy || phase === 'open' || phase === 'opening' || phase === 'closing' || !runTarget.canDispatch} onClick={() => void openSession()}>
            {t(phase === 'opening' ? 'CapabilityTests.aiRealtime.opening' : 'CapabilityTests.aiRealtime.open')}
          </Button>
          <Button type="button" size="sm" tone="ghost" disabled={!open || busy} onClick={() => void run(closeSession)}>
            {t('CapabilityTests.aiRealtime.close')}
          </Button>
          <StatusBadge tone={open ? 'success' : phase === 'terminated' ? 'warning' : 'neutral'} shape="dot">{t(`CapabilityTests.aiRealtime.phase.${phase}`)}</StatusBadge>
          {state.control ? (
            <span className="lab-realtime__meta">
              {t('CapabilityTests.aiRealtime.control', {
                lifecycle: state.control.lifecycle,
                backpressure: state.control.backpressure,
                buffered: state.control.bufferedItems,
                capacity: state.control.bufferCapacity,
              })}
            </span>
          ) : null}
        </div>
        {state.terminalReason ? <p className="lab-realtime__meta">{t('StudioResults.session.terminalReason')}: <code>{state.terminalReason}</code></p> : null}
        {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      </section>

      <section className="lab-realtime__card" aria-label={t('CapabilityTests.aiRealtime.inputSection')}>
        <TextareaField rows={2} value={text} disabled={!open} aria-label={t('CapabilityTests.aiRealtime.textInput')} onChange={(event) => setText(event.currentTarget.value)} />
        <div className="lab-realtime__row">
          <Button type="button" size="sm" tone="primary" disabled={!open || busy || !text.trim()} onClick={() => void run(() => sessionRef.current!.sendText(text.trim()))}>
            {t('CapabilityTests.aiRealtime.sendText')}
          </Button>
          <Button type="button" size="sm" tone="secondary" disabled={!open || busy} onClick={() => void (capture ? stopCapture() : startCapture()).catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)))}>
            {t(capture ? 'CapabilityTests.aiRealtime.stopMic' : 'CapabilityTests.aiRealtime.startMic')}
          </Button>
          <Button type="button" size="sm" tone="ghost" disabled={!open || busy} onClick={() => void control('commit-input')}>{t('CapabilityTests.aiRealtime.commitInput')}</Button>
          <Button type="button" size="sm" tone="ghost" disabled={!open || busy} onClick={() => void control('start-response')}>{t('CapabilityTests.aiRealtime.startResponse')}</Button>
          <Button type="button" size="sm" tone="ghost" disabled={!open || busy} onClick={() => void control('cancel-response')}>{t('CapabilityTests.aiRealtime.cancelResponse')}</Button>
          {activeTracks.map((track) => (
            <Button key={track.outputTrackId} type="button" size="sm" tone="ghost" disabled={!open || busy} onClick={() => void run(() => sessionRef.current!.interrupt(track.outputTrackId))}>
              {t('CapabilityTests.aiRealtime.interrupt', { track: track.outputTrackId })}
            </Button>
          ))}
        </div>
        <p className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.audioHint')}</p>
        {notice ? <InlineAlert tone="warning">{notice}</InlineAlert> : null}
      </section>

      <section className="lab-realtime__card" aria-label={t('CapabilityTests.aiRealtime.outputSection')}>
        {state.tracks.length === 0 && state.transcripts.length === 0 ? <p className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.noOutput')}</p> : null}
        {state.transcripts.map((entry, index) => (
          <p key={`${entry.utteranceId}:${index}`} className="lab-realtime__transcript">
            <strong>{t('CapabilityTests.aiRealtime.transcript', { final: entry.final ? 'final' : 'partial' })}</strong> {entry.text}
          </p>
        ))}
        {state.tracks.map((track) => (
          <div key={track.outputTrackId} className="lab-realtime__track">
            <strong>{t('CapabilityTests.aiRealtime.track', { track: track.outputTrackId, lifecycle: track.lifecycle, frames: track.audioFrames })}</strong>
            {track.reasonCode ? <code>{track.reasonCode}</code> : null}
            <p>{track.text || '…'}</p>
          </div>
        ))}
      </section>

      <details className="lab-realtime__card" open>
        <summary>{t('CapabilityTests.aiRealtime.events', { count: state.log.length })}</summary>
        <ol className="lab-realtime__log">
          {state.log.map((entry) => (
            <li key={entry.index}><code>{entry.kind}</code> {entry.detail}</li>
          ))}
        </ol>
      </details>

      {recorded ? (
        <section className="lab-realtime__card" aria-label={t('StudioResults.session.title')}>
          {recorded.ok && recorded.output.kind === 'session'
            ? <SessionSummaryView output={recorded.output} />
            : !recorded.ok ? (
              <InlineAlert tone="danger">
                {recorded.message}
                {recorded.diagnostics?.reasonCode ? <> · <code>{recorded.diagnostics.reasonCode}</code></> : null}
                <KnownJobNotice jobId={recorded.jobId} />
              </InlineAlert>
            ) : null}
        </section>
      ) : null}

      {recentSessions.length > 0 ? (
        <section className="lab-realtime__card" aria-label={t('CapabilityTests.aiRealtime.recentSessions')}>
          <strong>{t('CapabilityTests.aiRealtime.recentSessions')}</strong>
          <div className="lab-realtime__row">
            {recentSessions.map((record) => (
              <Button key={record.id} type="button" size="sm" tone={reviewed?.id === record.id ? 'secondary' : 'ghost'} onClick={() => setReviewed(record)}>
                {`${formatStudioRunHistoryTimestamp(record.createdAt, new Date())} · ${record.status}`}
              </Button>
            ))}
          </div>
          {reviewedResult?.ok && reviewedResult.output.kind === 'session' ? <SessionSummaryView output={reviewedResult.output} /> : null}
          {reviewedResult && !reviewedResult.ok ? (
            <InlineAlert tone="danger">
              {reviewedResult.message}
              {reviewedResult.diagnostics?.reasonCode ? <> · <code>{reviewedResult.diagnostics.reasonCode}</code></> : null}
            </InlineAlert>
          ) : null}
        </section>
      ) : null}

      <OverlayShell
        open={configOpen}
        kind="drawer"
        size="M"
        title={t('StudioModelConfig.drawerTitle')}
        panelClassName="flex flex-col"
        contentClassName="min-h-0 flex-1 overflow-y-auto p-0"
        onClose={() => {
          setConfigOpen(false);
          if (rootRef.current) notifyStudioAIConfigChanged(rootRef.current);
        }}
      >
        <Suspense fallback={<div className="p-5"><LoadingSkeleton lines={4} label={t('Common.loading')} /></div>}>
          {configOpen ? (
            <LabAiConfigSettingsPanel
              runtime={runtime}
              capabilityId="realtime.interact"
              onCommitted={() => notifyStudioAIConfigChanged(rootRef.current ?? window)}
            />
          ) : null}
        </Suspense>
      </OverlayShell>
    </div>
  );
}
