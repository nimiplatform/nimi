import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkbenchPage from './workbench-page.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';
import type { CharacterCardSourceManifest } from '@renderer/features/import/types.js';

const mockUseAgentListQuery = vi.fn();

vi.mock('@renderer/hooks/use-agent-queries.js', () => ({
  useAgentListQuery: (...args: unknown[]) => mockUseAgentListQuery(...args),
}));

vi.mock('@renderer/features/import/data/import-publish-client.js', () => ({
  publishForgeWorkspacePlan: vi.fn(),
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

describe('WorkbenchPage', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  beforeEach(() => {
    useForgeWorkspaceStore.getState().reset();
    mockUseAgentListQuery.mockReturnValue({
      data: [],
      isLoading: false,
    });
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
});
