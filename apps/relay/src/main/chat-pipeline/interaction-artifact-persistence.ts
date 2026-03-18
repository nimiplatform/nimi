// Relay interaction artifact persistence — adapted from local-chat interaction-artifact-persistence.ts
// Removed: mod SDK imports (RuntimeRouteBinding)
// Adapted: uses ../session-store/index.js, simplified AI-based memory extraction
//   (relation-memory-extractor and portable-memory-compiler will be added in a later phase;
//    for now, compileInteractionState provides basic memory slot scaffolding)

import type {
  InteractionBeat,
  LocalChatTurnAiClient,
  RelationMemorySlot,
} from './types.js';
import {
  getInteractionSnapshot,
  getSessionById,
  listLocalChatMediaAssets,
  getRelationMemorySlots,
  updateInteractionSnapshot,
  updateRelationMemorySlots,
  updateRecallIndex,
} from '../session-store/index.js';
import { createUlid } from './ulid.js';
import { compileInteractionState } from './interaction-state-compiler.js';
import { stripTrailingEndMarkerFragment } from './stream-end-marker.js';

function normalizeBeatText(content: string): string {
  return stripTrailingEndMarkerFragment(content.replace(/\s+/g, ' ').trim());
}

function candidateToRelationMemorySlot(input: {
  targetId: string;
  viewerId: string;
  updatedAt: string;
  candidate: {
    slotType: RelationMemorySlot['slotType'];
    key: string;
    value: string;
    confidence: number;
  };
}): RelationMemorySlot {
  return {
    id: `slot_${createUlid()}`,
    targetId: input.targetId,
    viewerId: input.viewerId,
    slotType: input.candidate.slotType,
    key: input.candidate.key,
    value: input.candidate.value,
    confidence: input.candidate.confidence,
    portability: 'local-only',
    sensitivity: 'personal',
    userOverride: 'inherit',
    updatedAt: input.updatedAt,
  };
}

type RouteBindingLike = {
  source?: string;
  connectorId?: string;
  model?: string;
};

export async function persistLocalChatInteractionArtifacts(input: {
  aiClient: Pick<LocalChatTurnAiClient, 'generateObject'>;
  sessionId: string;
  targetId: string;
  viewerId: string;
  assistantTurnId: string;
  deliveredBeats: InteractionBeat[];
  routeBinding?: RouteBindingLike | null;
  conversationDirective?: string | null;
  userText?: string | null;
}): Promise<void> {
  const [session, mediaAssets, previousSnapshot, existingSlots] = await Promise.all([
    getSessionById(input.sessionId, input.viewerId),
    listLocalChatMediaAssets({
      conversationId: input.sessionId,
      turnId: input.assistantTurnId,
    }),
    getInteractionSnapshot(input.sessionId),
    getRelationMemorySlots({
      targetId: input.targetId,
      viewerId: input.viewerId,
    }),
  ]);

  const compiled = compileInteractionState({
    conversationId: input.sessionId,
    targetId: input.targetId,
    viewerId: input.viewerId,
    session,
    deliveredBeats: input.deliveredBeats,
    mediaAssets,
    conversationDirective: input.conversationDirective,
    previousSnapshot,
  });

  // Phase 5 simplified: persist compiled interaction state + scaffolded memory slots.
  // Full AI-based relation memory extraction (extractRelationMemoryCandidates +
  // compilePortableMemorySlots) will be migrated in a later media/proactive phase.
  // For now, the basic slots from compileInteractionState are sufficient.
  const governedCandidates = compiled.relationMemorySlots.map((slot) =>
    candidateToRelationMemorySlot({
      targetId: input.targetId,
      viewerId: input.viewerId,
      updatedAt: compiled.snapshot.updatedAt,
      candidate: {
        slotType: slot.slotType,
        key: slot.key,
        value: slot.value,
        confidence: slot.confidence,
      },
    }),
  );

  await Promise.all([
    updateInteractionSnapshot(compiled.snapshot),
    updateRelationMemorySlots({
      targetId: input.targetId,
      viewerId: input.viewerId,
      entries: governedCandidates,
      resolutionTexts: [
        input.userText || '',
        ...input.deliveredBeats.map((beat) => beat.text),
      ].filter(Boolean),
      maxEntries: 50,
    }),
    updateRecallIndex({
      conversationId: input.sessionId,
      docs: compiled.recallDocs,
    }),
  ]);
}
