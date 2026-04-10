import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const navigateMock = vi.fn();
const ensureWorkspaceForWorldMock = vi.fn();
const ensureWorldAgentDraftMock = vi.fn();
const useWorldDetailQueryMock = vi.fn();
const useAgentDetailQueryMock = vi.fn();
let paramsValue: Record<string, string> = {};
let locationSearch = '';

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ search: locationSearch }),
  useParams: () => paramsValue,
}));

vi.mock('@renderer/components/page-layout.js', () => ({
  ForgeEmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  ForgeLoadingSpinner: () => <div>Loading</div>,
}));

vi.mock('@renderer/hooks/use-world-queries.js', () => ({
  useWorldDetailQuery: (...args: unknown[]) => useWorldDetailQueryMock(...args),
}));

vi.mock('@renderer/hooks/use-agent-queries.js', () => ({
  useAgentDetailQuery: (...args: unknown[]) => useAgentDetailQueryMock(...args),
}));

vi.mock('@renderer/state/forge-workspace-store.js', () => ({
  useForgeWorkspaceStore: (selector: (state: {
    ensureWorkspaceForWorld: typeof ensureWorkspaceForWorldMock;
    ensureWorldAgentDraft: typeof ensureWorldAgentDraftMock;
  }) => unknown) => selector({
    ensureWorkspaceForWorld: ensureWorkspaceForWorldMock,
    ensureWorldAgentDraft: ensureWorldAgentDraftMock,
  }),
}));

vi.mock('@renderer/pages/agents/agent-detail-page.js', () => ({
  default: () => <div>master-agent-detail</div>,
}));

import WorldEditEntryPage from './world-edit-entry-page.js';
import AgentEditEntryPage from './agent-edit-entry-page.js';

describe('WorldEditEntryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paramsValue = {};
    locationSearch = '';
  });

  it('redirects canonical world editing into the workbench world panel', async () => {
    paramsValue = { worldId: 'world-1' };
    locationSearch = '?releaseId=release-3';
    ensureWorkspaceForWorldMock.mockReturnValue('ws-1');
    useWorldDetailQueryMock.mockReturnValue({
      data: {
        id: 'world-1',
        name: 'Realm',
        description: 'World description',
      },
      isLoading: false,
      isFetching: false,
    });

    render(<WorldEditEntryPage />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        '/workbench/ws-1?releaseId=release-3&panel=WORLD_TRUTH',
        { replace: true },
      );
    });
  });
});

describe('AgentEditEntryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paramsValue = {};
    locationSearch = '';
  });

  it('redirects world-owned agents into hydrated workbench draft editing', async () => {
    paramsValue = { agentId: 'agent-1' };
    ensureWorkspaceForWorldMock.mockReturnValue('ws-1');
    ensureWorldAgentDraftMock.mockReturnValue('draft-1');
    useAgentDetailQueryMock.mockReturnValue({
      data: {
        id: 'agent-1',
        handle: 'ari',
        displayName: 'Ari',
        concept: 'Brave scout',
        description: 'Ari description',
        scenario: 'Ari scenario',
        greeting: 'Ari greeting',
        ownershipType: 'WORLD_OWNED',
        worldId: 'world-1',
        status: 'ACTIVE',
        state: 'READY',
        avatarUrl: 'https://cdn.example.com/ari.png',
        dna: null,
        rules: null,
        wakeStrategy: 'PROACTIVE',
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      isLoading: false,
      isFetching: false,
    });
    useWorldDetailQueryMock.mockReturnValue({
      data: {
        id: 'world-1',
        name: 'Realm',
        description: 'World description',
      },
      isLoading: false,
      isFetching: false,
    });

    render(<AgentEditEntryPage />);

    await waitFor(() => {
      expect(ensureWorldAgentDraftMock).toHaveBeenCalledWith('ws-1', expect.objectContaining({
        sourceAgentId: 'agent-1',
        description: 'Ari description',
        scenario: 'Ari scenario',
        greeting: 'Ari greeting',
        avatarUrl: 'https://cdn.example.com/ari.png',
      }));
      expect(navigateMock).toHaveBeenCalledWith('/workbench/ws-1/agents/draft-1', { replace: true });
    });
  });

  it('keeps master-owned agents on the standalone master detail page', () => {
    paramsValue = { agentId: 'agent-master-1' };
    useAgentDetailQueryMock.mockReturnValue({
      data: {
        id: 'agent-master-1',
        handle: 'mentor',
        displayName: 'Mentor',
        concept: 'Guide',
        description: null,
        scenario: null,
        greeting: null,
        ownershipType: 'MASTER_OWNED',
        worldId: null,
        status: 'ACTIVE',
        state: 'READY',
        avatarUrl: null,
        dna: null,
        rules: null,
        wakeStrategy: 'PASSIVE',
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      isLoading: false,
      isFetching: false,
    });
    useWorldDetailQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
    });

    render(<AgentEditEntryPage />);

    expect(screen.getByText('master-agent-detail')).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
