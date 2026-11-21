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
  className = '',
}: {
  src: string;
  characterName: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const playing = useCharacterVoicePreviewPlaying(src);
  const label = playing
    ? t('SourceDetail.worldCharacter.voicePause', { defaultValue: 'Pause voice' })
    : `${t('SourceDetail.worldCharacter.voicePlay', { defaultValue: 'Play voice' })} · ${characterName}`;

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
        `inline-flex h-8 items-center gap-1.5 rounded-full border border-white/20 px-2.5 text-xs font-semibold shadow-sm backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
          playing
            ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
            : 'bg-black/55 text-white hover:bg-black/75'
        } ${className}`
      }
    >
      {playing ? (
        <Pause aria-hidden className="h-3 w-3 shrink-0" fill="currentColor" strokeWidth={0} />
      ) : (
        <Play aria-hidden className="ml-0.5 h-3 w-3 shrink-0" fill="currentColor" strokeWidth={0} />
      )}
      <span className="leading-none">
        {playing
          ? t('SourceDetail.worldCharacter.voicePause', { defaultValue: 'Pause' })
          : t('SourceDetail.worldCharacter.voicePreview', { defaultValue: 'Voice' })}
      </span>
    </button>
  );
}
