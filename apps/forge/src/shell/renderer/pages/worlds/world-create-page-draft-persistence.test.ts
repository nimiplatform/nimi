import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorldCreatePageDraftPersistence } from './world-create-page-draft-persistence.js';

const mockGetWorldDraft = vi.fn();

vi.mock('@renderer/data/world-data-client.js', () => ({
  getWorldDraft: (...args: unknown[]) => mockGetWorldDraft(...args),
}));

describe('useWorldCreatePageDraftPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates a resumed draft payload back into snapshot state', async () => {
    mockGetWorldDraft.mockResolvedValue({
      status: 'REVIEW',
      sourceRef: 'book.txt',
      pipelineState: {
        createStep: 'DRAFT',
        parseJob: { phase: 'done', chunkTotal: 4 },
        phase1Artifact: { updatedAt: '2026-03-19T00:00:00.000Z' },
      },
      draftPayload: {
        sourceText: 'hello world',
        sourceRef: 'draft-ref',
        worldPatch: { name: 'Realm' },
        worldRules: [
          {
            ruleKey: 'axiom:time:module',
            structured: { timeFlowRatio: 2 },
          },
        ],
        eventsDraft: {
          primary: [{ id: 'e1', title: 'P1' }],
          secondary: [{ id: 'e2', title: 'S1' }],
        },
        futureEventsText: '[{}]',
        selectedStartTimeId: 't-1',
        selectedCharacters: ['Alice'],
        agentRules: [
          {
            characterName: 'Alice',
            payload: {
              structured: {
                concept: 'Hero',
              },
            },
          },
        ],
      },
    });

    const patchSnapshot = vi.fn();
    const setCreateStep = vi.fn();

    renderHook(() =>
      useWorldCreatePageDraftPersistence({
        hydrateForUser: vi.fn(),
        patchSnapshot,
        persistForUser: vi.fn(),
        resumeDraftId: 'draft-1',
        setCreateStep,
        setNotice: vi.fn(),
        snapshot: {},
        userId: 'user-1',
      }),
    );

    await waitFor(() => expect(mockGetWorldDraft).toHaveBeenCalledWith('draft-1'));
    await waitFor(() => expect(patchSnapshot).toHaveBeenCalledTimes(1));

    expect(patchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: 'hello world',
        sourceRef: 'draft-ref',
        worldPatch: { name: 'Realm' },
        worldviewPatch: { timeModel: { timeFlowRatio: 2 } },
        ruleTruthDraft: expect.objectContaining({
          worldRules: [
            expect.objectContaining({
              ruleKey: 'axiom:time:module',
            }),
          ],
          agentRules: [
            expect.objectContaining({
              characterName: 'Alice',
            }),
          ],
        }),
        futureEventsText: '[{}]',
        selectedStartTimeId: 't-1',
        selectedCharacters: ['Alice'],
        lorebooksDraft: [],
        eventsDraft: {
          primary: [{ id: 'e1', title: 'P1' }],
          secondary: [{ id: 'e2', title: 'S1' }],
        },
        agentSync: expect.objectContaining({
          selectedCharacterIds: ['Alice'],
          draftsByCharacter: {
            Alice: expect.objectContaining({
              characterName: 'Alice',
              concept: 'Hero',
            }),
          },
        }),
      }),
    );
    expect(setCreateStep).toHaveBeenCalledWith('DRAFT');
  });

  it('ignores legacy projection payload fields when restoring a draft', async () => {
    mockGetWorldDraft.mockResolvedValue({
      status: 'DRAFT',
      draftPayload: {
        worldviewPatch: { timeModel: { timeFlowRatio: 9 } },
        lorebooksDraft: [{ id: 'legacy-lore', title: 'Legacy Lore' }],
        agentSync: {
          selectedCharacterIds: ['Legacy Alice'],
          draftsByCharacter: {
            'Legacy Alice': {
              characterName: 'Legacy Alice',
              concept: 'Legacy Hero',
            },
          },
        },
        worldRules: [
          {
            ruleKey: 'axiom:time:module',
            structured: { timeFlowRatio: 3 },
          },
        ],
        agentRules: [
          {
            characterName: 'Alice',
            payload: {
              structured: {
                concept: 'Truth Hero',
              },
            },
          },
        ],
      },
      pipelineState: {},
    });

    const patchSnapshot = vi.fn();

    renderHook(() =>
      useWorldCreatePageDraftPersistence({
        hydrateForUser: vi.fn(),
        patchSnapshot,
        persistForUser: vi.fn(),
        resumeDraftId: 'draft-legacy',
        setCreateStep: vi.fn(),
        setNotice: vi.fn(),
        snapshot: {},
        userId: 'user-1',
      }),
    );

    await waitFor(() => expect(patchSnapshot).toHaveBeenCalledTimes(1));

    expect(patchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        worldviewPatch: {
          timeModel: { timeFlowRatio: 3 },
        },
        lorebooksDraft: [],
        selectedCharacters: ['Alice'],
        agentSync: {
          selectedCharacterIds: ['Alice'],
          draftsByCharacter: {
            Alice: expect.objectContaining({
              characterName: 'Alice',
              concept: 'Truth Hero',
            }),
          },
        },
      }),
    );
  });

  it('falls back from REVIEW status to DRAFT when createStep is missing', async () => {
    mockGetWorldDraft.mockResolvedValue({
      status: 'REVIEW',
      draftPayload: {},
      pipelineState: {},
    });

    const setCreateStep = vi.fn();

    renderHook(() =>
      useWorldCreatePageDraftPersistence({
        hydrateForUser: vi.fn(),
        patchSnapshot: vi.fn(),
        persistForUser: vi.fn(),
        resumeDraftId: 'draft-2',
        setCreateStep,
        setNotice: vi.fn(),
        snapshot: {},
        userId: 'user-1',
      }),
    );

    await waitFor(() => expect(setCreateStep).toHaveBeenCalledWith('DRAFT'));
  });

  it('restores workspace fields from truth-native worldRules and agentRules when patch fields are absent', async () => {
    mockGetWorldDraft.mockResolvedValue({
      status: 'DRAFT',
      draftPayload: {
        sourceText: 'truth first',
        worldRules: [
          {
            ruleKey: 'axiom:time:module',
            structured: { timeFlowRatio: 5 },
          },
          {
            ruleKey: 'economy:resource:catalog',
            structured: { resources: ['Mana'] },
          },
        ],
        agentRules: [
          {
            characterName: 'Alice',
            payload: {
              structured: {
                concept: 'Hero',
                backstory: 'Raised in the frontier.',
                coreValues: 'Duty',
                relationshipStyle: 'Protective',
                dna: { temperament: 'steady' },
              },
            },
          },
        ],
      },
      pipelineState: {},
    });

    const patchSnapshot = vi.fn();

    renderHook(() =>
      useWorldCreatePageDraftPersistence({
        hydrateForUser: vi.fn(),
        patchSnapshot,
        persistForUser: vi.fn(),
        resumeDraftId: 'draft-3',
        setCreateStep: vi.fn(),
        setNotice: vi.fn(),
        snapshot: {},
        userId: 'user-1',
      }),
    );

    await waitFor(() => expect(patchSnapshot).toHaveBeenCalledTimes(1));

    expect(patchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: 'truth first',
        worldviewPatch: {
          timeModel: { timeFlowRatio: 5 },
          resources: { resources: ['Mana'] },
        },
        ruleTruthDraft: {
          worldRules: [
            {
              ruleKey: 'axiom:time:module',
              structured: { timeFlowRatio: 5 },
            },
            {
              ruleKey: 'economy:resource:catalog',
              structured: { resources: ['Mana'] },
            },
          ],
          agentRules: [
            {
              characterName: 'Alice',
              payload: {
                structured: {
                  concept: 'Hero',
                  backstory: 'Raised in the frontier.',
                  coreValues: 'Duty',
                  relationshipStyle: 'Protective',
                  dna: { temperament: 'steady' },
                },
              },
            },
          ],
        },
        selectedCharacters: ['Alice'],
        agentSync: {
          selectedCharacterIds: ['Alice'],
          draftsByCharacter: {
            Alice: {
              characterName: 'Alice',
              handle: '',
              concept: 'Hero',
              backstory: 'Raised in the frontier.',
              coreValues: 'Duty',
              relationshipStyle: 'Protective',
              dnaPrimary: '',
              dna: { temperament: 'steady' },
            },
          },
        },
      }),
    );
  });
});
