import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineAlert, SegmentedControl, SelectField } from '@nimiplatform/kit/ui';
import {
  getLocaleLabel,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../../i18n/desktop-i18n.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import {
  Card,
  FormFeedback,
  PageShell,
  Section,
  SettingRow,
  ToggleRow,
} from './settings-layout-components.js';
import {
  APPEARANCE_THEMES,
  appearanceEqual,
  DevicePreferenceProjectionError,
  type AppearancePreferences,
  type AppearanceTheme,
} from './settings-device-preferences.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

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

function resolveAppearanceLoad(
  settings: ReturnType<typeof useDesktopRendererBindings>['app']['commands']['settings'],
): AppearanceLoad {
  try {
    return { status: 'ok', preferences: settings.loadAppearancePreferences() };
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

export function AppearancePage() {
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const [load] = useState<AppearanceLoad>(() => resolveAppearanceLoad(bindings.app.commands.settings));
  const initialPreferences = load.status === 'ok' ? load.preferences : null;
  const [preferences, setPreferences] = useState<AppearancePreferences | null>(initialPreferences);
  const [baseline, setBaseline] = useState<AppearancePreferences | null>(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const autosaveTimerRef = React.useRef<(() => void) | null>(null);
  const [language, setLanguage] = useState<SupportedLocale>(() => i18n.getCurrentLocale());
  const [changingLocale, setChangingLocale] = useState(false);
  const languageOptions = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: getLocaleLabel(locale),
  }));

  const handleLanguageChange = async (locale: SupportedLocale) => {
    if (changingLocale) {
      return;
    }
    setLanguage(locale);
    setChangingLocale(true);
    try {
      await i18n.changeLocale(locale);
      setFeedback(null);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('Appearance.changeLanguageError'),
      });
    } finally {
      setChangingLocale(false);
    }
  };

  const hasChanges = useMemo(
    () => preferences !== null && baseline !== null && !appearanceEqual(preferences, baseline),
    [preferences, baseline],
  );

  useEffect(() => () => {
    autosaveTimerRef.current?.();
  }, []);

  const handleSave = ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || !hasChanges || preferences === null) {
      return;
    }
    setSaving(true);
    try {
      bindings.app.commands.settings.persistAppearancePreferences(preferences);
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
      autosaveTimerRef.current?.();
      autosaveTimerRef.current = null;
      return;
    }
    autosaveTimerRef.current?.();
    autosaveTimerRef.current = bindings.clock.schedule(700, (result) => {
      if (result.ok) handleSave({ silentSuccess: true });
    });
    return () => {
      autosaveTimerRef.current?.();
      autosaveTimerRef.current = null;
    };
  }, [bindings, hasChanges, preferences, saving]);

  if (load.status === 'failClosed' || preferences === null) {
    return (
      <PageShell title={t('Appearance.pageTitle')} description={t('Appearance.pageDescription')}>
        <InlineAlert tone="danger" data-testid="settings:appearance-fail-closed">
          <p className="font-semibold">{t('Appearance.failClosedTitle')}</p>
          <p className="mt-1">{t('Appearance.failClosedBody')}</p>
        </InlineAlert>
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

      <Section title={t('Appearance.sectionTheme')} description={t('Appearance.sectionThemeDescription')}>
        <Card>
          <SettingRow
            icon={<PaintIcon className="h-5 w-5" />}
            title={t('Appearance.themeLabel')}
            description={t('Appearance.themeHelper')}
            control={(
              <SegmentedControl
                ariaLabel={t('Appearance.themeLabel')}
                items={APPEARANCE_THEMES.map((theme) => ({ value: theme, label: themeLabels[theme] }))}
                value={preferences.theme}
                onValueChange={(value) => setPreferences((previous) => (
                  previous ? { ...previous, theme: value as AppearanceTheme } : previous
                ))}
              />
            )}
          />
        </Card>
      </Section>

      <Section title={t('Appearance.sectionLanguage')} description={t('Appearance.sectionLanguageDescription')}>
        <Card>
          <SettingRow
            icon={<LanguageIcon className="h-5 w-5" />}
            title={t('Appearance.languageLabel')}
            description={t('Appearance.languageHelper')}
            control={(
              <SelectField
                aria-label={t('Appearance.languageLabel')}
                value={language}
                onValueChange={(locale) => { void handleLanguageChange(locale as SupportedLocale); }}
                options={languageOptions}
                disabled={changingLocale}
                className="w-56"
              />
            )}
          />
        </Card>
      </Section>

      <Section title={t('Appearance.sectionAccessibility')} description={t('Appearance.sectionAccessibilityDescription')}>
        <Card>
          <ToggleRow
            icon={<MotionIcon className="h-5 w-5" />}
            title={t('Appearance.reduceMotion')}
            description={t('Appearance.reduceMotionDescription')}
            checked={preferences.reduceMotion}
            onChange={(value) => setPreferences((previous) => (previous ? { ...previous, reduceMotion: value } : previous))}
          />
        </Card>
      </Section>
    </PageShell>
  );
}
