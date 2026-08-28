import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { ReportAgentConversationHostError } from './chat-agent-shell-adapter-host-feedback';
import {
  resolveAgentManualVoiceRenderRequest,
} from './chat-agent-manual-voice-request';

type PlaybackStatus = 'idle' | 'rendering' | 'playing' | 'unavailable' | 'error';

type VoicePlaybackState = {
  conversationAnchorId: string;
  messageId: string;
  active: boolean;
  amplitude: number;
  visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createAudioObjectUrl(bytes: Uint8Array, mimeType: string): string {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: mimeType });
  return URL.createObjectURL(blob);
}

export function AgentManualVoicePlaybackButton(props: {
  message: ConversationCanonicalMessage;
  activeTarget: AgentLocalTargetSnapshot | null;
  activeConversationAnchorId: string | null;
  playLabel: string;
  stopLabel: string;
  renderingLabel: string;
  unavailableLabel: string;
  errorLabel: string;
  onPlaybackStateChange?: (state: VoicePlaybackState) => void;
  reportHostError?: ReportAgentConversationHostError;
}) {
  const sdk = useDesktopRendererSdk();
  const {
    activeConversationAnchorId,
    activeTarget,
    errorLabel,
    message,
    onPlaybackStateChange,
    playLabel,
    renderingLabel,
    reportHostError,
    stopLabel,
    unavailableLabel,
  } = props;
  const [status, setStatus] = useState<PlaybackStatus>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const request = useMemo(() => resolveAgentManualVoiceRenderRequest({
    message,
    activeTarget,
    activeConversationAnchorId,
  }), [activeConversationAnchorId, activeTarget, message]);

  const emitPlaybackState = useCallback((active: boolean) => {
    if (!request) {
      return;
    }
    onPlaybackStateChange?.({
      conversationAnchorId: request.conversationAnchorId,
      messageId: request.messageId,
      active,
      amplitude: active ? 0.24 : 0,
      visemeId: active ? 'aa' : null,
    });
  }, [onPlaybackStateChange, request]);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    releaseObjectUrl();
    emitPlaybackState(false);
    setStatus((current) => (current === 'rendering' ? current : 'idle'));
  }, [emitPlaybackState, releaseObjectUrl]);

  useEffect(() => {
    generationRef.current += 1;
  }, [request?.agentHandle, request?.conversationAnchorId, request?.messageId]);

  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    releaseObjectUrl();
    emitPlaybackState(false);
  }, [emitPlaybackState, releaseObjectUrl]);

  const handleClick = useCallback(async () => {
    if (!request) {
      return;
    }
    if (status === 'playing') {
      stopPlayback();
      return;
    }
    stopPlayback();
    setStatus('rendering');
    const generation = generationRef.current;
    try {
      const conversation = sdk.conversation();
      const result = await conversation.renderVoice({
        agentHandle: request.agentHandle as NimiLocalAppAgentHandle,
        conversationAnchorId: request.conversationAnchorId,
        messageId: request.messageId,
        requestId: `desktop-manual-voice-${globalThis.crypto.randomUUID()}`,
      });
      if (generation !== generationRef.current) return;
      if (result.status !== 'ready') {
        setStatus('unavailable');
        emitPlaybackState(false);
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
        setStatus('unavailable');
        emitPlaybackState(false);
        return;
      }
      const objectUrl = createAudioObjectUrl(artifact.bytes, mimeType);
      objectUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onplay = () => {
        setStatus('playing');
        emitPlaybackState(true);
      };
      audio.onended = () => {
        audioRef.current = null;
        releaseObjectUrl();
        emitPlaybackState(false);
        setStatus('idle');
      };
      audio.onpause = () => {
        if (!audio.ended) {
          emitPlaybackState(false);
          setStatus('idle');
        }
      };
      await audio.play();
    } catch (error) {
      setStatus('error');
      emitPlaybackState(false);
      reportHostError?.(error, {
        action: 'render-runtime-agent-manual-voice',
        extra: {
          conversationAnchorId: request.conversationAnchorId,
          messageId: request.messageId,
        },
      });
    }
  }, [emitPlaybackState, releaseObjectUrl, reportHostError, request, sdk, status, stopPlayback]);

  if (!request) {
    return null;
  }

  const disabled = status === 'rendering';
  const label = status === 'rendering'
    ? renderingLabel
    : status === 'playing'
      ? stopLabel
      : status === 'unavailable'
        ? unavailableLabel
        : status === 'error'
          ? errorLabel
          : playLabel;

  return (
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
      className="mt-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_86%,white)] text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-surface-card)] disabled:cursor-wait disabled:opacity-60"
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
    </button>
  );
}
