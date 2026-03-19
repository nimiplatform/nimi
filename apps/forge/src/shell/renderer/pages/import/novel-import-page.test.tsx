import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NovelImportPage from './novel-import-page.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';

vi.mock('@renderer/features/import/state/novel-accumulator.js', () => ({
  accumulatorToImportResult: () => ({
    worldRules: [{
      ruleKey: 'world:timeline:core',
      title: 'Timeline',
      statement: 'The empire has fallen.',
      domain: 'NARRATIVE',
      category: 'DEFINITION',
      hardness: 'SOFT',
      scope: 'WORLD',
      provenance: 'EXTRACTED',
    }],
    agentRules: [{
      characterName: 'Ari',
      rules: [{
        ruleKey: 'identity:self:core',
        title: 'Core Identity',
        statement: 'Ari survived the fall.',
        layer: 'DNA',
        category: 'DEFINITION',
        hardness: 'FIRM',
        importance: 88,
        provenance: 'EXTRACTED',
      }],
    }],
  }),
}));

vi.mock('@renderer/features/import/hooks/use-novel-import.js', () => ({
  useNovelImport: () => ({
    sessionId: 'novel_session_1',
    machineState: 'FINAL_REVIEW',
    mode: 'auto',
    sourceManifest: {
      sourceType: 'novel',
      sourceFile: 'novel.md',
      importedAt: '2026-03-19T00:00:00.000Z',
      sourceText: 'chapter',
      chapterChunks: [],
    },
    accumulator: {
      sourceFile: 'novel.md',
      totalChapters: 1,
      processedChapters: 1,
      worldRules: {},
      characters: {},
      agentRulesByCharacter: {},
      conflicts: [],
      lineage: {},
    },
    currentChapterResult: null,
    progress: { current: 1, total: 1 },
    error: null,
    loadFile: vi.fn(),
    startExtraction: vi.fn(),
    confirmChapter: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    switchMode: vi.fn(),
    resolveConflict: vi.fn(),
    finishConflictCheck: vi.fn(),
    reset: vi.fn(),
  }),
}));

describe('NovelImportPage', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  beforeEach(() => {
    useForgeWorkspaceStore.getState().reset();
  });

  it('hands final novel extraction back into the owning workspace review state', async () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Novel Workspace',
    });

    const { getByTestId, queryByText } = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/workbench/${workspaceId}/import/novel`]}>
          <Routes>
            <Route path="/workbench/:workspaceId/import/novel" element={<NovelImportPage />} />
            <Route path="/workbench/:workspaceId" element={<div data-testid="review-target">review-target</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('review-target')).toBeTruthy();
    });

    const snapshot = useForgeWorkspaceStore.getState().workspaces[workspaceId]!;
    expect(snapshot.reviewState.worldRules).toHaveLength(1);
    expect(snapshot.reviewState.agentBundles).toHaveLength(1);
    expect(queryByText('Publish')).toBeNull();
  });
});
