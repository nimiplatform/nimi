import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AmbientBackground,
  Avatar,
  Button,
  StatusBadge,
  Surface,
} from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { findActiveNavItem, Sidebar } from './sidebar.js';

export function StudioLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAppStore((s) => s.auth.user);
  const creatorAccess = useAppStore((s) => s.creatorAccess);
  const activeItem = findActiveNavItem(location.pathname);

  return (
    <AmbientBackground
      as="div"
      variant="mesh"
      className="h-screen w-screen overflow-hidden bg-[var(--nimi-app-background)] text-[var(--nimi-text-primary)]"
    >
      <div className="flex h-full w-full">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col p-3 pl-3">
          <Surface
            tone="canvas"
            material="glass-thick"
            elevation="floating"
            padding="none"
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[30px] border-white/45"
          >
            <div className="px-4 pt-4">
              <Surface
                tone="overlay"
                material="glass-regular"
                elevation="raised"
                padding="md"
                className="flex flex-col gap-4 rounded-[20px] md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--nimi-accent-text)]">
                    Nimi Forge
                  </p>
                  <h1 className="mt-2 truncate text-xl font-semibold tracking-[-0.02em] text-[var(--nimi-text-primary)]">
                    {activeItem.fallbackLabel}
                  </h1>
                  <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">{activeItem.description}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  {creatorAccess.hasAccess ? (
                    <StatusBadge tone="success">Creator Access</StatusBadge>
                  ) : null}
                  <Button tone="secondary" size="sm" onClick={() => navigate('/workbench/new')}>
                    New Workspace
                  </Button>
                  <div className="flex items-center gap-3 rounded-[16px] border border-white/45 bg-[color-mix(in_srgb,var(--nimi-surface-canvas)_22%,transparent)] px-3 py-2">
                    <Avatar
                      src={user?.avatarUrl}
                      alt={user?.displayName || 'Forge user'}
                      size="sm"
                      shape="circle"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                        {user?.displayName || 'Creator'}
                      </p>
                      <p className="truncate text-xs text-[var(--nimi-text-muted)]">
                        {user?.email || 'Forge authoring session'}
                      </p>
                    </div>
                  </div>
                </div>
              </Surface>
            </div>

            <main className="min-h-0 flex-1 overflow-hidden px-2 pb-2 pt-3 md:px-3 md:pb-3">
              <Outlet />
            </main>
          </Surface>
        </div>
      </div>
    </AmbientBackground>
  );
}
