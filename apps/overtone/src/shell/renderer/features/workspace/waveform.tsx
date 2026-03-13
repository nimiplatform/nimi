import React, { useRef, useEffect, useCallback } from 'react';

const BAR_COUNT = 200;

interface WaveformProps {
  buffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  trimStart: number | null;
  trimEnd: number | null;
  onSeek: (time: number) => void;
}

export function Waveform({ buffer, currentTime, duration, trimStart, trimEnd, onSeek }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const peaks = computePeaks(buffer, BAR_COUNT);
    const barWidth = rect.width / BAR_COUNT;
    const playRatio = duration > 0 ? currentTime / duration : 0;
    const trimStartRatio = trimStart !== null && duration > 0 ? trimStart / duration : null;
    const trimEndRatio = trimEnd !== null && duration > 0 ? trimEnd / duration : null;

    // Draw trim region background
    if (trimStartRatio !== null || trimEndRatio !== null) {
      const startX = (trimStartRatio ?? 0) * rect.width;
      const endX = (trimEndRatio ?? 1) * rect.width;
      ctx.fillStyle = 'rgba(34, 211, 238, 0.08)';
      ctx.fillRect(startX, 0, endX - startX, rect.height);
    }

    // Draw bars
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = i * barWidth;
      const barRatio = i / BAR_COUNT;
      const peak = peaks[i] ?? 0;
      const barHeight = Math.max(1, peak * rect.height * 0.9);
      const y = (rect.height - barHeight) / 2;

      ctx.fillStyle = barRatio <= playRatio ? '#a1a1aa' : '#52525b';
      ctx.fillRect(x + 0.5, y, barWidth - 1, barHeight);
    }

    // Draw playhead
    if (duration > 0) {
      const playX = playRatio * rect.width;
      ctx.fillStyle = '#e4e4e7';
      ctx.fillRect(playX - 0.5, 0, 1, rect.height);
    }

    // Draw trim markers
    if (trimStartRatio !== null) {
      const startX = trimStartRatio * rect.width;
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(startX - 1, 0, 2, rect.height);
    }
    if (trimEndRatio !== null) {
      const endX = trimEndRatio * rect.width;
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(endX - 1, 0, 2, rect.height);
    }
  }, [buffer, currentTime, duration, trimStart, trimEnd]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  }, [duration, onSeek]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-12 rounded cursor-pointer"
      onClick={handleClick}
    />
  );
}

function computePeaks(buffer: AudioBuffer | null, barCount: number): number[] {
  if (!buffer) return new Array(barCount).fill(0);

  const data = buffer.getChannelData(0);
  const samplesPerBar = Math.floor(data.length / barCount);
  const peaks: number[] = [];
  let maxPeak = 0;

  for (let i = 0; i < barCount; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, data.length);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(data[j]!);
      if (abs > peak) peak = abs;
    }
    peaks.push(peak);
    if (peak > maxPeak) maxPeak = peak;
  }

  if (maxPeak > 0) {
    for (let i = 0; i < peaks.length; i++) {
      peaks[i] = peaks[i]! / maxPeak;
    }
  }

  return peaks;
}
