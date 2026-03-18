import type {
  LocalChatContextPacket,
  LocalChatPromptTrace,
  LocalChatTarget,
  LocalChatTurnAudit,
  SegmentParseMode,
} from './types.js';
import type { LocalChatCompiledPrompt } from '../prompt/types.js';
import type { PromptLayerId } from '../prompt/types.js';

type RouteSnapshot = {
  source: string;
  model: string;
};

type BuildPromptTraceInput = {
  compiledPrompt: LocalChatCompiledPrompt;
  contextPacket: LocalChatContextPacket;
  routeSnapshot: RouteSnapshot | null;
  routeBinding: { source?: string; model?: string } | null;
  chatRouteOptions: { selected: { source: string; model: string } } | null;
  planner: 'stream';
  planSegments: number;
  voiceSegments: number;
  textSegments: number;
  schedulerTotalDelayMs: number;
  streamDeltaCount: number;
  streamDurationMs: number;
  segmentParseMode: SegmentParseMode;
  nsfwPolicy: 'disabled' | 'local-only' | 'allowed';
  plannerUsed: boolean;
  plannerKind: 'none' | 'image' | 'video';
  plannerTrigger: 'user-explicit' | 'assistant-offer' | 'scene-enhancement' | 'none' | 'marker-override';
  plannerConfidence: number | null;
  plannerBlockedReason: string | null;
  imageReady: boolean;
  videoReady: boolean;
  imageDependencyStatus: 'ready' | 'missing' | 'degraded' | 'unknown' | null;
  videoDependencyStatus: 'ready' | 'missing' | 'degraded' | 'unknown' | null;
  mediaDecisionSource: 'tag' | 'explicit' | 'planner' | 'none';
  mediaDecisionKind: 'none' | 'image' | 'video';
  mediaExecutionStatus: 'none' | 'blocked' | 'pending' | 'ready' | 'failed';
  mediaExecutionRouteSource: 'local' | 'cloud' | null;
  mediaExecutionRouteModel: string | null;
  mediaExecutionReason: string | null;
};

function extractLayerIds(input: {
  layers: LocalChatCompiledPrompt['layers'];
  applied: boolean;
}): PromptLayerId[] {
  return input.layers
    .filter((layer) => layer.applied === input.applied)
    .map((layer) => layer.layer);
}

export function buildPromptTrace(input: BuildPromptTraceInput): LocalChatPromptTrace {
  const appliedLayers = extractLayerIds({
    layers: input.compiledPrompt.layers,
    applied: true,
  });
  const droppedLayers = extractLayerIds({
    layers: input.compiledPrompt.layers,
    applied: false,
  });
  return {
    id: `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: input.contextPacket.conversationId,
    routeSource: input.routeSnapshot?.source
      || (input.routeBinding?.source || input.chatRouteOptions?.selected.source || 'unknown'),
    routeModel: input.routeSnapshot?.model
      || (input.routeBinding?.model || input.chatRouteOptions?.selected.model || ''),
    promptChars: input.compiledPrompt.prompt.length,
    layerOrder: [...input.compiledPrompt.layerOrder],
    appliedLayers,
    droppedLayers,
    laneChars: input.compiledPrompt.laneChars,
    truncationByLane: input.compiledPrompt.truncationByLane,
    laneBudgets: input.compiledPrompt.budget.laneBudgets,
    memorySlices: {
      core: input.contextPacket.platformWarmStart?.core.length || 0,
      e2e: input.contextPacket.platformWarmStart?.e2e.length || 0,
      worldLore: input.compiledPrompt.retrieval.worldContextCount,
      agentLore: input.compiledPrompt.retrieval.recentTurnCount,
    },
    budget: {
      maxChars: input.compiledPrompt.budget.maxChars,
      usedChars: input.compiledPrompt.budget.usedChars,
      truncated: input.compiledPrompt.budget.truncatedLayers.length > 0,
    },
    compilerVersion: input.compiledPrompt.compilerVersion,
    pacingPlan: input.contextPacket.pacingPlan,
    planner: input.planner,
    planSegments: input.planSegments,
    voiceSegments: input.voiceSegments,
    textSegments: input.textSegments,
    schedulerTotalDelayMs: input.schedulerTotalDelayMs,
    streamDeltaCount: input.streamDeltaCount,
    streamDurationMs: input.streamDurationMs,
    segmentParseMode: input.segmentParseMode,
    nsfwPolicy: input.nsfwPolicy,
    plannerUsed: input.plannerUsed,
    plannerKind: input.plannerKind,
    plannerTrigger: input.plannerTrigger,
    plannerConfidence: input.plannerConfidence,
    plannerBlockedReason: input.plannerBlockedReason,
    imageReady: input.imageReady,
    videoReady: input.videoReady,
    imageDependencyStatus: input.imageDependencyStatus,
    videoDependencyStatus: input.videoDependencyStatus,
    mediaDecisionSource: input.mediaDecisionSource,
    mediaDecisionKind: input.mediaDecisionKind,
    mediaExecutionStatus: input.mediaExecutionStatus,
    mediaExecutionRouteSource: input.mediaExecutionRouteSource,
    mediaExecutionRouteModel: input.mediaExecutionRouteModel,
    mediaExecutionReason: input.mediaExecutionReason,
    selectedTurnSeqs: [...input.contextPacket.diagnostics.selectedTurnSeqs],
    sessionRecallCount: input.contextPacket.diagnostics.sessionRecallCount,
    createdAt: new Date().toISOString(),
  };
}

export function buildTurnAudit(input: {
  selectedTarget: LocalChatTarget;
  latencyMs: number;
  error?: string | null;
}): LocalChatTurnAudit {
  return {
    id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    targetId: input.selectedTarget.id,
    worldId: input.selectedTarget.worldId || null,
    latencyMs: input.latencyMs,
    error: input.error || null,
    createdAt: new Date().toISOString(),
  };
}
