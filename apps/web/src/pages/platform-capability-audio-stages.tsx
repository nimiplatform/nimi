import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  AudioLines,
  Headphones,
  Lock,
  Mic,
  Music2,
  Pause,
  PhoneCall,
  Play,
  Radio,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX,
  WandSparkles,
} from 'lucide-react';
import type { LandingLocale } from '../landing/i18n/locale.js';
import type { CapabilityId } from './platform-capability-samples.js';

const SPECTRUM_HEIGHTS = [
  22, 36, 58, 44, 76, 62, 34, 68, 92, 74, 46, 84,
  64, 32, 72, 94, 56, 42, 82, 66, 38, 78, 88, 52,
  36, 68, 84, 48, 62, 34, 74, 90, 58, 44, 80, 64,
  38, 70, 86, 50, 34, 62, 76, 44, 56, 30, 46, 26,
] as const;

function formatSeconds(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem < 10 ? '0' : ''}${rem.toFixed(1)}`;
}

/* ==========================================================================
   Shared SSR-safe HTML5 Audio Player Hook (tracks real progress via rAF)
   ========================================================================== */
function useAudioTrack() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cancelRaf();
    const node = audioRef.current;
    audioRef.current = null;
    if (node) {
      node.onended = null;
      node.onerror = null;
      node.onloadedmetadata = null;
      node.pause();
      node.src = '';
    }
    setPlayingUrl(null);
    setProgress(0);
    setCurrentTime(0);
  }, [cancelRaf]);

  useEffect(() => stop, [stop]);

  const startLoop = useCallback((node: HTMLAudioElement) => {
    const tick = () => {
      if (audioRef.current !== node || node.paused) return;
      const d = Number.isFinite(node.duration) && node.duration > 0 ? node.duration : 0;
      setCurrentTime(node.currentTime);
      if (d > 0) {
        setDuration(d);
        setProgress(Math.min(1, node.currentTime / d));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    cancelRaf();
    rafRef.current = requestAnimationFrame(tick);
  }, [cancelRaf]);

  const playUrl = useCallback((url: string, startAtSec = 0) => {
    if (typeof Audio === 'undefined') return;
    stop();
    const node = new Audio(url);
    audioRef.current = node;
    node.onloadedmetadata = () => {
      if (audioRef.current !== node) return;
      if (Number.isFinite(node.duration) && node.duration > 0) {
        setDuration(node.duration);
        if (startAtSec > 0 && startAtSec < node.duration) {
          node.currentTime = startAtSec;
          setCurrentTime(startAtSec);
          setProgress(startAtSec / node.duration);
        }
      }
    };
    node.onended = () => {
      if (audioRef.current === node) {
        stop();
      }
    };
    node.onerror = () => {
      if (audioRef.current === node) {
        stop();
      }
    };
    setPlayingUrl(url);
    void node.play()
      .then(() => {
        if (audioRef.current === node) {
          if (startAtSec > 0 && Number.isFinite(node.duration) && startAtSec < node.duration) {
            node.currentTime = startAtSec;
          }
          startLoop(node);
        }
      })
      .catch(() => {
        if (audioRef.current === node) stop();
      });
  }, [startLoop, stop]);

  const toggle = useCallback((url: string) => {
    if (playingUrl === url) {
      stop();
    } else {
      playUrl(url, 0);
    }
  }, [playingUrl, playUrl, stop]);

  const seek = useCallback((fraction: number, fallbackUrl?: string) => {
    const clamped = Math.max(0, Math.min(0.99, fraction));
    const node = audioRef.current;
    if (node && Number.isFinite(node.duration) && node.duration > 0) {
      node.currentTime = clamped * node.duration;
      setCurrentTime(node.currentTime);
      setProgress(clamped);
    } else if (fallbackUrl) {
      playUrl(fallbackUrl, 0);
    }
  }, [playUrl]);

  return { playingUrl, progress, currentTime, duration, toggle, playUrl, stop, seek };
}

interface AudioScrubBarProps {
  className: string;
  ariaLabel: string;
  progress: number;
  isPlaying: boolean;
  onSeek: (fraction: number) => void;
  onTogglePlay: () => void;
  children: ReactNode;
}

function AudioScrubBar({
  className,
  ariaLabel,
  progress,
  isPlaying,
  onSeek,
  onTogglePlay,
  children,
}: AudioScrubBarProps) {
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const seekFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const frac = Math.max(0, Math.min(0.99, (clientX - rect.left) / rect.width));
    onSeek(frac);
  };

  return (
    <div
      ref={trackRef}
      className={className}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((isPlaying ? progress : 0) * 100)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        seekFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        seekFromClientX(e.clientX);
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setDragging(false);
      }}
      onPointerCancel={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setDragging(false);
      }}
      onKeyDown={(e) => {
        const base = isPlaying ? progress : 0;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onSeek(Math.min(0.99, base + 0.05));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onSeek(Math.max(0, base - 0.05));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onSeek(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          onSeek(0.99);
        } else if (e.key === ' ') {
          e.preventDefault();
          onTogglePlay();
        }
      }}
    >
      {children}
    </div>
  );
}

/* ==========================================================================
   12. audio.synthesize — Expressive Voice Synthesis Studio (3 Real Voices)
   ========================================================================== */
const SYNTH_VOICES = [
  {
    id: 'qingzhao',
    url: '/demo/zhiyu/qingzhao-voice.mp3',
    durationSec: 8.5,
    name: { zh: '温润清澈', en: 'Warm & Clear' },
    tone: { zh: '自然呼吸 · 舒缓叙事', en: 'Natural breath · Calm narration' },
    line: {
      zh: '昨夜雨疏风骤，浓睡不消残酒。你听，「骤」字后头要停一停，酒意才上得来。',
      en: '“Last night the rain was sparse and the wind abrupt…” Hear that brief pause—that is where the mood settles in.',
    },
  },
  {
    id: 'heguan',
    url: '/demo/explore/heguan-voice.mp3',
    durationSec: 14.1,
    name: { zh: '从容沉稳', en: 'Steady Artisan' },
    tone: { zh: '低缓笃定 · 伴侣独白', en: 'Grounded cadence · Companion monologue' },
    line: {
      zh: '急不得。等这道斜阳移到第三格窗棂，阴影最深的时候，我才好拿矿彩点出檐下的烟痕。',
      en: 'Can’t rush it. I’m waiting for the slanting sunlight to reach the third pane of the lattice window.',
    },
  },
  {
    id: 'luomi',
    url: '/demo/explore/luomi-voice.mp3',
    durationSec: 7.3,
    name: { zh: '明快利落', en: 'Crisp & Energetic' },
    tone: { zh: '节奏干脆 · 场景对白', en: 'Crisp pacing · Story dialogue' },
    line: {
      zh: '拿上铜锥和引信，咱们现在就下涵洞摸排，两个时辰内准给它重新续上！',
      en: 'Grab the copper awl and the fuse—we’ll have the line working again within four hours!',
    },
  },
] as const;

function AudioSynthesizeStage({ locale }: { locale: LandingLocale }) {
  const [voiceIdx, setVoiceIdx] = useState(0);
  const player = useAudioTrack();
  const isZh = locale === 'zh';
  const active = SYNTH_VOICES[voiceIdx]!;
  const isPlaying = player.playingUrl === active.url;
  const totalDur = isPlaying && player.duration > 0 ? player.duration : active.durationSec;

  const handleSelectVoice = (idx: number) => {
    const next = SYNTH_VOICES[idx]!;
    setVoiceIdx(idx);
    if (player.playingUrl) {
      player.playUrl(next.url);
    }
  };

  return (
    <div className="platform-rich-stage platform-stage-audio-card">
      <div className="platform-audio-top-row">
        <div className="platform-audio-pills" role="group" aria-label={isZh ? '切换人声风格' : 'Select voice timbre'}>
          {SYNTH_VOICES.map((voice, idx) => (
            <button
              key={voice.id}
              type="button"
              aria-pressed={idx === voiceIdx}
              className={idx === voiceIdx ? 'is-active' : undefined}
              onClick={() => handleSelectVoice(idx)}
            >
              <AudioLines size={12} aria-hidden="true" />
              {voice.name[locale]}
            </button>
          ))}
        </div>
        <span className="platform-stage-chip is-emerald">24 kHz WAV · {active.tone[locale]}</span>
      </div>

      <div className="platform-audio-deck">
        <button
          type="button"
          className={`platform-audio-playbtn${isPlaying ? ' is-playing' : ''}`}
          aria-label={isPlaying ? (isZh ? '暂停试听' : 'Pause sample') : (isZh ? '试听真实人声' : 'Play voice sample')}
          onClick={() => player.toggle(active.url)}
        >
          {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>

        <AudioScrubBar
          className={`platform-audio-waveform${isPlaying ? ' is-playing' : ''}`}
          ariaLabel={isZh ? '音频播放进度' : 'Audio playback progress'}
          progress={player.progress}
          isPlaying={isPlaying}
          onSeek={(frac) => player.seek(frac, active.url)}
          onTogglePlay={() => player.toggle(active.url)}
        >
          {SPECTRUM_HEIGHTS.map((h, idx) => {
            const barPos = (idx + 0.5) / SPECTRUM_HEIGHTS.length;
            const isPast = isPlaying && barPos <= player.progress;
            return (
              <span
                key={idx}
                className={isPast ? 'is-past' : undefined}
                style={{ '--bar-h': `${h}%`, animationDelay: `${idx * -0.06}s` } as React.CSSProperties}
              />
            );
          })}
        </AudioScrubBar>

        <code className="platform-audio-tc">
          {formatSeconds(isPlaying ? player.currentTime : 0)} / {formatSeconds(totalDur)}
        </code>
      </div>

      <div className="platform-audio-script-box">
        <span className="platform-audio-script-label">
          <Volume2 size={13} aria-hidden="true" />
          {isZh ? '试听台词与语气示例' : 'Expressive reading sample'}
        </span>
        <p>{active.line[locale]}</p>
      </div>
    </div>
  );
}

/* ==========================================================================
   13. audio.transcribe — Playable Speech + Live Time-Aligned Karaoke Transcript
   ========================================================================== */
const TRANSCRIBE_URL = '/demo/zhiyu/chao-voice.mp3';
const TRANSCRIBE_DURATION_SEC = 10.06;
const TRANSCRIBE_SEGMENTS = [
  {
    start: 0.0,
    end: 4.1,
    tc: '00:00.0',
    zh: '新厦门，今晚九点后东北风转强，',
    en: 'New Xiamen: northeasterly wind strengthens after 9 p.m.,',
  },
  {
    start: 4.1,
    end: 7.5,
    tc: '00:04.1',
    zh: '四十七层的阳台会有六级阵风。',
    en: 'your 47th-floor balcony may have force-six gusts.',
  },
  {
    start: 7.5,
    end: 10.2,
    tc: '00:07.5',
    zh: '番茄，记得收进来。',
    en: 'Bring the tomato plant inside.',
  },
] as const;

function AudioTranscribeStage({ locale }: { locale: LandingLocale }) {
  const player = useAudioTrack();
  const isZh = locale === 'zh';
  const isPlaying = player.playingUrl === TRANSCRIBE_URL;
  const current = isPlaying ? player.currentTime : -1;
  const totalDur = isPlaying && player.duration > 0 ? player.duration : TRANSCRIBE_DURATION_SEC;

  return (
    <div className="platform-rich-stage platform-stage-audio-card">
      <div className="platform-audio-top-row">
        <span className="platform-stage-chip">
          <Mic size={12} aria-hidden="true" />
          {isZh ? '自动识别语种 · 无需手动指定' : 'Auto Language Detection · Time-Aligned'}
        </span>
        <code className="platform-audio-meta-code">WAV / MP3 · {formatSeconds(totalDur)}</code>
      </div>

      <div className="platform-audio-deck is-compact">
        <button
          type="button"
          className={`platform-audio-playbtn${isPlaying ? ' is-playing' : ''}`}
          aria-label={isPlaying ? (isZh ? '暂停录音' : 'Pause recording') : (isZh ? '播放录音查看时间轴高亮' : 'Play recording to watch live alignment')}
          onClick={() => player.toggle(TRANSCRIBE_URL)}
        >
          {isPlaying ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
        </button>

        <AudioScrubBar
          className={`platform-audio-waveform is-compact${isPlaying ? ' is-playing' : ''}`}
          ariaLabel={isZh ? '转写录音播放进度' : 'Transcription recording progress'}
          progress={player.progress}
          isPlaying={isPlaying}
          onSeek={(frac) => player.seek(frac, TRANSCRIBE_URL)}
          onTogglePlay={() => player.toggle(TRANSCRIBE_URL)}
        >
          {SPECTRUM_HEIGHTS.map((h, idx) => {
            const barPos = (idx + 0.5) / SPECTRUM_HEIGHTS.length;
            const isPast = isPlaying && barPos <= player.progress;
            return (
              <span
                key={idx}
                className={isPast ? 'is-past' : undefined}
                style={{ '--bar-h': `${h}%`, animationDelay: `${idx * -0.06}s` } as React.CSSProperties}
              />
            );
          })}
        </AudioScrubBar>

        <code className="platform-audio-tc">
          {formatSeconds(isPlaying ? player.currentTime : 0)} / {formatSeconds(totalDur)}
        </code>
      </div>

      <div className="platform-transcribe-list">
        {TRANSCRIBE_SEGMENTS.map((seg, idx) => {
          const isCurrent = isPlaying
            ? current >= seg.start && current < seg.end
            : idx === 0;
          return (
            <button
              key={seg.tc}
              type="button"
              className={`platform-transcribe-row${isCurrent ? ' is-active' : ''}`}
              onClick={() => player.playUrl(TRANSCRIBE_URL, seg.start)}
            >
              <code>{seg.tc}</code>
              <span>{seg[locale]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ==========================================================================
   14. voice.create — Voice Cloning & Design A/B Studio
   ========================================================================== */
const VOICE_CREATE_REF = '/platform/capabilities/voice-create-ref.mp3';
const VOICE_CREATE_OUT = '/platform/capabilities/voice-create-cloned.mp3';
const VOICE_CREATE_REF_DUR = 3.6;
const VOICE_CREATE_OUT_DUR = 3.9;
const VOICE_CREATE_REF_BARS = SPECTRUM_HEIGHTS.slice(0, 28);
const VOICE_CREATE_OUT_BARS = SPECTRUM_HEIGHTS.slice(12, 40);

function VoiceCreateStage({ locale }: { locale: LandingLocale }) {
  const player = useAudioTrack();
  const isZh = locale === 'zh';
  const playingRef = player.playingUrl === VOICE_CREATE_REF;
  const playingOut = player.playingUrl === VOICE_CREATE_OUT;
  const isAnyPlaying = playingRef || playingOut;
  const refDur = playingRef && player.duration > 0 ? player.duration : VOICE_CREATE_REF_DUR;
  const outDur = playingOut && player.duration > 0 ? player.duration : VOICE_CREATE_OUT_DUR;

  return (
    <div className="platform-rich-stage platform-stage-voice-create">
      <div className={`platform-voice-card${playingRef ? ' is-playing' : ''}`}>
        <div className="platform-voice-card-head">
          <span className="platform-stage-chip">
            <Mic size={11} aria-hidden="true" />
            {isZh ? '输入 · 参考样本' : 'Input · Reference'}
          </span>
          <code>3.6 s · 24 kHz</code>
        </div>

        <div className="platform-voice-quote-box">
          <div className="platform-voice-quote-meta">
            <span>{isZh ? '原声参考片段' : 'Reference recording'}</span>
            <small>{isZh ? '青年男声' : 'Male voice'}</small>
          </div>
          <p className="platform-voice-prompt">
            {isZh
              ? '「从这里往上，路在石缝里，不在图上。」'
              : '“From here on up, the path lies in the rock seams, not on the map.”'}
          </p>
        </div>

        <div className="platform-voice-wave-row">
          <AudioScrubBar
            className={`platform-audio-waveform is-mini is-ref${playingRef ? ' is-playing' : ''}`}
            ariaLabel={isZh ? '参考声线播放进度' : 'Reference sample playback progress'}
            progress={player.progress}
            isPlaying={playingRef}
            onSeek={(frac) => player.seek(frac, VOICE_CREATE_REF)}
            onTogglePlay={() => player.toggle(VOICE_CREATE_REF)}
          >
            {VOICE_CREATE_REF_BARS.map((h, idx) => (
              <span
                key={idx}
                className={playingRef && (idx + 0.5) / VOICE_CREATE_REF_BARS.length <= player.progress ? 'is-past' : undefined}
                style={{ '--bar-h': `${h}%`, animationDelay: `${idx * -0.06}s` } as React.CSSProperties}
              />
            ))}
          </AudioScrubBar>
          <code className="platform-voice-tc">
            {formatSeconds(playingRef ? player.currentTime : 0)} / {formatSeconds(refDur)}
          </code>
        </div>

        <div className="platform-voice-traits">
          <span>{isZh ? '温润清澈' : 'Warm & Clear'}</span>
          <span>{isZh ? '自然停顿' : 'Natural Pauses'}</span>
          <span>{isZh ? '从容叙事' : 'Calm Pacing'}</span>
        </div>

        <button
          type="button"
          className={`platform-voice-listen-btn${playingRef ? ' is-playing' : ''}`}
          onClick={() => player.toggle(VOICE_CREATE_REF)}
        >
          {playingRef ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          <span>{playingRef ? (isZh ? '停止参考录音' : 'Stop reference clip') : (isZh ? '试听原始参考样本' : 'Play reference sample')}</span>
        </button>
      </div>

      <div className={`platform-voice-bridge${isAnyPlaying ? ' is-active' : ''}`} aria-hidden="true">
        <span className="platform-voice-bridge-track" />
        <span className="platform-voice-bridge-node">
          <ArrowRight size={15} />
        </span>
        <span className="platform-voice-bridge-label">CLONE</span>
      </div>

      <div className={`platform-voice-card is-cloned${playingOut ? ' is-playing' : ''}`}>
        <div className="platform-voice-card-head">
          <span className="platform-stage-chip is-emerald">
            <Sparkles size={11} aria-hidden="true" />
            {isZh ? '专属声线 · 跨应用复用' : 'Custom Voice · Reusable'}
          </span>
          <code>{isZh ? '已存音色 · 24 kHz' : 'Saved · 24 kHz'}</code>
        </div>

        <div className="platform-voice-quote-box is-cloned">
          <div className="platform-voice-quote-meta">
            <span>{isZh ? '克隆声线朗读新台词' : 'New line in cloned voice'}</span>
            <small className="is-match">{isZh ? '同声线还原' : 'Same timbre'}</small>
          </div>
          <p className="platform-voice-prompt">
            {isZh
              ? '「走到看见松树的地方，就歇一歇，别赶。」'
              : '“When you reach the pines, take a rest—no need to rush.”'}
          </p>
        </div>

        <div className="platform-voice-wave-row">
          <AudioScrubBar
            className={`platform-audio-waveform is-mini is-emerald${playingOut ? ' is-playing' : ''}`}
            ariaLabel={isZh ? '克隆声线播放进度' : 'Cloned voice playback progress'}
            progress={player.progress}
            isPlaying={playingOut}
            onSeek={(frac) => player.seek(frac, VOICE_CREATE_OUT)}
            onTogglePlay={() => player.toggle(VOICE_CREATE_OUT)}
          >
            {VOICE_CREATE_OUT_BARS.map((h, idx) => (
              <span
                key={idx}
                className={playingOut && (idx + 0.5) / VOICE_CREATE_OUT_BARS.length <= player.progress ? 'is-past' : undefined}
                style={{ '--bar-h': `${h}%`, animationDelay: `${idx * -0.07}s` } as React.CSSProperties}
              />
            ))}
          </AudioScrubBar>
          <code className="platform-voice-tc">
            {formatSeconds(playingOut ? player.currentTime : 0)} / {formatSeconds(outDur)}
          </code>
        </div>

        <div className="platform-voice-reuse-row">
          <small>{isZh ? '全生态直调' : 'Reused in'}</small>
          <span>{isZh ? '织羽 · VoiceStudio · VideoLingo' : 'Zhiyu · VoiceStudio · VideoLingo'}</span>
        </div>

        <button
          type="button"
          className={`platform-voice-listen-btn is-primary${playingOut ? ' is-playing' : ''}`}
          onClick={() => player.toggle(VOICE_CREATE_OUT)}
        >
          {playingOut ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          <span>{playingOut ? (isZh ? '停止专属声线' : 'Stop custom voice') : (isZh ? '试听生成的专属声线' : 'Play created custom voice')}</span>
        </button>
      </div>
    </div>
  );
}

/* ==========================================================================
   15. audio.speaker.embed — Local speaker embedding samples
   ========================================================================== */
const SPEAKERS = [
  {
    id: 'spkA',
    url: '/demo/explore/peiyu-voice.mp3',
    avatar: '/demo/explore/emberware-court-character-1.png',
    name: { zh: '佩榆的语音片段', en: 'Peiyu’s voice clip' },
    accent: 'emerald',
  },
  {
    id: 'spkB',
    url: '/demo/explore/heguan-voice.mp3',
    avatar: '/demo/explore/emberware-court-character-0.png',
    name: { zh: '禾罐的语音片段', en: 'Heguan’s voice clip' },
    accent: 'sky',
  },
] as const;

function AudioSpeakerEmbedStage({ locale }: { locale: LandingLocale }) {
  const player = useAudioTrack();
  const isZh = locale === 'zh';

  return (
    <div className="platform-rich-stage platform-stage-audio-card">
      <div className="platform-audio-top-row">
        <span className="platform-stage-chip is-emerald">
          <Lock size={11} aria-hidden="true" />
          {isZh ? '本机 ONNX 声纹提取' : 'Local ONNX speaker embeddings'}
        </span>
        <span className="platform-audio-meta-code">{isZh ? '示例录音' : 'Sample recordings'}</span>
      </div>

      <div className="platform-speaker-grid">
        {SPEAKERS.map((spk) => {
          const isPlaying = player.playingUrl === spk.url;
          return (
            <div key={spk.id} className={`platform-speaker-card is-${spk.accent}${isPlaying ? ' is-playing' : ''}`}>
              <img src={spk.avatar} alt="" className="platform-speaker-avatar" />
              <div className="platform-speaker-info">
                <strong>{spk.name[locale]}</strong>
              </div>
              <button
                type="button"
                className={`platform-audio-playbtn is-sm${isPlaying ? ' is-playing' : ''}`}
                aria-label={isPlaying ? (isZh ? `停止 ${spk.name.zh}` : `Stop ${spk.name.en}`) : (isZh ? `试听 ${spk.name.zh}` : `Play ${spk.name.en}`)}
                onClick={() => player.toggle(spk.url)}
              >
                {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==========================================================================
   16. audio.separate — Live 4-Stem Sample-Locked Web Audio Mixer (Showstopper!)
   ========================================================================== */
const SEPARATE_STEMS = [
  { id: 'vocals', url: '/platform/capabilities/separate-vocals.mp3', label: { zh: '纯人声轨', en: 'Vocals' }, color: 'emerald' },
  { id: 'drums', url: '/platform/capabilities/separate-drums.mp3', label: { zh: '鼓点节奏', en: 'Drums' }, color: 'sky' },
  { id: 'bass', url: '/platform/capabilities/separate-bass.mp3', label: { zh: '低音贝斯', en: 'Bass' }, color: 'indigo' },
  { id: 'backing', url: '/platform/capabilities/separate-backing.mp3', label: { zh: '和弦伴奏', en: 'Backing' }, color: 'amber' },
] as const;

type StemId = (typeof SEPARATE_STEMS)[number]['id'];

function AudioSeparateStage({ locale }: { locale: LandingLocale }) {
  const isZh = locale === 'zh';
  const [activeStems, setActiveStems] = useState<Record<StemId, boolean>>({
    vocals: true,
    drums: true,
    bass: true,
    backing: true,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Partial<Record<StemId, AudioBuffer>>>({});
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainsRef = useRef<Partial<Record<StemId, GainNode>>>({});
  const startTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const stopMixer = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    for (const src of sourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    sourcesRef.current = [];
    gainsRef.current = {};
    setIsPlaying(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      stopMixer();
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx) void ctx.close().catch(() => {});
    };
  }, [stopMixer]);

  // Smooth live gain update without stopping playback
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !isPlaying) return;
    for (const stem of SEPARATE_STEMS) {
      const gainNode = gainsRef.current[stem.id];
      if (gainNode) {
        gainNode.gain.setTargetAtTime(activeStems[stem.id] ? 1.0 : 0.0, ctx.currentTime, 0.025);
      }
    }
  }, [activeStems, isPlaying]);

  const togglePlay = async () => {
    if (typeof window === 'undefined') return;
    if (isPlaying) {
      stopMixer();
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    setIsLoading(true);
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioCtx();
      }
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Fetch & decode all 4 stems once
      await Promise.all(
        SEPARATE_STEMS.map(async (stem) => {
          if (buffersRef.current[stem.id]) return;
          const res = await fetch(stem.url);
          const arr = await res.arrayBuffer();
          buffersRef.current[stem.id] = await ctx.decodeAudioData(arr);
        }),
      );

      stopMixer();
      const startAt = ctx.currentTime + 0.04;
      startTimeRef.current = startAt;
      const newSources: AudioBufferSourceNode[] = [];
      const newGains: Partial<Record<StemId, GainNode>> = {};

      for (const stem of SEPARATE_STEMS) {
        const buf = buffersRef.current[stem.id];
        if (!buf) continue;
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.loop = true;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(activeStems[stem.id] ? 1.0 : 0.0, startAt);
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(startAt);
        newSources.push(source);
        newGains[stem.id] = gain;
      }

      sourcesRef.current = newSources;
      gainsRef.current = newGains;
      setIsPlaying(true);

      const loopDur = buffersRef.current.backing?.duration || 8.0;
      const tick = () => {
        if (!ctxRef.current || sourcesRef.current.length === 0) return;
        const elapsed = Math.max(0, ctxRef.current.currentTime - startTimeRef.current);
        setProgress((elapsed % loopDur) / loopDur);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      stopMixer();
    } finally {
      setIsLoading(false);
    }
  };

  const applyPreset = (preset: 'full' | 'vocals' | 'karaoke') => {
    if (preset === 'full') setActiveStems({ vocals: true, drums: true, bass: true, backing: true });
    if (preset === 'vocals') setActiveStems({ vocals: true, drums: false, bass: false, backing: false });
    if (preset === 'karaoke') setActiveStems({ vocals: false, drums: true, bass: true, backing: true });
  };

  const isFull = activeStems.vocals && activeStems.drums && activeStems.bass && activeStems.backing;
  const isVocalsOnly = activeStems.vocals && !activeStems.drums && !activeStems.bass && !activeStems.backing;
  const isKaraoke = !activeStems.vocals && activeStems.drums && activeStems.bass && activeStems.backing;

  return (
    <div className="platform-rich-stage platform-stage-separate">
      <div className="platform-separate-bar">
        <button
          type="button"
          className={`platform-audio-playbtn is-sm${isPlaying ? ' is-playing' : ''}`}
          aria-label={isPlaying ? (isZh ? '暂停分轨混音' : 'Pause stem mixer') : (isZh ? '播放四轨同步混音' : 'Play synced 4-stem mix')}
          disabled={isLoading}
          onClick={() => void togglePlay()}
        >
          {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>

        <div className="platform-separate-meta">
          <strong>{isPlaying ? (isZh ? '四轨同步播放中 · 随时点击开关静音' : '4-Stem Synced Playback · Toggle Live') : (isZh ? '点击播放，实时开关任意音轨试听分离效果' : 'Press play and mute/solo any stem live')}</strong>
          <div className="platform-separate-progress" aria-hidden="true">
            <i style={{ transform: `scaleX(${progress})` }} />
          </div>
        </div>

        <div className="platform-embed-presets" role="group" aria-label={isZh ? '快速切换分轨预设' : 'Quick stem presets'}>
          <button type="button" aria-pressed={isFull} className={isFull ? 'is-active' : undefined} onClick={() => applyPreset('full')}>
            {isZh ? '完整混音' : 'Full Mix'}
          </button>
          <button type="button" aria-pressed={isVocalsOnly} className={isVocalsOnly ? 'is-active' : undefined} onClick={() => applyPreset('vocals')}>
            {isZh ? '仅纯人声' : 'Vocals Only'}
          </button>
          <button type="button" aria-pressed={isKaraoke} className={isKaraoke ? 'is-active' : undefined} onClick={() => applyPreset('karaoke')}>
            {isZh ? '纯伴奏' : 'No Vocals'}
          </button>
        </div>
      </div>

      <div className="platform-stem-mixer-list">
        {SEPARATE_STEMS.map((stem, idx) => {
          const on = activeStems[stem.id];
          return (
            <button
              key={stem.id}
              type="button"
              className={`platform-mixer-row is-${stem.color}${on ? ' is-on' : ' is-off'}${isPlaying && on ? ' is-live' : ''}`}
              aria-pressed={on}
              onClick={() => setActiveStems((prev) => ({ ...prev, [stem.id]: !prev[stem.id] }))}
            >
              <span className="platform-mixer-name">
                {on ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
                <strong>{stem.label[locale]}</strong>
              </span>
              <span className="platform-mixer-meter" aria-hidden="true">
                {SPECTRUM_HEIGHTS.slice(idx * 3, idx * 3 + 36).map((h, bIdx) => (
                  <i key={bIdx} style={{ '--bar-h': `${h}%`, animationDelay: `${(bIdx + idx) * -0.06}s` } as React.CSSProperties} />
                ))}
              </span>
              <code className="platform-mixer-state">{on ? 'ON' : 'MUTE'}</code>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ==========================================================================
   17. audio.voice.convert — A/B Timbre & Key-Shift Studio
   ========================================================================== */
const VOICE_CONVERT_TRACKS = {
  orig: '/platform/capabilities/voice-convert-orig.mp3',
  dn2: '/platform/capabilities/voice-convert-dn2.mp3',
  zero: '/platform/capabilities/voice-convert-0st.mp3',
  up2: '/platform/capabilities/voice-convert-up2.mp3',
} as const;
const VOICE_CONVERT_DURATION_SEC = 7.2;

function AudioVoiceConvertStage({ locale }: { locale: LandingLocale }) {
  const [mode, setMode] = useState<'orig' | 'converted'>('converted');
  const [pitch, setPitch] = useState<'dn2' | 'zero' | 'up2'>('zero');
  const player = useAudioTrack();
  const isZh = locale === 'zh';

  const activeUrl = mode === 'orig' ? VOICE_CONVERT_TRACKS.orig : VOICE_CONVERT_TRACKS[pitch];
  const isPlaying = player.playingUrl === activeUrl;
  const totalDur = isPlaying && player.duration > 0 ? player.duration : VOICE_CONVERT_DURATION_SEC;

  const switchTrack = (nextMode: 'orig' | 'converted', nextPitch: 'dn2' | 'zero' | 'up2') => {
    setMode(nextMode);
    setPitch(nextPitch);
    const nextUrl = nextMode === 'orig' ? VOICE_CONVERT_TRACKS.orig : VOICE_CONVERT_TRACKS[nextPitch];
    if (player.playingUrl) {
      player.playUrl(nextUrl, player.currentTime > 0.2 ? player.currentTime : 0);
    }
  };

  return (
    <div className="platform-rich-stage platform-stage-audio-card">
      <div className="platform-audio-top-row">
        <div className="platform-audio-pills" role="group" aria-label={isZh ? '切换原声与转换后音色' : 'Switch original vs converted timbre'}>
          <button
            type="button"
            aria-pressed={mode === 'orig'}
            className={mode === 'orig' ? 'is-active' : undefined}
            onClick={() => switchTrack('orig', pitch)}
          >
            <Mic size={12} aria-hidden="true" />
            {isZh ? '原唱清唱小样' : 'Original Dry Vocal'}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'converted'}
            className={mode === 'converted' ? 'is-active' : undefined}
            onClick={() => switchTrack('converted', pitch)}
          >
            <WandSparkles size={12} aria-hidden="true" />
            {isZh ? '转换目标歌喉' : 'Converted Target Voice'}
          </button>
        </div>

        <div className="platform-embed-presets" role="group" aria-label={isZh ? '选择升降半音' : 'Select pitch shift'}>
          <button
            type="button"
            aria-pressed={mode === 'converted' && pitch === 'dn2'}
            className={mode === 'converted' && pitch === 'dn2' ? 'is-active' : undefined}
            onClick={() => switchTrack('converted', 'dn2')}
          >
            -2 st
          </button>
          <button
            type="button"
            aria-pressed={mode === 'converted' && pitch === 'zero'}
            className={mode === 'converted' && pitch === 'zero' ? 'is-active' : undefined}
            onClick={() => switchTrack('converted', 'zero')}
          >
            0 st
          </button>
          <button
            type="button"
            aria-pressed={mode === 'converted' && pitch === 'up2'}
            className={mode === 'converted' && pitch === 'up2' ? 'is-active' : undefined}
            onClick={() => switchTrack('converted', 'up2')}
          >
            +2 st
          </button>
        </div>
      </div>

      <div className="platform-audio-deck">
        <button
          type="button"
          className={`platform-audio-playbtn${isPlaying ? ' is-playing' : ''}`}
          aria-label={isPlaying ? (isZh ? '暂停试听' : 'Pause playback') : (isZh ? '播放当前人声' : 'Play current vocal')}
          onClick={() => player.toggle(activeUrl)}
        >
          {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>

        <AudioScrubBar
          className={`platform-audio-waveform${mode === 'converted' ? ' is-emerald' : ''}${isPlaying ? ' is-playing' : ''}`}
          ariaLabel={isZh ? '声音转换播放进度' : 'Voice conversion playback progress'}
          progress={player.progress}
          isPlaying={isPlaying}
          onSeek={(frac) => player.seek(frac, activeUrl)}
          onTogglePlay={() => player.toggle(activeUrl)}
        >
          {SPECTRUM_HEIGHTS.map((h, idx) => (
            <span
              key={idx}
              className={isPlaying && (idx + 0.5) / SPECTRUM_HEIGHTS.length <= player.progress ? 'is-past' : undefined}
              style={{ '--bar-h': `${h}%`, animationDelay: `${idx * -0.06}s` } as React.CSSProperties}
            />
          ))}
        </AudioScrubBar>

        <code className="platform-audio-tc">
          {formatSeconds(isPlaying ? player.currentTime : 0)} / {formatSeconds(totalDur)}
        </code>
      </div>

      <div className="platform-audio-script-box">
        <span className="platform-audio-script-label">
          <Sliders size={13} aria-hidden="true" />
          {mode === 'orig'
            ? (isZh ? '当前播放：原始清唱干声（轻柔女声 · 完整保留呼吸与咬字）' : 'Playing: Original dry singing vocal (airy female · phrasing & breath preserved)')
            : (isZh
                ? `当前播放：目标歌喉迁移（醇厚男声 · ${pitch === 'zero' ? '原调' : pitch === 'up2' ? '升 2 半音 · 清亮' : '降 2 半音 · 深沉'}，零变速变拍）`
                : `Playing: Converted target singer (warm male · ${pitch === 'zero' ? 'original key' : pitch === 'up2' ? '+2 semitones' : '-2 semitones'}, exact rhythm preserved)`)}
        </span>
        <p>
          {isZh
            ? '播放中可随时点击上方 A/B 与半音按钮，实时对比咬字节奏完全贴合下的嗓音蜕变。'
            : 'Switch between Original and Target + semitone presets mid-playback to compare seamless timbre transfer.'}
        </p>
      </div>
    </div>
  );
}

/* ==========================================================================
   18. music.generate — Original 44.1kHz Stereo Soundtrack Studio
   ========================================================================== */
const MUSIC_GEN_URL = '/platform/capabilities/music-generate-cue.mp3';

function MusicGenerateStage({ locale }: { locale: LandingLocale }) {
  const player = useAudioTrack();
  const isZh = locale === 'zh';
  const isPlaying = player.playingUrl === MUSIC_GEN_URL;
  const totalDur = isPlaying && player.duration > 0 ? player.duration : 12.0;

  return (
    <div className="platform-rich-stage platform-stage-music-gen">
      <div className="platform-music-head">
        <span className="platform-stage-pill is-static is-emerald">
          <Music2 size={12} aria-hidden="true" />
          {isZh ? '情绪提示：晨光海岸 · 温暖木钢琴与弦乐铺底' : 'Prompt: Sunlit coast · warm felt piano & lush strings'}
        </span>
        <code className="platform-music-spec">44.1 kHz · STEREO</code>
      </div>

      <div className="platform-music-visualizer">
        <button
          type="button"
          className={`platform-audio-playbtn is-music${isPlaying ? ' is-playing' : ''}`}
          aria-label={isPlaying ? (isZh ? '暂停原创配乐' : 'Pause soundtrack') : (isZh ? '播放立体声原创配乐' : 'Play stereo soundtrack')}
          onClick={() => player.toggle(MUSIC_GEN_URL)}
        >
          {isPlaying ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
        </button>

        <AudioScrubBar
          className={`platform-music-bars${isPlaying ? ' is-playing' : ''}`}
          ariaLabel={isZh ? '原创配乐播放进度' : 'Soundtrack playback progress'}
          progress={player.progress}
          isPlaying={isPlaying}
          onSeek={(frac) => player.seek(frac, MUSIC_GEN_URL)}
          onTogglePlay={() => player.toggle(MUSIC_GEN_URL)}
        >
          {SPECTRUM_HEIGHTS.map((h, idx) => {
            const isPast = isPlaying && (idx + 0.5) / SPECTRUM_HEIGHTS.length <= player.progress;
            return (
              <span
                key={idx}
                className={isPast ? 'is-past' : undefined}
                style={{ '--bar-h': `${h}%`, animationDelay: `${idx * -0.055}s` } as React.CSSProperties}
              />
            );
          })}
        </AudioScrubBar>

        <code className="platform-music-tc">
          {formatSeconds(isPlaying ? player.currentTime : 0)} / {formatSeconds(totalDur)}
        </code>
      </div>

      <div className="platform-music-foot">
        <div className="platform-music-tags">
          <span>Felt Piano</span>
          <span>Stereo Strings</span>
          <span>Celesta</span>
          <span>Cmaj9 · 80 BPM</span>
        </div>
        <span className="platform-music-hint">
          <Headphones size={12} aria-hidden="true" />
          {isZh ? '点击试听 12 秒原创立体声乐段' : 'Click to audition 12 s stereo cue'}
        </span>
      </div>
    </div>
  );
}

/* ==========================================================================
   19. music.transcribe — Interactive Synced MIDI Piano Roll + Audio A/B
   ========================================================================== */
const TRANSCRIBE_PIANO_URL = '/platform/capabilities/music-transcribe-piano.mp3';
const TRANSCRIBE_MIDI_URL = '/platform/capabilities/music-transcribe-midi.mp3';

// Exact 1:1 note map matching build-phase2-audio.mjs (duration = 8.0s, MIDI pitch 60..72)
const PIANO_ROLL_NOTES = [
  { midi: 60, name: 'C4', start: 0.0, dur: 0.48 },
  { midi: 64, name: 'E4', start: 0.5, dur: 0.48 },
  { midi: 67, name: 'G4', start: 1.0, dur: 0.48 },
  { midi: 71, name: 'B4', start: 1.5, dur: 0.48 },
  { midi: 69, name: 'A4', start: 2.0, dur: 0.72 },
  { midi: 67, name: 'G4', start: 2.75, dur: 0.45 },
  { midi: 64, name: 'E4', start: 3.25, dur: 0.70 },
  { midi: 65, name: 'F4', start: 4.0, dur: 0.48 },
  { midi: 69, name: 'A4', start: 4.5, dur: 0.48 },
  { midi: 72, name: 'C5', start: 5.0, dur: 0.92 },
  { midi: 71, name: 'B4', start: 6.0, dur: 0.48 },
  { midi: 67, name: 'G4', start: 6.5, dur: 0.48 },
  { midi: 64, name: 'E4', start: 7.0, dur: 0.90 },
] as const;

const PIANO_CHORDS = [
  { label: 'Cmaj7', bar: 1 },
  { label: 'Am7', bar: 2 },
  { label: 'Fmaj7', bar: 3 },
  { label: 'G7', bar: 4 },
] as const;

const PIANO_KEYS = ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'C4'] as const;
const PIANO_KEY_ROW: Readonly<Record<string, number>> = {
  C5: 0,
  B4: 1,
  A4: 2,
  G4: 3,
  F4: 4,
  E4: 5,
  C4: 6,
};

function MusicTranscribeStage({ locale }: { locale: LandingLocale }) {
  const [sourceMode, setSourceMode] = useState<'piano' | 'midi'>('piano');
  const player = useAudioTrack();
  const isZh = locale === 'zh';

  const activeUrl = sourceMode === 'piano' ? TRANSCRIBE_PIANO_URL : TRANSCRIBE_MIDI_URL;
  const isPlaying = player.playingUrl === activeUrl;
  const currentSec = isPlaying ? player.currentTime : -1;

  const switchMode = (next: 'piano' | 'midi') => {
    setSourceMode(next);
    const url = next === 'piano' ? TRANSCRIBE_PIANO_URL : TRANSCRIBE_MIDI_URL;
    if (player.playingUrl) {
      player.playUrl(url, player.currentTime > 0.1 ? player.currentTime : 0);
    }
  };

  return (
    <div className="platform-rich-stage platform-stage-piano-roll">
      <div className="platform-pianoroll-toolbar">
        <button
          type="button"
          className={`platform-audio-playbtn is-sm${isPlaying ? ' is-playing' : ''}`}
          aria-label={isPlaying ? (isZh ? '暂停扒谱回放' : 'Pause playback') : (isZh ? '播放并同步高亮 MIDI 音符' : 'Play with live MIDI highlight')}
          onClick={() => player.toggle(activeUrl)}
        >
          {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>

        <div className="platform-embed-presets" role="group" aria-label={isZh ? '切换原录音或 MIDI 回放' : 'Switch acoustic recording vs MIDI playback'}>
          <button type="button" aria-pressed={sourceMode === 'piano'} className={sourceMode === 'piano' ? 'is-active' : undefined} onClick={() => switchMode('piano')}>
            {isZh ? '原钢琴录音' : 'Acoustic Piano'}
          </button>
          <button type="button" aria-pressed={sourceMode === 'midi'} className={sourceMode === 'midi' ? 'is-active' : undefined} onClick={() => switchMode('midi')}>
            {isZh ? '提取 MIDI 回放' : 'Extracted MIDI'}
          </button>
        </div>

        <code className="platform-audio-meta-code">SMF-0 · MIDI / ABC</code>
      </div>

      <div className="platform-pianoroll-body">
        <div className="platform-pianoroll-chords">
          <span className="platform-pianoroll-corner">KEY</span>
          {PIANO_CHORDS.map((ch, idx) => {
            const activeBar = isPlaying && currentSec >= idx * 2 && currentSec < (idx + 1) * 2;
            return (
              <span key={ch.label} className={activeBar ? 'is-active' : undefined}>
                {ch.label}
              </span>
            );
          })}
        </div>

        <div className="platform-pianoroll-grid-wrap">
          <div className="platform-pianoroll-keys" aria-hidden="true">
            {PIANO_KEYS.map((k) => (
              <span key={k}>{k}</span>
            ))}
          </div>

          <AudioScrubBar
            className="platform-pianoroll-canvas"
            ariaLabel={isZh ? '钢琴卷帘播放进度' : 'Piano roll playback progress'}
            progress={player.progress}
            isPlaying={isPlaying}
            onSeek={(frac) => player.seek(frac, activeUrl)}
            onTogglePlay={() => player.toggle(activeUrl)}
          >
            {PIANO_ROLL_NOTES.map((note, idx) => {
              const row = PIANO_KEY_ROW[note.name] ?? 3;
              const topPct = ((row + 0.5) / PIANO_KEYS.length) * 100;
              const leftPct = (note.start / 8.0) * 100;
              const widthPct = (note.dur / 8.0) * 100;
              const isLit = isPlaying && currentSec >= note.start && currentSec <= note.start + note.dur + 0.12;
              return (
                <span
                  key={idx}
                  className={`platform-midi-block${isLit ? ' is-lit' : ''}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: `calc(${topPct}% - 8px)` }}
                >
                  <small>{note.name}</small>
                </span>
              );
            })}
            <span
              className="platform-pianoroll-head-track"
              style={{ transform: `translate3d(${(isPlaying ? player.progress : 0.12) * 100}%, 0, 0)` }}
              aria-hidden="true"
            >
              <span className={`platform-pianoroll-head${isPlaying ? ' is-playing' : ''}`} />
            </span>
          </AudioScrubBar>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   20. realtime.interact — Live Full-Duplex Voice Call & Barge-In Stage
   ========================================================================== */
