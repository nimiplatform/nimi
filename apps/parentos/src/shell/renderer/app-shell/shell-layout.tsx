import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent, type ReactNode, type ComponentType } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, User, BookText, MessageCircle, TrendingUp, Settings, Bell, LogOut, type LucideProps } from 'lucide-react';
import { useAppStore, computeAgeMonths } from './app-store.js';
import { startParentosWindowDrag } from '../bridge/window-drag.js';
import { clearAuthSession as clearPersistedAuthSession } from '../bridge/index.js';
import { setAppSetting } from '../bridge/sqlite-bridge.js';
import { syncParentOSLocalDataScope } from '../infra/parentos-bootstrap.js';
import { isoNow } from '../bridge/ulid.js';
import { BG, GLASS } from './page-style.js';

const textMain = '#1e293b';
const textMuted = '#475569';

const navItems: Array<{ to: string; label: string; Icon: ComponentType<LucideProps> }> = [
  { to: '/timeline', label: '首页', Icon: Home },
  { to: '/profile', label: '档案', Icon: User },
  { to: '/journal', label: '成长随记', Icon: BookText },
  { to: '/advisor', label: '顾问', Icon: MessageCircle },
  { to: '/reports', label: '报告', Icon: TrendingUp },
  { to: '/settings', label: '设置', Icon: Settings },
];

/* ── Account Avatar Menu ───────────────────────────────────── */

const accountMenuItems = [
  { id: 'profile', label: '档案', icon: User, route: '/profile' },
  { id: 'settings', label: '设置', icon: Settings, route: '/settings' },
] as const;

