import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square } from 'lucide-react';

function formatVoiceDuration(durationSec: number | null): string | null {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) {
    return null;
  }
  const total = Math.round(durationSec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Opening-voice control for the character empty state. `overlay` renders a
// circular on-image glass button, `pill` a labeled capsule. When `autoPlay` is
// set the sample starts as soon as the empty state appears (the navigation
// click supplies the user activation; if the browser still refuses, the button
// simply stays in its idle state). Clicking while playing stops and rewinds.
export function AgentEmptyCharacterVoiceButton({
  src,
  durationSec,
  autoPlay = false,
  variant = 'pill',
}: {
  src: string;
  durationSec: number | null;
  autoPlay?: boolean;
  variant?: 'pill' | 'overlay';
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!autoPlay) {
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      void audio.play().catch(() => setPlaying(false));
    }
  }, [autoPlay, src]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const handleToggle = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      return;
    }
    void audio.play().catch(() => setPlaying(false));
  };

  const stateLabel = playing
    ? t('Chat.agentEmptyVoiceStop', { defaultValue: 'Stop the opening voice' })
    : t('Chat.agentEmptyVoicePlay', { defaultValue: 'Play the opening voice' });
  const durationLabel = formatVoiceDuration(durationSec);
  const audioNode = (
    <audio
      ref={audioRef}
      src={src}
      preload="auto"
      className="hidden"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)}
    />
  );

  if (variant === 'overlay') {
    return (
      <span className="inline-flex items-center">
        {audioNode}
        <button
          type="button"
          data-agent-empty-character-voice="true"
          aria-label={stateLabel}
          aria-pressed={playing}
          onClick={handleToggle}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border text-white backdrop-blur-md transition-[background-color,border-color,transform] duration-[var(--nimi-motion-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 active:scale-95 ${
            playing
              ? 'border-white/50 bg-[rgba(9,12,20,0.62)]'
              : 'border-white/30 bg-[rgba(9,12,20,0.35)] hover:bg-[rgba(9,12,20,0.52)]'
          }`}
        >
          {playing
            ? <Square aria-hidden className="h-[13px] w-[13px]" fill="currentColor" strokeWidth={0} />
            : <Play aria-hidden className="ml-0.5 h-[14px] w-[14px]" fill="currentColor" strokeWidth={0} />}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center">
      {audioNode}
      <button
        type="button"
        data-agent-empty-character-voice="true"
        aria-label={stateLabel}
        aria-pressed={playing}
        onClick={handleToggle}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-3 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] transition-[border-color,color] duration-[var(--nimi-motion-fast)] hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)] hover:text-[var(--nimi-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-action-primary-bg)]"
      >
        {playing
          ? <Square aria-hidden className="h-[12px] w-[12px]" fill="currentColor" strokeWidth={0} />
          : <Play aria-hidden className="h-[12px] w-[12px]" fill="currentColor" strokeWidth={0} />}
        {durationLabel ? <span className="tabular-nums">{durationLabel}</span> : null}
      </button>
    </span>
  );
}
