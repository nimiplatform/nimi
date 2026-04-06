import type {
  LocalChatContextLaneId,
  LocalChatContextPacket,
  LocalChatPromptLaneBudget,
} from '../chat-pipeline/types.js';

export type PromptLayerId =
  | 'platformSafety'
  | 'contentBoundary'
  | 'identity'
  | 'world'
  | 'turnMode'
  | 'interactionProfile'
  | 'interactionState'
  | 'relationMemory'
  | 'platformWarmStart'
  | 'sessionRecall'
  | 'recentTurns'
  | 'userInput';

export type LocalChatPromptProfile = 'full-turn' | 'first-beat';

export type PromptLayerTrace = {
  layer: PromptLayerId;
  applied: boolean;
  reason: string;
  chars: number;
  truncated: boolean;
};

export type PromptBudgetTrace = {
  maxChars: number;
  usedChars: number;
  truncatedLayers: PromptLayerId[];
  laneBudgets: Partial<Record<LocalChatContextLaneId, LocalChatPromptLaneBudget>>;
};

export type PromptRetrievalTrace = {
  durableMemoryCount: number;
  sessionRecallCount: number;
  worldContextCount: number;
  recentTurnCount: number;
};

export type LocalChatCompiledPrompt = {
  prompt: string;
  profile: LocalChatPromptProfile;
  layerOrder: PromptLayerId[];
  layers: PromptLayerTrace[];
  laneChars: Partial<Record<LocalChatContextLaneId, number>>;
  truncationByLane: Partial<Record<LocalChatContextLaneId, boolean>>;
  budget: PromptBudgetTrace;
  retrieval: PromptRetrievalTrace;
  compilerVersion: 'v7';
};

export type LocalChatPromptCompileInput = {
  contextPacket: LocalChatContextPacket;
  maxPromptChars?: number;
  profile?: LocalChatPromptProfile;
};
