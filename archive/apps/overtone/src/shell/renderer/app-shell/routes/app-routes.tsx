import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { StudioLayout } from '@renderer/app-shell/layouts/studio-layout.js';

const WorkspacePage = lazy(async () => import('@renderer/features/workspace/workspace-page.js').then((module) => ({ default: module.WorkspacePage })));

export function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={<StudioLayout />}>
          <Route index element={<WorkspacePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