const REALTIME_REPLY_URL = '/demo/explore/heguan-voice.mp3';

// Exact time-aligned captions matching /demo/explore/heguan-voice.mp3 (14.08 s)
const REALTIME_SEGMENTS = [
  {
    start: 0.0,
    end: 5.2,
    zh: '借光，劳驾往旁边侧半步，别挡了照在方凳上的天光。',
    en: 'Excuse me—step half a pace aside so you don’t block the skylight on the stool.',
    cutZh: '借光，劳驾往旁边侧半步——',
    cutEn: 'Excuse me—step half a pace aside—',
  },
  {
    start: 5.2,
    end: 10.8,
    zh: '今天晨光正好，我正起着佩榆阿姨在檐下拣菜的轮廓呢。',
    en: 'The morning light is just right; I’m outlining Auntie Peiyu sorting greens under the eaves.',
    cutZh: '今天晨光正好，我正起着佩榆阿姨——',
    cutEn: 'The morning light is just right; I’m outlining Auntie Peiyu—',
  },
  {
    start: 10.8,
    end: 14.08,
    zh: '等我收稳这几笔刀线，再同你说话。',
    en: 'Let me steady these last few chisel strokes, then I’ll talk with you.',
    cutZh: '等我收稳这几笔刀线——',
    cutEn: 'Let me steady these last few chisel strokes—',
  },
] as const;

