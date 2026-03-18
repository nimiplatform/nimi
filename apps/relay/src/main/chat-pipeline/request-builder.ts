// Relay request builder — adapted from local-chat request-builder.ts.
// Builds AI request input from context packet + route snapshot.
// No mod SDK dependencies; uses relay types only.

import type { LocalChatPromptProfile, LocalChatCompiledPrompt } from '../prompt/types.js';
import type {
  ChatRouteSnapshot,
  LocalChatContextPacket,
  LocalChatTarget,
  LocalChatTurnMode,
  VoiceConversationMode,
} from './types.js';
import {
  assembleFirstBeatContext,
  assembleFullTurnContext,
  type AssembleFirstBeatContextInput,
  type AssembleFullTurnContextInput,
} from './context-assembler.js';

const MAX_SEGMENT_TOKENS = 2048;

// ── Turn invoke input (simplified — no RuntimeRouteBinding) ─────────

export type TurnInvokeInput = {
  capability: 'text.generate';
  prompt: string;
  maxTokens?: number;
  mode: 'STORY' | 'SCENE_TURN';
  worldId?: string;
  agentId: string;
  routeSnapshot?: ChatRouteSnapshot;
};

// ── Build input types ───────────────────────────────────────────────

export type BuildTurnRequestFirstBeatInput = {
  text: string;
  viewerId: string;
  viewerDisplayName: string;
  selectedTarget: LocalChatTarget;
  selectedSessionId: string;
  runtimeMode: 'STORY' | 'SCENE_TURN' | undefined;
  routeSnapshot: ChatRouteSnapshot | null;
  allowMultiReply: boolean;
  turnMode?: LocalChatTurnMode;
  voiceConversationMode?: VoiceConversationMode;
  profile?: LocalChatPromptProfile;
  compilePrompt: (input: {
    contextPacket: LocalChatContextPacket;
    profile?: LocalChatPromptProfile;
  }) => LocalChatCompiledPrompt;
} & Omit<AssembleFirstBeatContextInput, 'allowMultiReply'>;

export type BuildTurnRequestFullInput = {
  text: string;
  viewerId: string;
  viewerDisplayName: string;
  selectedTarget: LocalChatTarget;
  selectedSessionId: string;
  runtimeMode: 'STORY' | 'SCENE_TURN' | undefined;
  routeSnapshot: ChatRouteSnapshot | null;
  allowMultiReply: boolean;
  turnMode?: LocalChatTurnMode;
  voiceConversationMode?: VoiceConversationMode;
  profile?: LocalChatPromptProfile;
  compilePrompt: (input: {
    contextPacket: LocalChatContextPacket;
    profile?: LocalChatPromptProfile;
  }) => LocalChatCompiledPrompt;
} & Omit<AssembleFullTurnContextInput, 'allowMultiReply'>;

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeTurnMode(
  mode: 'STORY' | 'SCENE_TURN' | undefined,
): 'STORY' | 'SCENE_TURN' {
  return mode === 'SCENE_TURN' ? 'SCENE_TURN' : 'STORY';
}

// ── First-beat request builder ──────────────────────────────────────

/**
 * Builds a first-beat (lightweight) AI request from context.
 */
export function buildFirstBeatRequestInput(input: BuildTurnRequestFirstBeatInput): {
  prompt: string;
  contextPacket: LocalChatContextPacket;
  compiledPrompt: LocalChatCompiledPrompt;
  invokeInput: TurnInvokeInput;
} {
  const contextPacket = assembleFirstBeatContext({
    text: input.text,
    viewerId: input.viewerId,
    viewerDisplayName: input.viewerDisplayName,
    selectedTarget: input.selectedTarget,
    selectedSessionId: input.selectedSessionId,
    allowMultiReply: input.allowMultiReply,
    turnMode: input.turnMode,
    voiceConversationMode: input.voiceConversationMode,
    promptLocale: input.promptLocale,
    recentTurns: input.recentTurns,
    interactionSnapshot: input.interactionSnapshot,
    worldLines: input.worldLines,
  });

  const compiledPrompt = input.compilePrompt({
    contextPacket,
    profile: input.profile || 'first-beat',
  });
  const prompt = compiledPrompt.prompt;

  const invokeInput: TurnInvokeInput = {
    capability: 'text.generate',
    prompt,
    maxTokens: MAX_SEGMENT_TOKENS,
    mode: normalizeTurnMode(input.runtimeMode),
    worldId: input.selectedTarget.worldId || undefined,
    agentId: input.selectedTarget.id,
    routeSnapshot: input.routeSnapshot || undefined,
  };

  return {
    prompt,
    contextPacket,
    compiledPrompt,
    invokeInput,
  };
}

// ── Full-turn request builder ───────────────────────────────────────

/**
 * Builds a full-turn (complete) AI request from context with memory, recall, snapshot.
 */
export function buildFullTurnRequestInput(input: BuildTurnRequestFullInput): {
  prompt: string;
  contextPacket: LocalChatContextPacket;
  compiledPrompt: LocalChatCompiledPrompt;
  invokeInput: TurnInvokeInput;
} {
  const contextPacket = assembleFullTurnContext({
    text: input.text,
    viewerId: input.viewerId,
    viewerDisplayName: input.viewerDisplayName,
    selectedTarget: input.selectedTarget,
    selectedSessionId: input.selectedSessionId,
    allowMultiReply: input.allowMultiReply,
    turnMode: input.turnMode,
    voiceConversationMode: input.voiceConversationMode,
    promptLocale: input.promptLocale,
    recentTurns: input.recentTurns,
    interactionSnapshot: input.interactionSnapshot,
    relationMemorySlots: input.relationMemorySlots,
    recallIndex: input.recallIndex,
    platformWarmStart: input.platformWarmStart,
    worldLines: input.worldLines,
  });

  const compiledPrompt = input.compilePrompt({
    contextPacket,
    profile: input.profile || 'full-turn',
  });
  const prompt = compiledPrompt.prompt;

  const invokeInput: TurnInvokeInput = {
    capability: 'text.generate',
    prompt,
    maxTokens: MAX_SEGMENT_TOKENS,
    mode: normalizeTurnMode(input.runtimeMode),
    worldId: input.selectedTarget.worldId || undefined,
    agentId: input.selectedTarget.id,
    routeSnapshot: input.routeSnapshot || undefined,
  };

  return {
    prompt,
    contextPacket,
    compiledPrompt,
    invokeInput,
  };
}
