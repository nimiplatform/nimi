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
import { createRunConfigSnapshot, studioConfiguredTargetLabel, useStudioRunTargetSummary } from '../../ai-studio-core/section-ai-testing-run.js';
import { studioNonSuccessDiagnostics } from '../../ai-studio-core/runtime.js';
import { notifyStudioAIConfigChanged } from '../../ai-studio-core/ai-config.js';
import { SessionSummaryView } from '../../ai-studio-core/section-ai-testing-session-result.js';
import { KnownJobNotice } from '../../ai-studio-core/section-ai-testing-output.js';
import { formatStudioRunHistoryTimestamp, restoreStudioCapabilityRunResult, type StudioRunHistoryRecord } from '../../ai-studio-core/history.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { requireLabNativeClient } from '../../shell/local-app-runtime-platform.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { LabAIStudioAdapter } from '../lab-ai-studio-adapter.js';
import { capabilityNonSuccess } from '../lab-non-success.js';
import { labAiRealtimeCapability } from './capability-test-registrations.js';
import {
  LAB_AI_REALTIME_INPUT_AUDIO,
  createLabRealtimeController,
  labRealtimeInputAudio,
  labRealtimeSessionSummary,
  type LabRealtimeController,
  type LabRealtimeOwnerControl,
  type LabRealtimeState,
} from './ai-realtime-session.js';
import { LAB_AI_REALTIME_MAX_RECORDING_BYTES, readLabRealtimeRecording, sendLabRealtimeRecordingFrames } from './ai-realtime-recording.js';

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
  const [interactionMode, setInteractionMode] = useState<'owner-controlled' | 'continuous'>('owner-controlled');
  const [contextText, setContextText] = useState('');
  const [contextKind, setContextKind] = useState<'instruction' | 'context' | 'sanitized-result'>('context');
  const [contextRequestId, setContextRequestId] = useState('general');
  const [turnDetection, setTurnDetection] = useState<'server-vad' | 'manual'>('manual');
  const [audioOutputEnabled, setAudioOutputEnabled] = useState(false);
  const [inputSampleRate, setInputSampleRate] = useState<16000 | 24000>(16000);
  const [text, setText] = useState('Say hello in one short sentence.');
  const [state, setState] = useState<LabRealtimeState>({ phase: 'idle', responsePending: false, tracks: [], transcripts: [], log: [], observed: {} });
  const [capture, setCapture] = useState<Capture | null>(null);
  const [recording, setRecording] = useState<File | null>(null);
  const [recordingSubmitted, setRecordingSubmitted] = useState(false);
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
  const latest = useRef({ runTarget, workspace, t, interactionMode, turnDetection, audioOutputEnabled, inputSampleRate });
  latest.current = { runTarget, workspace, t, interactionMode, turnDetection, audioOutputEnabled, inputSampleRate };

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
        interactionMode: current.interactionMode,
        ...(current.interactionMode === 'owner-controlled' ? { turnDetection: current.turnDetection } : {}),
        audioOutputEnabled: current.audioOutputEnabled,
        inputAudio: current.t('CapabilityTests.aiRealtime.inputFormatValue', { rate: current.inputSampleRate / 1000, bytes: current.inputSampleRate * 2 * 20 / 1000 }),
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
    if (!['closed', 'terminated'].includes(session.getState().phase)) return;
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
    if ((state.phase === 'closed' || state.phase === 'terminated' || state.phase === 'interrupted') && session && state.scope) {
      void stopCapture();
      recordSummary(session);
    }
  }, [state.phase]);

  // Leaving the page stops capture, playback and the Session.
  useEffect(() => () => {
    void captureRef.current?.stop().catch(() => undefined);
    captureRef.current = null;
    const session = sessionRef.current;
    if (session && !['idle', 'closed', 'terminated'].includes(session.getState().phase)) {
      void session.dispose().then(() => recordSummary(session), () => recordSummary(session));
    }
    void media.playback.close().catch(() => undefined);
  }, []);

  const phase = state.phase;
  const open = phase === 'open';
  useEffect(() => {
    if (phase === 'closed' || phase === 'terminated' || phase === 'interrupted') setRecordingSubmitted(false);
  }, [phase]);

  async function openSession() {
    setBusy(true);
    setNotice('');
    setRecordingSubmitted(false);
    recordedRef.current = false;
    setRecorded(null);
    const session = createLabRealtimeController({
      client: requireLabNativeClient(rendererHost.sdk.localAppClient).ai.realtime,
      now: () => new Date(),
      createId: (prefix) => createNimiClientId(prefix),
      onState: setState,
      ...(audioOutputEnabled ? { playback: media.playback } : {}),
    });
    sessionRef.current = session;
    try {
      await session.open({ instruction, interactionMode, turnDetection, audioOutputEnabled, inputAudio: labRealtimeInputAudio(inputSampleRate) });
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
    if (interactionMode === 'continuous' && state.inputMuted) await session.ownerControl('unmute-input');
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

  async function stopCapture(muteInput = true) {
    const active = captureRef.current;
    captureRef.current = null;
    setCapture(null);
    await active?.stop();
    if (muteInput && active && interactionMode === 'continuous' && sessionRef.current && state.phase === 'open') await sessionRef.current.ownerControl('mute-input');
  }

  async function sendRecording(startResponse = true) {
    const session = sessionRef.current;
    if (!session || !recording || !open || captureRef.current) return;
    if (recordingSubmitted) return;
    if (recording.size > LAB_AI_REALTIME_MAX_RECORDING_BYTES + 4_096) {
      throw new Error(t('CapabilityTests.aiRealtime.recordingFormatError'));
    }
    const frames = readLabRealtimeRecording(await recording.arrayBuffer(), state.negotiatedInputAudio?.sampleRateHz === 24000 ? 24000 : 16000);
    const inputTrackId = createNimiClientId('lab-recording-track');
    const utteranceId = createNimiClientId('lab-recording-utterance');
    try {
      if (interactionMode === 'continuous' && state.inputMuted) await session.ownerControl('unmute-input');
      await sendLabRealtimeRecordingFrames({ session, frames, inputTrackId, utteranceId, interactionMode, turnDetection, startResponse });
      if (!startResponse || interactionMode === 'continuous') setRecordingSubmitted(true);
    } catch (error) {
      // Even a lost first ack can leave input on the owner. Discard that
      // partial or unknown buffer by closing the captured Session before retry.
      await session.close().catch(() => undefined);
      record(capabilityNonSuccess(registration.descriptor, 'runtime-call-failed',
        error instanceof Error ? error.message : String(error), studioNonSuccessDiagnostics(error)));
      throw error;
    }
  }

  async function closeSession() {
    const session = sessionRef.current;
    if (!session) return;
    await stopCapture(false).catch(() => undefined);
    try {
      await session.close();
    } finally {
      setRecordingSubmitted(false);
      recordSummary(session);
    }
  }

  const control = (kind: LabRealtimeOwnerControl) => run(async () => {
    await sessionRef.current!.ownerControl(kind);
    if (kind === 'start-response' || kind === 'continue-response') setRecordingSubmitted(false);
  });
  const activeTracks = state.tracks.filter((track) => track.lifecycle === 'active');
  const interruptibleTracks = state.tracks.filter((track) => track.lifecycle === 'active' || track.playbackPending);

  return (
    <div ref={rootRef} className="lab-realtime" data-testid="lab-ai-realtime">
      <header className="lab-realtime__head">
        <div>
          <h1>{t('CapabilityTests.aiRealtime.title')}</h1>
          <p>{t('CapabilityTests.aiRealtime.intro')}</p>
        </div>
        <div className="lab-realtime__head-actions">
          <StatusBadge tone={runTarget.canDispatch ? 'info' : 'warning'} shape="dot">{studioConfiguredTargetLabel(runTarget, t)}</StatusBadge>
          <Button type="button" size="sm" tone="secondary" onClick={() => setConfigOpen(true)}>{t('CapabilityTests.aiRealtime.configure')}</Button>
        </div>
      </header>
      {runTarget.source === 'local' ? <InlineAlert tone="info">{t('CapabilityTests.aiRealtime.localRouteNote')}</InlineAlert> : null}
      {!runTarget.canDispatch ? <InlineAlert tone="warning">{runTarget.detail}</InlineAlert> : null}

      {phase === 'interrupted' ? <InlineAlert tone="warning">{t('CapabilityTests.aiRealtime.closeUnconfirmed')}</InlineAlert> : null}
      <section className="lab-realtime__card" aria-label={t('CapabilityTests.aiRealtime.openSection')}>
        <TextareaField rows={2} value={instruction} disabled={phase !== 'idle' && phase !== 'closed' && phase !== 'terminated'} aria-label={t('CapabilityTests.aiRealtime.instruction')} onChange={(event) => setInstruction(event.currentTarget.value)} />
        <div className="lab-realtime__row">
          <label className="lab-realtime__field">
            <span>{t('CapabilityTests.aiRealtime.interactionMode')}</span>
            <SelectField value={interactionMode} aria-label={t('CapabilityTests.aiRealtime.interactionMode')}
              disabled={['open','opening','closing','interrupted'].includes(phase)}
              options={[
                { value: 'owner-controlled', label: t('CapabilityTests.aiRealtime.ownerControlled') },
                { value: 'continuous', label: t('CapabilityTests.aiRealtime.continuous') },
              ]}
              onValueChange={value => {
                const mode = value === 'continuous' ? 'continuous' : 'owner-controlled';
                setInteractionMode(mode);
                if (mode === 'continuous') setAudioOutputEnabled(true);
              }} />
          </label>
          {interactionMode === 'owner-controlled' ? <label className="lab-realtime__field">
            <span>{t('CapabilityTests.aiRealtime.turnDetection')}</span>
            <SelectField
              value={turnDetection}
              disabled={['open', 'opening', 'closing', 'interrupted'].includes(phase)}
              aria-label={t('CapabilityTests.aiRealtime.turnDetection')}
              options={[
                { value: 'manual', label: t('CapabilityTests.aiRealtime.manual') },
                { value: 'server-vad', label: t('CapabilityTests.aiRealtime.serverVad') },
              ]}
              onValueChange={(value) => setTurnDetection(value === 'server-vad' ? 'server-vad' : 'manual')}
            />
          </label> : null}
          <label className="lab-realtime__toggle">
            <Toggle checked={audioOutputEnabled} disabled={interactionMode === 'continuous' || phase === 'open' || phase === 'opening'} onValueChange={setAudioOutputEnabled} ariaLabel={t('CapabilityTests.aiRealtime.audioOutput')} />
            <span>{t('CapabilityTests.aiRealtime.audioOutput')}</span>
          </label>
          <label className="lab-realtime__field">
            <span>{t('CapabilityTests.aiRealtime.inputSampleRate')}</span>
            <SelectField
              value={String(inputSampleRate)}
              disabled={phase === 'open' || phase === 'opening'}
              aria-label={t('CapabilityTests.aiRealtime.inputSampleRate')}
              options={[{ value: '16000', label: '16 kHz' }, { value: '24000', label: '24 kHz' }]}
              onValueChange={(value) => setInputSampleRate(value === '24000' ? 24000 : 16000)}
            />
          </label>
          <span className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.inputFormat', { rate: inputSampleRate / 1000, bytes: inputSampleRate * 2 * 20 / 1000 })}</span>
        </div>
        <div className="lab-realtime__row">
          {open || phase === 'closing' || phase === 'interrupted' ? (
            <Button type="button" size="sm" tone="secondary" disabled={busy || phase === 'closing'} onClick={() => void run(closeSession)}>
              {t('CapabilityTests.aiRealtime.close')}
            </Button>
          ) : (
            <Button type="button" size="sm" tone="primary" disabled={busy || phase === 'opening' || !runTarget.canDispatch} onClick={() => void openSession()}>
              {t(phase === 'opening' ? 'CapabilityTests.aiRealtime.opening' : 'CapabilityTests.aiRealtime.open')}
            </Button>
          )}
          <StatusBadge tone={open ? 'success' : phase === 'terminated' || phase === 'interrupted' ? 'warning' : 'neutral'} shape="dot">{t(`CapabilityTests.aiRealtime.phase.${phase === 'terminated' && !state.scope ? 'openFailed' : phase}`)}</StatusBadge>
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
        <label className="lab-realtime__field">
          <span>{t('CapabilityTests.aiRealtime.recordingFile')}</span>
          <input type="file" accept=".wav,audio/wav" aria-label={t('CapabilityTests.aiRealtime.recordingFile')}
            disabled={busy || !!capture || (interactionMode === 'owner-controlled' && recordingSubmitted)}
            onChange={(event) => { setRecording(event.currentTarget.files?.[0] ?? null); setRecordingSubmitted(false); }} />
        </label>
        {!open ? <p className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.openToSendInput')}</p> : null}
        {open ? <>
        {interactionMode === 'continuous' ? <InlineAlert tone="info">{t('CapabilityTests.aiRealtime.continuousHelp')}</InlineAlert> : null}
        {interactionMode === 'owner-controlled' ? <TextareaField rows={2} value={text} disabled={!open} aria-label={t('CapabilityTests.aiRealtime.textInput')} onChange={(event) => setText(event.currentTarget.value)} /> : null}
        <div className="lab-realtime__row">
          {interactionMode === 'owner-controlled' ? <Button type="button" size="sm" tone="primary" disabled={!open || busy || state.responsePending || !text.trim()} onClick={() => void run(() => sessionRef.current!.sendText(text.trim()))}>
            {t('CapabilityTests.aiRealtime.sendText')}
          </Button> : null}
          <Button type="button" size="sm" tone="secondary" disabled={!open || busy} onClick={() => void (capture ? stopCapture() : startCapture()).catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)))}>
            {t(capture ? 'CapabilityTests.aiRealtime.stopMic' : 'CapabilityTests.aiRealtime.startMic')}
          </Button>
          <Button type="button" size="sm" tone="secondary"
            disabled={!open || busy || !!capture || !recording || recordingSubmitted || (interactionMode === 'owner-controlled' && (state.responsePending || activeTracks.length > 0))}
            onClick={() => void run(sendRecording)}>{t(interactionMode === 'continuous' ? 'CapabilityTests.aiRealtime.sendContinuousRecording' : turnDetection === 'manual' ? 'CapabilityTests.aiRealtime.sendRecording' : 'CapabilityTests.aiRealtime.sendRecordingVad')}</Button>
          {interactionMode === 'owner-controlled' && turnDetection === 'manual' ? <Button type="button" size="sm" tone="secondary"
            disabled={!open || busy || !!capture || !recording || recordingSubmitted || state.responsePending || activeTracks.length > 0}
            onClick={() => void run(() => sendRecording(false))}>{t('CapabilityTests.aiRealtime.submitRecordingOnly')}</Button> : null}
          {interactionMode === 'owner-controlled' ? <>
          <Button type="button" size="sm" tone="ghost" disabled={!open || busy} onClick={() => void control('commit-input')}>{t('CapabilityTests.aiRealtime.commitInput')}</Button>
          <Button type="button" size="sm" tone="ghost" disabled={!open || busy || state.responsePending || activeTracks.length > 0} onClick={() => void control('start-response')}>{t('CapabilityTests.aiRealtime.startResponse')}</Button>
          <Button type="button" size="sm" tone="ghost" disabled={!open || busy || state.responsePending || activeTracks.length > 0 || state.tracks.length === 0} onClick={() => void control('continue-response')}>{t('CapabilityTests.aiRealtime.continueResponse')}</Button>
          <Button type="button" size="sm" tone="ghost" disabled={!open || busy || activeTracks.length === 0} onClick={() => void control('cancel-response')}>{t('CapabilityTests.aiRealtime.cancelResponse')}</Button>
          {interruptibleTracks.map((track) => (
            <Button key={track.outputTrackId} type="button" size="sm" tone="ghost" disabled={!open || busy} onClick={() => void run(() => sessionRef.current!.interrupt(track.outputTrackId))}>
              {t('CapabilityTests.aiRealtime.interrupt', { track: track.outputTrackId })}
            </Button>
          ))}
          </> : <Button type="button" size="sm" tone="secondary" disabled={!open || busy || !!capture} onClick={() => void control(state.inputMuted ? 'unmute-input' : 'mute-input')}>{t(state.inputMuted ? 'CapabilityTests.aiRealtime.unmuteInput' : 'CapabilityTests.aiRealtime.muteInput')}</Button>}
        </div>
        {recordingSubmitted ? <p role="status">{t(interactionMode === 'continuous' ? 'CapabilityTests.aiRealtime.recordingStreamed' : 'CapabilityTests.aiRealtime.recordingSubmitted')}</p> : null}
        <p className="lab-realtime__meta">{t(interactionMode === 'continuous' ? 'CapabilityTests.aiRealtime.continuousAudioHint' : 'CapabilityTests.aiRealtime.audioHint')}</p>
        <p className="lab-realtime__meta">{t(interactionMode === 'continuous' ? 'CapabilityTests.aiRealtime.continuousRecordingHint' : turnDetection === 'manual' ? 'CapabilityTests.aiRealtime.recordingHint' : 'CapabilityTests.aiRealtime.recordingHintVad')}</p>
        </> : null}
        {notice ? <InlineAlert tone="warning">{notice}</InlineAlert> : null}
      </section>

      {open && interactionMode === 'continuous' ? <section className="lab-realtime__card" aria-label={t('CapabilityTests.aiRealtime.contextSection')}>
        <strong>{t('CapabilityTests.aiRealtime.contextSection')}</strong>
        <p className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.contextHelp')}</p>
        <div className="lab-realtime__row">
          <SelectField aria-label={t('CapabilityTests.aiRealtime.contextKind')} value={contextKind} options={['instruction','context','sanitized-result'].map(value=>({value,label:t(`CapabilityTests.aiRealtime.contextKinds.${value}`)}))} onValueChange={value=>setContextKind(value as typeof contextKind)} disabled={!open || busy} />
          <SelectField aria-label={t('CapabilityTests.aiRealtime.contextRequest')} value={contextRequestId} options={[{value:'general',label:t('CapabilityTests.aiRealtime.generalContext')},...(state.contextRequests??[]).filter(request=>!request.replied).map(request=>({value:request.contextRequestId,label:`${request.contextRequestId} · ${request.offsetMs} ms`}))]} onValueChange={setContextRequestId} disabled={!open || busy} />
        </div>
        <TextareaField rows={2} value={contextText} onChange={event=>setContextText(event.currentTarget.value)} aria-label={t('CapabilityTests.aiRealtime.contextText')} disabled={!open || busy} />
        <p className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.contextBytes', { bytes: new TextEncoder().encode(contextText.trim()).byteLength })}</p>
        <Button type="button" size="sm" tone="secondary" disabled={!open || busy || !contextText.trim() || new TextEncoder().encode(contextText.trim()).byteLength>500} onClick={()=>void run(async()=>{await sessionRef.current!.appendOwnerContext(contextText.trim(),contextKind,contextRequestId==='general'?undefined:contextRequestId);setContextText('');setContextRequestId('general');})}>{t('CapabilityTests.aiRealtime.sendContext')}</Button>
      </section> : null}

      {phase !== 'idle' ? <section className="lab-realtime__card" aria-label={t('CapabilityTests.aiRealtime.outputSection')}>
        {state.tracks.length === 0 && state.transcripts.length === 0 && !(state.continuousTranscripts?.length) ? <p className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.noOutput')}</p> : null}
        {state.sessionUsage ? <p className="lab-realtime__meta">{t(state.sessionUsage.final ? 'CapabilityTests.aiRealtime.usageFinal' : 'CapabilityTests.aiRealtime.usagePartial', { seconds: state.sessionUsage.audioSeconds })}</p> : null}
        {state.transcriptWindowTrimmed ? <p className="lab-realtime__meta">{t('CapabilityTests.aiRealtime.transcriptWindow')}</p> : null}
        {state.closure ? <p className="lab-realtime__meta">{t(!state.closure.localResourcesReleased ? 'CapabilityTests.aiRealtime.localClosureUnconfirmed' : state.closure.providerSessionClosed ? 'CapabilityTests.aiRealtime.providerClosureConfirmed' : 'CapabilityTests.aiRealtime.localClosureConfirmed')}</p> : null}
        {state.continuousTranscripts?.map((entry,index)=><p key={index} className="lab-realtime__transcript"><strong>{t(entry.direction==='input'?'CapabilityTests.aiRealtime.inputTranscript':'CapabilityTests.aiRealtime.outputTranscript')}{entry.startMs===undefined?'':` · ${entry.startMs}–${entry.endMs} ms`}</strong> {entry.textDelta}</p>)}
        {state.transcripts.map((entry, index) => (
          <p key={`${entry.utteranceId}:${index}`} className="lab-realtime__transcript">
            <strong>{t('CapabilityTests.aiRealtime.transcript', { final: entry.final ? 'final' : 'partial' })}</strong> {entry.text}
          </p>
        ))}
        {state.tracks.map((track) => (
          <div key={track.outputTrackId} className="lab-realtime__track">
            <strong>{t('CapabilityTests.aiRealtime.track', { track: track.outputTrackId, lifecycle: track.lifecycle === 'active' && (phase === 'closed' || phase === 'terminated') ? t('CapabilityTests.aiRealtime.receptionStopped') : track.lifecycle, frames: track.audioFrames })}</strong>
            {track.reasonCode ? <code>{track.reasonCode}</code> : null}
            <p>{track.text || '…'}</p>
          </div>
        ))}
      </section> : null}

      <details className="lab-realtime__card">
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