const REALTIME_PIVOT_CLOSING = { start: 11.22, duration: 2.86, segmentIdx: 2 } as const;
const REALTIME_PIVOT_ALT = { start: 5.72, duration: 4.65, segmentIdx: 1 } as const;
const REALTIME_AUTO_BARGEIN_MS = 2450;
const REALTIME_BARGEIN_GAP_MS = 320;

type RealtimePhase = 'idle' | 'speaking' | 'interrupting' | 'pivoted';
type BargeInRecord = {
  cutSegmentIdx: number;
  pivotSegmentIdx: number;
};

function findRealtimeSegmentIndex(sec: number): number {
  for (let i = REALTIME_SEGMENTS.length - 1; i >= 0; i -= 1) {
    if (sec >= REALTIME_SEGMENTS[i]!.start) return i;
  }
  return 0;
}

function playBargeInCue(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const tones = [
    { freq: 523.25, start: 0.0, dur: 0.075 },
    { freq: 783.99, start: 0.065, dur: 0.11 },
  ];
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(tone.freq, now + tone.start);
    gain.gain.setValueAtTime(0.0001, now + tone.start);
    gain.gain.exponentialRampToValueAtTime(0.11, now + tone.start + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.start + tone.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + tone.start);
    osc.stop(now + tone.start + tone.dur + 0.015);
  }
}

