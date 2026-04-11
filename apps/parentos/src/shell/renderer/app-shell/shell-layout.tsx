import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent, type ReactNode, type ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, User, BookText, MessageCircle, TrendingUp, Settings, type LucideProps } from 'lucide-react';
import { useAppStore, computeAgeMonths } from './app-store.js';
import { startParentosWindowDrag } from '../bridge/window-drag.js';

const navItems: Array<{ to: string; label: string; Icon: ComponentType<LucideProps> }> = [
  { to: '/timeline', label: '首页', Icon: Home },
  { to: '/profile', label: '档案', Icon: User },
  { to: '/journal', label: '观察笔记', Icon: BookText },
  { to: '/advisor', label: '顾问', Icon: MessageCircle },
  { to: '/reports', label: '报告', Icon: TrendingUp },
  { to: '/settings', label: '设置', Icon: Settings },
];

/* ── Child avatar popover (matches dashboard card switcher) ── */

function ChildAvatarPicker({ childList, activeChildId, activeChild, onSwitch }: {
  childList: Array<{ childId: string; displayName: string; birthDate: string; gender: string }>;
  activeChildId: string | null;
  activeChild: { displayName: string } | undefined;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const openPicker = () => { setMounted(true); requestAnimationFrame(() => setOpen(true)); };
  const closePicker = () => setOpen(false);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) closePicker(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative z-40 mt-auto">
      <button onClick={() => open ? closePicker() : openPicker()}
        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all hover:shadow-md"
        style={{ background: '#86AFDA', color: '#fff' }}>
        {activeChild?.displayName.charAt(0) ?? '?'}
      </button>

      {childList.length > 1 && mounted && (
        <div
          className="absolute bottom-12 left-0 z-50 min-w-[190px] rounded-xl p-1.5"
          onTransitionEnd={() => { if (!open) setMounted(false); }}
          style={{
            background: '#fff',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            opacity: open ? 1 : 0,
            transform: open ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.95)',
            transformOrigin: 'bottom left',
            transition: 'opacity 0.2s ease, transform 0.2s ease',
            pointerEvents: open ? 'auto' : 'none',
          }}>
          {childList.map((c, idx) => {
            const am = computeAgeMonths(c.birthDate);
            const y = Math.floor(am / 12);
            const m = am % 12;
            const isActive = c.childId === activeChildId;
            return (
              <button key={c.childId}
                onClick={() => { onSwitch(c.childId); closePicker(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left transition-colors hover:bg-[#f5f3ef]"
                style={{
                  ...(isActive ? { background: '#EEF3F1' } : undefined),
                  opacity: open ? 1 : 0,
                  transform: open ? 'translateY(0)' : 'translateY(4px)',
                  transition: `opacity 0.2s ease ${idx * 0.03}s, transform 0.2s ease ${idx * 0.03}s`,
                }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: isActive ? '#86AFDA' : '#e0e4e8', color: isActive ? '#fff' : '#1a2b4a' }}>
                  {c.displayName.charAt(0)}
                </div>
                <div className="min-w-0">
                  <span className="block text-[12px] font-medium truncate" style={{ color: '#1a2b4a' }}>{c.displayName}</span>
                  <span className="block text-[10px]" style={{ color: '#8a8f9a' }}>
                    {y > 0 ? `${y}岁` : ''}{m > 0 ? `${m}个月` : ''} · {c.gender === 'female' ? '女孩' : '男孩'}
                  </span>
                </div>
                {isActive && (
                  <svg className="ml-auto shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86AFDA" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ShellLayout({ children }: { children: ReactNode }) {
  const { children: childList, activeChildId, setActiveChildId } = useAppStore();
  const activeChild = childList.find((c) => c.childId === activeChildId);
  const handleWindowDragMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    void startParentosWindowDrag();
  };

  return (
    <div className="isolate flex h-full" style={{ background: '#E5ECEA' }}>
      {/* Narrow icon sidebar */}
      <nav className="relative z-30 flex w-[72px] shrink-0 flex-col items-center overflow-visible py-4" style={{ background: '#E5ECEA' }}>
        {/* Greeting — above nav icons, left-aligned with them, overflows right */}
        <div className="w-[42px] self-center mb-5 relative" onMouseDown={handleWindowDragMouseDown}>
          <div className="whitespace-nowrap">
            <h1 className="text-[18px] font-bold leading-tight" style={{ color: '#1a2b4a' }}>记录成长，科学育娃</h1>
            <p className="text-[11px] mt-0.5" style={{ color: '#8a94a6' }}>
              {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
          </div>
        </div>

        {/* Nav items */}
        <div className="flex flex-1 flex-col items-center gap-[10px]">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex items-center justify-center w-[42px] h-[42px] rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'text-white'
                    : 'hover:bg-black/[0.04]'
                }`
              }
              style={({ isActive }) =>
                isActive
                  ? { background: '#94A533', color: '#fff' }
                  : { color: '#8a94a6' }
              }
            >
              <item.Icon size={20} strokeWidth={1.8} />
              {/* Green tooltip on hover */}
              <span className="pointer-events-none absolute left-[54px] z-50 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                style={{ background: '#94A533' }}>
                {item.label}
              </span>
            </NavLink>
          ))}
        </div>

        {/* Child avatar + popover switcher */}
        {childList.length > 0 && (
          <ChildAvatarPicker
            childList={childList}
            activeChildId={activeChildId}
            activeChild={activeChild}
            onSwitch={setActiveChildId}
          />
        )}
      </nav>

      {/* Main content */}
      <main className="relative z-0 min-w-0 flex-1 overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 z-20 h-[72px]"
          data-testid="shell-main-drag-region"
          aria-hidden="true"
          onMouseDown={handleWindowDragMouseDown}
        />
        <div className="h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
