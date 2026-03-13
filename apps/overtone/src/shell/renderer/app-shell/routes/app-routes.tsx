import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { StudioLayout } from '@renderer/app-shell/layouts/studio-layout.js';
import { WorkspacePage } from '@renderer/features/workspace/workspace-page.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<StudioLayout />}>
        <Route index element={<WorkspacePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
