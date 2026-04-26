import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store.js';
import { PolyinfoLayout } from './polyinfo-layout.js';
import type { FrontendCategoryGroup } from '@renderer/data/types.js';

const { fetchFrontendRootCategoriesMock } = vi.hoisted(() => ({
  fetchFrontendRootCategoriesMock: vi.fn<() => Promise<FrontendCategoryGroup[]>>(),
}));

vi.mock('@renderer/data/frontend-taxonomy.js', () => ({
  fetchFrontendRootCategories: fetchFrontendRootCategoriesMock,
  fetchFrontendSectorCatalog: fetchFrontendRootCategoriesMock,
  fetchFrontendSubcategories: vi.fn(async () => []),
}));

function SectorScreen() {
  const { sectorId = '' } = useParams<{ sectorId: string }>();
  return <div>sector-workspace-screen:{sectorId}</div>;
}

function renderLayout(initialEntries = ['/']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const router = createMemoryRouter([
    {
      path: '/',
      element: <PolyinfoLayout />,
      children: [
        { index: true, element: <div>home-screen</div> },
        { path: 'sectors/:sectorId', element: <SectorScreen /> },
      ],
    },
  ], {
    initialEntries,
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
}

describe('polyinfo layout', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchFrontendRootCategoriesMock.mockReset();
    fetchFrontendRootCategoriesMock.mockResolvedValue([]);
    vi.spyOn(Date, 'now').mockReturnValue(123);
    useAppStore.setState({
      customSectors: {},
      taxonomyBySector: {},
      chatsBySector: {},
      snapshotsBySector: {},
      importedEventsBySector: {},
      lastActiveSectorId: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the new custom sector workspace after creating it from the custom group', async () => {
    const router = renderLayout();

    fireEvent.click(await screen.findByRole('button', { name: /Custom Sectors/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'New custom sector' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sectors/custom-123');
    });
    expect(useAppStore.getState().customSectors['custom-123']?.title).toBe('New custom sector');
    expect(await screen.findByText('sector-workspace-screen:custom-123')).toBeTruthy();
  });

  it('renames a custom sector from the sidebar without using a browser prompt', async () => {
    const router = renderLayout();

    fireEvent.click(await screen.findByRole('button', { name: /Custom Sectors/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'New custom sector' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sectors/custom-123');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Custom sector name'), {
      target: { value: 'Desk Watchlist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(useAppStore.getState().customSectors['custom-123']?.title).toBe('Desk Watchlist');
    expect(await screen.findByText('Desk Watchlist')).toBeTruthy();
  });

  it('deletes the active custom sector and opens the next available custom sector', async () => {
    useAppStore.setState({
      customSectors: {
        'custom-a': {
          id: 'custom-a',
          title: 'Alpha',
          createdAt: 1,
          updatedAt: 1,
        },
        'custom-b': {
          id: 'custom-b',
          title: 'Beta',
          createdAt: 2,
          updatedAt: 2,
        },
      },
      taxonomyBySector: {
        'custom-a': { narratives: [], coreVariables: [] },
        'custom-b': { narratives: [], coreVariables: [] },
      },
      importedEventsBySector: {
        'custom-a': [],
        'custom-b': [],
      },
      lastActiveSectorId: 'custom-a',
    });
    const router = renderLayout(['/sectors/custom-a']);

    const alphaCard = await screen.findByTestId('custom-sector-card-custom-a');
    fireEvent.click(within(alphaCard).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(alphaCard).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sectors/custom-b');
    });
    expect(useAppStore.getState().customSectors['custom-a']).toBeUndefined();
    expect(useAppStore.getState().taxonomyBySector['custom-a']).toBeUndefined();
    expect(useAppStore.getState().importedEventsBySector['custom-a']).toBeUndefined();
    expect(await screen.findByText('sector-workspace-screen:custom-b')).toBeTruthy();
  });
});
