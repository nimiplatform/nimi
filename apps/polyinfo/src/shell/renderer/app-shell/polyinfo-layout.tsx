import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from './app-store.js';
import { fetchSectorTags } from '@renderer/data/polymarket.js';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/mapping', label: 'Mapping' },
  { to: '/signals', label: 'Signals' },
  { to: '/settings', label: 'Settings' },
];

export function PolyinfoLayout() {
  const authUser = useAppStore((state) => state.auth.user);
  const ensureSectorTaxonomy = useAppStore((state) => state.ensureSectorTaxonomy);
  const navigate = useNavigate();
  const location = useLocation();
  const sectorTagsQuery = useQuery({
    queryKey: ['polyinfo', 'sectors'],
    queryFn: () => fetchSectorTags(),
    staleTime: 10 * 60 * 1000,
  });
  const sectors = sectorTagsQuery.data ?? [];
  const currentSlug = location.pathname.startsWith('/sectors/')
    ? location.pathname.split('/')[2] ?? ''
    : '';

  return (
    <div className="min-h-screen text-slate-100">
      <div
        className="polyinfo-drag-strip flex h-11 items-center px-28 text-xs font-medium tracking-[0.24em] text-slate-400"
        data-tauri-drag-region
      >
        POLYINFO
      </div>
      <header className="border-b border-white/8 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-sky-300/80">Polyinfo</p>
            <h1 className="mt-1 text-xl font-semibold">Market Analysis Workbench</h1>
          </div>
          <nav className="flex items-center gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive ? 'bg-sky-400 text-slate-950' : 'text-slate-300 hover:bg-white/8 hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
            {authUser?.displayName || authUser?.email || 'Guest'}
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] grid-cols-[240px_minmax(0,1fr)] gap-4 px-4 py-4">
        <aside className="rounded-md border border-white/10 bg-slate-950/55 p-3">
          <p className="px-2 text-xs uppercase tracking-[0.2em] text-slate-400">Sectors</p>
          <div className="mt-3 space-y-2">
            {sectorTagsQuery.isLoading ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
                Loading sectors…
              </div>
            ) : null}
            {sectorTagsQuery.isError ? (
              <div className="rounded-md border border-rose-400/20 bg-rose-400/10 px-3 py-4 text-sm text-rose-100">
                无法读取板块列表：{sectorTagsQuery.error instanceof Error ? sectorTagsQuery.error.message : 'unknown error'}
              </div>
            ) : null}
            {sectors.map((sector) => (
              <button
                key={sector.id}
                type="button"
                onClick={() => {
                  ensureSectorTaxonomy(sector.slug);
                  navigate(`/sectors/${sector.slug}`);
                }}
                className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                  sector.slug === currentSlug
                    ? 'border-sky-300/60 bg-sky-300/14'
                    : 'border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{sector.label}</span>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                    {sector.slug}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                  {sector.description || 'Polymarket 前台分类。进入后会叠加你自己的 narrative 和 core variable。'}
                </p>
              </button>
            ))}
          </div>
        </aside>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
