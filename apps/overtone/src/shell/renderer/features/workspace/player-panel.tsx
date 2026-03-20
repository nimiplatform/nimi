import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { Waveform } from './waveform.js';

export function PlayerPanel() {
  const takes = useAppStore((state) => state.takes);
  const selectedTakeId = useAppStore((state) => state.selectedTakeId);
  const audioBuffers = useAppStore((state) => state.audioBuffers);
  const trimStart = useAppStore((state) => state.trimStart);
  const trimEnd = useAppStore((state) => state.trimEnd);
  const setTrimStart = useAppStore((state) => state.setTrimStart);
  const setTrimEnd = useAppStore((state) => state.setTrimEnd);
  const clearTrim = useAppStore((state) => state.clearTrim);

  const selectedTake = takes.find((take) => take.takeId === selectedTakeId);
  const audioData = selectedTakeId ? audioBuffers.get(selectedTakeId) : undefined;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef(0);
  const offsetRef = useRef(0);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped
      }
      sourceRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    stopPlayback();
    setCurrentTime(0);
    setDuration(0);
    decodedBufferRef.current = null;
    offsetRef.current = 0;

    if (!audioData) {
      return;
    }

    const context = getAudioContext();
    context.decodeAudioData(audioData.slice(0)).then((decoded) => {
      decodedBufferRef.current = decoded;
      setDuration(decoded.duration);
    }).catch(() => {
      decodedBufferRef.current = null;
    });
  }, [audioData, getAudioContext, selectedTakeId, stopPlayback]);

  useEffect(() => stopPlayback, [stopPlayback]);

  const startPlayback = useCallback((fromOffset?: number) => {
    const decoded = decodedBufferRef.current;
    if (!decoded) return;

    const context = getAudioContext();
    if (context.state === 'suspended') {
      void context.resume();
    }

    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);

    const effectiveStart = trimStart ?? 0;
    const effectiveEnd = trimEnd ?? decoded.duration;

    const offset = fromOffset !== undefined
      ? fromOffset
      : offsetRef.current < effectiveStart
        ? effectiveStart
        : offsetRef.current;
    const playDuration = effectiveEnd - offset;

    if (playDuration <= 0) {
      offsetRef.current = effectiveStart;
      return;
    }

    source.onended = () => {
      stopPlayback();
      setCurrentTime(effectiveEnd);
      offsetRef.current = effectiveStart;
    };

    source.start(0, offset, playDuration);
    sourceRef.current = source;
    startTimeRef.current = context.currentTime - offset;
    setIsPlaying(true);

    const tick = () => {
      const elapsed = context.currentTime - startTimeRef.current;
      const clamped = Math.min(elapsed, effectiveEnd);
      setCurrentTime(clamped);
      if (elapsed < effectiveEnd) {
        animationRef.current = requestAnimationFrame(tick);
      }
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [getAudioContext, stopPlayback, trimStart, trimEnd]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      const context = getAudioContext();
      offsetRef.current = context.currentTime - startTimeRef.current;
      stopPlayback();
      return;
    }
    startPlayback();
  }, [getAudioContext, isPlaying, stopPlayback, startPlayback]);

  const handleSeek = useCallback((time: number) => {
    if (isPlaying) {
      stopPlayback();
      offsetRef.current = time;
      setCurrentTime(time);
      startPlayback(time);
    } else {
      offsetRef.current = time;
      setCurrentTime(time);
    }
  }, [isPlaying, stopPlayback, startPlayback]);

  /* ─── Global keyboard event listeners ─── */
  useEffect(() => {
    function onToggle() {
      handlePlayPause();
    }
    function onSeekDelta(e: Event) {
      const delta = (e as CustomEvent<number>).detail;
      const newTime = Math.max(0, Math.min(duration, currentTime + delta));
      handleSeek(newTime);
    }
    window.addEventListener('ot-toggle-playback', onToggle);
    window.addEventListener('ot-seek-delta', onSeekDelta);
    return () => {
      window.removeEventListener('ot-toggle-playback', onToggle);
      window.removeEventListener('ot-seek-delta', onSeekDelta);
    };
  }, [handlePlayPause, handleSeek, duration, currentTime]);

  const handleSetTrimStart = useCallback(() => {
    setTrimStart(currentTime);
  }, [currentTime, setTrimStart]);

  const handleSetTrimEnd = useCallback(() => {
    setTrimEnd(currentTime);
  }, [currentTime, setTrimEnd]);

  const hasAudio = Boolean(decodedBufferRef.current);

  /* ─── Empty state ─── */
  if (!selectedTake) {
    return (
      <div className="ot-glass h-[80px] flex items-center justify-center px-6 z-50 shrink-0">
        <button className="ot-play-btn" disabled type="button">
          <span className="text-sm">&#x25B6;</span>
        </button>
        <div className="flex-1 flex items-center justify-center mx-5">
          <div className="w-full h-[1px] bg-ot-surface-5 relative">
            <span className="absolute left-1/2 -translate-x-1/2 -top-3 text-[11px] text-ot-text-ghost whitespace-nowrap">
              Select a take to preview
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ot-glass h-[80px] flex items-center gap-5 px-6 z-50 shrink-0">
      {/* Play button */}
      <button
        className={`ot-play-btn${isPlaying ? ' ot-play-btn--playing' : ''}`}
        onClick={handlePlayPause}
        disabled={!hasAudio}
        type="button"
      >
        <span className="text-sm">{isPlaying ? '\u23F8' : '\u25B6'}</span>
      </button>

      {/* Track info */}
      <div className="shrink-0 min-w-0 max-w-[200px]">
        <p className="text-xs font-medium text-ot-text-primary truncate">{selectedTake.title}</p>
        <p className="text-[11px] font-mono text-ot-text-secondary tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </p>
      </div>

      {/* Waveform */}
      <div className="flex-1 min-w-0">
        {hasAudio ? (
          <Waveform
            buffer={decodedBufferRef.current}
            currentTime={currentTime}
            duration={duration}
            trimStart={trimStart}
            trimEnd={trimEnd}
            onSeek={handleSeek}
          />
        ) : (
          <div className="h-10 bg-ot-surface-3 rounded-lg flex items-center justify-center">
            <p className="text-[10px] text-ot-text-ghost">No audio data available</p>
          </div>
        )}
      </div>

      {/* Trim controls */}
      {hasAudio && (
        <div className="flex items-center gap-2 shrink-0">
          <button className="ot-btn-tertiary text-[11px] py-1 px-2" onClick={handleSetTrimStart} type="button">
            Set ▸
          </button>
          <button className="ot-btn-tertiary text-[11px] py-1 px-2" onClick={handleSetTrimEnd} type="button">
            ▸ Set
          </button>
          {(trimStart !== null || trimEnd !== null) && (
            <>
              <button className="ot-btn-tertiary text-[11px] py-1 px-2" onClick={clearTrim} type="button">
                Clear
              </button>
              <span className="text-[11px] font-mono text-ot-violet-300 tabular-nums">
                {trimStart !== null ? formatTime(trimStart) : '0:00'}
                {' – '}
                {trimEnd !== null ? formatTime(trimEnd) : formatTime(duration)}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}
