import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChatStreamStatus,
  type CanonicalMessageContentSlot,
  type ConversationCanonicalMessage,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  cancelStream,
  getStreamState,
  subscribeStream,
  type StreamState,
} from '../turns/stream-controller';
import { parseAgentTextTurnDebugMetadata } from './chat-agent-debug-metadata';
import {
  parseAgentVoicePlaybackCueEnvelope,
  resolveAgentVoicePlaybackCueFromEnvelope,
  type AgentVoicePlaybackCueEnvelope,
} from './chat-agent-voice-playback-envelope';
import {
  resolveAgentVoicePlaybackCue,
  resolveAgentVoicePlaybackEstimatedFrame,
} from './chat-agent-voice-playback-state';

function normalizeReasoningText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveImageUrls(message: ConversationCanonicalMessage): string[] {
  const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
  const attachmentUrls = Array.isArray(metadata.attachments)
    ? metadata.attachments
      .map((attachment) => (
        attachment && typeof attachment === 'object'
          ? normalizeText((attachment as { url?: unknown }).url)
          : ''
      ))
      .filter(Boolean)
    : [];
  const mediaUrl = normalizeText(metadata.mediaUrl);
  if (attachmentUrls.length > 0) {
    return attachmentUrls;
  }
  return mediaUrl ? [mediaUrl] : [];
}

export function useConversationStreamState(chatId: string | null): StreamState | null {
  const [state, setState] = useState<StreamState | null>(() => (chatId ? getStreamState(chatId) : null));

  useEffect(() => {
    if (!chatId) {
      setState(null);
      return;
    }
    setState(getStreamState(chatId));
    return subscribeStream(chatId, (updated) => {
      setState({ ...updated });
    });
  }, [chatId]);

  return state;
}

