import { NavLink, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useRuntimeReadiness } from '@renderer/hooks/use-runtime-readiness.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevStore } from '@renderer/features/lookdev/lookdev-store.js';

function RuntimeBadge() {
  const status = useAppStore((state) => state.runtimeStatus);
  const issues = useAppStore((state) => state.runtimeProbe.issues);
  const tone = status === 'ready'
    ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20'
    : status === 'degraded'
      ? 'bg-amber-300/12 text-amber-100 border-amber-300/20'
      : status === 'unavailable'
        ? 'bg-rose-400/12 text-rose-100 border-rose-300/20'
        : 'bg-white/6 text-white/70 border-white/10';

  return (
    <div className={`rounded-full border px-3 py-1 text-xs ${tone}`}>
      Runtime {status}
      {issues.length > 0 ? ` · ${issues.length} issue${issues.length > 1 ? 's' : ''}` : ''}
    </div>
  );
}

export function LookdevLayout() {
  const authUser = useAppStore((state) => state.auth.user);
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  useRuntimeReadiness();

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }
    void useLookdevStore.getState().resumeActiveBatches();
  }, [bootstrapReady]);

  return (
    <div className="ld-grid-glow min-h-screen bg-transparent">
      <div className="mx-auto flex min-h-screen w-full max-w-[1560px] gap-5 px-5 py-5">
        <aside className="ld-card flex w-[260px] shrink-0 flex-col justify-between overflow-hidden px-5 py-5">
          <div className="space-y-8">
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border border-[var(--ld-panel-border)] bg-white/6 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[var(--ld-accent)]">
                Batch Control Plane
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Lookdev</h1>
                <p className="mt-2 text-sm leading-6 text-white/68">
                  Generate, auto-evaluate, and commit agent portrait truth in controlled batches.
                </p>
              </div>
            </div>

            <nav className="space-y-2">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `block rounded-2xl px-4 py-3 text-sm transition ${
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white shadow-[0_16px_36px_rgba(44,224,188,0.14)]'
                      : 'text-white/72 hover:bg-white/6 hover:text-white'
                  }`
                }
              >
                Batch List
              </NavLink>
              <NavLink
                to="/batches/new"
                className={({ isActive }) =>
                  `block rounded-2xl px-4 py-3 text-sm transition ${
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--ld-accent)_16%,transparent)] text-white shadow-[0_16px_36px_rgba(44,224,188,0.14)]'
                      : 'text-white/72 hover:bg-white/6 hover:text-white'
                  }`
                }
              >
                Create Batch
              </NavLink>
            </nav>
          </div>

          <div className="space-y-3">
            <RuntimeBadge />
            <div className="rounded-2xl border border-white/8 bg-black/16 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.16em] text-white/42">Operator</div>
              <div className="mt-1 text-sm text-white">{authUser?.displayName || 'Unknown operator'}</div>
              <div className="text-xs text-white/50">{authUser?.email || authUser?.id || ''}</div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
