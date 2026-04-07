import type { ReactNode, ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, User, BookText, MessageCircle, TrendingUp, Settings, type LucideProps } from 'lucide-react';
import { useAppStore } from './app-store.js';

const navItems: Array<{ to: string; label: string; Icon: ComponentType<LucideProps> }> = [
  { to: '/timeline', label: '首页', Icon: Home },
  { to: '/profile', label: '档案', Icon: User },
  { to: '/journal', label: '观察笔记', Icon: BookText },
  { to: '/advisor', label: '顾问', Icon: MessageCircle },
  { to: '/reports', label: '报告', Icon: TrendingUp },
  { to: '/settings', label: '设置', Icon: Settings },
];

export function ShellLayout({ children }: { children: ReactNode }) {
  const { children: childList, activeChildId, setActiveChildId } = useAppStore();
  const activeChild = childList.find((c) => c.childId === activeChildId);

  return (
    <div className="flex h-full" style={{ background: '#E5ECEA' }}>
      {/* Narrow icon sidebar */}
      <nav className="flex w-[72px] shrink-0 flex-col items-center py-4" style={{ background: '#E5ECEA' }}>
        {/* Greeting — above nav icons, left-aligned with them, overflows right */}
        <div className="w-[42px] self-center mb-5 relative">
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

        {/* Child avatar + hidden selector */}
        {childList.length > 0 && (
          <div className="relative mt-auto">
            <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold" style={{ background: '#1a2b4a', color: '#fff' }}>
              {activeChild?.displayName.charAt(0) ?? '?'}
            </div>
            {childList.length > 1 && (
              <select
                value={activeChildId ?? ''}
                onChange={(event) => setActiveChildId(event.target.value || null)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="切换孩子"
              >
                {childList.map((child) => (
                  <option key={child.childId} value={child.childId}>
                    {child.displayName}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
