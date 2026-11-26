import React from 'react';
import { createRoot } from 'react-dom/client';
import type { NimiAppSession } from '@nimiplatform/kit/core/app-session';
import { Button, NimiMotionProvider, NimiThemeProvider, NimiToaster, TooltipProvider } from '@nimiplatform/kit/ui';
import { NimiAppSessionProvider, NimiAccountControl, NimiAppAccessGate } from '@nimiplatform/kit/auth/app';
import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { I18nProvider, useI18n } from '../i18n.js';
import { AppThemeProvider, useAppTheme } from '../theme.js';
import { RemoteSessions } from './sessions.js';
import '../styles.css';

function RemoteFrame({ session, integrationId }: { session: NimiAppSession; integrationId?: string }) {
  const { scheme, preference, cyclePreference } = useAppTheme();
  const { locale, toggleLocale, t } = useI18n();
  const ThemeIcon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;

  return (
    <NimiThemeProvider scheme={scheme} accentPack="nimi-accent">
      <NimiMotionProvider>
        <TooltipProvider>
          <NimiAppSessionProvider session={session}>
            <div className="harness-remote-app">
              <header className="harness-remote-topbar">
                <h1>{t('app.name')}</h1>
                <div className="harness-remote-topbar__controls">
                  <Button size="sm" tone="ghost" leadingIcon={<ThemeIcon size={14} />} onClick={cyclePreference} aria-label={t('app.theme.label')} />
                  <Button size="sm" tone="ghost" leadingIcon={<Languages size={14} />} onClick={toggleLocale} aria-label={t('app.language.label')}>
                    {locale === 'en' ? '中文' : 'EN'}
                  </Button>
                  <NimiAccountControl hideSignedOut language={locale} />
                </div>
              </header>
              <div className="harness-remote-body">
                <NimiAppAccessGate title={t('app.name')} language={locale}>
                  {scope => <RemoteSessions scope={scope} integrationId={integrationId} key={scope.viewKey} />}
                </NimiAppAccessGate>
              </div>
              <NimiToaster />
            </div>
          </NimiAppSessionProvider>
        </TooltipProvider>
      </NimiMotionProvider>
    </NimiThemeProvider>
  );
}

export function mountRemoteSessions(session: NimiAppSession, options?: { integrationId?: string }) {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <React.StrictMode>
      <AppThemeProvider>
        <I18nProvider>
          <RemoteFrame session={session} integrationId={options?.integrationId} />
        </I18nProvider>
      </AppThemeProvider>
    </React.StrictMode>,
  );
  void session.start();
  return () => { session.dispose(); root.unmount(); };
}
