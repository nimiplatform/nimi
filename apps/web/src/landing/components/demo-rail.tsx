import type { ReactElement } from 'react';
import { Avatar, IconButton, SegmentedControl } from '@nimiplatform/kit/ui';
import type { HeroDemo, HeroDemoSurface } from '../content/landing-content.js';
import { AppsIcon, BellIcon, ChatIcon, CompassIcon, GearIcon, RuntimeIcon } from './demo-icons.js';

const SURFACE_ICONS: Record<HeroDemoSurface, () => ReactElement> = {
  chat: ChatIcon,
  explore: CompassIcon,
  apps: AppsIcon,
  runtime: RuntimeIcon,
  settings: GearIcon,
};

export function DemoRail({
  demo,
  surface,
  onSelect,
}: {
  demo: HeroDemo;
  surface: HeroDemoSurface;
  onSelect: (next: HeroDemoSurface) => void;
}) {
  const primary: ReadonlyArray<HeroDemoSurface> = ['chat', 'explore', 'apps', 'runtime'];
  return (
    <nav aria-label={demo.windowTitle} className="flex w-14 shrink-0 flex-col items-center gap-3 py-4">
      <img src="/logo.svg" alt="" className="h-6 w-6" aria-hidden="true" />
      <ul className="mt-2 flex flex-col items-center gap-2">
        {primary.map((id) => {
          const Icon = SURFACE_ICONS[id];
          return (
            <li key={id}>
              <IconButton
                aria-label={demo.nav[id]}
                aria-pressed={id === surface}
                active={id === surface}
                icon={<Icon />}
                onClick={() => onSelect(id)}
              />
            </li>
          );
        })}
      </ul>
      <div className="mt-auto flex flex-col items-center gap-2">
        <IconButton
          aria-label={demo.nav.settings}
          aria-pressed={surface === 'settings'}
          active={surface === 'settings'}
          icon={<GearIcon />}
          onClick={() => onSelect('settings')}
        />
        <span className="flex h-9 w-9 items-center justify-center text-[var(--nimi-text-muted)]" aria-hidden="true">
          <BellIcon />
        </span>
        <Avatar
          alt={demo.chat.userName}
          size="md"
          className="bg-gradient-to-br from-[#2fc79a] to-[#22cce7]"
          fallback={<span className="text-xs font-bold text-slate-950">H</span>}
        />
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
  onSelect: (next: HeroDemoSurface) => void;
}) {
  const surfaces: ReadonlyArray<HeroDemoSurface> = ['chat', 'explore', 'apps', 'runtime', 'settings'];
  return (
    <SegmentedControl
      ariaLabel={demo.windowTitle}
      size="sm"
      value={surface}
      onValueChange={(value) => onSelect(value as HeroDemoSurface)}
      items={surfaces.map((id) => ({ value: id, label: demo.nav[id] }))}
    />
  );
}
