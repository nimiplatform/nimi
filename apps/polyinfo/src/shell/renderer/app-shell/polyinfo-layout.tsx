import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from './app-store.js';
import {
  getOfficialRootSectorsQueryOptions,
  getOfficialSubsectorsQueryOptions,
} from './official-sector-query.js';
import { hasTauriInvoke, invoke } from '@renderer/bridge';
import { buildSectorPath } from './workspace-routes.js';
import { resolvePrimarySectorGroupId, type PrimarySectorGroupId } from './sector-navigation.js';

const utilityNavItems = [
  { to: '/signals', label: 'Signals' },
  { to: '/runtime', label: 'Runtime' },
  { to: '/settings', label: 'Settings' },
];
const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 72;

export function PolyinfoLayout() {
  const authUser = useAppStore((state) => state.auth.user);
  const customSectors = useAppStore((state) => state.customSectors);
  const addCustomSector = useAppStore((state) => state.addCustomSector);
  const renameCustomSector = useAppStore((state) => state.renameCustomSector);
  const deleteCustomSector = useAppStore((state) => state.deleteCustomSector);
  const ensureSectorTaxonomy = useAppStore((state) => state.ensureSectorTaxonomy);
  const setLastActiveSectorId = useAppStore((state) => state.setLastActiveSectorId);
  const navigate = useNavigate();
  const location = useLocation();
  const rootSectorsQuery = useQuery(getOfficialRootSectorsQueryOptions());
  const activeSectorId = location.pathname.startsWith('/sectors/')
    ? decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] ?? '')
    : '';
  const customSectorList = Object.values(customSectors).sort((left, right) => left.title.localeCompare(right.title));
  const officialRootSectors = rootSectorsQuery.data ?? [];
  const [selectedPrimaryGroup, setSelectedPrimaryGroup] = useState<PrimarySectorGroupId | null>(null);
  const lastSyncedActiveSectorIdRef = useRef<string | null>(null);
  const rootDerivedPrimaryGroup = useMemo(
    () => resolvePrimarySectorGroupId({
      preferredSectorId: activeSectorId || null,
      officialRootSectors,
      visibleSubsectors: [],
      customSectors,
    }),
    [activeSectorId, customSectors, officialRootSectors],
  );
  const effectivePrimaryGroup = selectedPrimaryGroup ?? rootDerivedPrimaryGroup;
  const activeOfficialRoot = useMemo(
    () => officialRootSectors.find((root) => root.slug === effectivePrimaryGroup) ?? null,
    [effectivePrimaryGroup, officialRootSectors],
  );
  const subsectorsQuery = useQuery(
    activeOfficialRoot
      ? getOfficialSubsectorsQueryOptions(activeOfficialRoot)
      : {
          queryKey: ['polyinfo', 'official-subsectors', 'idle'] as const,
          queryFn: async () => [],
          enabled: false,
          staleTime: 60 * 60 * 1000,
          gcTime: 6 * 60 * 60 * 1000,
          retry: false,
          refetchOnMount: false,
          refetchOnReconnect: false,
        },
  );
  const derivedPrimaryGroup = useMemo(
    () => resolvePrimarySectorGroupId({
      preferredSectorId: activeSectorId || null,
      officialRootSectors,
      visibleSubsectors: subsectorsQuery.data ?? [],
      customSectors,
    }),
    [activeSectorId, customSectors, officialRootSectors, subsectorsQuery.data],
  );
  useEffect(() => {
    if (lastSyncedActiveSectorIdRef.current === activeSectorId && selectedPrimaryGroup !== null) {
      return;
    }
    lastSyncedActiveSectorIdRef.current = activeSectorId;
    setSelectedPrimaryGroup(derivedPrimaryGroup);
  }, [activeSectorId, derivedPrimaryGroup, selectedPrimaryGroup]);
  const secondaryOfficialItems = useMemo(() => {
    if (!activeOfficialRoot) {
      return [];
    }
    const children = (subsectorsQuery.data ?? [])
      .filter((item) => item.slug !== activeOfficialRoot.slug)
      .map((item) => ({
        sectorId: item.slug,
        displayLabel: item.label,
        displayedCount: item.displayedCount,
      }));
    return [
      {
        sectorId: activeOfficialRoot.slug,
        displayLabel: `All ${activeOfficialRoot.label}`,
        displayedCount: undefined,
      },
      ...children,
    ];
  }, [activeOfficialRoot, subsectorsQuery.data]);
  const retryingOfficialSectors = rootSectorsQuery.isFetching || subsectorsQuery.isFetching;
  const openSector = (sectorId: string) => {
    ensureSectorTaxonomy(sectorId);
    setLastActiveSectorId(sectorId);
    navigate(buildSectorPath(sectorId));
  };
  const createCustomSector = () => {
    const title = window.prompt('输入新的自建 sector 名称');
    if (!title) {
      return;
    }
    setSelectedPrimaryGroup('custom');
    const sectorId = addCustomSector(title);
    openSector(sectorId);
  };
  const handleWindowDrag = useCallback(async (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    if (event.detail > 1) {
      return;
    }
    if (event.clientX < MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.polyinfo-no-drag')) {
      return;
    }
    if (!hasTauriInvoke()) {
      return;
    }
    try {
      await invoke('start_window_drag');
    } catch {
      // Ignore when drag is unavailable outside the desktop shell.
    }
  }, []);

  return (
    <div className="polyinfo-shell flex h-screen flex-col overflow-hidden text-slate-100">
      <div
        className="mx-auto grid w-full max-w-[1680px] shrink-0 grid-cols-[256px_minmax(0,1fr)_336px] items-center gap-3 px-4 pb-3 pt-3"
        data-tauri-drag-region
        onMouseDown={handleWindowDrag}
      >
        <Link
          to="/"
          aria-label="返回 Polyinfo 主页"
          className="polyinfo-no-drag polyinfo-focus-ring polyinfo-surface flex h-12 items-center gap-3 rounded-2xl px-4 text-slate-200 transition-colors hover:border-teal-300/45 hover:bg-slate-900/90"
          data-tauri-drag-region
        >
          <span className="polyinfo-brand-mark h-8 w-8 shrink-0 rounded-xl">
            <span className="sr-only">Polyinfo</span>
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="text-[15px] font-semibold text-white">Polyinfo</span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-teal-200/60">Market command</span>
          </span>
        </Link>
        <div className="polyinfo-surface min-w-0 rounded-2xl px-2 py-1.5">
          <div className="polyinfo-scrollbar-hidden polyinfo-no-drag flex items-center gap-2 overflow-x-auto">
            {officialRootSectors.map((root) => {
              const isActive = effectivePrimaryGroup === root.slug;
              return (
                <button
                  key={root.slug}
                  type="button"
                  onClick={() => setSelectedPrimaryGroup(root.slug)}
                  className={`polyinfo-focus-ring shrink-0 rounded-xl px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-teal-300 text-slate-950 shadow-[0_0_24px_rgba(45,212,191,0.18)]'
                      : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
                  }`}
                >
                  {root.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="polyinfo-no-drag flex min-w-0 items-center justify-end gap-2">
          {utilityNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `polyinfo-focus-ring rounded-xl px-3.5 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-white text-slate-950 shadow-[0_10px_28px_rgba(255,255,255,0.12)]'
                    : 'bg-white/[0.045] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 gap-3 px-4 pb-4">
        <aside className="polyinfo-surface flex w-[256px] shrink-0 flex-col rounded-2xl p-4">
          <div className="border-b polyinfo-hairline pb-4">
            <button
              type="button"
              onClick={() => setSelectedPrimaryGroup('custom')}
              className={`polyinfo-focus-ring w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
                effectivePrimaryGroup === 'custom'
                  ? 'border-teal-300/60 bg-teal-300/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'border-white/10 bg-white/[0.035] hover:border-white/18 hover:bg-white/[0.06]'
              }`}
            >
              <span className="block text-[13px] font-semibold text-white">Custom Sectors</span>
              <span className="mt-1 block text-[11px] leading-5 text-slate-500">
                自建 sector 和导入事件
              </span>
            </button>
          </div>

          <div className="polyinfo-scrollbar-hidden mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {effectivePrimaryGroup === 'custom' ? (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Custom Sectors</p>
                  <button
                    type="button"
                    onClick={createCustomSector}
                    className="polyinfo-focus-ring rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.06]"
                  >
                    New
                  </button>
                </div>
                <div className="space-y-2">
                  {customSectorList.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] px-3 py-4 text-sm leading-6 text-slate-500">
                      还没有自建 sector。导入 Polymarket event 后会出现在这里。
                    </div>
                  ) : customSectorList.map((sector) => {
                      const isActive = activeSectorId === sector.id;
                      return (
                        <div
                          key={sector.id}
                          className={`rounded-xl border px-3 py-3 ${
                            isActive
                              ? 'border-teal-300/60 bg-teal-300/12'
                              : 'border-white/10 bg-white/[0.035]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => openSector(sector.id)}
                            className="w-full text-left"
                          >
                            <p className="text-sm font-medium text-white">{sector.title}</p>
                            <p className="mt-1 text-[11px] leading-5 text-slate-500">URL import enabled</p>
                          </button>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const nextTitle = window.prompt('重命名这个自建 sector', sector.title);
                                if (!nextTitle) {
                                  return;
                                }
                                renameCustomSector(sector.id, nextTitle);
                              }}
                              className="rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/[0.1]"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm(`删除 ${sector.title}？这会一起删除它的聊天、结构和导入 event。`)) {
                                  return;
                                }
                                deleteCustomSector(sector.id);
                                if (activeSectorId === sector.id) {
                                  navigate('/');
                                }
                              }}
                              className="rounded-lg bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-400/16"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            ) : (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Sectors</p>
                  {activeOfficialRoot ? (
                    <span className="text-[11px] text-slate-600">
                      {activeOfficialRoot.label}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {rootSectorsQuery.isLoading || subsectorsQuery.isLoading ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-4 text-sm text-slate-400">
                      Loading sectors…
                    </div>
                  ) : null}
                  {rootSectorsQuery.isError || subsectorsQuery.isError ? (
                    <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-4 text-sm text-rose-100">
                      <p>
                        读取官方 sector 失败：
                        {rootSectorsQuery.error instanceof Error
                          ? rootSectorsQuery.error.message
                          : subsectorsQuery.error instanceof Error
                            ? subsectorsQuery.error.message
                            : 'unknown error'}
                      </p>
                      <button
                        type="button"
                        disabled={retryingOfficialSectors}
                        onClick={() => {
                          void rootSectorsQuery.refetch();
                          if (activeOfficialRoot) {
                            void subsectorsQuery.refetch();
                          }
                        }}
                        className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-[11px] text-white hover:bg-white/15 disabled:opacity-50"
                      >
                        {retryingOfficialSectors ? '重试中…' : '重试'}
                      </button>
                    </div>
                  ) : null}
                  {!rootSectorsQuery.isLoading && !rootSectorsQuery.isError && !activeOfficialRoot ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] px-3 py-4 text-sm leading-6 text-slate-500">
                      点击上面的一级分类后，再加载对应的子 sector。
                    </div>
                  ) : null}
                  {secondaryOfficialItems.map((sector) => {
                    const isActive = activeSectorId === sector.sectorId;
                    const isRootOverview = sector.sectorId === effectivePrimaryGroup;
                    return (
                      <button
                        key={sector.sectorId}
                        type="button"
                        onClick={() => openSector(sector.sectorId)}
                        className={`polyinfo-focus-ring w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                          isActive
                            ? 'border-teal-300/60 bg-teal-300/12 shadow-[inset_3px_0_0_rgba(45,212,191,0.72)]'
                            : 'border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.055]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <span className="block text-sm font-medium text-white">{sector.displayLabel}</span>
                            {isRootOverview ? (
                              <span className="mt-1 block text-[11px] text-slate-500">一级分类总览</span>
                            ) : null}
                          </div>
                          {typeof sector.displayedCount === 'number' ? (
                            <span className="text-[11px] text-slate-500">{sector.displayedCount}</span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                  {!rootSectorsQuery.isLoading && !rootSectorsQuery.isError && !subsectorsQuery.isError && activeOfficialRoot && secondaryOfficialItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] px-3 py-4 text-sm leading-6 text-slate-500">
                      这个一级分类下面还没有可用的二级 sector。
                    </div>
                  ) : null}
                </div>
              </section>
            )}
          </div>

          <div className="mt-4 border-t polyinfo-hairline pt-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-slate-300">
              {authUser?.displayName || authUser?.email || 'Guest'}
            </div>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
