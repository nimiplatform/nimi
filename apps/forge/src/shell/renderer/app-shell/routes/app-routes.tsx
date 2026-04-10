import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { StudioLayout } from '@renderer/app-shell/layouts/studio-layout.js';

// Lazy-loaded feature pages
const WorkbenchHomePage = lazy(() => import('@renderer/pages/workbench/workbench-home-page.js'));
const WorkbenchNewPage = lazy(() => import('@renderer/pages/workbench/workbench-new-page.js'));
const WorkbenchPage = lazy(() => import('@renderer/pages/workbench/workbench-page.js'));
const WorkbenchAgentDetailPage = lazy(() => import('@renderer/pages/workbench/workbench-agent-detail-page.js'));
const WorldEditEntryPage = lazy(() => import('@renderer/app-shell/routes/world-edit-entry-page.js'));
const AgentEditEntryPage = lazy(() => import('@renderer/app-shell/routes/agent-edit-entry-page.js'));
const WorldsPage = lazy(() => import('@renderer/pages/worlds/worlds-page.js'));
const AgentsPage = lazy(() => import('@renderer/pages/agents/agents-page.js'));
const ImageStudioPage = lazy(() => import('@renderer/pages/content/image-studio-page.js'));
const VideoStudioPage = lazy(() => import('@renderer/pages/content/video-studio-page.js'));
const MusicStudioPage = lazy(() => import('@renderer/pages/content/music-studio-page.js'));
const ContentLibraryPage = lazy(() => import('@renderer/pages/content/content-library-page.js'));
const ReleasesPage = lazy(() => import('@renderer/pages/publish/releases-page.js'));
const ChannelsPage = lazy(() => import('@renderer/pages/publish/channels-page.js'));
const CopyrightPage = lazy(() => import('@renderer/pages/copyright/copyright-page.js'));
const RevenueDashboardPage = lazy(() => import('@renderer/pages/revenue/revenue-dashboard-page.js'));
const WithdrawalsPage = lazy(() => import('@renderer/pages/revenue/withdrawals-page.js'));
const TemplateBrowsePage = lazy(() => import('@renderer/pages/templates/template-browse-page.js'));
const TemplateMinePage = lazy(() => import('@renderer/pages/templates/template-mine-page.js'));
const TemplateDetailPage = lazy(() => import('@renderer/pages/templates/template-detail-page.js'));
const AdvisorHubPage = lazy(() => import('@renderer/pages/advisors/advisor-hub-page.js'));
const AnalyticsDashboardPage = lazy(() => import('@renderer/pages/analytics/analytics-dashboard-page.js'));
const SettingsPage = lazy(() => import('@renderer/pages/settings/settings-page.js'));
const CharacterCardImportPage = lazy(() => import('@renderer/pages/import/character-card-import-page.js'));
const NovelImportPage = lazy(() => import('@renderer/pages/import/novel-import-page.js'));

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export function AppRoutes() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<StudioLayout />}>
          <Route index element={<PageSuspense><WorkbenchHomePage /></PageSuspense>} />
          <Route path="workbench" element={<PageSuspense><WorkbenchHomePage /></PageSuspense>} />
          <Route path="workbench/new" element={<PageSuspense><WorkbenchNewPage /></PageSuspense>} />
          <Route path="workbench/:workspaceId" element={<PageSuspense><WorkbenchPage /></PageSuspense>} />
          <Route path="workbench/:workspaceId/import/character-card" element={<PageSuspense><CharacterCardImportPage /></PageSuspense>} />
          <Route path="workbench/:workspaceId/import/novel" element={<PageSuspense><NovelImportPage /></PageSuspense>} />
          <Route path="workbench/:workspaceId/agents/:agentId" element={<PageSuspense><WorkbenchAgentDetailPage /></PageSuspense>} />

          {/* Worlds */}
          <Route path="worlds/library" element={<PageSuspense><WorldsPage /></PageSuspense>} />
          <Route path="worlds/:worldId" element={<PageSuspense><WorldEditEntryPage /></PageSuspense>} />
          <Route path="worlds/:worldId/maintain" element={<PageSuspense><WorldEditEntryPage /></PageSuspense>} />

          {/* Agents */}
          <Route path="agents/library" element={<PageSuspense><AgentsPage /></PageSuspense>} />
          <Route path="agents/:agentId" element={<PageSuspense><AgentEditEntryPage /></PageSuspense>} />

          {/* Import */}
          {/* Secondary: Content */}
          <Route path="content/images" element={<PageSuspense><ImageStudioPage /></PageSuspense>} />
          <Route path="content/videos" element={<PageSuspense><VideoStudioPage /></PageSuspense>} />
          <Route path="content/music" element={<PageSuspense><MusicStudioPage /></PageSuspense>} />
          <Route path="content/library" element={<PageSuspense><ContentLibraryPage /></PageSuspense>} />

          {/* Secondary: Publish */}
          <Route path="publish/releases" element={<PageSuspense><ReleasesPage /></PageSuspense>} />
          <Route path="publish/channels" element={<PageSuspense><ChannelsPage /></PageSuspense>} />

          {/* Copyright */}
          <Route path="copyright" element={<PageSuspense><CopyrightPage /></PageSuspense>} />

          {/* Revenue */}
          <Route path="revenue" element={<PageSuspense><RevenueDashboardPage /></PageSuspense>} />
          <Route path="revenue/withdrawals" element={<PageSuspense><WithdrawalsPage /></PageSuspense>} />

          {/* Templates */}
          <Route path="templates" element={<PageSuspense><TemplateBrowsePage /></PageSuspense>} />
          <Route path="templates/mine" element={<PageSuspense><TemplateMinePage /></PageSuspense>} />
          <Route path="templates/:templateId" element={<PageSuspense><TemplateDetailPage /></PageSuspense>} />

          {/* AI Advisors */}
          <Route path="advisors" element={<PageSuspense><AdvisorHubPage /></PageSuspense>} />

          {/* Analytics */}
          <Route path="analytics" element={<PageSuspense><AnalyticsDashboardPage /></PageSuspense>} />

          {/* Settings */}
          <Route path="settings" element={<PageSuspense><SettingsPage /></PageSuspense>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