function RealtimeInteractStage({ locale }: { locale: LandingLocale }) {
  const isZh = locale === 'zh';
  const [phase, setPhase] = useState<RealtimePhase>('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSegmentIdx, setActiveSegmentIdx] = useState(0);
  const [companionProgress, setCompanionProgress] = useState(0);
  const [bargeInRecord, setBargeInRecord] = useState<BargeInRecord | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  const currentSecRef = useRef(0);
  const phaseRef = useRef<RealtimePhase>('idle');

  const updatePhase = useCallback((next: RealtimePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearScheduled = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fadeOutActiveSource = useCallback((fadeSec = 0.025) => {
    const src = sourceRef.current;
    const gain = gainRef.current;
    const ctx = ctxRef.current;
    sourceRef.current = null;
    gainRef.current = null;
    if (!src) return;
    src.onended = null;
    try {
      if (ctx && gain && fadeSec > 0) {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
        gain.gain.linearRampToValueAtTime(0.0, now + fadeSec);
        src.stop(now + fadeSec + 0.01);
      } else {
        src.stop();
      }
    } catch {
      // already stopped
    }
  }, []);

  const stopAll = useCallback((fadeSec = 0.02) => {
    runIdRef.current += 1;
    clearScheduled();
    fadeOutActiveSource(fadeSec);
    currentSecRef.current = 0;
    setCompanionProgress(0);
    updatePhase('idle');
  }, [clearScheduled, fadeOutActiveSource, updatePhase]);

  useEffect(() => {
    return () => {
      stopAll(0);
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx) void ctx.close().catch(() => {});
    };
  }, [stopAll]);

  const ensureBuffer = useCallback(async (): Promise<{ ctx: AudioContext; buffer: AudioBuffer } | null> => {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctxRef.current) {
      ctxRef.current = new AudioCtx();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (!bufferRef.current) {
      setIsLoading(true);
      try {
        const res = await fetch(REALTIME_REPLY_URL);
        const arr = await res.arrayBuffer();
        bufferRef.current = await ctx.decodeAudioData(arr);
      } finally {
        setIsLoading(false);
      }
    }
    return { ctx, buffer: bufferRef.current };
  }, []);

  const playWindow = useCallback((
    ctx: AudioContext,
    buffer: AudioBuffer,
    offsetSec: number,
    durationSec: number,
    nextPhase: 'speaking' | 'pivoted',
    runId: number,
  ) => {
    clearScheduled();
    fadeOutActiveSource(0.02);

    const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, buffer.duration - 0.1)));
    const safeDur = Math.max(0.1, Math.min(durationSec, buffer.duration - safeOffset));

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const startAt = ctx.currentTime + 0.01;
    gain.gain.setValueAtTime(0.001, startAt);
    gain.gain.linearRampToValueAtTime(1.0, startAt + 0.015);
    if (safeDur > 0.06) {
      gain.gain.setValueAtTime(1.0, startAt + safeDur - 0.025);
      gain.gain.linearRampToValueAtTime(0.0, startAt + safeDur);
    }
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(startAt, safeOffset, safeDur);

    sourceRef.current = source;
    gainRef.current = gain;
    currentSecRef.current = safeOffset;
    setActiveSegmentIdx(findRealtimeSegmentIndex(safeOffset));
    setCompanionProgress(0);
    updatePhase(nextPhase);

    source.onended = () => {
      if (runIdRef.current !== runId || sourceRef.current !== source) return;
      clearScheduled();
      sourceRef.current = null;
      gainRef.current = null;
      setCompanionProgress(0);
      updatePhase('idle');
    };

    const tick = () => {
      if (runIdRef.current !== runId || sourceRef.current !== source || !ctxRef.current) return;
      const elapsed = Math.max(0, ctxRef.current.currentTime - startAt);
      const sec = Math.min(safeOffset + safeDur, safeOffset + elapsed);
      currentSecRef.current = sec;
      setActiveSegmentIdx(findRealtimeSegmentIndex(sec));
      setCompanionProgress(Math.min(1, elapsed / safeDur));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [clearScheduled, fadeOutActiveSource, updatePhase]);

  const executeBargeInCut = useCallback((ctx: AudioContext, buffer: AudioBuffer, runId: number) => {
    const cutIdx = findRealtimeSegmentIndex(currentSecRef.current);
    const target = cutIdx === 2 ? REALTIME_PIVOT_ALT : REALTIME_PIVOT_CLOSING;

    clearScheduled();
    fadeOutActiveSource(0.025);
    playBargeInCue(ctx);
    setCompanionProgress(0);
    setBargeInRecord({ cutSegmentIdx: cutIdx, pivotSegmentIdx: target.segmentIdx });
    setActiveSegmentIdx(target.segmentIdx);
    updatePhase('interrupting');

    timerRef.current = window.setTimeout(() => {
      if (runIdRef.current !== runId) return;
      playWindow(ctx, buffer, target.start, target.duration, 'pivoted', runId);
    }, REALTIME_BARGEIN_GAP_MS);
  }, [clearScheduled, fadeOutActiveSource, playWindow, updatePhase]);

  const handleToggleCall = async () => {
    if (phaseRef.current !== 'idle') {
      stopAll(0.025);
      return;
    }
    const runId = ++runIdRef.current;
    try {
      const loaded = await ensureBuffer();
      if (!loaded || runIdRef.current !== runId) return;
      setBargeInRecord(null);
      playWindow(loaded.ctx, loaded.buffer, 0, loaded.buffer.duration, 'speaking', runId);
    } catch {
      if (runIdRef.current === runId) stopAll(0);
    }
  };

  const handleBargeIn = async () => {
    if (phaseRef.current === 'interrupting') return;
    const wasActive = phaseRef.current === 'speaking' || phaseRef.current === 'pivoted';
    const runId = ++runIdRef.current;
    try {
      const loaded = await ensureBuffer();
      if (!loaded || runIdRef.current !== runId) return;

      if (wasActive) {
        // Cut the currently playing sentence immediately and pivot live
        executeBargeInCut(loaded.ctx, loaded.buffer, runId);
      } else {
        // When idle, play the opening phrase and audibly cut it mid-sentence
        setBargeInRecord(null);
        playWindow(loaded.ctx, loaded.buffer, 0, loaded.buffer.duration, 'speaking', runId);
        timerRef.current = window.setTimeout(() => {
          if (runIdRef.current !== runId) return;
          executeBargeInCut(loaded.ctx, loaded.buffer, runId);
        }, REALTIME_AUTO_BARGEIN_MS);
      }
    } catch {
      if (runIdRef.current === runId) stopAll(0);
    }
  };

  const isCallLive = phase !== 'idle';
  const isCompanionSpeaking = phase === 'speaking' || phase === 'pivoted';
  const isInterrupting = phase === 'interrupting';
  const hasBargeIn = bargeInRecord !== null;
  const currentSegment = REALTIME_SEGMENTS[activeSegmentIdx] ?? REALTIME_SEGMENTS[0];
  const cutSegment = bargeInRecord ? REALTIME_SEGMENTS[bargeInRecord.cutSegmentIdx] : null;
  const pivotSegment = bargeInRecord ? REALTIME_SEGMENTS[bargeInRecord.pivotSegmentIdx] : null;

  const companionStatus = isInterrupting
    ? (isZh ? '已截断旧回复' : 'Cut mid-sentence')
    : phase === 'pivoted' || hasBargeIn
      ? (isZh ? '已截断旧回复并续答' : 'Cut & pivoted live')
      : phase === 'speaking'
        ? 'STREAMING'
        : 'FULL DUPLEX';

  const bargeInButtonLabel = isInterrupting || phase === 'pivoted'
    ? (isZh ? '已触发插话打断 · 立刻让出话筒' : 'Barge-in active · Replied instantly')
    : hasBargeIn
      ? (isZh ? '再次模拟中途插话打断' : 'Replay mid-sentence barge-in')
      : (isZh ? '模拟中途插话打断' : 'Simulate mid-sentence barge-in');

  return (
    <div className="platform-rich-stage platform-stage-realtime">
      <div className="platform-realtime-companion">
        <div className={`platform-realtime-avatar-ring${isCallLive ? ' is-live' : ''}`}>
          <img
            src="/demo/explore/emberware-court-character-0.png"
            alt={isZh ? '常驻语音伙伴头像' : 'Live voiced companion portrait'}
          />
        </div>
        <div className="platform-realtime-id">
          <strong>{isZh ? '禾罐 · 实时语音通话中' : 'Heguan · Live Duplex Call'}</strong>
          <span className="platform-stage-chip is-emerald">
            <Radio size={11} aria-hidden="true" />
            TTFB 190 ms · Full Duplex
          </span>
        </div>
        <div className="platform-realtime-actions">
          <button
            type="button"
            className={`platform-voice-listen-btn is-primary${isCallLive ? ' is-playing' : ''}`}
            disabled={isLoading}
            onClick={() => void handleToggleCall()}
          >
            {isCallLive ? <Pause size={14} aria-hidden="true" /> : <PhoneCall size={14} aria-hidden="true" />}
            <span>{isCallLive ? (isZh ? '结束语音回放' : 'Stop voice reply') : (isZh ? '试听即时语音回应' : 'Hear instant voice reply')}</span>
          </button>
          <button
            type="button"
            className={`platform-bargein-btn${hasBargeIn || isInterrupting ? ' is-active' : ''}`}
            disabled={isLoading}
            onClick={() => void handleBargeIn()}
          >
            {bargeInButtonLabel}
          </button>
        </div>
      </div>

      <div className="platform-realtime-lanes">
        <div className={`platform-realtime-lane${hasBargeIn || isInterrupting ? ' is-barge' : ''}`}>
          <div className="platform-realtime-lane-head">
            <small>{isZh ? '你 · 连续开口 / 随时插话' : 'You · Speak or interrupt anytime'}</small>
            <code>{hasBargeIn || isInterrupting ? (isZh ? '插话抢占 42 ms' : 'Barge-in 42 ms') : 'MIC OPEN'}</code>
          </div>
          <div className={`platform-audio-waveform is-mini${isInterrupting ? ' is-playing' : ''}`} aria-hidden="true">
            {SPECTRUM_HEIGHTS.slice(0, 34).map((h, idx) => (
              <span
                key={idx}
                className={(isInterrupting || (hasBargeIn && idx > 14 && idx < 28)) ? 'is-past' : undefined}
                style={{ '--bar-h': `${(hasBargeIn || isInterrupting) && idx > 14 ? Math.min(95, h + 18) : h}%`, animationDelay: `${idx * -0.07}s` } as React.CSSProperties}
              />
            ))}
          </div>
        </div>

        <div className={`platform-realtime-lane is-reply${isInterrupting ? ' is-cut' : ''}`}>
          <div className="platform-realtime-lane-head">
            <small>{isZh ? '伙伴 · 毫秒级语音回应 + 实时字幕' : 'Companion · Instant voice + captions'}</small>
            <code>{companionStatus}</code>
          </div>
          <div className={`platform-audio-waveform is-mini is-emerald${isCompanionSpeaking ? ' is-playing' : ''}`} aria-hidden="true">
            {SPECTRUM_HEIGHTS.slice(10, 44).map((h, idx) => {
              const barPos = (idx + 0.5) / 34;
              const isPast = isCompanionSpeaking && barPos <= companionProgress;
              return (
                <span
                  key={idx}
                  className={isPast ? 'is-past' : undefined}
                  style={{ '--bar-h': `${h}%`, animationDelay: `${idx * -0.07}s` } as React.CSSProperties}
                />
              );
            })}
          </div>
          <p className="platform-realtime-caption" lang={locale} aria-live="polite">
            {cutSegment && pivotSegment ? (
              <>
                <span className="platform-realtime-caption-cut">
                  <em className="platform-realtime-cut-tag">{isZh ? '已截断' : 'Cut'}</em>
                  <del>{isZh ? `「${cutSegment.cutZh}」` : `“${cutSegment.cutEn}”`}</del>
                </span>
                <span className="platform-realtime-caption-live">
                  {isInterrupting
                    ? (isZh ? '正在让出话筒并切入新回应…' : 'Yielding the floor and pivoting live…')
                    : (isZh ? `「${pivotSegment.zh}」` : `“${pivotSegment.en}”`)}
                </span>
              </>
            ) : (
              <span className="platform-realtime-caption-live">
                {isZh ? `「${currentSegment.zh}」` : `“${currentSegment.en}”`}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export function PlatformCapabilityAudioStage({
  capability,
  locale,
}: {
  capability: CapabilityId;
  locale: LandingLocale;
}) {
  switch (capability) {
    case 'audio.synthesize':
      return <AudioSynthesizeStage locale={locale} />;
    case 'audio.transcribe':
      return <AudioTranscribeStage locale={locale} />;
    case 'voice.create':
      return <VoiceCreateStage locale={locale} />;
    case 'audio.speaker.embed':
      return <AudioSpeakerEmbedStage locale={locale} />;
    case 'audio.separate':
      return <AudioSeparateStage locale={locale} />;
    case 'audio.voice.convert':
      return <AudioVoiceConvertStage locale={locale} />;
    case 'music.generate':
      return <MusicGenerateStage locale={locale} />;
    case 'music.transcribe':
      return <MusicTranscribeStage locale={locale} />;
    case 'realtime.interact':
      return <RealtimeInteractStage locale={locale} />;
    default:
      return null;
  }
}
