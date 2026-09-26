import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Play, Square } from 'lucide-react';
import { Avatar } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentIntroduction } from '@nimiplatform/kit/core/sdk-contract';
import { agentIntroductionDisplayText, agentIntroductionQuestions, agentIntroductionSubtitle } from '../agent-introduction.js';

export type AgentIntroductionProps = {
  introduction: NimiLocalAppAgentIntroduction | null;
  displayName: string;
  avatarUrl?: string | null;
  locale: string;
  questionsEnabled: boolean;
  onPrefill?: (value: string) => void;
  unavailable?: boolean;
  onRetry?: () => void;
  imageMaxSize?: string;
};

// @nimi-authority: rule.nimi.platform.app-ecosystem.agent-introduction
export function AgentIntroduction({ introduction, displayName, avatarUrl, locale, questionsEnabled, onPrefill, unavailable, onRetry, imageMaxSize = 'clamp(180px, calc(100dvh - 540px), 420px)' }: AgentIntroductionProps) {
  const zh = locale.startsWith('zh');
  const subtitle = agentIntroductionSubtitle(introduction, locale);
  const rich = Boolean(subtitle || introduction?.greeting || introduction?.referenceImageUrl || introduction?.voiceSampleUrl);
  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-6 text-center [overflow-wrap:anywhere]" data-agent-introduction="true">
      <div className="flex w-full min-w-0 flex-col items-center gap-2">
        {!rich ? <Avatar src={avatarUrl ?? null} alt={displayName} size="lg" className="h-14 w-14" /> : null}
        <h2 className={`max-w-full ${rich ? 'text-[length:var(--nimi-type-hero-title-size)] font-[var(--nimi-type-hero-title-weight)] leading-tight text-[var(--nimi-text-primary)]' : 'text-sm font-medium text-[var(--nimi-text-secondary)]'}`}>{displayName}</h2>
        {subtitle ? <p className="max-w-full text-sm text-[var(--nimi-text-muted)]">{subtitle}</p> : null}
        {!rich ? <>
          <p className="mt-1 text-[length:var(--nimi-type-page-title-size)] font-semibold text-[var(--nimi-text-primary)]">{zh ? '开始一段对话' : 'Start a conversation'}</p>
          <p className="max-w-xl text-sm leading-7 text-[var(--nimi-text-secondary)]">{zh ? '提个问题、分享想法，或者告诉这个伙伴你想探索什么。' : 'Ask a question, share an idea, or tell this agent what you want to explore.'}</p>
        </> : null}
      </div>
      {unavailable ? <p role="status" className="text-sm text-[var(--nimi-text-muted)]">
        {zh ? '人物介绍暂时无法加载。' : 'The introduction could not be loaded.'}
        {onRetry ? <button type="button" className="ml-2 underline underline-offset-4" onClick={onRetry}>{zh ? '重试' : 'Retry'}</button> : null}
      </p> : null}
      {rich ? <div className="flex w-full max-w-[420px] flex-col items-center">
        {introduction?.referenceImageUrl ? <div className="relative aspect-square w-full overflow-hidden rounded-[var(--nimi-radius-xl)] bg-[var(--nimi-surface-panel)] shadow-[var(--nimi-elevation-raised)]" style={{ maxWidth: imageMaxSize }} data-agent-empty-character-image="true">
          <img src={introduction.referenceImageUrl} alt="" className="h-full w-full object-cover object-top" />
          {introduction.voiceSampleUrl ? <div className="absolute right-3 top-3"><IntroductionVoice src={introduction.voiceSampleUrl} duration={introduction.voiceSampleDurationSec} locale={locale} /></div> : null}
        </div> : null}
        {introduction?.greeting ? <p className={`${introduction.referenceImageUrl ? 'mt-5 ' : ''}w-full whitespace-pre-line text-[length:var(--nimi-type-body-size)] leading-7 text-[var(--nimi-text-primary)]`} data-agent-empty-character-greeting="true">{agentIntroductionDisplayText(introduction.greeting, locale)}</p> : null}
        {!introduction?.referenceImageUrl && introduction?.voiceSampleUrl ? <div className="mt-3"><IntroductionVoice src={introduction.voiceSampleUrl} duration={introduction.voiceSampleDurationSec} locale={locale} /></div> : null}
      </div> : null}
      {questionsEnabled && onPrefill ? <div className="flex flex-wrap justify-center gap-2.5" data-agent-empty-suggestions="true">
        {agentIntroductionQuestions(introduction, locale).map(question => <button key={question} type="button" onClick={() => onPrefill(question)} className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-2 text-sm text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
          {question}<ChevronRight size={14} className="shrink-0" aria-hidden="true" />
        </button>)}
      </div> : null}
    </div>
  );
}

function IntroductionVoice({ src, duration, locale }: { src: string; duration: number | null; locale: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let disposed = false;
    void audio.play().catch(() => { if (!disposed) setPlaying(false); });
    return () => { disposed = true; audio.pause(); audio.currentTime = 0; };
  }, [src]);
  const label = locale.startsWith('zh') ? playing ? '停止开场语音' : '播放开场语音' : playing ? 'Stop the opening voice' : 'Play the opening voice';
  return <>
    <audio ref={audioRef} src={src} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <button type="button" aria-label={label} aria-pressed={playing} title={duration ? `${label} · ${Math.round(duration)}s` : label} data-agent-empty-character-voice="true" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]" onClick={() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (!audio.paused) { audio.pause(); audio.currentTime = 0; } else { void audio.play().catch(() => setPlaying(false)); }
    }}>{playing ? <Square size={14} fill="currentColor" aria-hidden="true" /> : <Play size={14} fill="currentColor" aria-hidden="true" />}</button>
  </>;
}
