import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store.js';
import { AppRoutes } from './app-routes.js';
import type { SectorTag } from '@renderer/data/types.js';

const { fetchFrontendSectorCatalogMock } = vi.hoisted(() => ({
  fetchFrontendSectorCatalogMock: vi.fn<() => Promise<SectorTag[]>>(),
}));

vi.mock('@renderer/data/frontend-taxonomy.js', () => ({
  fetchFrontendSectorCatalog: fetchFrontendSectorCatalogMock,
}));

vi.mock('./polyinfo-layout.js', () => ({
  PolyinfoLayout: () => (
    <div>
      <div>layout-shell</div>
      <Outlet />
    </div>
  ),
}));

vi.mock('@renderer/features/sectors/sector-workspace-page.js', () => ({
  SectorWorkspacePage: () => <div>sector-workspace-screen</div>,
}));

vi.mock('@renderer/features/signals/signal-history-page.js', () => ({
  SignalHistoryPage: () => <div>signal-history-screen</div>,
}));

vi.mock('@renderer/features/settings/settings-page.js', () => ({
  SettingsPage: () => <div>settings-screen</div>,
}));

vi.mock('@renderer/features/runtime-config/runtime-page.js', () => ({
  RuntimePage: () => <div>runtime-screen</div>,
}));

function renderRoutes() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>,
  );
}

describe('app routes', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.setState({
      customSectors: {},
      lastActiveSectorId: null,
    });
    fetchFrontendSectorCatalogMock.mockReset();
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('redirects / to the last active workspace', async () => {
    fetchFrontendSectorCatalogMock.mockResolvedValue([
      { id: 'iran', label: 'Iran', slug: 'iran' },
    ]);
    useAppStore.setState({
      customSectors: {
        'custom-1': {
          id: 'custom-1',
          title: 'Desk',
          createdAt: 1,
          updatedAt: 1,
        },
      },
      lastActiveSectorId: 'custom-1',
    });

    window.location.hash = '#/';
    renderRoutes();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/sectors/custom-1');
    });
    expect(await screen.findByText('sector-workspace-screen')).toBeTruthy();
  });

  it('does not expose a mapping route', async () => {
    fetchFrontendSectorCatalogMock.mockResolvedValue([
      { id: 'iran', label: 'Iran', slug: 'iran' },
    ]);

    window.location.hash = '#/mapping';
    renderRoutes();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/sectors/iran');
    });
    expect(await screen.findByText('sector-workspace-screen')).toBeTruthy();
  });
});
