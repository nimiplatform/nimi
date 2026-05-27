/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AgentDetailPage from './agent-detail-page.js';
import { getAgent } from '@renderer/data/agent-client.js';
import { getCatalogEntry } from '@renderer/data/world-catalog.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@renderer/features/explore/onboarding-gate.js', () => ({
  useOnboardingGate: () => ({
    shouldRedirectToProfileCreation: false,
  }),
}));

vi.mock('@renderer/data/agent-client.js', () => ({
  getAgent: vi.fn(),
}));

vi.mock('@renderer/data/world-catalog.js', () => ({
  getCatalogEntry: vi.fn(),
}));

vi.mock('@renderer/bridge/sqlite-bridge.js', () => ({
  sqliteGetSessionsForLearner: vi.fn(),
  sqliteCreateSession: vi.fn(),
  sqliteUpdateSession: vi.fn(),
}));

function renderPage(path: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/explore/:worldId/agent/:agentId" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentDetailPage', () => {
  beforeEach(() => {
    vi.mocked(getAgent).mockReset();
    vi.mocked(getCatalogEntry).mockReset();
  });

  it('fails closed before Realm agent reads when the world is absent from the catalog', () => {
    vi.mocked(getCatalogEntry).mockReturnValue(undefined);

    renderPage('/explore/world-missing/agent/agent-1');

    expect(screen.getByText('此人物所属时期不在时迹目录中')).toBeTruthy();
    expect(vi.mocked(getAgent)).not.toHaveBeenCalled();
  });

  it('fails closed before Realm agent reads when the catalog row is not active', () => {
    vi.mocked(getCatalogEntry).mockReturnValue({
      worldId: 'world-planned',
      displayName: 'Planned World',
      sortOrder: 1,
      startYear: 1,
      endYear: 2,
      eraLabel: 'Planned',
      contentType: 'history',
      truthMode: 'factual',
      status: 'PLANNED',
      timelineMountMode: 'PRIMARY',
      mapAvailability: false,
      primaryAgentIds: [],
      relatedWorldIds: [],
    });

    renderPage('/explore/world-planned/agent/agent-1');

    expect(screen.getByText('此人物所属时期不在时迹目录中')).toBeTruthy();
    expect(vi.mocked(getAgent)).not.toHaveBeenCalled();
  });
});
