import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation, type Blocker } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Database,
  Globe2,
  House,
  LogOut,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  Monitor,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAccountCopy, type AccountCopyKey } from './account-center-copy.js';
import { accountHandle } from './account-center-model.js';
import { persistLocale } from '../landing/i18n/locale.js';
import { loadWebLocaleFont } from '../fonts.js';

const navigation = [
  ['/account', 'overview', House],
  ['/account/profile', 'profile', UserRound],
  ['/account/friends', 'friends', UsersRound],
  ['/account/privacy', 'privacy', SlidersHorizontal],
  ['/account/security', 'security', ShieldCheck],
  ['/account/sessions', 'sessions', Monitor],
  ['/account/data', 'data', Database],
] as const;

export function AccountAvatar({
  user,
  size = 'normal',
}: {
  user: { displayName?: unknown; handle?: unknown; avatarUrl?: unknown };
  size?: 'normal' | 'large' | 'small';
}) {
  const [name, url] = [
    String(user.displayName || user.handle || 'N'),
    typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
  ];
  return (
    <span className={`ac-avatar ac-avatar--${size}`}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>
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
  children,
}: {
  user: Record<string, unknown>;
  onSignOut: () => void;
  working: boolean;
  children: ReactNode;
}) {
  const c = useAccountCopy();
  const { i18n } = useTranslation();
  const location = useLocation();
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const selected = navigation.find(([path]) => path === location.pathname)?.[1] ?? 'overview';
  useEffect(() => {
    if (mobileMenu.current) mobileMenu.current.open = false;
  }, [location.pathname]);
  const links = () =>
    navigation.map(([to, label, Icon]) => (
      <NavLink
        key={to}
        to={to}
        end={to === '/account'}
        className={({ isActive }) => `ac-nav-item${isActive ? ' is-active' : ''}`}
      >
        <Icon size={19} />
        <span>{c(label)}</span>
      </NavLink>
    ));
  const footer = () => (
    <div className="ac-sidebar-footer">
      <Link to="/account/recovery">
        {c('help')}
        <ArrowUpRight size={14} />
      </Link>
      <button type="button" disabled={working} onClick={onSignOut}>
        <LogOut size={17} />
        {c('signOut')}
      </button>
    </div>
  );
  return (
    <div className="ac-root">
      <a className="ac-skip" href="#account-content">
        {i18n.language.startsWith('zh') ? '跳到主要内容' : 'Skip to content'}
      </a>
      <header className="ac-topbar">
        <Link to="/" className="ac-brand" aria-label={c('home')}>
          <img src="/logo.svg" alt="" />
          <span>Nimi</span>
        </Link>
        <span className="ac-topbar-title">{c('center')}</span>
        <div className="ac-topbar-actions">
          <button
            type="button"
            className="ac-icon-button"
            aria-label={i18n.language.startsWith('zh') ? 'Switch to English' : '切换到中文'}
            onClick={() => {
              const locale = i18n.language.startsWith('zh') ? 'en' : 'zh';
              void i18n.changeLanguage(locale);
              document.documentElement.lang = locale;
              persistLocale(locale, window.localStorage);
              loadWebLocaleFont(locale);
            }}
          >
            <Globe2 size={18} />
            <span>{i18n.language.startsWith('zh') ? 'EN' : '中文'}</span>
          </button>
          <Link to="/" className="ac-home-link">
            {c('home')}
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>
      <div className="ac-workspace">
        <aside className="ac-sidebar">
          <div className="ac-desktop-nav">
            <Link to="/account/profile" className="ac-sidebar-person">
              <AccountAvatar user={user} />
              <span>
                <strong>{String(user.displayName || user.handle || c('profile'))}</strong>
                <small>@{accountHandle(user.handle)}</small>
              </span>
            </Link>
            <nav aria-label={c('center')}>{links()}</nav>
            {footer()}
          </div>
          <details ref={mobileMenu} className="ac-mobile-nav">
            <summary>
              <AccountAvatar user={user} size="small" />
              <strong>{String(user.displayName || user.handle)}</strong>
              <span>{c(selected)}</span>
              <ChevronDown size={17} />
            </summary>
            <nav aria-label={c('center')}>{links()}</nav>
            {footer()}
          </details>
        </aside>
        <main id="account-content" className="ac-main">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AccountOverview({ user }: { user: Record<string, unknown> }) {
  const c = useAccountCopy();
  const shortcuts: Array<{
    to: string;
    title: AccountCopyKey;
    hint: AccountCopyKey;
    icon: typeof UsersRound;
  }> = [
    { to: '/account/friends', title: 'friends', hint: 'friendsHint', icon: UsersRound },
    { to: '/account/privacy', title: 'privacy', hint: 'privacyHint', icon: SlidersHorizontal },
    { to: '/account/security', title: 'security', hint: 'securityHint', icon: ShieldCheck },
  ];
  return (
    <>
      <AccountHeading title={c('overview')} description={c('welcome')} />
      <section className="ac-identity">
        <AccountAvatar user={user} size="large" />
        <div className="ac-identity-body">
          <h2>{String(user.displayName || user.handle)}</h2>
          <p className="ac-handle">@{accountHandle(user.handle)}</p>
          {user.bio ? (
            <p className="ac-bio">{String(user.bio)}</p>
          ) : (
            <p className="ac-muted">{c('bioHint')}</p>
          )}
          <Link className="ac-button ac-button--secondary" to="/account/profile">
            {c('edit')}
          </Link>
        </div>
      </section>
      <div className="ac-shortcuts">
        {shortcuts.map(({ to, title, hint, icon: Icon }) => (
          <Link to={to} className="ac-shortcut" key={to}>
            <span className="ac-shortcut-icon">
              <Icon size={22} />
            </span>
            <span>
              <strong>{c(title)}</strong>
              <small>{c(hint)}</small>
            </span>
            <ChevronRight size={19} />
          </Link>
        ))}
      </div>
      <div className="ac-context-note">
        <img src="/logo.svg" alt="" />
        <div>
          <strong>{c('across')}</strong>
          <p>
            {c('acrossHint')} {c('chatHome')}
          </p>
        </div>
      </div>
    </>
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
  return (
    <main className="ac-entry">
      <Link to="/" className="ac-brand">
        <img src="/logo.svg" alt="" />
        <span>Nimi</span>
      </Link>
      <div className="ac-entry-content">
        <UserRound size={32} />
        <h1>{c(error ? 'accountUnavailable' : 'signedOut')}</h1>
        {!error ? <p>{c('signedOutHint')}</p> : null}
        <AccountFeedback error={error} />
        {error ? (
          <button className="ac-button" onClick={onRetry}>
            {c('retry')}
          </button>
        ) : (
          <Link className="ac-button" to={loginUrl}>
            {c('signedOut')}
          </Link>
        )}
        <Link to="/" className="ac-text-link">
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
