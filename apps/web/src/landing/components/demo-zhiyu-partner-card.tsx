import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { ArrowRight, Globe, Pause, Play } from 'lucide-react';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import type { HeroDemoZhiyuPartner } from '../content/landing-content.js';

export function DemoZhiyuPartnerCard({
  partner,
  placement,
  onSelect,
  onOpen,
  children,
}: {
  partner: HeroDemoZhiyuPartner;
  placement: 'rail' | 'composer';
  children: ReactElement;
  onSelect?: () => void;
  onOpen: (section: 'overview' | 'cognition') => void;
}) {
  const { t } = useAppPreviewLocale();
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const schedule = (next: boolean) => {
    cancel();
    timer.current = setTimeout(() => setOpen(next), next ? 180 : 200);
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
  const intro = partner.introduction;
  const image = intro?.referenceImageUrl;
  const go = (section: 'overview' | 'cognition') => {
    setOpen(false);
    onOpen(section);
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
            keyboard.current = true;
            setOpen(true);
            content.current?.focus();
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
        side={placement === 'rail' ? 'right' : 'top'}
        align={placement === 'rail' ? 'center' : 'start'}
        sideOffset={10}
        className="zhiyu-partner-preview"
        onMouseEnter={cancel}
        onMouseLeave={() => schedule(false)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (keyboard.current) {
            content.current?.focus();
            keyboard.current = false;
          }
        }}
      >
        <div
          ref={content}
          tabIndex={-1}
          className={`zhiyu-partner-preview__layout${image ? '' : ' is-compact'}`}
          aria-label={partner.name}
          data-demo-zhiyu-partner-card
          onFocusCapture={cancel}
        >
          {image && (
            <div className="zhiyu-partner-preview__art">
              <img src={image} alt={partner.name} />
            </div>
          )}
          <div className="zhiyu-partner-preview__copy">
            <h3>{partner.name}</h3>
            {intro?.voicePreviewUrl && (
              <div className="zhiyu-partner-preview__voice">
                <audio
                  ref={audio}
                  src={intro.voicePreviewUrl}
                  preload="none"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
                <button
                  type="button"
                  aria-pressed={playing}
                  onClick={() => {
                    setFailed(false);
                    if (playing) audio.current?.pause();
                    else void audio.current?.play().catch(() => setFailed(true));
                  }}
                >
                  <span>{playing ? <Pause size={12} /> : <Play size={12} />}</span>
                  {t(playing ? 'zhiyu.current.pause' : 'zhiyu.current.listen')}
                </button>
                {failed && <p role="status">{t('zhiyu.current.voiceFailed')}</p>}
              </div>
            )}
            {(partner.bio || intro?.role) && <p className="zhiyu-partner-preview__intro">{partner.bio ?? intro?.role}</p>}
            {intro?.worldName && (
              <p className="zhiyu-partner-preview__world">
                <Globe size={14} />
                {intro.worldName}
              </p>
            )}
            <div className="zhiyu-partner-preview__actions">
              <button type="button" onClick={() => go('overview')}>
                {t('zhiyu.copy.agentCenterLabel')}
                <ArrowRight size={16} />
              </button>
              <button type="button" onClick={() => go('cognition')}>
                {t('zhiyu.current.memory')}
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
