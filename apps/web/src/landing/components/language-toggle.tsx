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
  return (
    <fieldset className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 p-1">
      <legend className="sr-only">{props.label}</legend>
      {(['en', 'zh'] as const).map((item) => {
        const active = props.locale === item;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={active}
            aria-label={item === 'en' ? props.options.switchToEn : props.options.switchToZh}
            onClick={() => props.onChange(item)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {props.options[item]}
          </button>
        );
      })}
    </fieldset>
  );
}
