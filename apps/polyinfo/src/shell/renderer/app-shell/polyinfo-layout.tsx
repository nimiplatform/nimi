import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from './app-store.js';
import { fetchFrontendRootCategories, fetchFrontendSubcategories } from '@renderer/data/frontend-taxonomy.js';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/mapping', label: 'Mapping' },
  { to: '/signals', label: 'Signals' },
  { to: '/runtime', label: 'Runtime' },
  { to: '/settings', label: 'Settings' },
];

export function PolyinfoLayout() {
  const authUser = useAppStore((state) => state.auth.user);
  const ensureSectorTaxonomy = useAppStore((state) => state.ensureSectorTaxonomy);
  const navigate = useNavigate();
  const location = useLocation();
  const rootsQuery = useQuery({
    queryKey: ['polyinfo', 'frontend-root-sectors'],
    queryFn: () => fetchFrontendRootCategories(),
    staleTime: 10 * 60 * 1000,
  });
  const sectorPath = location.pathname.startsWith('/sectors/')
    ? location.pathname.split('/').filter(Boolean).slice(1)
    : [];
  const currentRootSlug = sectorPath[0] ?? '';
  const currentSectorSlug = sectorPath[1] ?? currentRootSlug;
  const roots = rootsQuery.data ?? [];
  const activeRootSlug = currentRootSlug || roots[0]?.slug || '';
  const activeRoot = roots.find((root) => root.slug === activeRootSlug) ?? roots[0] ?? null;
  const subcategoriesQuery = useQuery({
    queryKey: ['polyinfo', 'frontend-subcategories', activeRootSlug],
    queryFn: () => fetchFrontendSubcategories(activeRoot!),
    enabled: Boolean(activeRoot),
    staleTime: 10 * 60 * 1000,
  });
  const subcategories = subcategoriesQuery.data ?? [];

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
        <div className="border-t border-white/8">
          <div className="mx-auto flex max-w-[1600px] items-center gap-2 overflow-x-auto px-4 py-3">
            {rootsQuery.isLoading ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-slate-400">
                Loading sectors…
              </div>
            ) : null}
            {rootsQuery.isError ? (
              <div className="rounded-md border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                无法读取固定 sector：{rootsQuery.error instanceof Error ? rootsQuery.error.message : 'unknown error'}
              </div>
            ) : null}
            {roots.map((root) => {
              const isActive = root.slug === activeRootSlug;
              return (
                <button
                  key={root.slug}
                  type="button"
                  onClick={() => {
                    ensureSectorTaxonomy(root.slug);
                    navigate(`/sectors/${root.slug}`);
                  }}
                  className={`shrink-0 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  {root.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] grid-cols-[240px_minmax(0,1fr)] gap-4 px-4 py-4">
        <aside className="rounded-md border border-white/10 bg-slate-950/55 p-3">
          <p className="px-2 text-xs uppercase tracking-[0.2em] text-slate-400">
            {activeRoot ? `${activeRoot.label} 分类` : 'Categories'}
          </p>
          <div className="mt-3 space-y-2">
            {subcategoriesQuery.isLoading ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
                Loading categories…
              </div>
            ) : null}
            {subcategoriesQuery.isError ? (
              <div className="rounded-md border border-rose-400/20 bg-rose-400/10 px-3 py-4 text-sm text-rose-100">
                无法读取左侧分类：{subcategoriesQuery.error instanceof Error ? subcategoriesQuery.error.message : 'unknown error'}
              </div>
            ) : null}
            {subcategories.map((category) => (
              <button
                key={`${category.parentSlug}:${category.slug}`}
                type="button"
                onClick={() => {
                  ensureSectorTaxonomy(category.slug);
                  navigate(
                    category.slug === activeRootSlug
                      ? `/sectors/${activeRootSlug}`
                      : `/sectors/${activeRootSlug}/${category.slug}`,
                  );
                }}
                className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                  category.slug === currentSectorSlug
                    ? 'border-sky-300/60 bg-sky-300/14'
                    : 'border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{category.label}</span>
                  {typeof category.displayedCount === 'number' ? (
                    <span className="text-xs text-slate-400">
                      {category.displayedCount >= 1000
                        ? `${(category.displayedCount / 1000).toFixed(1)}k`
                        : category.displayedCount}
                    </span>
                  ) : null}
                </div>
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
