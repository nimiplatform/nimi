import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssembledContext } from '../types.js';

const mockAssembleContext = vi.fn();
const mockStreamDialogueText = vi.fn();
const mockInsertDialogueTurn = vi.fn();
const mockInsertChoice = vi.fn();
const mockUpdateSession = vi.fn();
const mockUpsertKnowledgeEntry = vi.fn();
const mockUpsertChapterProgress = vi.fn();
const mockUnlockAchievement = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  createNimiUlid: () => 'ulid-test',
}));

vi.mock('../context-assembler.js', () => ({
  assembleContext: mockAssembleContext,
}));

vi.mock('../ai-client.js', () => ({
  streamDialogueText: mockStreamDialogueText,
}));

vi.mock('@renderer/bridge/sqlite-bridge.js', () => ({
  sqliteInsertDialogueTurn: mockInsertDialogueTurn,
  sqliteInsertChoice: mockInsertChoice,
  sqliteUpdateSession: mockUpdateSession,
  sqliteUpsertKnowledgeEntry: mockUpsertKnowledgeEntry,
  sqliteUpsertChapterProgress: mockUpsertChapterProgress,
  sqliteUnlockAchievement: mockUnlockAchievement,
}));

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: {
    getState: () => ({
      aiModel: 'model-1',
      activeProfile: { id: 'learner-1' },
    }),
  },
}));

const { runDialoguePipelineStreaming } = await import('../dialogue-pipeline.js');

function makeContext(): AssembledContext {
  return {
    worldRules: 'World rules',
    agentRules: 'Agent rules',
    lorebooks: [],
    sessionSnapshot: {
      worldId: 'world-1',
      agentId: 'agent-1',
      contentType: 'history',
      truthMode: 'factual',
      chapterIndex: 1,
      sceneType: 'crisis',
      rhythmCounter: 0,
      trunkEventIndex: 0,
    },
    trunkEvents: [],
    learnerProfile: {
      age: 10,
      interestTags: [],
      strengthTags: [],
      communicationStyle: '',
      guardianGuidance: '',
      guardianGoals: '',
    },
    dialogueHistory: [],
    knowledgeFlags: [],
    agentMemory: '',
    temporalContext: {
      eraNotation: '建安十二年',
      ceYear: 207,
      displayLabel: '建安十二年（公元207年）',
    },
    sceneContext: null,
    adaptationNotes: '',
  };
}

describe('dialogue pipeline progress side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssembleContext.mockResolvedValue(makeContext());
    mockStreamDialogueText.mockResolvedValue({
      fullText: 'The chapter resolves with a clear learning milestone.\nA. Continue onward | The learner advances\nB. Pause to reflect | The learner reviews',
      interrupted: false,
    });
    mockInsertDialogueTurn.mockResolvedValue(undefined);
    mockInsertChoice.mockResolvedValue(undefined);
    mockUpdateSession.mockResolvedValue(undefined);
    mockUpsertKnowledgeEntry.mockResolvedValue(undefined);
    mockUpsertChapterProgress.mockResolvedValue(undefined);
    mockUnlockAchievement.mockResolvedValue(undefined);
  });

  it('persists chapter progress and first-chapter achievement before reporting dialogue success', async () => {
    await expect(runDialoguePipelineStreaming({
      sessionId: 'session-1',
      userInput: 'continue',
      onChunk: () => {},
    })).resolves.toMatchObject({
      assistantText: 'The chapter resolves with a clear learning milestone.\nA. Continue onward | The learner advances\nB. Pause to reflect | The learner reviews',
    });

    expect(mockUpsertChapterProgress).toHaveBeenCalledWith(expect.objectContaining({
      id: 'chapter-progress:session-1:1',
      learnerId: 'learner-1',
      sessionId: 'session-1',
      worldId: 'world-1',
      chapterIndex: 1,
      completedAt: expect.any(String),
    }));
    expect(mockUnlockAchievement).toHaveBeenCalledWith(expect.objectContaining({
      id: 'achievement:learner-1:dialogue.first_chapter',
      learnerId: 'learner-1',
      achievementKey: 'dialogue.first_chapter',
      unlockedAt: expect.any(String),
    }));
    expect(mockUpsertChapterProgress.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mockUnlockAchievement.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('fails closed when required achievement persistence fails', async () => {
    mockUnlockAchievement.mockRejectedValueOnce(new Error('achievement write failed'));

    await expect(runDialoguePipelineStreaming({
      sessionId: 'session-1',
      userInput: 'continue',
      onChunk: () => {},
    })).rejects.toThrow('achievement write failed');

    expect(mockUpdateSession).not.toHaveBeenCalled();
  });
});
