import { NavLink, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRuntimeReadiness } from '@renderer/hooks/use-runtime-readiness.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevStore } from '@renderer/features/lookdev/lookdev-store.js';
import { changeLocale, getCurrentLocale, getLocaleLabel, SUPPORTED_LOCALES, type SupportedLocale } from '@renderer/i18n/index.js';

function RuntimeBadge() {
  const { t } = useTranslation();
  const status = useAppStore((state) => state.runtimeStatus);
  const issues = useAppStore((state) => state.runtimeProbe.issues);
  const tone = status === 'ready'
    ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20'
    : status === 'degraded'
      ? 'bg-amber-300/12 text-amber-100 border-amber-300/20'
      : status === 'unavailable'
        ? 'bg-rose-400/12 text-rose-100 border-rose-300/20'
        : 'bg-white/6 text-white/70 border-white/10';

  return (
    <div className={`rounded-full border px-3 py-1 text-xs ${tone}`}>
      {t('layout.runtimeStatus', { status: t(`layout.runtimeStatus${status.charAt(0).toUpperCase()}${status.slice(1)}`) })}
      {issues.length > 0 ? ` · ${t('layout.runtimeIssues', { count: issues.length })}` : ''}
    </div>
  );
}

export function LookdevLayout() {
  const { t } = useTranslation();
  const authUser = useAppStore((state) => state.auth.user);
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const currentLocale = getCurrentLocale();
  useRuntimeReadiness();

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }
    void useLookdevStore.getState().resumeActiveBatches();
  }, [bootstrapReady]);

  return (
    <div className="ld-grid-glow min-h-screen bg-transparent">
      <div className="mx-auto flex min-h-screen w-full max-w-[1560px] gap-5 px-5 py-5">
        <aside className="ld-card flex w-[260px] shrink-0 flex-col justify-between overflow-hidden px-5 py-5">
          <div className="space-y-8">
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border border-[var(--ld-panel-border)] bg-white/6 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[var(--ld-accent)]">
                {t('layout.eyebrow')}
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">{t('common.appName')}</h1>
                <p className="mt-2 text-sm leading-6 text-white/68">
                  {t('layout.description')}
                </p>
              </div>
            </div>

            <nav className="space-y-2">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `block rounded-2xl px-4 py-3 text-sm transition ${
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white shadow-[0_16px_36px_rgba(44,224,188,0.14)]'
                      : 'text-white/72 hover:bg-white/6 hover:text-white'
                  }`
                }
              >
                {t('layout.navBatchList')}
              </NavLink>
              <NavLink
                to="/batches/new"
                className={({ isActive }) =>
                  `block rounded-2xl px-4 py-3 text-sm transition ${
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white shadow-[0_16px_36px_rgba(44,224,188,0.14)]'
                      : 'text-white/72 hover:bg-white/6 hover:text-white'
                  }`
                }
              >
                {t('layout.navCreateBatch')}
              </NavLink>
            </nav>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-white/8 bg-black/16 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.16em] text-white/42">{t('common.language')}</div>
              <div className="mt-2 flex gap-2">
                {SUPPORTED_LOCALES.map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    onClick={() => void changeLocale(locale as SupportedLocale)}
                    className={`rounded-xl px-3 py-2 text-xs transition ${
                      currentLocale === locale
                        ? 'bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white'
                        : 'bg-black/12 text-white/68 hover:bg-white/6 hover:text-white'
                    }`}
                  >
                    {getLocaleLabel(locale)}
                  </button>
                ))}
              </div>
            </div>
            <RuntimeBadge />
            <div className="rounded-2xl border border-white/8 bg-black/16 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.16em] text-white/42">{t('layout.operator')}</div>
              <div className="mt-1 text-sm text-white">{authUser?.displayName || t('common.unknownOperator')}</div>
              <div className="text-xs text-white/50">{authUser?.email || authUser?.id || ''}</div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