export function RuntimeReasoningMessageContent(props: {
  message: ConversationCanonicalMessage;
  reasoningText: string;
  reasoningLabel: ReactNode;
}) {
  const paragraphs = props.message.text
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <div className="space-y-3">
      <details className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,white)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-[var(--nimi-text-muted)]">
          {props.reasoningLabel}
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-[var(--nimi-text-secondary)]">
          {props.reasoningText}
        </pre>
      </details>
      {paragraphs.length > 0 ? (
        <div className="space-y-2">
          {paragraphs.map((paragraph, index) => (
            <p key={`${props.message.id}-paragraph-${index}`} className="whitespace-pre-wrap">
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RuntimeImageMessageContent(props: {
  message: ConversationCanonicalMessage;
  imageLabel: string;
  showCaptionLabel: string;
  hideCaptionLabel: string;
}) {
  const imageUrls = resolveImageUrls(props.message);
  const caption = normalizeText(props.message.text);
  const [captionVisible, setCaptionVisible] = useState(false);
  const toggleCaption = useCallback(() => setCaptionVisible((prev) => !prev), []);
  if (imageUrls.length === 0) {
    return caption ? <p className="whitespace-pre-wrap">{caption}</p> : null;
  }
  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {imageUrls.map((url, index) => (
          <div key={`${props.message.id}-image-${index}`} className="relative">
            <img
              src={url}
              alt={props.imageLabel}
              className="max-h-[480px] w-full max-w-[480px] rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] object-cover"
            />
            {caption ? (
              <button
                type="button"
                onClick={toggleCaption}
                className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80 transition hover:bg-black/70"
                aria-label={captionVisible ? props.hideCaptionLabel : props.showCaptionLabel}
                title={captionVisible ? props.hideCaptionLabel : props.showCaptionLabel}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {caption && captionVisible ? (
        <p className="whitespace-pre-wrap text-xs text-[var(--nimi-text-muted)]">{caption}</p>
      ) : null}
    </div>
  );
}

export function RuntimeVoiceMessageContent(props: {
  message: ConversationCanonicalMessage;
  voiceLabel: string;
  transcriptLabel: string;
  showTranscriptLabel: string;
  hideTranscriptLabel: string;
  transcriptUnavailableLabel: string;
  onPlaybackStateChange?: (state: {
    messageId: string;
    threadId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  }) => void;
}) {
  const metadata = (props.message.metadata as Record<string, unknown> | undefined) || {};
  const voiceUrl = normalizeText(metadata.voiceUrl);
  const transcript = normalizeText(metadata.voiceTranscript);
  const playbackCueEnvelope = parseAgentVoicePlaybackCueEnvelope(metadata.playbackCueEnvelope);
  const [transcriptVisible, setTranscriptVisible] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const estimatorFrameRef = useRef<{
    cue: {
      amplitude: number;
      visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
    };
    stableFrames: number;
  } | null>(null);
  const toggleTranscript = useCallback(() => setTranscriptVisible((previous) => !previous), []);

  const emitPlaybackState = useCallback((active: boolean, amplitude = 0, visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null = null) => {
    props.onPlaybackStateChange?.({
      messageId: props.message.id,
      threadId: props.message.sessionId,
      active,
      amplitude,
      visemeId,
    });
  }, [props.message.id, props.message.sessionId, props.onPlaybackStateChange]);

  const stopPlaybackSampling = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    estimatorFrameRef.current = null;
    emitPlaybackState(false);
  }, [emitPlaybackState]);

  const resolveFrameCue = useCallback((input: {
    playbackCueEnvelope: AgentVoicePlaybackCueEnvelope | null;
    currentTimeSeconds: number;
    timeDomainSamples: Uint8Array;
    frequencySamples?: Uint8Array;
  }) => {
    if (input.playbackCueEnvelope) {
      return {
        source: 'envelope' as const,
        cue: resolveAgentVoicePlaybackCueFromEnvelope(
          input.playbackCueEnvelope,
          input.currentTimeSeconds,
        ),
      };
    }
    return {
      source: 'estimator' as const,
      cue: resolveAgentVoicePlaybackCue(
        input.timeDomainSamples,
        input.currentTimeSeconds,
        input.frequencySamples,
      ),
    };
  }, []);

  const startPlaybackSampling = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playbackCueEnvelope) {
      const tick = () => {
        if (!audioRef.current || audioRef.current.paused || audioRef.current.ended) {
          stopPlaybackSampling();
          return;
        }
        const cue = resolveFrameCue({
          playbackCueEnvelope,
          currentTimeSeconds: audioRef.current.currentTime,
          timeDomainSamples: new Uint8Array(0),
        }).cue;
        emitPlaybackState(true, cue.amplitude, cue.visemeId);
        rafRef.current = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(tick)
          : null;
      };
      stopPlaybackSampling();
      tick();
      return;
    }
    if (typeof AudioContext === 'undefined') {
      emitPlaybackState(true, 0.26, 'aa');
      return;
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    const context = audioContextRef.current;
    if (!analyserRef.current) {
      analyserRef.current = context.createAnalyser();
      analyserRef.current.fftSize = 2048;
    }
    if (!sourceNodeRef.current) {
      sourceNodeRef.current = context.createMediaElementSource(audio);
      sourceNodeRef.current.connect(analyserRef.current);
      analyserRef.current.connect(context.destination);
    }
    void context.resume();
    const analyser = analyserRef.current;
    const samples = new Uint8Array(analyser.fftSize);
    const frequencySamples = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!audioRef.current || audioRef.current.paused || audioRef.current.ended) {
        stopPlaybackSampling();
        return;
      }
      analyser.getByteTimeDomainData(samples);
      analyser.getByteFrequencyData(frequencySamples);
      const frame = resolveRuntimeVoicePlaybackFrameCue({
        playbackCueEnvelope: null,
        currentTimeSeconds: audioRef.current.currentTime,
        timeDomainSamples: samples,
        frequencySamples,
        previousEstimatorFrame: estimatorFrameRef.current,
      });
      estimatorFrameRef.current = frame.estimatorFrame;
      const cue = frame.cue;
      emitPlaybackState(true, cue.amplitude, cue.visemeId);
      rafRef.current = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(tick)
        : null;
    };
    stopPlaybackSampling();
    tick();
  }, [emitPlaybackState, playbackCueEnvelope, resolveFrameCue, stopPlaybackSampling]);

  useEffect(() => () => {
    stopPlaybackSampling();
    sourceNodeRef.current?.disconnect();
    analyserRef.current?.disconnect();
    void audioContextRef.current?.close();
    sourceNodeRef.current = null;
    analyserRef.current = null;
    audioContextRef.current = null;
  }, [stopPlaybackSampling]);

  if (!voiceUrl) {
    return transcript ? <p className="whitespace-pre-wrap">{transcript}</p> : null;
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,white)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
          {props.voiceLabel}
        </div>
        <button
          type="button"
          onClick={toggleTranscript}
          className="rounded-full border border-[var(--nimi-border-subtle)] px-3 py-1 text-[11px] font-medium text-[var(--nimi-text-secondary)] transition hover:bg-white"
        >
          {transcriptVisible ? props.hideTranscriptLabel : props.showTranscriptLabel}
        </button>
      </div>
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        className="w-full"
        onPlay={startPlaybackSampling}
        onPause={stopPlaybackSampling}
        onEnded={stopPlaybackSampling}
      >
        <source src={voiceUrl} />
      </audio>
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
          {props.transcriptLabel}
        </div>
        {transcriptVisible ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {transcript || props.transcriptUnavailableLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function resolveRuntimeVoicePlaybackFrameCue(input: {
  playbackCueEnvelope: AgentVoicePlaybackCueEnvelope | null;
  currentTimeSeconds: number;
  timeDomainSamples: Uint8Array;
  frequencySamples?: Uint8Array;
  previousEstimatorFrame?: {
    cue: {
      amplitude: number;
      visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
    };
    stableFrames: number;
  } | null;
}) {
  if (input.playbackCueEnvelope) {
    return {
      source: 'envelope' as const,
      cue: resolveAgentVoicePlaybackCueFromEnvelope(
        input.playbackCueEnvelope,
        input.currentTimeSeconds,
      ),
      estimatorFrame: null,
    };
  }
  const estimatorFrame = resolveAgentVoicePlaybackEstimatedFrame({
    previous: input.previousEstimatorFrame || null,
    nextCue: resolveAgentVoicePlaybackCue(
      input.timeDomainSamples,
      input.currentTimeSeconds,
      input.frequencySamples,
    ),
  });
  return {
    source: 'estimator' as const,
    cue: estimatorFrame.cue,
    estimatorFrame,
  };
}

export function RuntimeAgentDebugMessageAccessory(props: {
  message: ConversationCanonicalMessage;
  debugVisible: boolean;
  summaryLabel: string;
  copyLabel: string;
  copiedLabel: string;
  followUpLabel: string;
  followUpInstructionLabel: string;
  promptLabel: string;
  systemPromptLabel: string;
  rawOutputLabel: string;
  normalizedOutputLabel: string;
}) {
  const debugMetadata = parseAgentTextTurnDebugMetadata(props.message.metadata);
  if (!debugMetadata) {
    return null;
  }
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      setCopied(false);
      return;
    }
    const payload = JSON.stringify({
      prompt: debugMetadata.prompt,
      systemPrompt: debugMetadata.systemPrompt,
      rawModelOutput: debugMetadata.rawModelOutput,
      normalizedModelOutput: debugMetadata.normalizedModelOutput,
      followUpTurn: debugMetadata.followUpTurn,
      followUpInstruction: debugMetadata.followUpInstruction,
      chainId: debugMetadata.chainId,
      followUpDepth: debugMetadata.followUpDepth,
      maxFollowUpTurns: debugMetadata.maxFollowUpTurns,
      followUpCanceledByUser: debugMetadata.followUpCanceledByUser,
      followUpSourceActionId: debugMetadata.followUpSourceActionId,
      followUpDelayMs: debugMetadata.followUpDelayMs,
    }, null, 2);
    void navigator.clipboard.writeText(payload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      setCopied(false);
    });
  }, [
    debugMetadata.chainId,
    debugMetadata.followUpDelayMs,
    debugMetadata.followUpDepth,
    debugMetadata.followUpCanceledByUser,
    debugMetadata.followUpInstruction,
    debugMetadata.maxFollowUpTurns,
    debugMetadata.followUpSourceActionId,
    debugMetadata.followUpTurn,
    debugMetadata.normalizedModelOutput,
    debugMetadata.prompt,
    debugMetadata.rawModelOutput,
    debugMetadata.systemPrompt,
  ]);
  if (!props.debugVisible && !debugMetadata.followUpTurn) {
    return null;
  }
  return (
    <div className="mt-2 space-y-2">
      {debugMetadata.followUpTurn ? (
        <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
          {debugMetadata.followUpDepth && debugMetadata.maxFollowUpTurns
            ? `${props.followUpLabel} ${debugMetadata.followUpDepth}/${debugMetadata.maxFollowUpTurns}`
            : props.followUpLabel}
        </div>
      ) : null}
      {props.debugVisible ? (
        <details className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,white)] px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium text-[var(--nimi-text-muted)]">
            <span>{props.summaryLabel}</span>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleCopy();
              }}
              className="rounded-lg border border-[var(--nimi-border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--nimi-text-secondary)] transition hover:bg-white"
            >
              {copied ? props.copiedLabel : props.copyLabel}
            </button>
          </summary>
          <div className="mt-2 space-y-2">
            {debugMetadata.systemPrompt ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                  {props.systemPromptLabel}
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--nimi-text-secondary)]">
                  {debugMetadata.systemPrompt}
                </pre>
              </div>
            ) : null}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                {props.promptLabel}
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--nimi-text-secondary)]">
                {debugMetadata.prompt}
              </pre>
            </div>
            {debugMetadata.followUpInstruction ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                  {props.followUpInstructionLabel}
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--nimi-text-secondary)]">
                  {debugMetadata.followUpInstruction}
                </pre>
              </div>
            ) : null}
            {debugMetadata.rawModelOutput ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                  {props.rawOutputLabel}
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--nimi-text-secondary)]">
                  {debugMetadata.rawModelOutput}
                </pre>
              </div>
            ) : null}
            {debugMetadata.normalizedModelOutput && debugMetadata.normalizedModelOutput !== debugMetadata.rawModelOutput ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                  {props.normalizedOutputLabel}
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--nimi-text-secondary)]">
                  {debugMetadata.normalizedModelOutput}
                </pre>
              </div>
            ) : null}
            {debugMetadata.followUpTurn ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                  Follow-up chain
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--nimi-text-secondary)]">
                  {[
                    debugMetadata.chainId ? `chainId=${debugMetadata.chainId}` : null,
                    debugMetadata.followUpDepth && debugMetadata.maxFollowUpTurns
                      ? `depth=${debugMetadata.followUpDepth}/${debugMetadata.maxFollowUpTurns}`
                      : null,
                    debugMetadata.followUpCanceledByUser ? 'canceledByUser=true' : null,
                    debugMetadata.followUpSourceActionId
                      ? `sourceActionId=${debugMetadata.followUpSourceActionId}`
                      : null,
                    debugMetadata.followUpDelayMs !== null
                      ? `delayMs=${debugMetadata.followUpDelayMs}`
                      : null,
                  ].filter(Boolean).join('\n')}
                </pre>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function createReasoningMessageContentRenderer(reasoningLabel: ReactNode): CanonicalMessageContentSlot {
  return (message) => {
    if (message.role !== 'assistant' && message.role !== 'agent') {
      return undefined;
    }
    const reasoningText = normalizeReasoningText(message.metadata?.reasoningText);
    if (!reasoningText) {
      return undefined;
    }
    return (
      <RuntimeReasoningMessageContent
        message={message}
        reasoningText={reasoningText}
        reasoningLabel={reasoningLabel}
      />
    );
  };
}

