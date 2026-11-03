import { useState } from 'react';
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
        <div className="relative">
          <button
            type="button"
            className="demo-account-avatar"
            aria-label={demo.appPreview.locale === 'zh' ? '账户菜单' : 'Account menu'}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <img src={demo.chat.self.avatarUrl} alt="" className="h-full w-full rounded-full" />
          </button>
          {menu && (
            <>
              <button
                type="button"
                className="demo-menu-dismiss"
                aria-label={demo.home.close}
                onClick={() => setMenu(false)}
              />
              <div className="demo-account-menu">
                <strong>Halliday</strong>
                <small>{demo.home.badge}</small>
                <button
                  type="button"
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
                  onClick={() => {
                    onSelect('settings', 'troubleshooting');
                    setMenu(false);
                  }}
                >
                  <Wrench size={16} />
                  {demo.home.settingsGroups[3]!.items[0]!.label}
                </button>
              </div>
            </>
          )}
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
