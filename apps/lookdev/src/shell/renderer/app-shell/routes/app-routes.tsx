import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LookdevLayout } from '@renderer/app-shell/layouts/lookdev-layout.js';

const BatchListPage = lazy(() => import('@renderer/features/lookdev/batch-list-page.js'));
const CreateBatchPage = lazy(() => import('@renderer/features/lookdev/create-batch-page.js'));
const BatchDetailPage = lazy(() => import('@renderer/features/lookdev/batch-detail-page.js'));

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[var(--ld-accent)]" />
    </div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<LookdevLayout />}>
          <Route index element={<BatchListPage />} />
          <Route path="batches/new" element={<CreateBatchPage />} />
          <Route path="batches/:batchId" element={<BatchDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
