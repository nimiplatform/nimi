import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkbenchPage from './workbench-page.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';
import type { CharacterCardSourceManifest } from '@renderer/features/import/types.js';

const mockUseAgentListQuery = vi.fn();
const publishForgeWorkspacePlanMock = vi.fn();
const createBatchRunMutateAsync = vi.fn();
const publishPackageMutateAsync = vi.fn();
const reportBatchItemFailureMutateAsync = vi.fn();

vi.mock('@renderer/hooks/use-agent-queries.js', () => ({
  useAgentListQuery: (...args: unknown[]) => mockUseAgentListQuery(...args),
}));

vi.mock('@renderer/features/import/data/import-publish-client.js', () => ({
  publishForgeWorkspacePlan: (...args: unknown[]) => publishForgeWorkspacePlanMock(...args),
}));

vi.mock('@renderer/hooks/use-world-commit-actions.js', () => ({
  useWorldCommitActions: () => ({
    createBatchRunMutation: {
      mutateAsync: createBatchRunMutateAsync,
      isPending: false,
    },
    publishPackageMutation: {
      mutateAsync: publishPackageMutateAsync,
      isPending: false,
    },
    reportBatchItemFailureMutation: {
      mutateAsync: reportBatchItemFailureMutateAsync,
      isPending: false,
    },
  }),
}));

