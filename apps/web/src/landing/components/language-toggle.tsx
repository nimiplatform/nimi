import type { LandingLocale } from '../i18n/locale.js';

export type LanguageToggleProps = {
  locale: LandingLocale;
  label: string;
  options: {
    en: string;
    zh: string;
  };
  onChange: (locale: LandingLocale) => void;
};

export function LanguageToggle(props: LanguageToggleProps) {
  return (
    <fieldset className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/70 p-1 shadow-lg shadow-slate-900/30">
      <legend className="sr-only">{props.label}</legend>
      {(['en', 'zh'] as const).map((item) => {
        const active = props.locale === item;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={active}
            aria-label={item === 'en' ? 'Switch language to English' : '切换到中文'}
            onClick={() => props.onChange(item)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? 'bg-mint-400 text-slate-950 shadow-sm shadow-mint-500/40'
                : 'text-slate-200 hover:bg-white/10'
            }`}
          >
            {props.options[item]}
          </button>
        );
      })}
    </fieldset>
  );
}
