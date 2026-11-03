import { DemoHumanAvatar, DemoHumanProfileDetails } from './demo-human-profile.js';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { ArrowRight, Globe, Play, Square } from 'lucide-react';
import type { HeroDemoAgent } from '../content/landing-content.js';

/** Mirrors Home's avatar hover/click/keyboard entry using public Kit popovers. */
export function DemoChatAvatarCard({
  person,
  locale,
  placement,
  children,
  onSelect,
  onProfile,
  onMemory,
  onWorld,
}: {
  person: HeroDemoAgent;
  locale: 'zh' | 'en';
  placement: 'rail' | 'composer' | 'message';
  children: ReactElement;
  onSelect?: () => void;
  onProfile: () => void;
  onMemory?: () => void;
  onWorld?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const human = person.id.startsWith('human:');
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const schedule = (value: boolean) => {
    cancel();
    timer.current = setTimeout(() => setOpen(value), value ? 180 : 200);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) {
      audio.current?.pause();
      setPlaying(false);
    }
  }, [open]);
  const go = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        onMouseEnter={() => schedule(true)}
        onMouseLeave={() => schedule(false)}
        onFocus={() => schedule(true)}
        onBlur={() => schedule(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            cancel();
            setOpen(true);
          }
          if (event.key === 'Escape') {
            cancel();
            setOpen(false);
          }
        }}
        onClick={(event) => {
          event.preventDefault();
          cancel();
          if (placement === 'rail') {
            setOpen(false);
            onSelect?.();
          } else setOpen(true);
        }}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side={placement === 'rail' ? 'left' : 'top'}
        align={placement === 'rail' ? 'center' : 'start'}
        sideOffset={10}
        onMouseEnter={cancel}
        onMouseLeave={() => schedule(false)}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={`demo-chat-avatar-popover ${human ? 'is-human' : ''}`}
      >
        <section className="demo-chat-avatar-card" aria-label={person.name} onFocusCapture={cancel}>
          {!human && (
            <img
              className="demo-chat-avatar-card-art"
              src={person.referenceImageUrl ?? person.avatarUrl}
              alt=""
            />
          )}
          <div className="demo-chat-avatar-card-copy">
            <header>
              {human && <DemoHumanAvatar person={person} />}
              <div>
                <h3>{person.name}</h3>
                {person.handle && <small>{person.handle}</small>}
              </div>
            </header>
            {person.voiceUrl && (
              <div className="demo-chat-card-voice">
                <audio
                  ref={audio}
                  src={person.voiceUrl}
                  preload="none"
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (playing) audio.current?.pause();
                    else
                      void audio.current
                        ?.play()
                        .then(() => setPlaying(true))
                        .catch(() => setPlaying(false));
                  }}
                >
                  {playing ? <Square size={13} /> : <Play size={13} />}
                  {playing ? t('暂停声音', 'Pause voice') : t('听听声音', 'Listen to voice')} ·{' '}
                  {person.voiceDuration}
                  {t('秒', 's')}
                </button>
              </div>
            )}
            <p>{person.role || person.bio}</p>
            {human && <DemoHumanProfileDetails person={person} locale={locale} />}
            {person.worldName && onWorld && (
              <button type="button" className="demo-chat-card-world" onClick={() => go(onWorld)}>
                <Globe size={14} />
                {person.worldName}
                <ArrowRight size={14} />
              </button>
            )}
            <footer>
              <button type="button" onClick={() => go(onProfile)}>
                {t('查看资料', 'View profile')}
                <ArrowRight size={17} />
              </button>
              {onMemory && (
                <button type="button" onClick={() => go(onMemory)}>
                  {t('记忆', 'Memory')}
                </button>
              )}
            </footer>
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}
