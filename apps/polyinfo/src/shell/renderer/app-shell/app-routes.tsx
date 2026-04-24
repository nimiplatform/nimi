import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { PolyinfoLayout } from './polyinfo-layout.js';
import { getOfficialRootSectorsQueryOptions } from './official-sector-query.js';
import { buildSectorPath, resolveInitialSectorPath } from './workspace-routes.js';
import { useAppStore } from './app-store.js';

const SectorWorkspacePage = lazy(async () => {
  const module = await import('@renderer/features/sectors/sector-workspace-page.js');
  return { default: module.SectorWorkspacePage };
});
const SignalHistoryPage = lazy(async () => {
  const module = await import('@renderer/features/signals/signal-history-page.js');
  return { default: module.SignalHistoryPage };
});
const SettingsPage = lazy(async () => {
  const module = await import('@renderer/features/settings/settings-page.js');
  return { default: module.SettingsPage };
});
const RuntimePage = lazy(async () => {
  const module = await import('@renderer/features/runtime-config/runtime-page.js');
  return { default: module.RuntimePage };
});

function RouteFallback() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
      正在打开页面…
    </div>
  );
}

function IndexRedirect() {
  const customSectors = useAppStore((state) => state.customSectors);
  const lastActiveSectorId = useAppStore((state) => state.lastActiveSectorId);
  const sectorsQuery = useQuery(getOfficialRootSectorsQueryOptions());
  const hasCustomSector = Object.keys(customSectors).length > 0;

  if (sectorsQuery.isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
        正在准备工作区…
      </div>
    );
  }

  if (sectorsQuery.isError && !hasCustomSector) {
    return (
      <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-6 text-sm text-rose-100">
        <p>读取官方 sector 失败：{sectorsQuery.error instanceof Error ? sectorsQuery.error.message : 'unknown error'}</p>
        <button
          type="button"
          onClick={() => {
            void sectorsQuery.refetch();
          }}
          className="mt-4 rounded-full bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/15"
        >
          重试
        </button>
      </div>
    );
  }

  const nextPath = resolveInitialSectorPath({
    lastActiveSectorId,
    officialSectors: sectorsQuery.data ?? [],
    customSectors,
  });

  return <Navigate to={nextPath ?? '/runtime'} replace />;
}

function LegacySectorRedirect() {
  return <Navigate to="/" replace />;
}

function NestedSectorRedirect() {
  const { sectorId = '' } = useParams<{ sectorId: string }>();
  return <Navigate to={buildSectorPath(sectorId)} replace />;
}

export function AppRoutes() {
  return (
    <HashRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<PolyinfoLayout />}>
            <Route index element={<IndexRedirect />} />
            <Route path="sectors" element={<LegacySectorRedirect />} />
            <Route path="sectors/:sectorId" element={<SectorWorkspacePage />} />
            <Route path="sectors/:_rootSlug/:sectorId" element={<NestedSectorRedirect />} />
            <Route path="signals" element={<SignalHistoryPage />} />
            <Route path="runtime" element={<RuntimePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
