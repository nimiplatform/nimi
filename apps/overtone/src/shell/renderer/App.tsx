import React from 'react';
import { AppProviders } from '@renderer/app-shell/providers/app-providers.js';
import { AppRoutes } from '@renderer/app-shell/routes/app-routes.js';

export default function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