export function RuntimeStreamFooter(props: {
  chatId: string;
  assistantName: string;
  assistantAvatarUrl: string | null;
  assistantKind: 'agent' | 'human';
  streamState: StreamState | null;
  optimisticWaiting?: boolean;
  stopLabel: string;
  interruptedLabel: string;
  reasoningLabel: ReactNode;
  waitingLabel?: string;
  showStreamingText?: boolean;
}) {
  if (props.optimisticWaiting && (!props.streamState || props.streamState.phase === 'idle')) {
    return (
      <ChatStreamStatus
        mode="streaming"
        partialText={props.waitingLabel || '...'}
        reasoningText=""
        reasoningLabel={props.reasoningLabel}
      />
    );
  }

  if (props.streamState && (props.streamState.phase === 'waiting' || props.streamState.phase === 'streaming')) {
    const showStreamingText = props.showStreamingText !== false;
    const visiblePartialText = showStreamingText
      ? (
        props.streamState.partialText
        || (props.streamState.phase === 'waiting'
          ? (props.waitingLabel || '...')
          : '')
      )
      : (props.waitingLabel || '...');
    const stopIcon = (
      <button
        type="button"
        onClick={() => cancelStream(props.chatId)}
        className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-400 shadow-sm transition-all duration-150 hover:border-red-300 hover:bg-red-50 hover:text-red-500 hover:shadow-md active:scale-95"
        aria-label={props.stopLabel}
        title={props.stopLabel}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    );
    return (
      <ChatStreamStatus
        mode="streaming"
        partialText={visiblePartialText}
        reasoningText={props.streamState.partialReasoningText}
        reasoningLabel={props.reasoningLabel}
        actions={stopIcon}
      />
    );
  }

  if (props.streamState && (props.streamState.phase === 'error' || props.streamState.phase === 'cancelled') && props.streamState.interrupted) {
    return (
      <ChatStreamStatus
        mode="interrupted"
        partialText={props.streamState.partialText}
        reasoningText={props.streamState.partialReasoningText}
        reasoningLabel={props.reasoningLabel}
        errorMessage={props.streamState.errorMessage}
        interruptedSuffix={<span className="ml-1 text-xs text-red-400">[{props.interruptedLabel}]</span>}
      />
    );
  }

  return null;
}
