import { useMemo, type ReactNode } from 'react';
import { AmbientBackground, Button, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { useStudioSession } from './studio-session.js';

export type StudioWorkspace = 'portfolio' | 'create' | 'detail' | 'settings' | 'assets' | 'posts' | 'schedule';

export type StudioWorkspaceItem = {
  id: StudioWorkspace;
  label: string;
  shortLabel: string;
  description: string;
};

export const studioWorkspaceItems: StudioWorkspaceItem[] = [
  { id: 'portfolio', label: 'Portfolio', shortLabel: 'P', description: 'Owner agent list, search, filters, and source status.' },
  { id: 'create', label: 'Create', shortLabel: '+', description: 'Create a user-owned Realm Agent with world and handle review.' },
  { id: 'detail', label: 'Detail', shortLabel: 'D', description: 'Current public profile, ownership, world, state, and friendCount.' },
  { id: 'settings', label: 'Settings', shortLabel: 'S', description: 'Owner-reviewed settings, visibility, and AI context review.' },
  { id: 'assets', label: 'Assets', shortLabel: 'A', description: 'Avatar, visual candidates, and voice sample review.' },
  { id: 'posts', label: 'Posts', shortLabel: 'T', description: 'Agent-authored post draft, media attachment, and Realm publish.' },
  { id: 'schedule', label: 'Schedule', shortLabel: 'L', description: 'Single local scheduled post candidate.' },
];

function AccountSurface() {
  const session = useStudioSession();
  const initials = useMemo(() => {
    const source = session.user?.displayName || session.user?.id || 'Owner';
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join('') || 'O';
  }, [session.user]);

  return (
    <Surface tone="panel" material="glass-thin" padding="sm" className="flex items-center gap-3 rounded-2xl">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-text-primary)] text-[13px] font-semibold text-[var(--nimi-text-inverse)]">
        {initials}
      </div>
      <div className="hidden min-w-0 lg:block">
        <div className="truncate text-[13px] font-medium text-[var(--nimi-text-primary)]">
          {session.user?.displayName || 'Owner'}
        </div>
        <div className="truncate text-[12px] text-[var(--nimi-text-muted)]">Runtime account</div>
      </div>
    </Surface>
  );
}

export function ShellLayout({
  children,
  activeWorkspace,
  onWorkspaceChange,
}: {
  children: ReactNode;
  activeWorkspace: StudioWorkspace;
  onWorkspaceChange: (workspace: StudioWorkspace) => void;
}) {
  const activeItem = studioWorkspaceItems.find((item) => item.id === activeWorkspace) || studioWorkspaceItems[0]!;

  return (
    <AmbientBackground variant="mesh" className="isolate flex h-full min-h-0 overflow-hidden">
      <nav className="relative z-30 flex w-[72px] shrink-0 flex-col items-center bg-transparent py-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--nimi-text-primary)] text-[12px] font-semibold text-[var(--nimi-text-inverse)] shadow-[var(--nimi-elevation-base)]">
          RAS
        </div>
        <div className="mt-8 flex flex-1 flex-col items-center gap-2">
          {studioWorkspaceItems.map((item) => (
            <Button
              key={item.id}
              size="sm"
              tone={item.id === activeWorkspace ? 'primary' : 'ghost'}
              className="group relative h-10 w-10 px-0"
              aria-label={item.label}
              aria-pressed={item.id === activeWorkspace}
              onClick={() => onWorkspaceChange(item.id)}
            >
              {item.shortLabel}
              <span className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded-2xl border border-[var(--nimi-material-glass-thick-border)] bg-[var(--nimi-material-glass-thick-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] opacity-0 shadow-[var(--nimi-elevation-floating)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] transition-opacity duration-100 group-hover:opacity-100 nimi-material-glass-thick">
                {item.label}
              </span>
            </Button>
          ))}
        </div>
      </nav>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-[64px] shrink-0 items-center gap-4 bg-transparent px-6">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="m-0 truncate text-[18px] font-semibold text-[var(--nimi-text-primary)]">
                Realm Agent Studio
              </h1>
              <StatusBadge tone="info">Owner</StatusBadge>
              <StatusBadge tone="neutral">{activeItem.label}</StatusBadge>
            </div>
            <p className="m-0 mt-0.5 truncate text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
              {activeItem.description}
            </p>
          </div>
          <div className="ml-auto">
            <AccountSurface />
          </div>
        </header>

        <main className="relative z-0 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5">
          {children}
        </main>
      </div>
    </AmbientBackground>
  );
}