function AccountAvatarMenu({ childList, activeChildId, onSwitchChild }: {
  childList: Array<{ childId: string; displayName: string; birthDate: string; gender: string }>;
  activeChildId: string | null;
  onSwitchChild: (id: string) => void;
}) {
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
    try { await clearPersistedAuthSession(); } catch { /* best-effort */ }
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
        className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold transition-all hover:-translate-y-0.5"
        style={{ background: textMain, color: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
      >
        {initial}
      </button>

      {mounted && (
        <div
          className="absolute right-0 top-12 z-50 w-64 overflow-hidden py-2"
          onTransitionEnd={() => { if (!open) setMounted(false); }}
          style={{
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(78,204,163,0.2)',
            borderRadius: 16,
            boxShadow: '0 8px 32px rgba(78,204,163,0.1)',
            opacity: open ? 1 : 0,
            transform: open ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.97)',
            transformOrigin: 'top right',
            transition: 'opacity 0.18s ease, transform 0.18s ease',
            pointerEvents: open ? 'auto' : 'none',
          }}
        >
          {/* ── User info header ── */}
          <div className="flex items-center gap-3 px-4 py-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
              style={{ background: textMain }}
            >
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" style={{ color: textMain }}>
                {displayName}
              </p>
              {authUser?.email ? (
                <p className="truncate text-xs" style={{ color: textMuted }}>{authUser.email}</p>
              ) : null}
            </div>
          </div>

          {/* ── Child switcher (only when multiple children) ── */}
          {childList.length > 1 && (
            <>
              <div className="mx-3 border-t" style={{ borderColor: 'rgba(78,204,163,0.2)' }} />
              <div className="px-1.5 py-1.5">
                <p className="px-3 py-1 text-[11px] font-medium" style={{ color: textMuted }}>切换孩子</p>
                {childList.map((c, idx) => {
                  const am = computeAgeMonths(c.birthDate);
                  const y = Math.floor(am / 12);
                  const m = am % 12;
                  const isActive = c.childId === activeChildId;
                  return (
                    <button key={c.childId}
                      onClick={() => { onSwitchChild(c.childId); closeMenu(); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors"
                      style={{
                        background: isActive ? 'rgba(78,204,163,0.1)' : undefined,
                        opacity: open ? 1 : 0,
                        transform: open ? 'translateY(0)' : 'translateY(3px)',
                        transition: `opacity 0.18s ease ${idx * 0.03}s, transform 0.18s ease ${idx * 0.03}s`,
                      }}
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                        style={{ background: isActive ? '#4ECCA3' : '#f1f5f9', color: isActive ? '#fff' : textMain }}>
                        {c.displayName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <span className="block truncate text-[12px] font-semibold" style={{ color: isActive ? '#2F7D6B' : textMain }}>{c.displayName}</span>
                        <span className="block text-[10px]" style={{ color: textMuted }}>
                          {y > 0 ? `${y}岁` : ''}{m > 0 ? `${m}个月` : ''} · {c.gender === 'female' ? '女孩' : '男孩'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Divider ── */}
          <div className="mx-3 border-t" style={{ borderColor: 'rgba(78,204,163,0.2)' }} />

          {/* ── Menu items ── */}
          <div className="px-1.5 py-1.5">
            {accountMenuItems.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => { closeMenu(); navigate(item.route); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] transition-all hover:bg-[#4ECCA3]/5"
                style={{
                  color: '#374151',
                  opacity: open ? 1 : 0,
                  transform: open ? 'translateY(0)' : 'translateY(3px)',
                  transition: `opacity 0.18s ease ${idx * 0.03}s, transform 0.18s ease ${idx * 0.03}s`,
                }}
              >
                <item.icon size={18} strokeWidth={1.8} style={{ color: '#9ca3af' }} />
                {item.label}
              </button>
            ))}
          </div>

          {/* ── Divider ── */}
          <div className="mx-3 border-t" style={{ borderColor: '#f3f4f6' }} />

          {/* ── Logout ── */}
          <div className="px-1.5 py-1.5">
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] transition-all hover:bg-red-50"
              style={{
                color: '#e25555',
                opacity: open ? 1 : 0,
                transform: open ? 'translateY(0)' : 'translateY(3px)',
                transition: `opacity 0.18s ease ${accountMenuItems.length * 0.03}s, transform 0.18s ease ${accountMenuItems.length * 0.03}s`,
              }}
            >
              <LogOut size={18} strokeWidth={1.8} style={{ color: '#e25555' }} />
              退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ShellLayout({ children }: { children: ReactNode }) {
  const { children: childList, activeChildId, setActiveChildId } = useAppStore();

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
    <div className="isolate flex h-full" style={{ background: BG, overflow: 'hidden' }}>
      {/* Sidebar — transparent, shares global bg */}
      <nav
        className="relative z-30 flex w-[62px] shrink-0 flex-col items-center overflow-visible pb-5"
        style={{ background: 'transparent', paddingTop: 128 }}
      >
        <div className="flex flex-1 flex-col items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex items-center justify-center w-[40px] h-[40px] rounded-[12px] transition-all duration-150 ${
                  isActive ? '' : 'hover:bg-white/40'
                }`
              }
              style={({ isActive }) =>
                isActive
                  ? { background: textMain, color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }
                  : { color: '#64748b' }
              }
            >
              <item.Icon size={19} strokeWidth={1.8} />
              <span
                className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap px-3 py-1.5 text-[11px] font-medium opacity-0 transition-opacity duration-100 group-hover:opacity-100"
                style={{ ...GLASS, background: 'rgba(255,255,255,0.85)', color: textMain }}
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
          className="z-20 flex h-[60px] shrink-0 items-center gap-4 px-6"
          style={{ background: 'transparent' }}
          onMouseDown={handleWindowDragMouseDown}
        >
          <h1 className="text-[17px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.3px' }}>ParentOS</h1>

          <div className="ml-auto flex items-center gap-3">
            <button className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/40"
              style={{ color: '#64748b' }}>
              <Bell size={17} strokeWidth={1.8} />
            </button>

            <AccountAvatarMenu childList={childList} activeChildId={activeChildId} onSwitchChild={setActiveChildId} />
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
    </div>
  );
}
