import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from './app-store.js';
import { getOfficialSectorCatalogQueryOptions } from './official-sector-query.js';
import { hasTauriInvoke, invoke } from '@renderer/bridge';
import { buildSectorPath } from './workspace-routes.js';
import {
  buildSecondaryOfficialSectorItems,
  getOfficialRootSectors,
  resolvePrimarySectorGroupId,
  type PrimarySectorGroupId,
} from './sector-navigation.js';

const utilityNavItems = [
  { to: '/signals', label: 'Signals' },
  { to: '/runtime', label: 'Runtime' },
  { to: '/settings', label: 'Settings' },
];
const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 72;

export function PolyinfoLayout() {
  const authUser = useAppStore((state) => state.auth.user);
  const customSectors = useAppStore((state) => state.customSectors);
  const lastActiveSectorId = useAppStore((state) => state.lastActiveSectorId);
  const addCustomSector = useAppStore((state) => state.addCustomSector);
  const renameCustomSector = useAppStore((state) => state.renameCustomSector);
  const deleteCustomSector = useAppStore((state) => state.deleteCustomSector);
  const ensureSectorTaxonomy = useAppStore((state) => state.ensureSectorTaxonomy);
  const setLastActiveSectorId = useAppStore((state) => state.setLastActiveSectorId);
  const navigate = useNavigate();
  const location = useLocation();
  const sectorsQuery = useQuery(getOfficialSectorCatalogQueryOptions());
  const activeSectorId = location.pathname.startsWith('/sectors/')
    ? decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] ?? '')
    : '';
  const customSectorList = Object.values(customSectors).sort((left, right) => left.title.localeCompare(right.title));
  const officialSectors = sectorsQuery.data ?? [];
  const officialRootSectors = useMemo(
    () => getOfficialRootSectors(officialSectors),
    [officialSectors],
  );
  const preferredSectorId = activeSectorId || lastActiveSectorId;
  const derivedPrimaryGroup = useMemo(
    () => resolvePrimarySectorGroupId({
      preferredSectorId,
      officialSectors,
      customSectors,
    }),
    [customSectors, officialSectors, preferredSectorId],
  );
  const [selectedPrimaryGroup, setSelectedPrimaryGroup] = useState<PrimarySectorGroupId | null>(derivedPrimaryGroup);

  useEffect(() => {
    setSelectedPrimaryGroup(derivedPrimaryGroup);
  }, [derivedPrimaryGroup]);

  const effectivePrimaryGroup = selectedPrimaryGroup ?? derivedPrimaryGroup;
  const secondaryOfficialItems = useMemo(
    () => (
      effectivePrimaryGroup && effectivePrimaryGroup !== 'custom'
        ? buildSecondaryOfficialSectorItems(effectivePrimaryGroup, officialSectors)
        : []
    ),
    [effectivePrimaryGroup, officialSectors],
  );
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
    <div className="min-h-screen text-slate-100">
      <div
        className="mx-auto flex max-w-[1680px] items-center gap-2 px-3 pb-2 pt-2"
        data-tauri-drag-region
        onMouseDown={handleWindowDrag}
      >
        <div
          className="polyinfo-drag-strip flex h-11 w-[200px] shrink-0 items-center rounded-full border border-white/10 bg-slate-950/70 px-5 text-[11px] font-medium tracking-[0.28em] text-slate-500"
          data-tauri-drag-region
        >
          POLYINFO
        </div>
        <div className="min-w-0 flex-1 rounded-full border border-white/10 bg-slate-950/70 px-2 py-1.5">
          <div className="polyinfo-scrollbar-hidden polyinfo-no-drag flex items-center gap-2 overflow-x-auto">
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedPrimaryGroup('custom')}
                className={`rounded-full px-3 py-2 text-sm transition-colors ${
                  effectivePrimaryGroup === 'custom'
                    ? 'bg-emerald-300 text-slate-950'
                    : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
                }`}
              >
                Custom
              </button>
              <button
                type="button"
                onClick={createCustomSector}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.08]"
                title="新建自选板块"
              >
                New
              </button>
            </div>
            {officialRootSectors.map((root) => {
              const isActive = effectivePrimaryGroup === root.slug;
              return (
                <button
                  key={root.slug}
                  type="button"
                  onClick={() => setSelectedPrimaryGroup(root.slug)}
                  className={`shrink-0 rounded-full px-3 py-2 text-sm transition-colors ${
                    isActive ? 'bg-white text-slate-950' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
                  }`}
                >
                  {root.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="polyinfo-no-drag flex shrink-0 items-center gap-2">
          {utilityNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-full px-3 py-2 text-xs transition-colors ${
                  isActive ? 'bg-white text-slate-950' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-2.25rem)] max-w-[1680px] gap-2 px-3 pb-3">
        <aside className="flex w-[244px] shrink-0 flex-col rounded-[24px] border border-white/10 bg-slate-950/70 p-4">
          <div className="border-b border-white/8 pb-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Workspace</p>
            <h1 className="mt-2 text-xl font-semibold text-white">Chat-First Analyst</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              上面选一级分类，左侧选具体 sector，再围绕 narrative、core issue 和 event 证据直接对话。
            </p>
          </div>

          <div className="polyinfo-scrollbar-hidden mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {effectivePrimaryGroup === 'custom' ? (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Custom Sectors</p>
                  <button
                    type="button"
                    onClick={createCustomSector}
                    className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/[0.06]"
                  >
                    New
                  </button>
                </div>
                <div className="space-y-2">
                  {customSectorList.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-sm leading-6 text-slate-500">
                      还没有自建 sector。新建后可以通过 Polymarket URL 导入 event。
                    </div>
                  ) : customSectorList.map((sector) => {
                      const isActive = activeSectorId === sector.id;
                      return (
                        <div
                          key={sector.id}
                          className={`rounded-2xl border px-3 py-3 ${
                            isActive
                              ? 'border-emerald-300/70 bg-emerald-300/12 shadow-[0_0_0_1px_rgba(110,231,183,0.18)]'
                              : 'border-white/8 bg-white/[0.03]'
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
                              className="rounded-full bg-white/[0.05] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/[0.08]"
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
                              className="rounded-full bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-400/16"
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
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Sectors</p>
                  {effectivePrimaryGroup ? (
                    <span className="text-[11px] text-slate-600">
                      {officialRootSectors.find((root) => root.slug === effectivePrimaryGroup)?.label ?? 'Official'}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {sectorsQuery.isLoading ? (
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
                      Loading sectors…
                    </div>
                  ) : null}
                  {sectorsQuery.isError ? (
                    <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-3 py-4 text-sm text-rose-100">
                      <p>读取官方 sector 失败：{sectorsQuery.error instanceof Error ? sectorsQuery.error.message : 'unknown error'}</p>
                      <button
                        type="button"
                        onClick={() => {
                          void sectorsQuery.refetch();
                        }}
                        className="mt-3 rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white hover:bg-white/15"
                      >
                        重试
                      </button>
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
                        className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                          isActive
                            ? 'border-sky-300/70 bg-sky-300/16 shadow-[0_0_0_1px_rgba(125,211,252,0.18)]'
                            : 'border-white/8 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.05]'
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
                  {!sectorsQuery.isLoading && !sectorsQuery.isError && secondaryOfficialItems.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-sm leading-6 text-slate-500">
                      这个一级分类下面还没有可用的二级 sector。
                    </div>
                  ) : null}
                </div>
              </section>
            )}
          </div>

          <div className="mt-4 border-t border-white/8 pt-4">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-slate-300">
              {authUser?.displayName || authUser?.email || 'Guest'}
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
