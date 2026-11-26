import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui';
import {
  Bell,
  Cloud,
  Compass,
  Cpu,
  Download,
  MessageSquare,
  UserRound,
  Wrench,
  Plug,
  Settings,
  ShoppingBag,
} from 'lucide-react';
import type { HeroDemo, HeroDemoSurface } from '../content/landing-content.js';

const primary = [
  ['chat', MessageSquare],
  ['explore', Compass],
  ['apps', ShoppingBag],
  ['runtime', Cpu],
  ['cloud', Cloud],
  ['integrations', Plug],
] as const;

export function DemoRail({
  demo,
  surface,
  onSelect,
}: {
  demo: HeroDemo;
  surface: HeroDemoSurface;
  onSelect: (next: HeroDemoSurface, target?: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useNimiReducedMotion();
  const menuMotion = nimiOverlayPanelMotion({
    kind: 'popover',
    side: 'top',
    align: 'start',
    reducedMotion,
  });

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuWrapRef.current?.contains(event.target)) return;
      setMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(false);
      menuTriggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [menu]);
  return (
    <nav
      aria-label={demo.windowTitle}
      className="demo-primary-rail"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setMenu(false);
      }}
    >
      <button
        type="button"
        className="demo-home-logo"
        aria-label={demo.nav.home}
        aria-pressed={surface === 'home'}
        onClick={() => onSelect('home')}
      >
        <img src="/logo.svg" alt="" />
      </button>
      <div className="demo-primary-items">
        {primary.map(([id, Icon]) => (
          <button
            type="button"
            key={id}
            className="demo-rail-button"
            aria-label={demo.nav[id]}
            title={demo.nav[id]}
            aria-pressed={surface === id}
            onClick={() => onSelect(id)}
          >
            <Icon size={21} strokeWidth={1.7} />
          </button>
        ))}
      </div>
      <div className="demo-rail-bottom">
        <button
          type="button"
          className="demo-rail-button"
          aria-label={demo.nav.downloads}
          title={demo.nav.downloads}
          aria-pressed={surface === 'downloads'}
          onClick={() => onSelect('downloads')}
        >
          <Download size={20} />
        </button>
        <button
          type="button"
          className="demo-rail-button"
          aria-label={demo.nav.messages}
          title={demo.nav.messages}
          aria-pressed={surface === 'messages'}
          onClick={() => onSelect('messages')}
        >
          <Bell size={20} />
        </button>
        <div className="relative" ref={menuWrapRef}>
          <button
            ref={menuTriggerRef}
            type="button"
            className="demo-account-avatar"
            aria-label={demo.appPreview.locale === 'zh' ? '账户菜单' : 'Account menu'}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <img src={demo.chat.self.avatarUrl} alt="" className="h-full w-full rounded-full" />
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div
                role="menu"
                data-demo-nested-dialog="true"
                className="demo-account-menu"
                {...menuMotion}
                style={{ ...menuMotion.style, transformOrigin: 'bottom left' }}
              >
                <strong>Halliday</strong>
                <small>{demo.home.badge}</small>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelect('settings', 'profile');
                    setMenu(false);
                  }}
                >
                  <UserRound size={16} />
                  {demo.home.settingsGroups[1]!.items[0]!.label}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelect('settings');
                    setMenu(false);
                  }}
                >
                  <Settings size={16} />
                  {demo.nav.settings}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelect('settings', 'troubleshooting');
                    setMenu(false);
                  }}
                >
                  <Wrench size={16} />
                  {demo.home.settingsGroups[3]!.items[0]!.label}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </nav>
  );
}

export function DemoSurfaceSwitcher({
  demo,
  surface,
  onSelect,
}: {
  demo: HeroDemo;
  surface: HeroDemoSurface;
  onSelect: (next: HeroDemoSurface, target?: string) => void;
}) {
  return (
    <select
      className="demo-mobile-nav"
      aria-label={demo.windowTitle}
      value={surface}
      onChange={(event) => onSelect(event.target.value as HeroDemoSurface)}
    >
      {Object.entries(demo.nav).map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  );
}
