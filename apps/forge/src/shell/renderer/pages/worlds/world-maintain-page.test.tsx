import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const navigateMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const setSearchParamsMock = vi.fn();
let searchParamsValue = '';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? '',
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ worldId: 'world-1' }),
  useSearchParams: () => [new URLSearchParams(searchParamsValue), setSearchParamsMock],
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey.join(':');
    if (key.includes('truth-worldview')) {
      return { data: {}, isLoading: false, isFetching: false };
    }
    if (key.includes('truth')) {
      return { data: {}, isLoading: false, isFetching: false };
    }
    return { data: [], isLoading: false, isFetching: false };
  },
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('@nimiplatform/nimi-kit/ui', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Surface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@world-engine/ui/maintain/maintain-workbench.js', () => ({
  MaintainWorkbench: () => <div>MaintainWorkbench</div>,
}));

vi.mock('@renderer/components/page-layout.js', () => ({
  ForgeEmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  ForgeLoadingSpinner: () => <div>Loading</div>,
}));

vi.mock('@renderer/components/status-indicators.js', () => ({
  ForgeStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@renderer/hooks/use-world-queries.js', () => ({
  useWorldResourceQueries: () => ({
    stateQuery: { data: { items: [] }, isLoading: false },
    historyQuery: { data: [], isLoading: false, isSuccess: true },
    lorebooksQuery: { data: [], isLoading: false },
    maintenanceTimeline: [],
    releasesQuery: {
      data: [
        {
          id: 'release-3',
          worldId: 'world-1',
          version: 3,
          tag: 'official-forge-ws-3',
          description: 'Official publish',
          packageVersion: 'forge-ws-3',
          releaseType: 'PUBLISH',
          status: 'PUBLISHED',
          ruleCount: 3,
          ruleChecksum: 'checksum-3',
          worldviewChecksum: 'wv-3',
          lorebookChecksum: 'lb-3',
          sourceProvenance: 'forge-text-source',
          reviewVerdict: 'approved',
          officialOwnerId: 'owner-1',
          editorialOperatorId: 'editor-1',
          reviewerId: 'reviewer-1',
          publisherId: 'publisher-1',
          publishActorId: 'actor-1',
          supersedesReleaseId: 'release-2',
          rollbackFromReleaseId: null,
          diffSummary: {
            previousReleaseId: 'release-2',
            rollbackTargetReleaseId: null,
            worldRuleDelta: 2,
            agentRuleSnapshotDelta: 1,
            worldviewChanged: true,
            lorebookChanged: false,
          },
          publishedAt: '2026-04-09T00:02:00.000Z',
          createdAt: '2026-04-09T00:02:00.000Z',
          createdBy: 'actor-1',
        },
      ],
      isLoading: false,
    },
    titleLineageQuery: {
      data: [
        {
          id: 'lineage-1',
          worldId: 'world-1',
          slug: 'realm',
          sourceTitle: 'Realm Source',
          canonicalTitle: 'Realm',
          titleLineageKey: 'realm:realm',
          packageVersion: 'forge-ws-1',
          releaseId: 'release-3',
          runId: 'run-1',
          itemId: 'item-1',
          recordedBy: 'actor-1',
          reason: 'Recorded from official publish flow.',
          createdAt: '2026-04-09T00:00:30.000Z',
        },
      ],
      isLoading: false,
    },
    batchRunsQuery: {
      data: [
        {
          id: 'run-1',
          name: 'Official Batch',
          status: 'FAILED',
          pipelineStages: ['ingest', 'validate'],
          retryLimit: 1,
          retryCount: 1,
          successCount: 0,
          failureCount: 1,
          qualityGateStatus: 'FAIL',
          qualityGateSummary: {
            findings: ['contract-mismatch'],
          },
          items: [
            {
              id: 'item-1',
              runId: 'run-1',
              worldId: 'world-1',
              slug: 'realm',
              sourceTitle: 'Realm Source',
              canonicalTitle: 'Realm',
              titleLineageKey: 'realm:realm',
              sourceMode: 'forge-official',
              status: 'FAILED',
              packageVersion: 'forge-ws-1',
              releaseId: 'release-3',
              retryCount: 1,
              startedAt: '2026-04-09T00:00:00.000Z',
              finishedAt: '2026-04-09T00:01:00.000Z',
              lastError: 'publish failed',
            },
          ],
          updatedAt: '2026-04-09T00:01:00.000Z',
        },
      ],
      isLoading: false,
    },
  }),
}));

vi.mock('@renderer/hooks/use-world-commit-actions.js', () => ({
  useWorldCommitActions: () => ({
    saveMaintenanceMutation: { isPending: false, mutateAsync: vi.fn() },
    syncEventsMutation: { isPending: false, mutateAsync: vi.fn() },
    syncResourceBindingsMutation: { isPending: false },
    createWorldRuleMutation: { isPending: false, mutateAsync: vi.fn() },
    updateWorldRuleMutation: { isPending: false, mutateAsync: vi.fn() },
    deprecateWorldRuleMutation: { isPending: false, mutateAsync: vi.fn() },
    archiveWorldRuleMutation: { isPending: false, mutateAsync: vi.fn() },
    createAgentRuleMutation: { isPending: false, mutateAsync: vi.fn() },
    updateAgentRuleMutation: { isPending: false, mutateAsync: vi.fn() },
    deprecateAgentRuleMutation: { isPending: false, mutateAsync: vi.fn() },
    archiveAgentRuleMutation: { isPending: false, mutateAsync: vi.fn() },
  }),
}));

