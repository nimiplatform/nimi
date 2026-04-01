import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, StatusBadge } from '@nimiplatform/nimi-kit/ui';
import { useRuntimeReadiness } from '@renderer/hooks/use-runtime-readiness.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { changeLocale, getCurrentLocale, getLocaleLabel, SUPPORTED_LOCALES, type SupportedLocale } from '@renderer/i18n/index.js';
import { LookdevShellSettingsDialog } from './lookdev-shell-settings-dialog.js';

function RuntimeBadge() {
  const { t } = useTranslation();
  const status = useAppStore((state) => state.runtimeStatus);
  const issues = useAppStore((state) => state.runtimeProbe.issues);
  const tone = status === 'ready'
    ? 'success'
    : status === 'degraded'
      ? 'warning'
      : status === 'unavailable'
        ? 'danger'
        : 'neutral';

  return (
    <StatusBadge tone={tone} className="px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
      {t('layout.runtimeStatus', { status: t(`layout.runtimeStatus${status.charAt(0).toUpperCase()}${status.slice(1)}`) })}
      {issues.length > 0 ? ` · ${t('layout.runtimeIssues', { count: issues.length })}` : ''}
    </StatusBadge>
  );
}

export function LookdevLayout() {
  const { t } = useTranslation();
  const authUser = useAppStore((state) => state.auth.user);
  const routeSettingsOpen = useAppStore((state) => state.routeSettingsOpen);
  const setRouteSettingsOpen = useAppStore((state) => state.setRouteSettingsOpen);
  const currentLocale = getCurrentLocale();
  useRuntimeReadiness();

  return (
    <div className="ld-grid-glow min-h-screen bg-transparent">
      <LookdevShellSettingsDialog open={routeSettingsOpen} onOpenChange={setRouteSettingsOpen} />
      <div className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-5 px-5 py-5">
        <header className="ld-card px-6 py-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="inline-flex items-center rounded-full border border-[var(--ld-panel-border)] bg-white/6 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[var(--ld-accent)]">
                  {t('layout.eyebrow')}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-white">{t('common.appName')}</h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-white/68">
                    {t('layout.description')}
                  </p>
                </div>
              </div>

              <nav className="flex flex-wrap gap-2">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    `rounded-full px-4 py-2.5 text-sm transition ${
                      isActive
                        ? 'border border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white shadow-[0_16px_36px_rgba(44,224,188,0.14)]'
                        : 'border border-white/10 bg-black/12 text-white/68 hover:bg-white/6 hover:text-white'
                    }`
                  }
                >
                  {t('layout.navBatchList')}
                </NavLink>
                <NavLink
                  to="/batches/new"
                  className={({ isActive }) =>
                    `rounded-full px-4 py-2.5 text-sm transition ${
                      isActive
                        ? 'border border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white shadow-[0_16px_36px_rgba(44,224,188,0.14)]'
                        : 'border border-white/10 bg-black/12 text-white/68 hover:bg-white/6 hover:text-white'
                    }`
                  }
                >
                  {t('layout.navCreateBatch')}
                </NavLink>
              </nav>
            </div>

            <div className="flex flex-wrap items-center gap-3 xl:justify-end">
              <RuntimeBadge />
              <div className="rounded-full border border-white/10 bg-black/12 p-1">
                <div className="flex gap-1">
                  {SUPPORTED_LOCALES.map((locale) => (
                    <Button
                      key={locale}
                      onClick={() => void changeLocale(locale as SupportedLocale)}
                      tone="secondary"
                      size="sm"
                      className={`rounded-full px-3 py-2 text-xs transition ${
                        currentLocale === locale
                          ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white'
                          : 'border-transparent bg-transparent text-white/62 hover:bg-white/6 hover:text-white'
                      }`}
                    >
                      {getLocaleLabel(locale)}
                    </Button>
                  ))}
                </div>
              </div>
              <Button
                tone="secondary"
                className="rounded-full border-white/10 bg-black/12 text-sm text-white hover:bg-white/6"
                onClick={() => setRouteSettingsOpen(true)}
              >
                {t('layout.shellSettings')}
              </Button>
              <div className="rounded-full border border-white/10 bg-black/12 px-4 py-2 text-sm text-white/74">
                {authUser?.displayName || t('common.unknownOperator')}
              </div>
            </div>
          </div>
        </header>

        <main className="min-h-0 min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
