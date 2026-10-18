import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/kit/core/sdk-contract';
import {
  resolveLocalAppConversationVoiceRequest,
} from '../headless/local-app-conversation-voice.js';
import { claimConversationPlayback } from '../headless/local-app-conversation-playback.js';

function formatAudioTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

type PlaybackStatus = 'idle' | 'rendering' | 'playing' | 'paused' | 'unavailable' | 'error';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createAudioObjectUrl(bytes: Uint8Array, mimeType: string): string {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: mimeType });
  return URL.createObjectURL(blob);
}

export function LocalAppConversationVoiceButton(props: {
  message: ConversationCanonicalMessage;
  agentHandle: string | null;
  conversation: () => import('@nimiplatform/kit/core/sdk-contract').NimiLocalAppConversationClient;
  onError?: (error: unknown) => void;
  activeConversationAnchorId: string | null;
  playLabel: string;
  stopLabel: string;
  renderingLabel: string;
  unavailableLabel: string;
  errorLabel: string;
  retryLabel: string;
  pauseLabel: string;
  resumeLabel: string;
  progressLabel: string;
  settingsLabel: string;
  settingsHint: string;
  onOpenSettings?: () => void;
}) {
  const {
    activeConversationAnchorId,
    agentHandle: targetHandle,
    errorLabel,
    retryLabel, pauseLabel, resumeLabel, progressLabel, settingsLabel, settingsHint, onOpenSettings,
    message,
    playLabel,
    renderingLabel,
    onError,
    stopLabel,
    unavailableLabel,
  } = props;
  const [status, setStatus] = useState<PlaybackStatus>('idle');
  const [progress, setProgress] = useState({ position: 0, duration: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const playbackOwner = useRef(Symbol('conversation-voice'));
  const releaseClaim = useRef<() => void>(() => {});
  const metadata = message.metadata as Record<string, unknown> | undefined;
  const readyArtifactId = metadata?.canonicalVoiceState === 'ready' ? normalizeText(metadata.canonicalVoiceArtifactId) : '';
  const failed = status === 'unavailable' || status === 'error' || (!readyArtifactId && metadata?.canonicalVoiceState === 'failed');
  const resolved = resolveLocalAppConversationVoiceRequest({ message, agentHandle: targetHandle, activeConversationAnchorId });
  const agentHandle = resolved?.agentHandle ?? null;
  const conversationAnchorId = resolved?.conversationAnchorId ?? null;
  const messageId = resolved?.messageId ?? null;
  // Snapshots replace message/target objects without changing the audio owner.
  const request = useMemo(() => agentHandle && conversationAnchorId && messageId
    ? { agentHandle, conversationAnchorId, messageId }
    : null, [agentHandle, conversationAnchorId, messageId]);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const releasePlayback = useCallback(() => {
    releaseClaim.current();
    releaseClaim.current = () => {};
    const audio = audioRef.current;
    if (audio) {
      audio.onplay = null;
      audio.onpause = null;
      audio.onended = null;
      audio.ontimeupdate = null;
      audio.onloadedmetadata = null;
      audio.ondurationchange = null;
      audio.onerror = null;
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    releaseObjectUrl();
    setProgress({ position: 0, duration: 0 });
  }, [releaseObjectUrl]);

  const stopPlayback = useCallback(() => {
    generationRef.current += 1;
    busyRef.current = false;
    releasePlayback();
    setStatus('idle');
  }, [releasePlayback]);

  useEffect(() => {
    generationRef.current += 1;
    setStatus('idle');
    busyRef.current = false;
    return () => {
      generationRef.current += 1;
      releasePlayback();
    };
  }, [request, releasePlayback]);

  const handleClick = useCallback(async () => {
    if (!request || busyRef.current) {
      return;
    }
    if (status === 'playing') {
      audioRef.current?.pause();
      return;
    }
    releaseClaim.current = claimConversationPlayback(
      JSON.stringify([request.agentHandle, request.conversationAnchorId]),
      playbackOwner.current,
      stopPlayback,
    );
    setStatus('rendering');
    busyRef.current = true;
    const generation = generationRef.current;
    try {
      if (audioRef.current) {
        await audioRef.current.play();
        return;
      }
      const conversation = props.conversation();
      const result = readyArtifactId ? { status: 'ready' as const, artifactId: readyArtifactId } : await conversation.renderVoice({
        agentHandle: request.agentHandle as NimiLocalAppAgentHandle,
        conversationAnchorId: request.conversationAnchorId,
        messageId: request.messageId,
        requestId: `conversation-voice-${globalThis.crypto.randomUUID()}`,
      });
      if (generation !== generationRef.current) return;
      if (result.status !== 'ready') {
        releaseClaim.current();
        setStatus('unavailable');
        return;
      }
      const artifact = await conversation.readArtifact({
        agentHandle: request.agentHandle as NimiLocalAppAgentHandle,
        conversationAnchorId: request.conversationAnchorId,
        artifactId: result.artifactId,
      });
      if (generation !== generationRef.current) return;
      const mimeType = normalizeText(artifact.mimeType);
      if (!mimeType.toLowerCase().startsWith('audio/') || artifact.bytes.length === 0) {
        releaseClaim.current();
        setStatus('unavailable');
        return;
      }
      const objectUrl = createAudioObjectUrl(artifact.bytes, mimeType);
      objectUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onplay = () => {
        setStatus('playing');
      };
      const updateProgress = () => setProgress({
        position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
      audio.ontimeupdate = updateProgress;
      audio.onloadedmetadata = updateProgress;
      audio.ondurationchange = updateProgress;
      audio.onerror = () => { releasePlayback(); setStatus('error'); };
      audio.onended = () => {
        releasePlayback();
        setStatus('idle');
      };
      audio.onpause = () => {
        if (!audio.ended) {
          setStatus('paused');
        }
      };
      await audio.play();
    } catch (error) {
      if (generation !== generationRef.current) return;
      releasePlayback();
      setStatus('error');
      onError?.(error);
    } finally {
      if (generation === generationRef.current) busyRef.current = false;
    }
  }, [readyArtifactId, releaseObjectUrl, releasePlayback, onError, request, props.conversation, status, stopPlayback]);

  if (!request) {
    return null;
  }

  const disabled = status === 'rendering';
  const label = status === 'rendering'
    ? renderingLabel
    : status === 'playing'
      ? pauseLabel
      : status === 'paused' ? resumeLabel
        : failed ? retryLabel : playLabel;


  return (
    <span className="mt-2 inline-flex flex-wrap items-center gap-2">
    {failed && !disabled ? <span role="status" className="text-xs text-[var(--nimi-text-secondary)]">{status === 'error' ? errorLabel : unavailableLabel}</span> : null}
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleClick();
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex min-h-7 min-w-7 gap-1 px-1 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_86%,white)] text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-surface-card)] disabled:cursor-wait disabled:opacity-60"
    >
      {status === 'playing' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
      )}
      {failed && !disabled ? <span className="text-xs">{retryLabel}</span> : null}
    </button>
    {(status === 'playing' || status === 'paused') ? <>
      <input type="range" aria-label={progressLabel} min={0} max={progress.duration || 1} step={0.1}
        value={Math.min(progress.position, progress.duration || 1)} disabled={progress.duration <= 0}
        onChange={(event) => { const audio = audioRef.current; if (audio && progress.duration > 0) { audio.currentTime = Number(event.currentTarget.value); setProgress(current => ({...current, position: audio.currentTime})); } }}
        className="w-28 accent-[var(--nimi-text-secondary)]" />
      <span className="text-xs tabular-nums text-[var(--nimi-text-secondary)]">{formatAudioTime(progress.position)} / {formatAudioTime(progress.duration)}</span>
      <button type="button" onClick={stopPlayback} aria-label={stopLabel} title={stopLabel} className="h-7 w-7 rounded-full border border-[var(--nimi-border-subtle)] text-[var(--nimi-text-secondary)]">■</button>
    </> : null}
    {failed && !disabled && onOpenSettings ? <span className="basis-full text-xs text-[var(--nimi-text-secondary)]">
      {settingsHint} <button type="button" className="underline" onClick={onOpenSettings}>{settingsLabel}</button>
    </span> : null}
    </span>
  );
}
