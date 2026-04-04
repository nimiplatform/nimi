/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import ExploreHomePage from './explore-home-page.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

vi.mock('./character-encounter.js', () => ({
  CharacterEncounter: () => null,
  useEncounterShouldShow: () => false,
}));

vi.mock('@renderer/data/world-client.js', () => ({
  getWorlds: vi.fn(),
}));

vi.mock('@renderer/data/world-catalog.js', () => ({
  getActiveCatalogEntries: vi.fn(() => []),
}));

vi.mock('@renderer/bridge/sqlite-bridge.js', () => ({
  sqliteGetSessionsForLearner: vi.fn(),
}));

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ExploreHomePage />
    </QueryClientProvider>,
  );
}

describe('ExploreHomePage', () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReset();
    vi.mocked(useQuery).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    useAppStore.setState({
      activeProfile: null,
    });
  });

  it('shows a hard-cut empty state when the catalog has no active worlds', () => {
    renderPage();
    expect(screen.getByText('当前无可用世界')).toBeTruthy();
  });
});
