import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FormFeedback,
  PageShell,
  SectionTitle,
} from './settings-layout-components.js';
import { SettingRow } from './settings-preferences-panel-parts.js';
import {
  APPEARANCE_THEMES,
  appearanceEqual,
  DevicePreferenceProjectionError,
  loadAppearancePreferences,
  persistAppearancePreferences,
  type AppearancePreferences,
  type AppearanceTheme,
} from './settings-device-preferences.js';

type FeedbackState = {
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
} | null;

/**
 * Result of resolving the appearance projection at mount.
 *
 * `failClosed` carries a projection failure (corrupt blob, storage rejected).
 * The page renders a fail-closed notice instead of preference toggles — it
 * never silently substitutes defaults for a failed projection.
 */
type AppearanceLoad =
  | { status: 'ok'; preferences: AppearancePreferences }
  | { status: 'failClosed'; reason: string };

function resolveAppearanceLoad(): AppearanceLoad {
  try {
    return { status: 'ok', preferences: loadAppearancePreferences() };
  } catch (error) {
    if (error instanceof DevicePreferenceProjectionError) {
      return { status: 'failClosed', reason: error.message };
    }
    throw error;
  }
}

function PaintIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 11h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-2" />
      <path d="M5 11V7a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H9" />
      <rect x="2" y="11" width="7" height="10" rx="2" />
    </svg>
  );
}

function MotionIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="m4.9 4.9 2.1 2.1" />
      <path d="m17 17 2.1 2.1" />
    </svg>
  );
}

function ContrastIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 18a6 6 0 0 0 0-12z" fill="currentColor" />
    </svg>
  );
}

function TextSizeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5h12v2" />
      <path d="M9 5v14" />
      <path d="M6 19h6" />
      <path d="M15 13v-2h6v2" />
      <path d="M18 11v8" />
      <path d="M16 19h4" />
    </svg>
  );
}

export function AppearancePage() {
  const { t } = useTranslation();
  const [load] = useState<AppearanceLoad>(() => resolveAppearanceLoad());
  const initialPreferences = load.status === 'ok' ? load.preferences : null;
  const [preferences, setPreferences] = useState<AppearancePreferences | null>(initialPreferences);
  const [baseline, setBaseline] = useState<AppearancePreferences | null>(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasChanges = useMemo(
    () => preferences !== null && baseline !== null && !appearanceEqual(preferences, baseline),
    [preferences, baseline],
  );

  useEffect(() => () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
  }, []);

  const handleSave = ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || !hasChanges || preferences === null) {
      return;
    }
    setSaving(true);
    try {
      persistAppearancePreferences(preferences);
      setBaseline(preferences);
      if (!silentSuccess) {
        setFeedback({ kind: 'success', message: t('Appearance.saveSuccess') });
      }
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof DevicePreferenceProjectionError
          ? t('Appearance.saveFailClosed')
          : (error instanceof Error ? error.message : t('Appearance.saveFailClosed')),
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (saving || !hasChanges) {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      handleSave({ silentSuccess: true });
    }, 700);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [hasChanges, preferences, saving]);

  if (load.status === 'failClosed' || preferences === null) {
    return (
      <PageShell title={t('Appearance.pageTitle')} description={t('Appearance.pageDescription')}>
        <div
          data-testid="settings:appearance-fail-closed"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"
        >
          <p className="font-semibold">{t('Appearance.failClosedTitle')}</p>
          <p className="mt-1 text-xs text-red-600">{t('Appearance.failClosedBody')}</p>
        </div>
      </PageShell>
    );
  }

  const themeLabels: Record<AppearanceTheme, string> = {
    system: t('Appearance.themeSystem'),
    light: t('Appearance.themeLight'),
    dark: t('Appearance.themeDark'),
  };

  return (
    <PageShell
      title={t('Appearance.pageTitle')}
      description={t('Appearance.pageDescription')}
    >
      <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} title={t('Appearance.pageTitle')} />

      <section className="mt-8">
        <SectionTitle description={t('Appearance.sectionThemeDescription')}>
          {t('Appearance.sectionTheme')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
              <PaintIcon className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{t('Appearance.themeLabel')}</p>
              <p className="text-xs text-gray-500">{t('Appearance.themeHelper')}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('Appearance.themeLabel')}>
            {APPEARANCE_THEMES.map((theme) => {
              const active = preferences.theme === theme;
              return (
                <button
                  key={theme}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`settings:appearance-theme-${theme}`}
                  onClick={() => setPreferences((previous) => (previous ? { ...previous, theme } : previous))}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-mint-400 bg-mint-50 text-mint-700'
                      : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-mint-300'
                  }`}
                >
                  {themeLabels[theme]}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle description={t('Appearance.sectionAccessibilityDescription')}>
          {t('Appearance.sectionAccessibility')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<MotionIcon className="h-5 w-5" />}
            title={t('Appearance.reduceMotion')}
            description={t('Appearance.reduceMotionDescription')}
            checked={preferences.reduceMotion}
            onChange={(value) => setPreferences((previous) => (previous ? { ...previous, reduceMotion: value } : previous))}
          />
          <div className="h-px bg-gray-100 mx-5" />
          <SettingRow
            icon={<ContrastIcon className="h-5 w-5" />}
            title={t('Appearance.highContrast')}
            description={t('Appearance.highContrastDescription')}
            checked={preferences.highContrast}
            onChange={(value) => setPreferences((previous) => (previous ? { ...previous, highContrast: value } : previous))}
          />
          <div className="h-px bg-gray-100 mx-5" />
          <SettingRow
            icon={<TextSizeIcon className="h-5 w-5" />}
            title={t('Appearance.largerText')}
            description={t('Appearance.largerTextDescription')}
            checked={preferences.largerText}
            onChange={(value) => setPreferences((previous) => (previous ? { ...previous, largerText: value } : previous))}
          />
        </div>
      </section>
    </PageShell>
  );
}
