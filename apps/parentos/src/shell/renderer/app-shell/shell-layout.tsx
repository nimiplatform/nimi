import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent, type ReactNode, type ComponentType } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, User, BookText, MessageCircle, TrendingUp, Settings, LogOut, ChevronDown, Check, UserPlus, type LucideProps } from 'lucide-react';
import { AmbientBackground, Surface, cn } from '@nimiplatform/nimi-kit/ui';
import { useAppStore, computeAgeMonths, type ChildProfile } from './app-store.js';
import { startParentosWindowDrag } from '../bridge/window-drag.js';
import { setAppSetting } from '../bridge/sqlite-bridge.js';
import { syncParentOSLocalDataScope } from '../infra/parentos-bootstrap.js';
import { logoutParentOSRuntimeAccount } from '../features/auth/parentos-auth-adapter.js';
import { isoNow } from '../bridge/ulid.js';
import { ProfileTodoDrawer } from '../features/profile/profile-todo-drawer.js';
import { ChildAvatar } from '../shared/child-avatar.js';

const navItems: Array<{ to: string; label: string; Icon: ComponentType<LucideProps> }> = [
  { to: '/timeline', label: '首页', Icon: Home },
  { to: '/profile', label: '档案', Icon: User },
  { to: '/journal', label: '成长随记', Icon: BookText },
  { to: '/advisor', label: '顾问', Icon: MessageCircle },
  { to: '/reports', label: '报告', Icon: TrendingUp },
  { to: '/settings', label: '设置', Icon: Settings },
];

/* ── Child Switcher Breadcrumb ─────────────────────────────── */

function formatChildAge(ageMonths: number): string {
  const y = Math.floor(ageMonths / 12);
  const m = ageMonths % 12;
  if (y > 0 && m > 0) return `${y}岁${m}个月`;
  if (y > 0) return `${y}岁`;
  return `${m}个月`;
}

function ChildSwitcherBreadcrumb({ childList, activeChildId, onSwitchChild }: {
  childList: ChildProfile[];
  activeChildId: string | null;
  onSwitchChild: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const openMenu = () => { setMounted(true); requestAnimationFrame(() => setOpen(true)); };
  const closeMenu = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', escHandler); };
  }, [open]);

  const activeChild = childList.find((c) => c.childId === activeChildId) ?? null;
  if (!activeChild) return null;

  return (
    <div ref={ref} className="relative z-40">
      <button
        type="button"
        onClick={() => open ? closeMenu() : openMenu()}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="切换孩子"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--nimi-action-ghost-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-[var(--nimi-border-subtle)]">
          <ChildAvatar child={activeChild} className="h-full w-full object-cover" />
        </span>
        <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{activeChild.displayName}</span>
        <ChevronDown size={13} strokeWidth={2} className="text-[var(--nimi-text-muted)]" />
      </button>

      {mounted && (
        <Surface
          as="div"
          material="glass-thick"
          padding="none"
          tone="card"
          role="menu"
          className={cn(
            'absolute left-0 top-12 z-50 w-60 origin-top-left overflow-hidden rounded-xl border-[var(--nimi-material-glass-thick-border)] py-1.5 shadow-[var(--nimi-elevation-floating)] transition-all duration-[var(--nimi-motion-fast)]',
            open ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-1 scale-95 opacity-0',
          )}
          onTransitionEnd={() => { if (!open) setMounted(false); }}
        >
          <div className="px-1.5">
            {childList.map((c) => {
              const isActive = c.childId === activeChildId;
              const ageLabel = formatChildAge(computeAgeMonths(c.birthDate));
              return (
                <button
                  key={c.childId}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => { onSwitchChild(c.childId); closeMenu(); }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-[var(--nimi-text-primary)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]',
                    isActive && 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full',
                      isActive ? 'ring-2 ring-[var(--nimi-action-primary-bg)]' : 'ring-1 ring-[var(--nimi-border-subtle)]',
                    )}>
                      <ChildAvatar child={c} className="h-full w-full object-cover" />
                    </span>
                    <div className="min-w-0">
                      <span className={cn(
                        'block truncate text-[14px] font-semibold',
                        isActive ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]',
                      )}>
                        {c.displayName}
                      </span>
                      <span className="block text-[12px] text-[var(--nimi-text-muted)]">{ageLabel}</span>
                    </div>
                  </div>
                  {isActive ? <Check size={16} strokeWidth={2.2} className="text-[var(--nimi-action-primary-bg)]" /> : null}
                </button>
              );
            })}
          </div>

          <div className="mx-3 my-1 border-t border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)]" />

          <div className="px-1.5 pb-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => { closeMenu(); navigate('/settings/children'); }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[14px] text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
            >
              <UserPlus size={16} strokeWidth={1.8} className="text-[var(--nimi-text-muted)]" />
              添加家庭成员
            </button>
          </div>
        </Surface>
      )}
    </div>
  );
}

/* ── Account Avatar Menu ───────────────────────────────────── */

const accountMenuItems = [
  { id: 'profile', label: '档案', icon: User, route: '/profile' },
  { id: 'settings', label: '设置', icon: Settings, route: '/settings' },
] as const;

