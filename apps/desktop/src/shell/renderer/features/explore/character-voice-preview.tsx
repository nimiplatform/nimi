import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';

type VoiceListener = (playingSrc: string | null) => void;

let sharedAudio: HTMLAudioElement | null = null;
let activeSrc: string | null = null;
const listeners = new Set<VoiceListener>();

function notifyListeners() {
  for (const listener of listeners) {
    listener(activeSrc);
  }
}

function getSharedAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!sharedAudio) {
    const audio = new Audio();
    audio.preload = 'none';
    const clearIfEnded = () => {
      if (activeSrc !== null) {
        activeSrc = null;
        notifyListeners();
      }
    };
    audio.addEventListener('ended', clearIfEnded);
    audio.addEventListener('error', clearIfEnded);
    audio.addEventListener('pause', () => {
      if (audio.ended || audio.paused) {
        if (activeSrc !== null) {
          activeSrc = null;
          notifyListeners();
        }
      }
    });
    sharedAudio = audio;
  }
  return sharedAudio;
}

export function toggleCharacterVoicePreview(src: string): void {
  const audio = getSharedAudio();
  if (!audio) return;
  if (activeSrc === src && !audio.paused) {
    audio.pause();
    activeSrc = null;
    notifyListeners();
    return;
  }
  if (!audio.paused) {
    audio.pause();
  }
  if (audio.src !== src) {
    audio.src = src;
  }
  audio.currentTime = 0;
  activeSrc = src;
  notifyListeners();
  void audio.play().catch(() => {
    if (activeSrc === src) {
      activeSrc = null;
      notifyListeners();
    }
  });
}

export function stopCharacterVoicePreview(): void {
  if (sharedAudio && !sharedAudio.paused) {
    sharedAudio.pause();
  }
  if (activeSrc !== null) {
    activeSrc = null;
    notifyListeners();
  }
}

export function useCharacterVoicePreviewPlaying(src: string | null | undefined): boolean {
  const [playing, setPlaying] = useState(() => Boolean(src && activeSrc === src));
  useEffect(() => {
    if (!src) {
      setPlaying(false);
      return;
    }
    const listener: VoiceListener = (current) => setPlaying(current === src);
    listeners.add(listener);
    setPlaying(activeSrc === src);
    return () => {
      listeners.delete(listener);
    };
  }, [src]);
  return playing;
}

export function CharacterVoicePreviewButton({
  src,
  characterName,
  variant = 'overlay',
  iconOnly = false,
  className = '',
}: {
  src: string;
  characterName: string;
  variant?: 'overlay' | 'surface';
  iconOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const playing = useCharacterVoicePreviewPlaying(src);
  const label = playing
    ? t('SourceDetail.worldCharacter.voicePause', { defaultValue: 'Pause voice' })
    : `${t('SourceDetail.worldCharacter.voicePlay', { defaultValue: 'Play voice' })} · ${characterName}`;
  const toneClass = variant === 'surface'
    ? (playing
      ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
      : 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_22%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-panel))] text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,var(--nimi-surface-panel))]')
    : (playing
      ? 'border-white/20 bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-sm'
      : 'border-white/20 bg-black/70 text-white shadow-sm hover:bg-black/85');
  const layoutClass = iconOnly
    ? 'h-8 w-8 justify-center'
    : 'h-8 gap-1.5 px-2.5 text-xs font-semibold';
  const iconSizeClass = iconOnly ? 'h-3.5 w-3.5' : 'h-3 w-3';

  return (
    <button
      type="button"
      data-testid="character-voice-preview-button"
      data-playing={playing ? 'true' : undefined}
      aria-label={label}
      aria-pressed={playing}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        toggleCharacterVoicePreview(src);
      }}
      className={
        `inline-flex items-center rounded-full border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${layoutClass} ${toneClass} ${className}`
      }
    >
      {playing ? (
        <Pause aria-hidden className={`${iconSizeClass} shrink-0`} fill="currentColor" strokeWidth={0} />
      ) : (
        <Play aria-hidden className={`ml-0.5 ${iconSizeClass} shrink-0`} fill="currentColor" strokeWidth={0} />
      )}
      {iconOnly ? null : (
        <span className="leading-none">
          {playing
            ? t('SourceDetail.worldCharacter.voicePause', { defaultValue: 'Pause' })
            : t('SourceDetail.worldCharacter.voicePreview', { defaultValue: 'Voice' })}
        </span>
      )}
    </button>
  );
}
