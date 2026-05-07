import { useEffect, useRef, useState, type RefObject } from 'react';
import { S } from '../../app-shell/page-style.js';
import type { VoiceDraft } from './journal-page-helpers.js';
import type { VoiceRecordingSession } from './voice-observation-recorder.js';

const BAR_COUNT = 36;
const BAR_RING_SIZE = BAR_COUNT;

/** Format milliseconds as MM:SS. */
function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Down-sample a captured level sample array into exactly `count` peak buckets. */
function downsamplePeaks(samples: number[], count: number): number[] {
  if (samples.length === 0) return Array.from({ length: count }, () => 0);
  if (samples.length <= count) {
    const padded = samples.slice();
    while (padded.length < count) padded.unshift(0);
    return padded;
  }
  const out: number[] = new Array(count).fill(0);
  const step = samples.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = samples[j] ?? 0;
      if (v > max) max = v;
    }
    out[i] = max;
  }
  return out;
}

/* ── Live waveform driven by the recording session's getLevel() ── */

function LiveWaveform({
  sessionRef,
}: {
  sessionRef: RefObject<VoiceRecordingSession | null>;
}) {
  const ringRef = useRef<number[]>(new Array(BAR_RING_SIZE).fill(0));
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_RING_SIZE).fill(0));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      const session = sessionRef.current;
      const level = session ? session.getLevel() : 0;
      const ring = ringRef.current;
      ring.shift();
      ring.push(level);
      setBars(ring.slice());
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [sessionRef]);

  return (
    <div className="flex h-[64px] items-center justify-center gap-[3px]">
      {bars.map((level, i) => {
        const heightPct = Math.max(8, Math.min(100, level * 130));
        return (
          <span
            key={i}
            className="rounded-full transition-[height] duration-[60ms] ease-out"
            style={{
              width: 3,
              height: `${heightPct}%`,
              background: `linear-gradient(180deg, ${S.accent} 0%, #6FE0BA 100%)`,
              opacity: 0.55 + Math.min(0.45, level * 0.9),
            }}
          />
        );
      })}
    </div>
  );
}

/* ── Static waveform for the recorded preview ── */

function StaticWaveform({
  samples,
  active = false,
}: {
  samples: number[];
  active?: boolean;
}) {
  const peaks = downsamplePeaks(samples, BAR_COUNT);
  const peakMax = Math.max(0.05, ...peaks);

  return (
    <div className="flex h-[42px] items-center justify-center gap-[3px]">
      {peaks.map((level, i) => {
        const heightPct = Math.max(10, Math.min(100, (level / peakMax) * 100));
        return (
          <span
            key={i}
            className="rounded-full"
            style={{
              width: 3,
              height: `${heightPct}%`,
              background: active
                ? `linear-gradient(180deg, ${S.accent} 0%, #6FE0BA 100%)`
                : '#cbd5d3',
              opacity: active ? 0.95 : 0.7,
            }}
          />
        );
      })}
    </div>
  );
}

/* ── Live recording timer ── */

function LiveTimer({
  sessionRef,
}: {
  sessionRef: RefObject<VoiceRecordingSession | null>;
}) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const session = sessionRef.current;
      setMs(session ? session.getDurationMs() : 0);
    }, 250);
    return () => window.clearInterval(id);
  }, [sessionRef]);
  return (
    <span
      className="font-mono text-[28px] font-medium tabular-nums tracking-wide"
      style={{ color: S.text }}
    >
      {formatDuration(ms)}
    </span>
  );
}

/* ── Idle state — entry button ── */

export function VoiceIdleEntry({
  recordingSupported,
  onStart,
  onSwitchToText,
}: {
  recordingSupported: boolean;
  onStart: () => void;
  onSwitchToText: () => void;
}) {
  return (
    <div className="relative flex flex-col items-center gap-3 py-7">
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle, ${S.accent}55 0%, transparent 70%)`,
            transform: 'scale(1.6)',
            filter: 'blur(8px)',
          }}
        />
        <button
          type="button"
          onClick={onStart}
          disabled={!recordingSupported}
          className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
          style={{
            background: `linear-gradient(135deg, ${S.accent} 0%, #6FE0BA 100%)`,
            boxShadow: `0 10px 30px ${S.accent}55, 0 2px 6px rgba(0,0,0,0.08)`,
          }}
          aria-label="开始语音记录"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>
      </div>
      <p className="text-[14px] font-medium" style={{ color: S.text }}>点击开始语音记录</p>
      <button
        type="button"
        onClick={onSwitchToText}
        className="text-[13px] underline-offset-2 transition-colors hover:text-[color:var(--nimi-text)]"
        style={{ color: S.sub }}
      >
        切换文字输入
      </button>
      {!recordingSupported ? (
        <p className="mt-1 text-[12px] text-red-500">当前环境不支持录音，请在桌面端使用并授权麦克风。</p>
      ) : null}
    </div>
  );
}

