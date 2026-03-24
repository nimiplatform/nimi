/**
 * Settings Page (FG-SHELL-010)
 *
 * App preferences stored in localStorage — no backend needed.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StatusBadge, Surface, useNimiTheme } from '@nimiplatform/nimi-ui';
import { AiConfigSection } from './ai-config-section.js';

type ThemeOption = 'light' | 'dark';
type LanguageOption = 'en' | 'zh';

const SETTINGS_KEY = 'nimi:forge:settings';

interface ForgeSettings {
  theme: ThemeOption;
  language: LanguageOption;
  sidebarCollapsed: boolean;
  notificationsEnabled: boolean;
}

const DEFAULT_SETTINGS: ForgeSettings = {
  theme: 'light',
  language: 'en',
  sidebarCollapsed: false,
  notificationsEnabled: true,
};

function loadSettings(): ForgeSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ForgeSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: ForgeSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { scheme, setScheme } = useNimiTheme();
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    setScheme(settings.theme);
  }, [setScheme, settings.theme]);

  function update<K extends keyof ForgeSettings>(key: K, value: ForgeSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (key === 'language') {
      void i18n.changeLanguage(value as string);
    }
  }

  return (
    <Surface tone="canvas" padding="none" className="h-full overflow-auto rounded-none border-0 p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[color:var(--nimi-text-primary)]">{t('pages.settingsPage')}</h1>
          <p className="mt-1 text-sm text-[color:var(--nimi-text-muted)]">
            {t('settings.subtitle', 'Configure your Forge experience')}
          </p>
        </div>

        {/* Appearance */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--nimi-text-secondary)]">
            {t('settings.appearance', 'Appearance')}
          </h2>

          <SettingRow
            label={t('settings.theme', 'Theme')}
            description={t('settings.themeDesc', 'Choose color scheme')}
          >
            <div className="flex gap-2">
              {(['light', 'dark'] as const).map((option) => (
                <Button
                  key={option}
                  onClick={() => update('theme', option)}
                  tone={settings.theme === option ? 'primary' : 'secondary'}
                  size="sm"
                >
                  {option === 'dark' ? t('settings.themeDark', 'Dark') : t('settings.themeLight', 'Light')}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label={t('settings.language', 'Language')}
            description={t('settings.languageDesc', 'Interface language')}
          >
            <div className="flex gap-2">
              {(['en', 'zh'] as const).map((lang) => (
                <Button
                  key={lang}
                  onClick={() => update('language', lang)}
                  tone={settings.language === lang ? 'primary' : 'secondary'}
                  size="sm"
                >
                  {lang === 'en' ? 'English' : '中文'}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label={t('settings.sidebarDefault', 'Sidebar Default')}
            description={t('settings.sidebarDefaultDesc', 'Sidebar state on app launch')}
          >
            <div className="flex gap-2">
              <Button
                onClick={() => update('sidebarCollapsed', false)}
                tone={!settings.sidebarCollapsed ? 'primary' : 'secondary'}
                size="sm"
              >
                {t('settings.expanded', 'Expanded')}
              </Button>
              <Button
                onClick={() => update('sidebarCollapsed', true)}
                tone={settings.sidebarCollapsed ? 'primary' : 'secondary'}
                size="sm"
              >
                {t('settings.collapsed', 'Collapsed')}
              </Button>
            </div>
          </SettingRow>
        </section>

        {/* Notifications */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--nimi-text-secondary)]">
            {t('settings.notifications', 'Notifications')}
          </h2>

          <SettingRow
            label={t('settings.enableNotifications', 'Enable Notifications')}
            description={t('settings.enableNotificationsDesc', 'Show desktop notifications for important events')}
          >
            <Button
              onClick={() => update('notificationsEnabled', !settings.notificationsEnabled)}
              tone={settings.notificationsEnabled ? 'primary' : 'secondary'}
              size="sm"
              className="min-w-24 justify-center"
            >
              {settings.notificationsEnabled
                ? t('Common.enabled', 'Enabled')
                : t('Common.disabled', 'Disabled')}
            </Button>
          </SettingRow>
        </section>

        {/* AI Configuration */}
        <AiConfigSection />

        {/* About */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--nimi-text-secondary)]">
            {t('settings.about', 'About')}
          </h2>
          <Surface tone="card" elevation="base" className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[color:var(--nimi-text-secondary)]">
                {t('app.name')} — {t('settings.version', 'Version')} 0.1.0
              </p>
              <StatusBadge tone="info">{`nimi-${scheme}`}</StatusBadge>
            </div>
          </Surface>
        </section>
      </div>
    </Surface>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Surface tone="card" elevation="base" className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium text-[color:var(--nimi-text-primary)]">{label}</p>
        <p className="mt-0.5 text-xs text-[color:var(--nimi-text-muted)]">{description}</p>
      </div>
      {children}
    </Surface>
  );
}
