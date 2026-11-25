import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, type Blocker } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cpu,
  Database,
  House,
  LogOut,
  Monitor,
  Pencil,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAvatarMonogram, resolveAvatarMeshPalette } from '@nimiplatform/kit/ui';
import { useAccountCopy, type AccountCopyKey } from './account-center-copy.js';
import { accountHandle } from './account-center-model.js';
import { LanguageToggle } from '../landing/components/language-toggle.js';
import { persistLocale } from '../landing/i18n/locale.js';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import { loadWebLocaleFont } from '../fonts.js';

const ACCOUNT_LOCALE_OPTIONS = {
  zh: {
    en: 'English',
    zh: '中文',
    switchToEn: '切换为英文',
    switchToZh: '切换为中文',
  },
  en: {
    en: 'English',
    zh: '中文',
    switchToEn: 'Switch to English',
    switchToZh: 'Switch to Chinese',
  },
} as const;

type SettingsNavItem = readonly [to: string, label: AccountCopyKey, icon: typeof House];
type SettingsNavGroup = readonly [heading: AccountCopyKey, items: readonly SettingsNavItem[]];

const identityMenuItems: readonly SettingsNavItem[] = [
  ['/account/profile', 'profile', UserRound],
  ['/account/friends', 'friends', UsersRound],
  ['/account/privacy', 'privacy', SlidersHorizontal],
];

const securityMenuItems: readonly SettingsNavItem[] = [
  ['/account/security', 'security', ShieldCheck],
  ['/account/sessions', 'sessions', Monitor],
  ['/account/data', 'data', Database],
];

const settingsSidebarGroups: readonly SettingsNavGroup[] = [
  ['navGroupIdentity', identityMenuItems],
  ['navGroupSecurity', securityMenuItems],
];

type AccountLayoutMode = 'portal' | 'host' | 'download' | 'settings' | 'connect';

function resolveLayoutMode(pathname: string): AccountLayoutMode {
  const segment = pathname.replace(/\/+$/, '').split('/')[2] || '';
  if (!segment) return 'portal';
  if (segment === 'runtime') return 'host';
  if (segment === 'download') return 'download';
  if (segment === 'connect') return 'connect';
  if (['profile', 'friends', 'privacy', 'security', 'sessions', 'data', 'delete'].includes(segment)) {
    return 'settings';
  }
  return 'portal';
}

export function AccountAvatar({
  user,
  size = 'normal',
}: {
  user: { id?: unknown; displayName?: unknown; handle?: unknown; avatarUrl?: unknown };
  size?: 'normal' | 'large' | 'small';
}) {
  const name = String(user.displayName || user.handle || 'N');
  const url = typeof user.avatarUrl === 'string' && user.avatarUrl.trim() ? user.avatarUrl : null;
  const seed = String(user.id || user.handle || user.displayName || 'N');
  const palette = url ? null : resolveAvatarMeshPalette(seed);
  return (
    <span
      className={`ac-avatar ac-avatar--${size}`}
      data-nimi-avatar-mesh={palette?.id}
    >
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span aria-hidden="true">{getAvatarMonogram(name)}</span>
      )}
    </span>
  );
}

