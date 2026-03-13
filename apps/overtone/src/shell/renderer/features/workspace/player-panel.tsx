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

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      const context = getAudioContext();
      offsetRef.current = context.currentTime - startTimeRef.current;
      stopPlayback();
      return;
    }

    const decoded = decodedBufferRef.current;
    if (!decoded) {
      return;
    }

    const context = getAudioContext();
    if (context.state === 'suspended') {
      void context.resume();
    }

    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);

    const effectiveStart = trimStart ?? 0;
    const effectiveEnd = trimEnd ?? decoded.duration;

    const offset = offsetRef.current < effectiveStart ? effectiveStart : offsetRef.current;
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
  }, [getAudioContext, isPlaying, stopPlayback, trimStart, trimEnd]);

  const handleSeek = useCallback((time: number) => {
    if (isPlaying) {
      stopPlayback();
    }
    offsetRef.current = time;
    setCurrentTime(time);
  }, [isPlaying, stopPlayback]);

  const handleSetTrimStart = useCallback(() => {
    setTrimStart(currentTime);
  }, [currentTime, setTrimStart]);

  const handleSetTrimEnd = useCallback(() => {
    setTrimEnd(currentTime);
  }, [currentTime, setTrimEnd]);

  if (!selectedTake) {
    return (
      <div className="border-t border-zinc-800 px-4 py-3">
        <p className="text-xs text-zinc-600 text-center">Select a take to preview</p>
      </div>
    );
  }

  const hasAudio = Boolean(decodedBufferRef.current);

  return (
    <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <button
          className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={handlePlayPause}
          disabled={!hasAudio}
          type="button"
        >
          <span className="text-sm">{isPlaying ? '\u23F8' : '\u25B6'}</span>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-zinc-300 truncate">{selectedTake.title}</span>
            <span className="text-[10px] text-zinc-500 tabular-nums shrink-0 ml-2">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
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
            <div className="h-12 bg-zinc-800 rounded flex items-center justify-center">
              <p className="text-[10px] text-zinc-600">No audio data available for this take</p>
            </div>
          )}
        </div>
      </div>

      {hasAudio && (
        <div className="flex items-center gap-2 pl-11">
          <button
            className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            onClick={handleSetTrimStart}
            type="button"
          >
            Set Start
          </button>
          <button
            className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            onClick={handleSetTrimEnd}
            type="button"
          >
            Set End
          </button>
          {(trimStart !== null || trimEnd !== null) && (
            <>
              <button
                className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={clearTrim}
                type="button"
              >
                Clear
              </button>
              <span className="text-[10px] text-cyan-400 tabular-nums">
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
