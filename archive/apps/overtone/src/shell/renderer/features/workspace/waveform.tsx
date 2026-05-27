import React, { useRef, useEffect, useCallback } from 'react';

const BAR_COUNT = 200;

interface WaveformProps {
  buffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  trimStart: number | null;
  trimEnd: number | null;
  onSeek: (time: number) => void;
  mini?: boolean;
}

export function Waveform({ buffer, currentTime, duration, trimStart, trimEnd, onSeek, mini }: WaveformProps) {
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

    const barCount = mini ? 80 : BAR_COUNT;
    const peaks = computePeaks(buffer, barCount);
    const barWidth = rect.width / barCount;
    const playRatio = duration > 0 ? currentTime / duration : 0;
    const trimStartRatio = trimStart !== null && duration > 0 ? trimStart / duration : null;
    const trimEndRatio = trimEnd !== null && duration > 0 ? trimEnd / duration : null;
    const centerY = rect.height / 2;

    // Trim region background
    if (!mini && (trimStartRatio !== null || trimEndRatio !== null)) {
      const startX = (trimStartRatio ?? 0) * rect.width;
      const endX = (trimEndRatio ?? 1) * rect.width;
      ctx.fillStyle = 'rgba(139, 92, 246, 0.08)';
      ctx.fillRect(startX, 0, endX - startX, rect.height);
    }

    // Create gradient for played region
    const playedGradient = ctx.createLinearGradient(0, 0, rect.width, 0);
    playedGradient.addColorStop(0, '#8b5cf6');
    playedGradient.addColorStop(1, '#a785ff');

    // Mini mode colors
    const miniPlayedColor = 'rgba(139, 92, 246, 0.40)';
    const unplayedColor = '#2f354e';

    for (let i = 0; i < barCount; i++) {
      const x = i * barWidth;
      const barRatio = i / barCount;
      const peak = peaks[i] ?? 0;
      const minH = mini ? 1 : 2;
      const maxH = rect.height * (mini ? 0.8 : 0.42);
      const halfH = Math.max(minH, peak * maxH);
      const barW = barWidth - 2;

      const isPlayed = barRatio <= playRatio;

      if (mini) {
        ctx.fillStyle = isPlayed ? miniPlayedColor : unplayedColor;
        drawRoundedBar(ctx, x + 1, centerY - halfH, barW, halfH * 2, 2);
      } else {
        ctx.fillStyle = isPlayed ? playedGradient : unplayedColor;
        // Top half (grows upward from center)
        drawRoundedBar(ctx, x + 1, centerY - halfH, barW, halfH, 2);
        // Bottom half (grows downward from center, flat top)
        ctx.fillRect(x + 1, centerY, barW, halfH);

        // Underglow reflection (played bars only)
        if (isPlayed) {
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = playedGradient;
          ctx.fillRect(x + 1, centerY + halfH + 2, barW, halfH * 0.6);
          ctx.globalAlpha = 1.0;
        }
      }
    }

    if (mini) return;

    // Playhead
    if (duration > 0) {
      const playX = playRatio * rect.width;
      ctx.fillStyle = '#e8eaf0';
      ctx.fillRect(playX - 1, 0, 2, rect.height);
      // Diamond head
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX + 4, 4);
      ctx.lineTo(playX, 8);
      ctx.lineTo(playX - 4, 4);
      ctx.closePath();
      ctx.fill();
    }

    // Trim markers
    if (trimStartRatio !== null) {
      const startX = trimStartRatio * rect.width;
      ctx.fillStyle = '#a785ff';
      ctx.fillRect(startX - 1, 0, 2, rect.height);
    }
    if (trimEndRatio !== null) {
      const endX = trimEndRatio * rect.width;
      ctx.fillStyle = '#a785ff';
      ctx.fillRect(endX - 1, 0, 2, rect.height);
    }
  }, [buffer, currentTime, duration, trimStart, trimEnd, mini]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (mini || duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  }, [duration, onSeek, mini]);

  return (
    <canvas
      ref={canvasRef}
      className={mini ? 'w-full h-12' : 'w-full h-10 cursor-pointer'}
      onClick={handleClick}
    />
  );
}

function drawRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  if (w <= 0 || h <= 0) return;
  const r = Math.min(radius, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
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
