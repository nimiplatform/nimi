import { useEffect, useRef, useState } from 'react';
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

export function LanguageToggle(props: LanguageToggleProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
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
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.label}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38d6a3]"
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
      {open ? (
        <div
          role="menu"
          aria-label={props.label}
          className="absolute right-0 top-[calc(100%+0.375rem)] z-50 min-w-32 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
        >
          {(['en', 'zh'] as const).map((item) => {
            const active = props.locale === item;
            return (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                aria-label={item === 'en' ? props.options.switchToEn : props.options.switchToZh}
                onClick={() => {
                  props.onChange(item);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                  active
                    ? 'bg-[#38d6a3]/10 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
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
                    className="h-3.5 w-3.5 text-[#2ba980]"
                  >
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
