/**
 * Settings Page (FG-SHELL-010)
 *
 * App preferences stored in localStorage — no backend needed.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StatusBadge,
  SettingsCard,
  SettingsSectionTitle,
  useNimiTheme,
} from '@nimiplatform/nimi-kit/ui';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';
import { ToggleRow } from '@renderer/components/form-fields.js';
import { ForgePage, ForgePageHeader } from '@renderer/components/page-layout.js';
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
    <ForgePage maxWidth="max-w-4xl">
      <ForgePageHeader
        title={t('pages.settingsPage')}
        subtitle={t('settings.subtitle', 'Configure your Forge experience')}
      />

      {/* Appearance */}
      <section className="space-y-3">
        <SettingsSectionTitle description={t('settings.appearanceDesc', 'Theme, language, and layout preferences')}>
          {t('settings.appearance', 'Appearance')}
        </SettingsSectionTitle>

        <SettingsCard>
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            <SettingRow label={t('settings.theme', 'Theme')} description={t('settings.themeDesc', 'Choose color scheme')}>
              <ForgeSegmentControl
                options={[
                  { value: 'light' as const, label: t('settings.themeLight', 'Light') },
                  { value: 'dark' as const, label: t('settings.themeDark', 'Dark') },
                ]}
                value={settings.theme}
                onChange={(v) => update('theme', v)}
              />
            </SettingRow>

            <SettingRow label={t('settings.language', 'Language')} description={t('settings.languageDesc', 'Interface language')}>
              <ForgeSegmentControl
                options={[
                  { value: 'en' as const, label: 'English' },
                  { value: 'zh' as const, label: '中文' },
                ]}
                value={settings.language}
                onChange={(v) => update('language', v)}
              />
            </SettingRow>

            <SettingRow label={t('settings.sidebarDefault', 'Sidebar Default')} description={t('settings.sidebarDefaultDesc', 'Sidebar state on app launch')}>
              <ForgeSegmentControl
                options={[
                  { value: 'expanded' as const, label: t('settings.expanded', 'Expanded') },
                  { value: 'collapsed' as const, label: t('settings.collapsed', 'Collapsed') },
                ]}
                value={settings.sidebarCollapsed ? 'collapsed' : 'expanded'}
                onChange={(v) => update('sidebarCollapsed', v === 'collapsed')}
              />
            </SettingRow>
          </div>
        </SettingsCard>
      </section>

      {/* Notifications */}
      <section className="space-y-3">
        <SettingsSectionTitle description={t('settings.notificationsDesc', 'Control desktop notification behavior')}>
          {t('settings.notifications', 'Notifications')}
        </SettingsSectionTitle>

        <SettingsCard>
          <div className="px-4">
            <ToggleRow
              label={t('settings.enableNotifications', 'Enable Notifications')}
              description={t('settings.enableNotificationsDesc', 'Show desktop notifications for important events')}
              checked={settings.notificationsEnabled}
              onChange={(v) => update('notificationsEnabled', v)}
            />
          </div>
        </SettingsCard>
      </section>

      {/* AI Configuration */}
      <AiConfigSection />

      {/* About */}
      <section className="space-y-3">
        <SettingsSectionTitle>{t('settings.about', 'About')}</SettingsSectionTitle>
        <SettingsCard>
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm text-[var(--nimi-text-secondary)]">
              {t('app.name')} — {t('settings.version', 'Version')} 0.1.0
            </p>
            <StatusBadge tone="info">{`nimi-${scheme}`}</StatusBadge>
          </div>
        </SettingsCard>
      </section>
    </ForgePage>
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
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{description}</p>
      </div>
      {children}
    </div>
  );
}