function createCharacterManifest(): CharacterCardSourceManifest {
  return {
    sourceType: 'character_card',
    sourceFile: 'ari.json',
    importedAt: '2026-03-19T00:00:00.000Z',
    rawJson: '{}',
    rawCard: {},
    normalizedCard: {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Ari',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        tags: [],
        creator: '',
        character_version: '1',
        extensions: {},
      },
    },
    unknownRootFields: {},
    unknownDataFields: {},
    cardExtensions: {},
    characterBookExtensions: {},
    characterBookEntries: [],
  };
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderWorkbench(workspaceId: string, panel: string) {
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/workbench/${workspaceId}?panel=${panel}`]}>
          <Routes>
            <Route path="/workbench/:workspaceId" element={<WorkbenchPage />} />
            <Route path="/worlds/:worldId/maintain" element={<div>Maintain</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function createPublishReadyWorkspace() {
  const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
    mode: 'NEW_WORLD',
    title: 'Archive Realm',
    worldName: 'Archive Realm',
    worldDescription: 'A city governed by memory.',
  });

  const draftAgentId = useForgeWorkspaceStore.getState().attachMasterAgentClone(workspaceId, {
    masterAgentId: 'master_ari',
    displayName: 'Ari',
    handle: 'ari',
    concept: 'Archive guardian',
  });

  useForgeWorkspaceStore.getState().patchWorldDraft(workspaceId, {
    tagline: 'Every oath is recorded.',
    overview: 'A memory-city on the brink of fracture.',
    genre: 'archive-fantasy',
    themes: ['memory', 'duty'],
    bannerUrl: 'https://cdn.example.com/world-banner.png',
    iconUrl: 'https://cdn.example.com/world-icon.png',
  });

  useForgeWorkspaceStore.getState().updateAgentDraft(workspaceId, draftAgentId, {
    description: 'Keeper of the archive gates.',
    scenario: 'Ari watches over the moon archive.',
    greeting: 'State your business.',
    avatarUrl: 'https://cdn.example.com/ari-avatar.png',
    voiceDemoUrl: 'https://cdn.example.com/ari-voice.mp3',
    voiceDemoResourceId: 'resource-voice-ari',
  });

  useForgeWorkspaceStore.setState((state) => ({
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspaceId]: {
        ...state.workspaces[workspaceId]!,
        reviewState: {
          ...state.workspaces[workspaceId]!.reviewState,
          worldRules: [{
            ruleKey: 'world:axiom:memory',
            title: 'Memory is law',
            statement: 'Archive memory governs civic order.',
            domain: 'META',
            category: 'POLICY',
            hardness: 'HARD',
            scope: 'WORLD',
            provenance: 'CREATOR',
          }],
          agentBundles: [{
            draftAgentId,
            characterName: 'Ari',
            sourceSessionId: null,
            rules: [{
              ruleKey: 'identity:self:core',
              title: 'Core Identity',
              statement: 'Ari protects the archive.',
              layer: 'DNA',
              category: 'DEFINITION',
              hardness: 'FIRM',
              importance: 90,
              provenance: 'CREATOR',
            }],
          }],
        },
      },
    },
  }));

  return { workspaceId, draftAgentId };
}

describe('WorkbenchPage', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useForgeWorkspaceStore.getState().reset();
    mockUseAgentListQuery.mockReturnValue({
      data: [],
      isLoading: false,
    });
    createBatchRunMutateAsync.mockResolvedValue({
      id: 'run-1',
      items: [{ id: 'item-1' }],
    });
    publishPackageMutateAsync.mockResolvedValue({
      worldId: 'world-1',
    });
    reportBatchItemFailureMutateAsync.mockResolvedValue(undefined);
    useAppStore.getState().setAuthSession(
      { id: 'user-1', displayName: 'Forge Operator' },
      'token-1',
      'refresh-1',
    );
  });

  it('blocks publish-plan handoff while review conflicts remain unresolved', async () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Review Blocked',
    });

    useForgeWorkspaceStore.getState().applyCharacterCardReviewDraft(workspaceId, {
      sessionId: 'session_card_1',
      sourceFile: 'ari.json',
      importedAt: '2026-03-19T00:00:00.000Z',
      characterName: 'Ari',
      sourceManifest: createCharacterManifest(),
      agentRules: [{
        ruleKey: 'identity:self:core',
        title: 'Core Identity',
        statement: 'Ari is a scout.',
        layer: 'DNA',
        category: 'DEFINITION',
        hardness: 'FIRM',
        importance: 90,
        provenance: 'CREATOR',
      }],
      worldRules: [{
        ruleKey: 'world:seed:scenario',
        title: 'Scenario',
        statement: 'A fallen city.',
        domain: 'NARRATIVE',
        category: 'DEFINITION',
        hardness: 'SOFT',
        scope: 'WORLD',
        provenance: 'SEED',
      }],
    });

    useForgeWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: {
        ...state.workspaces,
        [workspaceId]: {
          ...state.workspaces[workspaceId]!,
          reviewState: {
            ...state.workspaces[workspaceId]!.reviewState,
            conflicts: [{
              sessionId: 'session_card_1',
              ruleKey: 'world:seed:scenario',
              previousStatement: 'A fallen city.',
              newStatement: 'A restored city.',
              resolution: 'UNRESOLVED',
            }],
            hasPendingConflicts: true,
          },
        },
      },
    }));

    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[`/workbench/${workspaceId}?panel=REVIEW`]}>
            <Routes>
              <Route path="/workbench/:workspaceId" element={<WorkbenchPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    const button = await screen.findByRole('button', { name: 'Build Publish Plan' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('clones a master agent into the active world workspace', async () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Agent Drafts',
    });

    mockUseAgentListQuery.mockReturnValue({
      data: [{
        id: 'master_ari',
        handle: 'ari',
        displayName: 'Ari',
        concept: 'Brave scout',
        ownershipType: 'MASTER_OWNED',
        worldId: null,
        status: 'ACTIVE',
        avatarUrl: null,
        createdAt: '2026-03-19T00:00:00.000Z',
        updatedAt: '2026-03-19T00:00:00.000Z',
      }],
      isLoading: false,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[`/workbench/${workspaceId}?panel=AGENTS`]}>
            <Routes>
              <Route path="/workbench/:workspaceId" element={<WorkbenchPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Clone to World' }));

    await waitFor(() => {
      const drafts = Object.values(useForgeWorkspaceStore.getState().workspaces[workspaceId]!.agentDrafts);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.ownershipType).toBe('WORLD_OWNED');
    });

    expect(screen.getByText('World-Owned Draft Agents')).toBeTruthy();
    expect(screen.getAllByText('Ari').length).toBeGreaterThan(0);
  });

  it('renders the canonical enrichment panel', async () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Enrichment Workspace',
    });

    useForgeWorkspaceStore.getState().attachMasterAgentClone(workspaceId, {
      masterAgentId: 'master_ari',
      displayName: 'Ari',
      handle: 'ari',
      concept: 'Brave scout',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[`/workbench/${workspaceId}?panel=ENRICHMENT`]}>
            <Routes>
              <Route path="/workbench/:workspaceId" element={<WorkbenchPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('One-Click Enrichment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Complete Missing World + Agents' })).toBeTruthy();
  });

  it('blocks publish until completeness requirements are satisfied', async () => {
    const { workspaceId } = createPublishReadyWorkspace();

    useForgeWorkspaceStore.getState().patchWorldDraft(workspaceId, {
      bannerUrl: null,
    });

    renderWorkbench(workspaceId, 'PUBLISH');

    const button = await screen.findByRole('button', { name: 'Publish' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('World banner is required.')).toBeTruthy();
    expect(createBatchRunMutateAsync).not.toHaveBeenCalled();
    expect(publishPackageMutateAsync).not.toHaveBeenCalled();
  });

  it('publishes a complete workspace through canonical package publish instead of the legacy publish-plan handoff', async () => {
    const { workspaceId } = createPublishReadyWorkspace();

    renderWorkbench(workspaceId, 'PUBLISH');

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    await waitFor(() => {
      expect(createBatchRunMutateAsync).toHaveBeenCalledTimes(1);
      expect(publishPackageMutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(publishForgeWorkspacePlanMock).not.toHaveBeenCalled();
    expect(createBatchRunMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      pipelineStages: ['workbench-completeness-gate', 'package-publish'],
    }));
    expect(publishPackageMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      package: expect.objectContaining({
        world: expect.objectContaining({
          bannerUrl: 'https://cdn.example.com/world-banner.png',
          iconUrl: 'https://cdn.example.com/world-icon.png',
        }),
        agentBlueprints: expect.arrayContaining([
          expect.objectContaining({
            name: 'Ari',
            scenario: 'Ari watches over the moon archive.',
            greeting: 'State your business.',
            referenceImageUrl: 'https://cdn.example.com/ari-avatar.png',
          }),
        ]),
      }),
      governance: expect.objectContaining({
        officialOwnerId: 'user-1',
        reviewerId: 'user-1',
      }),
      operations: expect.objectContaining({
        batchRunId: 'run-1',
        batchItemId: 'item-1',
      }),
    }));
  });

  it('uses forge-file-source provenance for novel-derived workspace publish', async () => {
    const { workspaceId } = createPublishReadyWorkspace();

    useForgeWorkspaceStore.getState().patchWorldDraft(workspaceId, {
      sourceType: 'NOVEL',
    });

    renderWorkbench(workspaceId, 'PUBLISH');

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    await waitFor(() => {
      expect(publishPackageMutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(publishPackageMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      governance: expect.objectContaining({
        sourceProvenance: 'forge-file-source',
      }),
    }));
  });
});
