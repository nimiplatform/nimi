import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Button, IconButton, Surface, TextareaField } from '@nimiplatform/nimi-kit/ui';
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
            className="parentos-waveform-bar parentos-waveform-bar-primary rounded-full transition-[height] duration-[60ms] ease-out"
            style={{
              '--parentos-waveform-height': `${heightPct}%`,
              '--parentos-waveform-opacity': String(0.55 + Math.min(0.45, level * 0.9)),
            } as CSSProperties}
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
            className={active ? 'parentos-waveform-bar parentos-waveform-bar-primary rounded-full' : 'parentos-waveform-bar parentos-waveform-bar-muted rounded-full'}
            style={{
              '--parentos-waveform-height': `${heightPct}%`,
              '--parentos-waveform-opacity': active ? '0.95' : '0.7',
            } as CSSProperties}
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
    <span className="font-mono text-[28px] font-medium tabular-nums tracking-wide text-[var(--nimi-text-primary)]">
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
          className="parentos-voice-orb-glow pointer-events-none absolute inset-0 rounded-full"
        />
        <button
          type="button"
          onClick={onStart}
          disabled={!recordingSupported}
          className="parentos-voice-primary-orb relative flex h-[76px] w-[76px] items-center justify-center rounded-full text-[var(--nimi-action-primary-text)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
          aria-label="开始语音记录"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>
      </div>
      <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">点击开始语音记录</p>
      <button
        type="button"
        onClick={onSwitchToText}
        className="text-[13px] text-[var(--nimi-text-muted)] underline-offset-2 transition-colors hover:text-[var(--nimi-text-primary)]"
      >
        切换文字输入
      </button>
      {!recordingSupported ? (
        <p className="mt-1 text-[12px] text-[var(--nimi-status-danger)]">当前环境不支持录音，请在桌面端使用并授权麦克风。</p>
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
    <Surface
      tone="card"
      elevation="base"
      padding="md"
      className="relative flex flex-col items-center gap-5 parentos-radius-18 border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,var(--nimi-border-subtle))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))_0%,var(--nimi-surface-card)_100%)] px-5 py-7"
    >
      <IconButton
        type="button"
        onClick={onCancel}
        tone="ghost"
        size="sm"
        className="absolute right-3 top-3 h-7 min-h-0 w-7 parentos-radius-full text-[var(--nimi-text-muted)]"
        aria-label="取消录音"
        title="取消录音"
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        }
      />

      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span
            className="parentos-status-danger-bg absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
          />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--nimi-status-danger)]" />
        </span>
        <span className="text-[12px] font-medium tracking-wide text-[var(--nimi-text-muted)]">录音中</span>
      </div>

      <div className="w-full max-w-[360px]">
        <LiveWaveform sessionRef={sessionRef} />
      </div>

      <LiveTimer sessionRef={sessionRef} />

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onCancel} tone="ghost" size="sm" className="parentos-radius-full px-5 py-2 text-[13px] font-medium">
          取消
        </Button>
        <button
          type="button"
          onClick={onStop}
          className="parentos-voice-stop-button flex items-center gap-2 rounded-full px-6 py-2.5 text-[14px] font-semibold text-[var(--nimi-action-primary-text)] transition-transform hover:-translate-y-0.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          完成
        </button>
      </div>
    </Surface>
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
      <Surface
        tone="card"
        elevation="base"
        padding="sm"
        className="flex items-center gap-3 parentos-radius-lg bg-[linear-gradient(135deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-card))_0%,var(--nimi-surface-card)_100%)] px-4 py-3"
      >
        <button
          type="button"
          onClick={togglePlay}
          className="parentos-voice-play-button flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--nimi-action-primary-text)] transition-transform hover:scale-105 active:scale-95"
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

        <span className="shrink-0 font-mono text-[13px] tabular-nums text-[var(--nimi-text-muted)]">
          {formatDuration(voiceDraft.durationMs)}
        </span>

        <IconButton
          type="button"
          onClick={onClear}
          tone="ghost"
          size="sm"
          className="h-8 min-h-0 w-8 shrink-0 parentos-radius-full text-[var(--nimi-text-muted)]"
          aria-label="删除录音"
          title="删除录音"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18" /><path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </svg>
          }
        />

        {voiceDraft.previewUrl ? (
          <audio ref={audioRef} src={voiceDraft.previewUrl} preload="metadata" className="hidden" />
        ) : null}
      </Surface>

      {!transcribed ? (
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={onTranscribe}
            disabled={transcribing || voiceRuntimeAvailable === false}
            className="parentos-transcribe-button flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
          >
            {transcribing ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span
                    className="parentos-action-primary-bg absolute inline-flex h-full w-full animate-ping rounded-full"
                  />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--nimi-action-primary-bg)]" />
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
        <p className="text-center text-[12px] text-[var(--nimi-status-warning)]">
          语音转写暂不可用，仍可保存语音记录。
        </p>
      ) : null}
      {voiceDraft.error ? (
        <p className="text-center text-[12px] text-[var(--nimi-status-danger)]">{voiceDraft.error}</p>
      ) : null}

      {transcribed ? (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--nimi-action-primary-bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
            </svg>
            <span className="text-[12px] font-medium text-[var(--nimi-action-primary-bg)]">转写结果（可编辑）</span>
          </div>
          <TextareaField
            value={voiceDraft.transcript}
            onChange={(event) => onTranscriptChange(event.target.value)}
            placeholder="转写结果可以在这里继续修改..."
            className="w-full parentos-radius-md text-[14px] leading-relaxed"
            textareaClassName="resize-none"
            rows={4}
          />
        </div>
      ) : null}
    </div>
  );
}
