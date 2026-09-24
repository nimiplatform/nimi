import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineAlert, OverlayShell, StatusBadge } from '@nimiplatform/kit/ui';
import { Film, Upload } from 'lucide-react';

import type { AIStudioWorkspaceController } from '../../ai-studio-core/workspace.js';
import type { StudioCapabilityRunResult, StudioRuntimeInspection } from '../../ai-studio-core/runtime-types.js';
import { createRunConfigSnapshot, useStudioRunTargetSummary } from '../../ai-studio-core/section-ai-testing-run.js';
import { studioNonSuccessDiagnostics } from '../../ai-studio-core/runtime.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { t as translate, useTranslation } from '../../shell/i18n/index.js';
import { capabilityNonSuccess } from '../lab-non-success.js';
import { labVideoFaceSwapCapability } from './capability-test-registrations.js';
import { LAB_FACE_SWAP_IMAGE_MIME_TYPES, isLabFaceSwapImage } from './face-swap.js';
import {
  LAB_VIDEO_SESSION_MAX_FRAMES,
  createLabVideoSessionController,
  labContainRect,
  labRgb8ToRgba,
  labRgbaToRgb8,
  labVideoSessionSummary,
  type LabVideoSessionController,
  type LabVideoSessionState,
} from './video-face-swap-session.js';

type PreparedFrame = { readonly name: string; readonly rgb: Uint8Array; readonly previewUrl: string };
type UploadMime = 'image/png' | 'image/jpeg';

async function canvasObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(translate('CapabilityTests.videoSession.previewEncodeFailed'));
  return URL.createObjectURL(blob);
}

function fixedFrameCanvas(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!context) throw new Error(translate('CapabilityTests.videoSession.canvasUnavailable'));
  return { canvas, context };
}

// Converts a chosen image into the Session's fixed 1280x720 sRGB RGB8 frame,
// letterboxed on black without cropping or stretching.
async function prepareFrame(file: File): Promise<PreparedFrame> {
  const bitmap = await createImageBitmap(file);
  try {
    const { canvas, context } = fixedFrameCanvas();
    context.fillStyle = '#000';
    context.fillRect(0, 0, 1280, 720);
    const rect = labContainRect(bitmap.width, bitmap.height);
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    const rgb = labRgbaToRgb8(context.getImageData(0, 0, 1280, 720).data);
    return { name: file.name, rgb, previewUrl: await canvasObjectUrl(canvas) };
  } finally {
    bitmap.close();
  }
}

async function returnedFrameUrl(frame: Uint8Array): Promise<string> {
  const { canvas, context } = fixedFrameCanvas();
  context.putImageData(new ImageData(labRgb8ToRgba(frame), 1280, 720), 0, 0);
  return canvasObjectUrl(canvas);
}

export function LabVideoFaceSwapSessionLauncher(props: {
  readonly controller: AIStudioWorkspaceController;
  readonly runtime: StudioRuntimeInspection | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" tone="secondary" leadingIcon={<Film size={15} aria-hidden="true" />} onClick={() => setOpen(true)}>
        {t('CapabilityTests.videoSession.launch')}
      </Button>
      <OverlayShell
        open={open}
        kind="drawer"
        size="L"
        title={t('CapabilityTests.videoSession.title')}
        description={t('CapabilityTests.videoSession.description')}
        panelClassName="flex flex-col"
        contentClassName="min-h-0 flex-1 overflow-y-auto p-5"
        onClose={() => setOpen(false)}
      >
        {open ? <LabVideoFaceSwapSessionPanel controller={props.controller} runtime={props.runtime} /> : null}
      </OverlayShell>
    </>
  );
}

