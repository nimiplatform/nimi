import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PolyinfoLayout } from './polyinfo-layout.js';
import { DashboardPage } from '@renderer/features/dashboard/dashboard-page.js';
import { SectorWorkspacePage } from '@renderer/features/sectors/sector-workspace-page.js';
import { SignalHistoryPage } from '@renderer/features/signals/signal-history-page.js';
import { SettingsPage } from '@renderer/features/settings/settings-page.js';
import { FrontendTaxonomyPage } from '@renderer/features/mapping/frontend-taxonomy-page.js';

export function AppRoutes() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<PolyinfoLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="sectors/:sectorSlug" element={<SectorWorkspacePage />} />
          <Route path="mapping" element={<FrontendTaxonomyPage />} />
          <Route path="signals" element={<SignalHistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
