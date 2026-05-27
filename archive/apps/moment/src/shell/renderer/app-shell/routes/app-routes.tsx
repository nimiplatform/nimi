import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { MomentShell } from '@renderer/app-shell/layouts/moment-shell.js';
import { useMomentStore } from '@renderer/features/moment/moment-store.js';

const MomentHomePage = lazy(() => import('@renderer/features/moment/pages/moment-home-page.js'));
const MomentPlayPage = lazy(() => import('@renderer/features/moment/pages/moment-play-page.js'));

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#f3cf91]" />
    </div>
  );
}

function MomentIndexRoute() {
  const session = useMomentStore((state) => state.session);
  if (session) {
    return <Navigate to="/play" replace />;
  }
  return <MomentHomePage />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<MomentShell />}>
          <Route index element={<MomentIndexRoute />} />
          <Route path="play" element={<MomentPlayPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
