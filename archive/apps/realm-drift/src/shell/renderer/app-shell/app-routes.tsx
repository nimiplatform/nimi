import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { DriftLayout } from './drift-layout.js';
import { WorldBrowserPage } from '@renderer/features/world-browser/world-browser-page.js';

const WorldViewerPage = lazy(() =>
  import('@renderer/features/world-viewer/world-viewer-page.js').then((m) => ({
    default: m.WorldViewerPage,
  })),
);

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
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
        <Route element={<DriftLayout />}>
          <Route index element={<WorldBrowserPage />} />
          <Route
            path="world/:worldId"
            element={
              <PageSuspense>
                <WorldViewerPage />
              </PageSuspense>
            }
          />
        </Route>
      </Routes>
    </HashRouter>
  );
}