export function AccountHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="ac-page-heading">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function AccountFeedback({
  error,
  message,
}: {
  error?: string | null;
  message?: string | null;
}) {
  return (
    <>
      {error ? (
        <p className="ac-feedback ac-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="ac-feedback" role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}

export function AccountFrame({
  user,
  onSignOut,
  working,
  pendingReceivedCount = null,
  children,
}: {
  user: Record<string, unknown>;
  onSignOut: () => void;
  working: boolean;
  pendingReceivedCount?: number | null;
  children: ReactNode;
}) {
  const c = useAccountCopy();
  const { i18n } = useTranslation();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const locale = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const layoutMode = resolveLayoutMode(location.pathname);
  const displayName = String(user.displayName || user.handle || c('profile'));
  const handle = accountHandle(user.handle);
  const email = typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null;
  const secondaryIdentity = email || (handle ? `@${handle}` : null);
  const twoFactor = user.isTwoFactorEnabled === true;
  const hasPendingRequests = Boolean(pendingReceivedCount && pendingReceivedCount > 0);
  const isDeleteRoute = location.pathname.replace(/\/+$/, '') === '/account/delete';

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus({ preventScroll: true });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuContainerRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="ac-root" data-account-layout={layoutMode}>
      <a className="ac-skip" href="#account-content">
        {locale === 'zh' ? '跳到主要内容' : 'Skip to content'}
      </a>

      <div className="ac-topbar-wrap">
        <header className="ac-topbar">
          <Link to={withLocaleQuery('/', locale)} className="ac-brand" aria-label={c('home')}>
            <img src="/logo.svg" alt="" width={29} height={29} />
            <span>Nimi</span>
          </Link>

          <nav className="ac-portal-nav" aria-label={c('center')}>
            <NavLink
              to="/account"
              end
              className={({ isActive }) => `ac-portal-nav-link${isActive ? ' is-active' : ''}`}
            >
              {c('navPortal')}
            </NavLink>
            <NavLink
              to="/account/runtime"
              className={({ isActive }) => `ac-portal-nav-link${isActive ? ' is-active' : ''}`}
            >
              {c('runtimeNav')}
            </NavLink>
            <NavLink
              to="/account/download"
              className={({ isActive }) => `ac-portal-nav-link${isActive ? ' is-active' : ''}`}
            >
              {c('navDownloadDesktop')}
            </NavLink>
          </nav>

          <div className="ac-topbar-actions">
            {hasPendingRequests ? (
              <Link
                to="/account/friends?view=received"
                className="ac-friend-alert-pill"
                aria-label={`${pendingReceivedCount} ${c('overviewPendingRequests')}`}
              >
                <span className="ac-friend-alert-dot" aria-hidden="true" />
                <span>
                  {pendingReceivedCount} {c('navPendingShort')}
                </span>
              </Link>
            ) : null}

            <div className="ac-topbar-lang">
              <LanguageToggle
                locale={locale}
                label={locale === 'zh' ? '语言' : 'Language'}
                options={ACCOUNT_LOCALE_OPTIONS[locale]}
                onChange={(nextLocale) => {
                  setMenuOpen(false);
                  void i18n.changeLanguage(nextLocale);
                  document.documentElement.lang = nextLocale;
                  persistLocale(nextLocale, window.localStorage);
                  loadWebLocaleFont(nextLocale);
                }}
              />
            </div>

            <div className="ac-identity-menu" ref={menuContainerRef}>
              <button
                ref={menuTriggerRef}
                type="button"
                className={`ac-identity-trigger${menuOpen ? ' is-open' : ''}`}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-controls="ac-identity-popover"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <AccountAvatar user={user} size="small" />
                <span className="ac-identity-trigger-name">{displayName}</span>
                {hasPendingRequests ? (
                  <span className="ac-identity-trigger-dot" aria-hidden="true" />
                ) : null}
                <ChevronDown size={15} aria-hidden="true" className="ac-identity-trigger-chevron" />
              </button>

              {menuOpen ? (
                <div id="ac-identity-popover" className="ac-identity-popover" role="menu">
                  <div className="ac-popover-person">
                    <AccountAvatar user={user} size="normal" />
                    <div className="ac-popover-person-copy">
                      <strong>{displayName}</strong>
                      {secondaryIdentity ? <small>{secondaryIdentity}</small> : null}
                    </div>
                    <Link
                      to="/account/profile"
                      role="menuitem"
                      className="ac-popover-edit"
                      title={c('edit')}
                      aria-label={c('edit')}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </Link>
                  </div>

                  <div className="ac-popover-divider ac-popover-divider--accent" aria-hidden="true" />

                  <div className="ac-popover-mobile-nav">
                    <NavLink
                      to="/account"
                      end
                      role="menuitem"
                      className={({ isActive }) => `ac-popover-item${isActive ? ' is-active' : ''}`}
                    >
                      <House size={16} aria-hidden="true" />
                      <span className="ac-popover-item-label">{c('navPortal')}</span>
                      <ChevronRight size={14} aria-hidden="true" className="ac-popover-chevron" />
                    </NavLink>
                    <NavLink
                      to="/account/runtime"
                      role="menuitem"
                      className={({ isActive }) => `ac-popover-item${isActive ? ' is-active' : ''}`}
                    >
                      <Cpu size={16} aria-hidden="true" />
                      <span className="ac-popover-item-label">{c('runtimeNav')}</span>
                      <ChevronRight size={14} aria-hidden="true" className="ac-popover-chevron" />
                    </NavLink>
                    <NavLink
                      to="/account/download"
                      role="menuitem"
                      className={({ isActive }) => `ac-popover-item${isActive ? ' is-active' : ''}`}
                    >
                      <ArrowDownToLine size={16} aria-hidden="true" />
                      <span className="ac-popover-item-label">{c('navDownloadDesktop')}</span>
                      <ChevronRight size={14} aria-hidden="true" className="ac-popover-chevron" />
                    </NavLink>
                    <div className="ac-popover-divider" aria-hidden="true" />
                  </div>

                  <div className="ac-popover-group">
                    <span className="ac-popover-group-label">{c('navGroupIdentity')}</span>
                    <div className="ac-popover-list">
                      {identityMenuItems.map(([to, label, Icon]) => (
                        <NavLink
                          key={to}
                          to={to}
                          role="menuitem"
                          className={({ isActive }) => `ac-popover-item${isActive ? ' is-active' : ''}`}
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span className="ac-popover-item-label">{c(label)}</span>
                          {to === '/account/friends' && hasPendingRequests ? (
                            <span className="ac-badge">{pendingReceivedCount}</span>
                          ) : null}
                          <ChevronRight size={14} aria-hidden="true" className="ac-popover-chevron" />
                        </NavLink>
                      ))}
                    </div>
                  </div>

                  <div className="ac-popover-group">
                    <span className="ac-popover-group-label">{c('navGroupSecurity')}</span>
                    <div className="ac-popover-list">
                      {securityMenuItems.map(([to, label, Icon]) => (
                        <NavLink
                          key={to}
                          to={to}
                          role="menuitem"
                          className={({ isActive }) =>
                            `ac-popover-item${isActive || (to === '/account/data' && isDeleteRoute) ? ' is-active' : ''}`
                          }
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span className="ac-popover-item-label">{c(label)}</span>
                          {to === '/account/security' ? (
                            <span className={`ac-popover-pill${twoFactor ? ' is-enabled' : ''}`}>
                              {c(twoFactor ? 'enabled' : 'notEnabled')}
                            </span>
                          ) : null}
                          <ChevronRight size={14} aria-hidden="true" className="ac-popover-chevron" />
                        </NavLink>
                      ))}
                    </div>
                  </div>

                  <div className="ac-popover-divider" aria-hidden="true" />

                  <div className="ac-popover-list ac-popover-list--bottom">
                    <Link
                      to="/account/recovery"
                      role="menuitem"
                      className="ac-popover-item"
                    >
                      <CircleHelp size={16} aria-hidden="true" />
                      <span className="ac-popover-item-label">{c('help')}</span>
                      <ChevronRight size={14} aria-hidden="true" className="ac-popover-chevron" />
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      className="ac-popover-item ac-popover-item--danger"
                      disabled={working}
                      onClick={onSignOut}
                    >
                      <LogOut size={16} aria-hidden="true" />
                      <span className="ac-popover-item-label">{c('signOut')}</span>
                      <ChevronRight size={14} aria-hidden="true" className="ac-popover-chevron" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>
      </div>

      <div className={`ac-workspace ac-workspace--${layoutMode}`}>
        {layoutMode === 'settings' ? (
          <aside className="ac-settings-sidebar" aria-label={c('center')}>
            <Link to="/account" className="ac-back-portal">
              <ArrowLeft size={15} aria-hidden="true" />
              <span>{c('navBackPortal')}</span>
            </Link>

            <nav className="ac-settings-nav" aria-label={c('center')}>
              {settingsSidebarGroups.map(([groupKey, items]) => (
                <div className="ac-settings-nav-group" key={groupKey}>
                  <span className="ac-settings-nav-label">{c(groupKey)}</span>
                  <div className="ac-settings-nav-items">
                    {items.map(([to, label, Icon]) => (
                      <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) =>
                          `ac-settings-nav-item${isActive || (to === '/account/data' && isDeleteRoute) ? ' is-active' : ''}`
                        }
                      >
                        <Icon size={17} aria-hidden="true" />
                        <span className="ac-settings-nav-text">{c(label)}</span>
                        {to === '/account/friends' && hasPendingRequests ? (
                          <span className="ac-badge">{pendingReceivedCount}</span>
                        ) : null}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        ) : null}

        <main id="account-content" className="ac-main">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AccountSignedOut({
  loginUrl,
  error,
  onRetry,
}: {
  loginUrl: string;
  error?: string | null;
  onRetry: () => void;
}) {
  const c = useAccountCopy();
  const location = useLocation();
  const lang = new URLSearchParams(location.search).get('lang')?.trim().toLowerCase();
  const homeHref = lang === 'zh' || lang === 'en' ? `/?lang=${lang}` : '/';
  return (
    <main className="ac-entry">
      <Link to={homeHref} className="ac-brand">
        <img src="/logo.svg" alt="" />
        <span>Nimi</span>
      </Link>
      <div className="ac-entry-content">
        <UserRound size={32} />
        <h1>{c(error ? 'accountUnavailable' : 'signedOut')}</h1>
        {!error ? <p>{c('signedOutHint')}</p> : null}
        <AccountFeedback error={error} />
        {error ? (
          <>
            <button className="ac-button" onClick={onRetry}>
              {c('retry')}
            </button>
            <Link className="ac-text-link" to={loginUrl}>
              {c('signedOut')}
            </Link>
          </>
        ) : (
          <Link className="ac-button" to={loginUrl}>
            {c('signedOut')}
          </Link>
        )}
        <Link to={homeHref} className="ac-text-link">
          <ArrowLeft size={16} />
          {c('home')}
        </Link>
      </div>
    </main>
  );
}

export function AccountDraftDialog({ blocker }: { blocker: Blocker }) {
  const c = useAccountCopy();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (blocker.state === 'blocked') dialog.current?.showModal();
  }, [blocker.state]);
  if (blocker.state !== 'blocked') return null;
  return (
    <dialog
      ref={dialog}
      className="ac-dialog"
      aria-labelledby="ac-discard-title"
      onCancel={() => blocker.reset()}
    >
      <h2 id="ac-discard-title">{c('discard')}</h2>
      <div className="ac-actions">
        <button
          autoFocus
          type="button"
          className="ac-button ac-button--secondary"
          onClick={() => blocker.reset()}
        >
          {c('keepEditing')}
        </button>
        <button type="button" className="ac-button" onClick={() => blocker.proceed()}>
          {c('discardChanges')}
        </button>
      </div>
    </dialog>
  );
}