function AccountAvatarMenu() {
  const authUser = useAppStore((s) => s.auth.user);
  const clearAuth = useAppStore((s) => s.clearAuthSession);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const openMenu = () => { setMounted(true); requestAnimationFrame(() => setOpen(true)); };
  const closeMenu = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', escHandler); };
  }, [open]);

  const handleLogout = async () => {
    closeMenu();
    // PO-SHELL-008: revoke through Runtime account custody (single source of
    // truth). No legacy app-local session storage to clear.
    try { await logoutParentOSRuntimeAccount(); } catch { /* best-effort */ }
    clearAuth();
    void syncParentOSLocalDataScope(null);
  };

  const displayName = authUser?.displayName || '用户';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative z-40">
      <button
        onClick={() => open ? closeMenu() : openMenu()}
        aria-expanded={open}
        aria-label="打开账号菜单"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--nimi-text-primary)] text-[14px] font-semibold text-[var(--nimi-text-inverse)] shadow-[var(--nimi-elevation-base)] transition-all hover:-translate-y-0.5"
      >
        {initial}
      </button>

      {mounted && (
        <Surface
          as="div"
          material="glass-thick"
          padding="none"
          tone="card"
          className={cn(
            'absolute right-0 top-12 z-50 w-64 origin-top-right overflow-hidden rounded-xl border-[var(--nimi-material-glass-thick-border)] py-2 shadow-[var(--nimi-elevation-floating)] transition-all duration-[var(--nimi-motion-fast)]',
            open ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-1 scale-95 opacity-0',
          )}
          onTransitionEnd={() => { if (!open) setMounted(false); }}
        >
          {/* ── User info header ── */}
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-text-primary)] text-[16px] font-semibold text-[var(--nimi-text-inverse)]">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                {displayName}
              </p>
              {authUser?.email ? (
                <p className="truncate text-xs text-[var(--nimi-text-muted)]">{authUser.email}</p>
              ) : null}
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="mx-3 border-t border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)]" />

          {/* ── Menu items ── */}
          <div className="px-1.5 py-1.5">
            {accountMenuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => { closeMenu(); navigate(item.route); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-[var(--nimi-text-secondary)] transition-all hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]"
              >
                <item.icon size={18} strokeWidth={1.8} className="text-[var(--nimi-text-muted)]" />
                {item.label}
              </button>
            ))}
          </div>

          {/* ── Divider ── */}
          <div className="mx-3 border-t border-[var(--nimi-border-subtle)]" />

          {/* ── Logout ── */}
          <div className="px-1.5 py-1.5">
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-[var(--nimi-status-danger)] transition-all hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)]"
            >
              <LogOut size={18} strokeWidth={1.8} className="text-[var(--nimi-status-danger)]" />
              退出登录
            </button>
          </div>
        </Surface>
      )}
    </div>
  );
}

export function ShellLayout({ children }: { children: ReactNode }) {
  const { children: childList, activeChildId, setActiveChildId } = useAppStore();
  const location = useLocation();
  const isProfileDetailPage = /^\/profile\/[^/]+/.test(location.pathname);

  useEffect(() => {
    const now = isoNow();
    const value = activeChildId ?? '';
    void Promise.all([
      setAppSetting('activeChildId', value, now),
      setAppSetting('inspection:last-active-child-id', value, now),
    ]).catch(() => {});
  }, [activeChildId]);

  const handleWindowDragMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const tag = (event.target as HTMLElement).tagName;
    const interactive = (event.target as HTMLElement).closest('a, button, input, select, textarea, [role="button"], [tabindex]');
    if (interactive || tag === 'A' || tag === 'BUTTON' || tag === 'INPUT') return;
    void startParentosWindowDrag();
  };

  return (
    <AmbientBackground variant="mesh" className="isolate flex h-full overflow-hidden">
      {/* Sidebar — transparent, shares global bg */}
      <nav
        className="relative z-30 flex w-[62px] shrink-0 flex-col items-center overflow-visible bg-transparent pt-32 pb-5"
      >
        <div className="flex flex-1 flex-col items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex items-center justify-center w-[40px] h-[40px] rounded-xl transition-all duration-150 ${
                  isActive
                    ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-text-inverse)] shadow-[var(--nimi-elevation-base)]'
                    : 'text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]'
                }`
              }
            >
              <item.Icon size={19} strokeWidth={1.8} />
              <span
                className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded-2xl border border-[var(--nimi-material-glass-thick-border)] bg-[var(--nimi-material-glass-thick-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] opacity-0 shadow-[var(--nimi-elevation-floating)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] transition-opacity duration-100 group-hover:opacity-100 nimi-material-glass-thick"
              >
                {item.label}
              </span>
            </NavLink>
          ))}
        </div>

        <div className="mt-auto" />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header
          className="z-20 flex h-[60px] shrink-0 items-center gap-4 bg-transparent px-6"
          onMouseDown={handleWindowDragMouseDown}
        >
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-[18px] font-semibold text-[var(--nimi-text-primary)]">ParentOS</h1>
            {childList.length > 0 && activeChildId ? (
              <>
                <span className="select-none text-[var(--nimi-border-strong)]" aria-hidden="true">/</span>
                <ChildSwitcherBreadcrumb
                  childList={childList}
                  activeChildId={activeChildId}
                  onSwitchChild={setActiveChildId}
                />
              </>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <AccountAvatarMenu />
          </div>
        </header>

        <main className="relative z-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (e.clientY - rect.top > 40) return;
            const tag = (e.target as HTMLElement).tagName;
            const interactive = (e.target as HTMLElement).closest('a, button, input, select, textarea, [role="button"], [tabindex]');
            if (interactive || tag === 'A' || tag === 'BUTTON' || tag === 'INPUT') return;
            void startParentosWindowDrag();
          }}
          data-testid="shell-main-drag-region"
        >
          <div className="h-full">{children}</div>
        </main>
      </div>
      {isProfileDetailPage ? <ProfileTodoDrawer /> : null}
    </AmbientBackground>
  );
}
