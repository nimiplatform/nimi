import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui';
import type { LandingLocale } from '../i18n/locale.js';

export type LanguageToggleProps = {
  locale: LandingLocale;
  label: string;
  options: {
    en: string;
    zh: string;
    switchToEn: string;
    switchToZh: string;
  };
  onChange: (locale: LandingLocale) => void;
};

const LOCALE_ORDER = ['en', 'zh'] as const;

export function LanguageToggle(props: LanguageToggleProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openViaKeyboardRef = useRef(false);
  const reducedMotion = useNimiReducedMotion();
  const popoverMotion = nimiOverlayPanelMotion({
    kind: 'popover',
    side: 'bottom',
    align: 'end',
    reducedMotion,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    if (openViaKeyboardRef.current) {
      openViaKeyboardRef.current = false;
      const activeIdx = Math.max(0, LOCALE_ORDER.indexOf(props.locale));
      window.requestAnimationFrame(() => {
        itemRefs.current[activeIdx]?.focus({ preventScroll: true });
      });
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (!rootRef.current?.contains(document.activeElement)) return;
      const activeIdx = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        itemRefs.current[(activeIdx + 1 + LOCALE_ORDER.length) % LOCALE_ORDER.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        itemRefs.current[(activeIdx - 1 + LOCALE_ORDER.length) % LOCALE_ORDER.length]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        itemRefs.current[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        itemRefs.current[LOCALE_ORDER.length - 1]?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, props.locale]);

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onBlur={(event) => {
        if (!open) return;
        const next = event.relatedTarget;
        if (next instanceof Node && rootRef.current?.contains(next)) return;
        setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.label}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            openViaKeyboardRef.current = true;
            if (event.key === 'ArrowDown' && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }
        }}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-[var(--nimi-text-secondary)] transition-[color,background-color,transform] active:scale-[var(--nimi-motion-pressed-scale,0.97)] hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-action-primary-bg)]"
      >
        {props.options[props.locale]}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            aria-label={props.label}
            {...popoverMotion}
            style={{ ...popoverMotion.style, transformOrigin: 'top right' }}
            className="absolute right-0 top-[calc(100%+0.375rem)] z-50 min-w-32 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-1 shadow-[var(--nimi-elevation-floating)]"
          >
            {LOCALE_ORDER.map((item, idx) => {
              const active = props.locale === item;
              return (
                <button
                  key={item}
                  ref={(el) => { itemRefs.current[idx] = el; }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  aria-label={item === 'en' ? props.options.switchToEn : props.options.switchToZh}
                  onClick={() => {
                    props.onChange(item);
                    setOpen(false);
                    buttonRef.current?.focus();
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-primary)]'
                      : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)]'
                  }`}
                >
                  {props.options[item]}
                  {active ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-[var(--nimi-action-primary-bg)]"
                    >
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
