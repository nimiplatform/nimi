import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  changeLocale,
  getCurrentLocale,
  getLocaleLabel,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@renderer/i18n';
import {
  PageShell,
  SectionTitle,
} from './settings-layout-components';

type SettingsDropdownOption = {
  value: string;
  label: string;
};

function LanguageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8l6 6" />
      <path d="M4 14l6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="M22 22l-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function SettingsDropdown({
  value,
  onChange,
  options,
  disabled,
  icon,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SettingsDropdownOption[];
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find((item) => item.value === value)?.label || value;

  return (
    <div ref={dropdownRef} className="relative">
      {icon ? (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
          {icon}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-10 text-sm text-gray-900 outline-none transition-all hover:border-mint-300 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-60"
      >
        <span>{selectedLabel}</span>
      </button>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {isOpen ? (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                value === option.value
                  ? 'bg-mint-50 text-mint-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                {value === option.value ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mint-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
                <span className={value === option.value ? 'ml-0' : 'ml-6'}>{option.label}</span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LanguageRegionPage() {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [language, setLanguage] = useState<SupportedLocale>(getCurrentLocale());
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [saving, setSaving] = useState(false);
  const languageOptions: SettingsDropdownOption[] = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: getLocaleLabel(locale),
  }));
  const timezoneOptions: SettingsDropdownOption[] = [
    { value: 'Asia/Shanghai', label: t('LanguageRegion.timezoneCst') },
    { value: 'Asia/Tokyo', label: t('LanguageRegion.timezoneJst') },
    { value: 'America/New_York', label: t('LanguageRegion.timezoneEt') },
    { value: 'America/Los_Angeles', label: t('LanguageRegion.timezonePt') },
    { value: 'Europe/London', label: t('LanguageRegion.timezoneGmt') },
    { value: 'Europe/Berlin', label: t('LanguageRegion.timezoneCet') },
  ];
  const dateFormatOptions: SettingsDropdownOption[] = [
    { value: 'YYYY-MM-DD', label: t('LanguageRegion.dateFormatIso') },
    { value: 'MM/DD/YYYY', label: t('LanguageRegion.dateFormatUs') },
    { value: 'DD/MM/YYYY', label: t('LanguageRegion.dateFormatEu') },
    { value: 'DD.MM.YYYY', label: t('LanguageRegion.dateFormatDe') },
  ];

  const handleLanguageChange = async (locale: SupportedLocale) => {
    if (saving) {
      return;
    }
    setLanguage(locale);
    setSaving(true);
    try {
      await changeLocale(locale);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('LanguageRegion.changeLanguageError'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={t('LanguageRegion.pageTitle')}
      description={t('LanguageRegion.pageDescription')}
    >
      <section>
        <SectionTitle>{t('LanguageRegion.sectionDisplayLanguage')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.language')}
              </label>
              <SettingsDropdown
                value={language}
                onChange={(locale) => { void handleLanguageChange(locale as SupportedLocale); }}
                options={languageOptions}
                disabled={saving}
                icon={<LanguageIcon className="h-5 w-5" />}
              />
              <p className="mt-1.5 text-xs text-gray-400">{t('LanguageRegion.languageHelper')}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>{t('LanguageRegion.sectionRegionSettings')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.timezone')}
              </label>
              <SettingsDropdown
                value={timezone}
                onChange={setTimezone}
                options={timezoneOptions}
                icon={<ClockIcon className="h-5 w-5" />}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.dateFormat')}
              </label>
              <SettingsDropdown
                value={dateFormat}
                onChange={setDateFormat}
                options={dateFormatOptions}
                icon={<CalendarIcon className="h-5 w-5" />}
              />
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
