import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRuntimeReadiness } from '@renderer/hooks/use-runtime-readiness.js';
import { changeLocale, getCurrentLocale, getLocaleLabel, SUPPORTED_LOCALES, type SupportedLocale } from '@renderer/i18n/index.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { RouteSettingsDialog } from '@renderer/features/moment/components/route-settings-dialog.js';

function RuntimeBadge() {
  const { t } = useTranslation();
  const status = useAppStore((state) => state.runtimeStatus);
  const issues = useAppStore((state) => state.runtimeProbe.issues);
  const tone = status === 'ready'
    ? 'moment-badge-ready'
    : status === 'degraded'
      ? 'moment-badge-degraded'
      : status === 'unavailable'
        ? 'moment-badge-error'
        : 'moment-badge-neutral';

  const label = status === 'ready'
    ? t('shell.runtimeReady')
    : status === 'degraded'
      ? t('shell.runtimeDegraded')
      : status === 'unavailable'
        ? t('shell.runtimeUnavailable')
        : t('shell.runtimeChecking');

  return (
    <div className={`moment-runtime-badge ${tone}`}>
      {label}
      {issues.length > 0 ? ` · ${t('shell.runtimeIssues', { count: issues.length })}` : ''}
    </div>
  );
}

export function MomentShell() {
  const { t } = useTranslation();
  const authUser = useAppStore((state) => state.auth.user);
  const routeSettingsOpen = useAppStore((state) => state.routeSettingsOpen);
  const setRouteSettingsOpen = useAppStore((state) => state.setRouteSettingsOpen);
  const currentLocale = getCurrentLocale();

  useRuntimeReadiness();

  return (
    <div className="moment-app-shell">
      <RouteSettingsDialog open={routeSettingsOpen} onOpenChange={setRouteSettingsOpen} />
      <div className="moment-bg-orb moment-bg-orb-top" />
      <div className="moment-bg-orb moment-bg-orb-bottom" />

      <header className="moment-header">
        <div>
          <div className="moment-brand">Moment</div>
          <div className="moment-promise">{t('shell.promise')}</div>
        </div>

        <div className="moment-header-actions">
          <RuntimeBadge />
          <button type="button" className="moment-settings-trigger" onClick={() => setRouteSettingsOpen(true)}>
            {t('shell.settings')}
          </button>
          <div className="moment-locale-switch">
            {SUPPORTED_LOCALES.map((locale) => (
              <button
                key={locale}
                type="button"
                onClick={() => void changeLocale(locale as SupportedLocale)}
                className={currentLocale === locale ? 'is-active' : ''}
              >
                {getLocaleLabel(locale)}
              </button>
            ))}
          </div>
          <div className="moment-operator">
            {authUser?.displayName || t('common.unknownOperator')}
          </div>
        </div>
      </header>

      <main className="moment-main-shell">
        <Outlet />
      </main>
    </div>
  );
}
