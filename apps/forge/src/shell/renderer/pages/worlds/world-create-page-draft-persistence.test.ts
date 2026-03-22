import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorldCreatePageDraftPersistence } from './world-create-page-draft-persistence.js';

const mockGetWorldDraft = vi.fn();

vi.mock('@renderer/data/world-data-client.js', () => ({
  getWorldDraft: (...args: unknown[]) => mockGetWorldDraft(...args),
}));

function buildDraftPayload(overrides?: Record<string, unknown>) {
  return {
    importSource: {
      sourceType: 'TEXT',
      sourceRef: 'draft-ref',
      sourceText: 'hello world',
    },
    truthDraft: {
      worldRules: [
        {
          ruleKey: 'axiom:time:module',
          structured: { timeFlowRatio: 2 },
        },
      ],
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
    stateDraft: {
      worldState: { name: 'Realm' },
    },
    historyDraft: {
      events: {
        primary: [{ id: 'e1', title: 'P1' }],
        secondary: [{ id: 'e2', title: 'S1' }],
      },
    },
    workflowState: {
      workspaceVersion: 'ws-1',
      createStep: 'DRAFT',
      futureEventsText: '[{}]',
      selectedStartTimeId: 't-1',
      selectedCharacters: ['Alice'],
    },
    ...overrides,
  };
}

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
      draftPayload: buildDraftPayload({
        workflowState: {
          workspaceVersion: 'ws-1',
          createStep: 'DRAFT',
          futureEventsText: '[{}]',
          selectedStartTimeId: 't-1',
          selectedCharacters: ['Alice'],
          parseJob: { phase: 'done', chunkTotal: 4 },
          phase1Artifact: { updatedAt: '2026-03-19T00:00:00.000Z' },
        },
      }),
    });

    const patchWorkspaceSnapshot = vi.fn();
    const setCreateStep = vi.fn();

    renderHook(() =>
      useWorldCreatePageDraftPersistence({
        hydrateForUser: vi.fn(),
        patchWorkspaceSnapshot,
        persistForUser: vi.fn(),
        resumeDraftId: 'draft-1',
        setCreateStep,
        setNotice: vi.fn(),
        snapshot: {},
        userId: 'user-1',
      }),
    );

    await waitFor(() => expect(mockGetWorldDraft).toHaveBeenCalledWith('draft-1'));
    await waitFor(() => expect(patchWorkspaceSnapshot).toHaveBeenCalledTimes(1));

    expect(patchWorkspaceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: 'hello world',
        sourceRef: 'draft-ref',
        worldStateDraft: { name: 'Realm' },
        workspaceVersion: 'ws-1',
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

  it('fails close for legacy draft payloads that do not match typed schema', async () => {
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

    const patchWorkspaceSnapshot = vi.fn();
    const setNotice = vi.fn();

    renderHook(() =>
      useWorldCreatePageDraftPersistence({
        hydrateForUser: vi.fn(),
        patchWorkspaceSnapshot,
        persistForUser: vi.fn(),
        resumeDraftId: 'draft-legacy',
        setCreateStep: vi.fn(),
        setNotice,
        snapshot: {},
        userId: 'user-1',
      }),
    );

    await waitFor(() => expect(setNotice).toHaveBeenCalledWith('Failed to load draft. Starting fresh.'));
    expect(patchWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('falls back from REVIEW status to DRAFT when createStep is missing', async () => {
    mockGetWorldDraft.mockResolvedValue({
      status: 'REVIEW',
      draftPayload: buildDraftPayload({
        workflowState: {
          workspaceVersion: 'ws-2',
          selectedCharacters: [],
        },
      }),
      pipelineState: {},
    });

    const setCreateStep = vi.fn();

    renderHook(() =>
      useWorldCreatePageDraftPersistence({
        hydrateForUser: vi.fn(),
        patchWorkspaceSnapshot: vi.fn(),
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
      draftPayload: buildDraftPayload({
        importSource: {
          sourceType: 'TEXT',
          sourceText: 'truth first',
        },
        truthDraft: {
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
        historyDraft: {
          events: { primary: [], secondary: [] },
        },
        workflowState: {
          workspaceVersion: 'ws-3',
          selectedCharacters: ['Alice'],
        },
      }),
      pipelineState: {},
    });

    const patchWorkspaceSnapshot = vi.fn();

    renderHook(() =>
      useWorldCreatePageDraftPersistence({
        hydrateForUser: vi.fn(),
        patchWorkspaceSnapshot,
        persistForUser: vi.fn(),
        resumeDraftId: 'draft-3',
        setCreateStep: vi.fn(),
        setNotice: vi.fn(),
        snapshot: {},
        userId: 'user-1',
      }),
    );

    await waitFor(() => expect(patchWorkspaceSnapshot).toHaveBeenCalledTimes(1));

    expect(patchWorkspaceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: 'truth first',
        workspaceVersion: 'ws-3',
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