/* ── Recording state — live waveform + timer + finish/cancel ── */

export function VoiceRecordingPanel({
  sessionRef,
  onStop,
  onCancel,
}: {
  sessionRef: RefObject<VoiceRecordingSession | null>;
  onStop: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="relative flex flex-col items-center gap-5 rounded-[18px] px-5 py-7"
      style={{
        background: 'linear-gradient(180deg, #f4faf7 0%, #fafafa 100%)',
        border: `1px solid ${S.accent}25`,
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5"
        style={{ color: S.sub }}
        aria-label="取消录音"
        title="取消录音"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>

      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
            style={{ background: '#ef4444' }}
          />
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: '#ef4444' }} />
        </span>
        <span className="text-[12px] font-medium tracking-wide" style={{ color: '#9ca3af' }}>录音中</span>
      </div>

      <div className="w-full max-w-[360px]">
        <LiveWaveform sessionRef={sessionRef} />
      </div>

      <LiveTimer sessionRef={sessionRef} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-5 py-2 text-[13px] font-medium transition-colors"
          style={{ background: '#f1f5f4', color: S.sub }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={onStop}
          className="flex items-center gap-2 rounded-full px-6 py-2.5 text-[14px] font-semibold text-white transition-transform hover:-translate-y-0.5"
          style={{
            background: `linear-gradient(135deg, ${S.accent} 0%, #3DB890 100%)`,
            boxShadow: `0 8px 20px ${S.accent}55`,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          完成
        </button>
      </div>
    </div>
  );
}

/* ── Ready / transcribing / transcribed — playback + actions ── */

export function VoicePreviewPanel({
  voiceDraft,
  voiceRuntimeAvailable,
  onTranscribe,
  onClear,
  onTranscriptChange,
}: {
  voiceDraft: VoiceDraft;
  voiceRuntimeAvailable: boolean | null;
  onTranscribe: () => void;
  onClear: () => void;
  onTranscriptChange: (value: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const transcribing = voiceDraft.status === 'transcribing';
  const transcribed = voiceDraft.status === 'transcribed' || voiceDraft.transcript.length > 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [voiceDraft.previewUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  return (
    <div className="space-y-4">
      <div
        className="flex items-center gap-3 rounded-[16px] px-4 py-3"
        style={{
          background: 'linear-gradient(135deg, #f6faf8 0%, #ffffff 100%)',
          border: `1px solid ${S.border}`,
        }}
      >
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95"
          style={{
            background: `linear-gradient(135deg, ${S.accent} 0%, #6FE0BA 100%)`,
            boxShadow: `0 4px 12px ${S.accent}55`,
          }}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <StaticWaveform samples={voiceDraft.levelSamples} active={isPlaying} />
        </div>

        <span className="shrink-0 font-mono text-[13px] tabular-nums" style={{ color: S.sub }}>
          {formatDuration(voiceDraft.durationMs)}
        </span>

        <button
          type="button"
          onClick={onClear}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          style={{ color: S.sub }}
          aria-label="删除录音"
          title="删除录音"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18" /><path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
          </svg>
        </button>

        {voiceDraft.previewUrl ? (
          <audio ref={audioRef} src={voiceDraft.previewUrl} preload="metadata" className="hidden" />
        ) : null}
      </div>

      {!transcribed ? (
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={onTranscribe}
            disabled={transcribing || voiceRuntimeAvailable === false}
            className="flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
            style={{
              background: '#fff',
              color: S.accent,
              border: `1px solid ${S.accent}40`,
            }}
          >
            {transcribing ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full"
                    style={{ background: S.accent }}
                  />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: S.accent }} />
                </span>
                AI 正在转写...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
                </svg>
                转为文字
              </>
            )}
          </button>
        </div>
      ) : null}

      {voiceRuntimeAvailable === false ? (
        <p className="text-center text-[12px]" style={{ color: '#b45309' }}>
          语音转写暂不可用，仍可保存语音记录。
        </p>
      ) : null}
      {voiceDraft.error ? (
        <p className="text-center text-[12px] text-red-500">{voiceDraft.error}</p>
      ) : null}

      {transcribed ? (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={S.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
            </svg>
            <span className="text-[12px] font-medium" style={{ color: S.accent }}>转写结果（可编辑）</span>
          </div>
          <textarea
            value={voiceDraft.transcript}
            onChange={(event) => onTranscriptChange(event.target.value)}
            placeholder="转写结果可以在这里继续修改..."
            className="w-full resize-none rounded-[12px] p-3 text-[14px] leading-relaxed outline-none transition-colors focus:border-[color:var(--nimi-accent)]"
            style={{ border: `1px solid ${S.border}`, background: '#fafafa' }}
            rows={4}
          />
        </div>
      ) : null}
    </div>
  );
}
