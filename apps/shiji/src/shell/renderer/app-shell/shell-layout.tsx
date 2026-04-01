import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShellErrorBoundary } from '@nimiplatform/nimi-kit/telemetry/error-boundary';

// Nav icon components (simple SVG, education-appropriate)
function ExploreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function KnowledgeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function ProgressIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const NAV_ITEMS = [
  { to: '/explore', label: 'nav.explore', Icon: ExploreIcon },
  { to: '/knowledge', label: 'nav.knowledge', Icon: KnowledgeIcon },
  { to: '/progress', label: 'nav.progress', Icon: ProgressIcon },
  { to: '/settings', label: 'nav.settings', Icon: SettingsIcon },
] as const;

export function ShellLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      {/* Side navigation — SJ-SHELL-003:1 */}
      <nav
        className="flex flex-col items-center gap-1 py-4 px-2 border-r border-neutral-100 bg-amber-50/60 w-16 shrink-0"
        aria-label="主导航"
      >
        {/* App logo mark */}
        <div className="mb-4 mt-1">
          <div className="w-9 h-9 rounded-xl bg-amber-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold leading-none">迹</span>
          </div>
        </div>

        {NAV_ITEMS.map(({ to, label, Icon }) => {
          const isActive = location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              title={t(label)}
              className={[
                'flex flex-col items-center gap-1 rounded-xl p-2 w-12 transition-colors',
                isActive
                  ? 'bg-amber-100 text-amber-700'
                  : 'text-neutral-400 hover:text-amber-600 hover:bg-amber-50',
              ].join(' ')}
            >
              <Icon />
              <span className="text-[10px] leading-tight font-medium">{t(label)}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Content area — SJ-SHELL-003:2,4 */}
      <main className="flex-1 overflow-hidden relative">
        <ShellErrorBoundary appName="ShiJi">
          <Outlet />
        </ShellErrorBoundary>
      </main>
    </div>
  );
}