function LabVideoFaceSwapSessionPanel({
  controller: workspace,
  runtime,
}: {
  readonly controller: AIStudioWorkspaceController;
  readonly runtime: StudioRuntimeInspection | null;
}) {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const client = rendererHost.sdk.localAppClient;
  const registration = labVideoFaceSwapCapability;
  const runTarget = useStudioRunTargetSummary(registration, runtime);
  const [reference, setReference] = useState<File | null>(null);
  const [frames, setFrames] = useState<readonly PreparedFrame[]>([]);
  const [sessionState, setSessionState] = useState<LabVideoSessionState>({ phase: 'idle', frames: [] });
  const [resultUrls, setResultUrls] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sessionRef = useRef<LabVideoSessionController | null>(null);
  const recordedRef = useRef(false);
  const urlsRef = useRef<Set<string>>(new Set());
  const referenceInput = useRef<HTMLInputElement>(null);
  const framesInput = useRef<HTMLInputElement>(null);
  const latest = useRef({ runTarget, frames, workspace, t });
  latest.current = { runTarget, frames, workspace, t };

  const trackUrl = (url: string) => { urlsRef.current.add(url); return url; };

  const record = async (result: StudioCapabilityRunResult) => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    const current = latest.current;
    const runConfig = createRunConfigSnapshot({
      target: current.runTarget,
      context: '',
      attachmentCount: current.frames.length,
      requestParameters: { mode: 'session', frames: current.frames.length, format: '1280x720 rgb8' },
    });
    try {
      await current.workspace.handleResult(result, current.t('CapabilityTests.videoSession.historyPrompt', { frames: current.frames.length }), runConfig);
    } catch (error) {
      setNotice(current.t('CapabilityTests.common.recordFailed', { detail: error instanceof Error ? error.message : String(error) }));
    }
  };

  const recordSummary = (state: LabVideoSessionState) => {
    const summary = labVideoSessionSummary(state);
    void record({
      ok: true,
      capabilityId: registration.descriptor.id,
      capabilityLabel: registration.descriptor.label,
      message: t(summary.ending === 'closed' ? 'CapabilityTests.videoSession.closedMessage' : 'CapabilityTests.videoSession.terminatedMessage', { reason: summary.terminalReason }),
      output: { kind: 'session', ...summary },
    });
  };

  // A Session the owner ended is recorded once, with what was observed.
  useEffect(() => {
    if (sessionState.phase === 'terminated' && sessionState.scope) recordSummary(sessionState);
  }, [sessionState.phase]);

  // Returned frames are converted for this page only; nothing is saved.
  useEffect(() => {
    for (const frame of sessionState.frames) {
      const result = frame.result;
      if (result?.type !== 'transformed' || resultUrls[frame.sequence]) continue;
      void returnedFrameUrl(result.frame).then((url) => {
        trackUrl(url);
        setResultUrls((current) => ({ ...current, [frame.sequence]: url }));
      }, (error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
    }
  }, [sessionState.frames]);

  // Leaving the page closes the Session and releases frame previews. An Open
  // still pending closes the Session the owner returns; a controller still
  // waiting for its reference upload is closed so Open is never sent.
  useEffect(() => () => {
    const session = sessionRef.current;
    const phase = session?.getState().phase;
    if (session && (phase === 'open' || phase === 'opening')) {
      void session.close().then(
        () => recordSummary(session.getState()),
        () => recordSummary(session.getState()),
      );
    } else if (session && phase === 'idle') {
      void session.close();
    }
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current.clear();
  }, []);

  const phase = sessionState.phase;
  const canOpen = phase === 'idle' && Boolean(reference) && frames.length > 0 && runTarget.canDispatch && !busy;

  async function openSession() {
    if (!reference || !canOpen) return;
    setBusy(true);
    setNotice('');
    const session = createLabVideoSessionController({ client: client.ai.videoSessions, now: () => new Date(), onState: setSessionState });
    sessionRef.current = session;
    try {
      // The reference must be an artifact owned by this App before Open.
      const uploaded = await client.ai.artifacts.upload({ bytes: new Uint8Array(await reference.arrayBuffer()), mimeType: reference.type as UploadMime });
      await session.open(uploaded.artifactId);
    } catch (error) {
      await record({
        ...capabilityNonSuccess(registration.descriptor, 'runtime-call-failed', error instanceof Error ? error.message : String(error), studioNonSuccessDiagnostics(error)),
      });
      setNotice(t('CapabilityTests.videoSession.openFailed', { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  async function submitFrames() {
    const session = sessionRef.current;
    if (!session || phase !== 'open') return;
    setBusy(true);
    setNotice('');
    try {
      for (const frame of frames.slice(sessionState.frames.length)) {
        if (session.getState().phase !== 'open') break;
        await session.submit(frame.rgb);
      }
    } catch (error) {
      setNotice(t('CapabilityTests.videoSession.submitFailed', { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    const session = sessionRef.current;
    if (!session) return;
    setBusy(true);
    try {
      await session.close();
    } catch (error) {
      setNotice(t('CapabilityTests.videoSession.closeFailed', { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      recordSummary(session.getState());
      setBusy(false);
    }
  }

  async function chooseFrames(files: readonly File[]) {
    setNotice('');
    try {
      const prepared: PreparedFrame[] = [];
      for (const file of files.slice(0, LAB_VIDEO_SESSION_MAX_FRAMES)) {
        const frame = await prepareFrame(file);
        trackUrl(frame.previewUrl);
        prepared.push(frame);
      }
      setFrames(prepared);
    } catch (error) {
      setNotice(t('CapabilityTests.videoSession.frameFailed', { detail: error instanceof Error ? error.message : String(error) }));
    }
  }

  const frameRows = useMemo(() => frames.map((frame, index) => ({
    frame,
    state: sessionState.frames[index],
  })), [frames, sessionState.frames]);
  const summary = labVideoSessionSummary(sessionState);

  return (
    <div className="lab-session" data-testid="lab-video-session">
      <p className="lab-session__hint">{t('CapabilityTests.videoSession.intro')}</p>
      <p className="lab-session__hint">{t('CapabilityTests.common.localRouteOnly')}</p>
      {!runTarget.canDispatch ? <InlineAlert tone="warning">{runTarget.detail}</InlineAlert> : null}
      <div className="lab-session__inputs">
        <input ref={referenceInput} hidden type="file" accept={LAB_FACE_SWAP_IMAGE_MIME_TYPES.join(',')} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          if (!isLabFaceSwapImage({ mimeType: file.type, sizeBytes: file.size })) {
            setNotice(t('CapabilityTests.faceSwap.imageFileInvalid'));
            return;
          }
          setReference(file);
        }} />
        <input ref={framesInput} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          if (files.length) void chooseFrames(files);
        }} />
        <Button type="button" size="sm" tone="secondary" disabled={phase !== 'idle' || busy} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => referenceInput.current?.click()}>
          {t('CapabilityTests.videoSession.chooseReference')}
        </Button>
        <span>{reference ? `${reference.name} · ${reference.type} · ${reference.size} B` : t('CapabilityTests.faceSwap.noneSelected')}</span>
        <Button type="button" size="sm" tone="secondary" disabled={phase !== 'idle' || busy} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => framesInput.current?.click()}>
          {t('CapabilityTests.videoSession.chooseFrames', { max: LAB_VIDEO_SESSION_MAX_FRAMES })}
        </Button>
        <span>{t('CapabilityTests.videoSession.framesSelected', { count: frames.length })}</span>
      </div>
      <div className="lab-session__actions">
        <Button type="button" size="sm" tone="primary" disabled={!canOpen} onClick={() => void openSession()}>
          {t(phase === 'opening' ? 'CapabilityTests.videoSession.opening' : 'CapabilityTests.videoSession.openSession')}
        </Button>
        <Button type="button" size="sm" tone="secondary" disabled={phase !== 'open' || busy || sessionState.frames.length >= frames.length} onClick={() => void submitFrames()}>
          {t('CapabilityTests.videoSession.submitFrames')}
        </Button>
        <Button type="button" size="sm" tone="ghost" disabled={(phase !== 'open' && phase !== 'opening') || busy} onClick={() => void closeSession()}>
          {t('CapabilityTests.videoSession.closeSession')}
        </Button>
        <StatusBadge tone={phase === 'open' ? 'success' : phase === 'terminated' ? 'warning' : 'neutral'} shape="dot">
          {t(`CapabilityTests.videoSession.phase.${phase}`)}
        </StatusBadge>
      </div>
      {sessionState.scope ? (
        <p className="lab-session__meta"><code>{sessionState.scope.videoSessionId}</code> · {t('CapabilityTests.videoSession.generation', { generation: sessionState.scope.generation })}</p>
      ) : null}
      {sessionState.terminalReason ? <p className="lab-session__meta">{t('StudioResults.session.terminalReason')}: <code>{sessionState.terminalReason}</code></p> : null}
      {sessionState.error ? <InlineAlert tone="danger">{sessionState.error}</InlineAlert> : null}
      {notice ? <InlineAlert tone="warning">{notice}</InlineAlert> : null}
      <ul className="lab-session__frames">
        {frameRows.map(({ frame, state }, index) => (
          <li key={`${frame.name}:${index}`} className="lab-session__frame">
            <figure>
              <img src={frame.previewUrl} alt={t('CapabilityTests.videoSession.inputFrame', { index: index + 1 })} />
              <figcaption>{t('CapabilityTests.videoSession.inputFrame', { index: index + 1 })} · {frame.name}</figcaption>
            </figure>
            <figure>
              {state?.result?.type === 'transformed' && resultUrls[state.sequence]
                ? <img src={resultUrls[state.sequence]} alt={t('CapabilityTests.videoSession.returnedFrame', { sequence: state.sequence })} />
                : <div className="lab-session__placeholder">{frameStatus(state, t)}</div>}
              <figcaption>
                {state ? t('CapabilityTests.videoSession.frameMeta', { sequence: state.sequence, timestamp: state.timestampUs }) : t('CapabilityTests.videoSession.notSubmitted')}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <p className="lab-session__meta">
        {Object.entries(summary.observed).filter(([, count]) => count > 0).map(([name, count]) => `${name}: ${count}`).join(' · ') || t('StudioResults.session.nothingObserved')}
      </p>
    </div>
  );
}

function frameStatus(state: LabVideoSessionState['frames'][number] | undefined, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (!state) return t('CapabilityTests.videoSession.notSubmitted');
  if (state.receipt === 'rejected') return t('CapabilityTests.videoSession.receiptRejected', { detail: state.receiptError ?? '' });
  if (!state.result) return t(state.receipt === 'pending' ? 'CapabilityTests.videoSession.submitting' : 'CapabilityTests.videoSession.receiptOnly');
  if (state.result.type === 'transformed') return t('CapabilityTests.videoSession.renderingResult');
  return t('CapabilityTests.videoSession.disposition', { type: state.result.type, reason: state.result.reasonCode });
}
