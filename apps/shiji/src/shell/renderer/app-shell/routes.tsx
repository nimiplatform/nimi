import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ShellLayout } from './shell-layout.js';

// Lazy-loaded feature pages — per routes.yaml
const ExploreHomePage = lazy(() => import('@renderer/features/explore/explore-home-page.js'));
const WorldDetailPage = lazy(() => import('@renderer/features/explore/world-detail-page.js'));
const AgentDetailPage = lazy(() => import('@renderer/features/explore/agent-detail-page.js'));
const ExploreAtlasPage = lazy(() => import('@renderer/features/explore/explore-atlas-page.js'));

const DialogueSessionPage = lazy(() => import('@renderer/features/session/dialogue-session-page.js'));

const KnowledgeGraphPage = lazy(() => import('@renderer/features/knowledge/knowledge-graph-page.js'));
const KnowledgeWorldPage = lazy(() => import('@renderer/features/knowledge/knowledge-world-page.js'));

const ProgressOverviewPage = lazy(() => import('@renderer/features/progress/progress-overview-page.js'));
const AchievementsPage = lazy(() => import('@renderer/features/progress/achievements-page.js'));

const SettingsPage = lazy(() => import('@renderer/features/settings/settings-page.js'));

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
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
        {/* / → /explore (SJ-routes: canonical redirect) */}
        <Route index element={<Navigate to="/explore" replace />} />

        {/* Dialogue session — full-screen, no side nav (SJ-SHELL-003:3) */}
        <Route
          path="session/:sessionId"
          element={<PageSuspense><DialogueSessionPage /></PageSuspense>}
        />

        {/* Shell layout routes — have side nav */}
        <Route element={<ShellLayout />}>
          {/* Explore */}
          <Route path="explore" element={<PageSuspense><ExploreHomePage /></PageSuspense>} />
          <Route path="explore/map" element={<PageSuspense><ExploreAtlasPage /></PageSuspense>} />
          <Route path="explore/:worldId" element={<PageSuspense><WorldDetailPage /></PageSuspense>} />
          <Route path="explore/:worldId/agent/:agentId" element={<PageSuspense><AgentDetailPage /></PageSuspense>} />

          {/* Knowledge */}
          <Route path="knowledge" element={<PageSuspense><KnowledgeGraphPage /></PageSuspense>} />
          <Route path="knowledge/:worldId" element={<PageSuspense><KnowledgeWorldPage /></PageSuspense>} />

          {/* Progress */}
          <Route path="progress" element={<PageSuspense><ProgressOverviewPage /></PageSuspense>} />
          <Route path="progress/achievements" element={<PageSuspense><AchievementsPage /></PageSuspense>} />

          {/* Settings */}
          <Route path="settings" element={<PageSuspense><SettingsPage /></PageSuspense>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/explore" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
