import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import {
  parseAgentVoicePlaybackCueEnvelope,
  resolveRuntimeVoicePlaybackFrameCue,
  type AgentVoicePlaybackCueEnvelope,
} from '@nimiplatform/kit/features/avatar/runtime';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    conversationAnchorId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  }) => void;
}) {
  const bindings = useDesktopRendererBindings();
  const metadata = (props.message.metadata as Record<string, unknown> | undefined) || {};
  const voiceUrl = normalizeText(metadata.voiceUrl);
  const transcript = normalizeText(metadata.voiceTranscript);
  const playbackCueEnvelope = parseAgentVoicePlaybackCueEnvelope(metadata.playbackCueEnvelope);
  const [transcriptVisible, setTranscriptVisible] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const cancelFrameRef = useRef<(() => void) | null>(null);
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
      conversationAnchorId: props.message.sessionId,
      active,
      amplitude,
      visemeId,
    });
  }, [props.message.id, props.message.sessionId, props.onPlaybackStateChange]);

  const stopPlaybackSampling = useCallback(() => {
    cancelFrameRef.current?.();
    cancelFrameRef.current = null;
    estimatorFrameRef.current = null;
    emitPlaybackState(false);
  }, [emitPlaybackState]);

  const resolveFrameCue = useCallback((input: {
    playbackCueEnvelope: AgentVoicePlaybackCueEnvelope | null;
    currentTimeSeconds: number;
    timeDomainSamples: Uint8Array;
    frequencySamples?: Uint8Array;
  }) => {
    const frame = resolveRuntimeVoicePlaybackFrameCue({
      ...input,
      previousEstimatorFrame: null,
    });
    return {
      source: frame.source,
      cue: frame.cue,
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
        cancelFrameRef.current = bindings.clock.animationFrame((result) => {
          cancelFrameRef.current = null;
          if (result.ok) tick();
        });
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
      cancelFrameRef.current = bindings.clock.animationFrame((result) => {
        cancelFrameRef.current = null;
        if (result.ok) tick();
      });
    };
    stopPlaybackSampling();
    tick();
  }, [bindings.clock, emitPlaybackState, playbackCueEnvelope, resolveFrameCue, stopPlaybackSampling]);

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
          className="rounded-full border border-[var(--nimi-border-subtle)] px-3 py-1 text-[11px] font-medium text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-surface-card)]"
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
