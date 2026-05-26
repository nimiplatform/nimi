import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CharacterCardImportPage from './character-card-import-page.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';

const mockLoadFile = vi.fn();
const mockMapRules = vi.fn();

vi.mock('@renderer/features/import/hooks/use-character-card-import.js', () => ({
  useCharacterCardImport: () => ({
    validation: null,
    loadFile: mockLoadFile,
    mapRules: mockMapRules,
  }),
}));

describe('CharacterCardImportPage', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  beforeEach(() => {
    useForgeWorkspaceStore.getState().reset();
    mockLoadFile.mockReset();
    mockMapRules.mockReset();
  });

  it('writes import output into the current workspace and hands off to review', async () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Character Workspace',
    });

    mockLoadFile.mockResolvedValue({
      success: true,
      sessionId: 'card_session_1',
      card: { data: { name: 'Ari' } },
      sourceManifest: {
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
            description: 'Ari is a scout.',
            personality: '',
            scenario: 'Ari watches the old roads.',
            first_mes: 'Stay close.',
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: [],
            creator: '',
            character_version: '',
            extensions: {},
          },
        },
        unknownRootFields: {},
        unknownDataFields: {},
        cardExtensions: {},
        characterBookExtensions: {},
        characterBookEntries: [],
      },
    });
    mockMapRules.mockResolvedValue({
      sourceManifest: {
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
            description: 'Ari is a scout.',
            personality: '',
            scenario: 'Ari watches the old roads.',
            first_mes: 'Stay close.',
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: [],
            creator: '',
            character_version: '',
            extensions: {},
          },
        },
        unknownRootFields: {},
        unknownDataFields: {},
        cardExtensions: {},
        characterBookExtensions: {},
        characterBookEntries: [],
      },
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

    const { container, getByTestId } = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/workbench/${workspaceId}/import/character-card`]}>
          <Routes>
            <Route path="/workbench/:workspaceId/import/character-card" element={<CharacterCardImportPage />} />
            <Route path="/workbench/:workspaceId" element={<div data-testid="review-target">review-target</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{}'], 'ari.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(getByTestId('review-target')).toBeTruthy();
    });

    const snapshot = useForgeWorkspaceStore.getState().workspaces[workspaceId]!;
    expect(snapshot.reviewState.agentBundles).toHaveLength(1);
    expect(snapshot.importSessions[0]?.sessionId).toBe('card_session_1');
  });
});