vi.mock('@renderer/hooks/use-agent-queries.js', () => ({
  useAgentListQuery: () => ({
    data: [],
  }),
}));

vi.mock('@renderer/app-shell/providers/app-store.js', () => ({
  useAppStore: (selector: (state: { auth?: { user?: { id?: string } } }) => unknown) =>
    selector({ auth: { user: { id: 'user-1' } } }),
}));

vi.mock('@renderer/state/creator-world-workspace.js', () => ({
  toForgeWorkspaceSnapshot: () => ({
    unsavedChangesByPanel: {},
    workspaceVersion: 'ws-1',
    worldStateDraft: {},
    worldviewPatch: {},
    eventsDraft: { primary: [], secondary: [] },
    lorebooksDraft: [],
    agentSync: { selectedCharacterIds: [], draftsByCharacter: {} },
    taskState: { activeTask: null, recentTasks: [], expertMode: false },
  }),
  toWorldStudioWorkspacePatch: (patch: unknown) => patch,
}));

vi.mock('@renderer/state/creator-world-store.js', () => {
  const snapshot = {
    panel: { selectedWorldId: 'world-1', activeSection: 'BASE' },
    eventsDraft: { primary: [], secondary: [] },
  };
  const store = {
    snapshot,
    patchSnapshot: vi.fn(),
    patchPanel: vi.fn(),
    hydrateForUser: vi.fn(),
    persistForUser: vi.fn(),
  };
  return {
    useCreatorWorldStore: (selector: (state: typeof store) => unknown) => selector(store),
  };
});

vi.mock('./world-rule-truth-panel.js', () => ({
  WorldRuleTruthPanel: () => <div>WorldRuleTruthPanel</div>,
}));

vi.mock('./world-maintain-page-helpers.js', () => ({
  asRecord: (value: unknown) => value ?? {},
  getTimeFlowRatioFromWorldviewPatch: () => '1.0',
  getWorkspaceStateDraft: () => null,
  requireWorkspaceSessionId: () => 'ws-1',
  requireWorkspaceStateRef: () => ({ recordId: 'state-1', scope: 'WORLD', scopeKey: 'world-1' }),
  toEventNodeDraft: () => ({}),
  toHistoryAppend: () => ({}),
}));

vi.mock('@renderer/data/world-data-client.js', () => ({
  getWorldTruth: vi.fn().mockResolvedValue({}),
  getWorldviewTruth: vi.fn().mockResolvedValue({}),
  listAgentRules: vi.fn().mockResolvedValue([]),
  listWorldRules: vi.fn().mockResolvedValue([]),
  rollbackWorldRelease: vi.fn(),
  retryOfficialFactoryBatchRun: vi.fn(),
}));

import { WorldMaintainPageView } from './world-maintain-page.js';

describe('WorldMaintainPageView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsValue = '';
  });

  it('expands factory run diagnostics for stages findings and lineage details', () => {
    render(<WorldMaintainPageView worldIdOverride="world-1" embedded />);

    expect(screen.getByText('Official Batch')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show Details' })[1]!);

    expect(screen.getByText('Pipeline Stages')).toBeTruthy();
    expect(screen.getAllByText(/ingest -> validate/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Quality Findings')).toBeTruthy();
    expect(screen.getByText('contract-mismatch')).toBeTruthy();
    expect(screen.getByText('Item Lineage')).toBeTruthy();
    expect(screen.getByText(/package forge-ws-1/i)).toBeTruthy();
    expect(screen.getAllByText(/release release-3/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/lineage realm:realm/i)).toBeTruthy();
  });

  it('expands release diagnostics for diff governance and lineage', () => {
    render(<WorldMaintainPageView worldIdOverride="world-1" embedded />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Show Details' })[0]!);

    expect(screen.getByText('Release Diff')).toBeTruthy();
    expect(screen.getByText(/world rules 2/i)).toBeTruthy();
    expect(screen.getByText(/agent snapshots 1/i)).toBeTruthy();
    expect(screen.getByText('Governance')).toBeTruthy();
    expect(screen.getByText(/owner owner-1/i)).toBeTruthy();
    expect(screen.getByText(/publisher publisher-1/i)).toBeTruthy();
    expect(screen.getByText('Release Lineage')).toBeTruthy();
    expect(screen.getByText(/supersedes release-2/i)).toBeTruthy();
    expect(screen.getByText(/checksum checksum-3/i)).toBeTruthy();
  });

  it('opens related release and batch run diagnostics from title lineage anchor', () => {
    render(<WorldMaintainPageView worldIdOverride="world-1" embedded />);

    expect(screen.getByText(/anchor release release-3 · run run-1 · item item-1/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Related' }));

    expect(screen.getByText('Release Diff')).toBeTruthy();
    expect(screen.getByText('Pipeline Stages')).toBeTruthy();
    expect(screen.getAllByText(/realm:realm/i).length).toBeGreaterThan(0);
    expect(setSearchParamsMock).toHaveBeenCalledTimes(1);
  });

  it('hydrates compare anchor state from deep-link search params', () => {
    searchParamsValue = 'lineageKey=realm%3Arealm&releaseId=release-3&runId=run-1';

    render(<WorldMaintainPageView worldIdOverride="world-1" embedded />);

    expect(screen.getByText('Release Diff')).toBeTruthy();
    expect(screen.getByText('Pipeline Stages')).toBeTruthy();
    expect(screen.getAllByText(/realm:realm/i).length).toBeGreaterThan(0);
  });
});
