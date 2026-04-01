/**
 * dialogue-pipeline.ts — SJ-DIAL-001 ~ 019
 *
 * Main orchestrator for the per-turn dialogue pipeline:
 *
 *  1. Context assembly        (context-assembler.ts)
 *  2. Pacing enforcement      (pacing-enforcer.ts)
 *  3. Prompt construction     (prompt-builder.ts)
 *  4. AI text generation      (ai-client.ts) — streaming
 *  5. Choice parsing          (choice-parser.ts)
 *  6. Trunk convergence       (trunk-convergence.ts) — Phase 2 (no-op until /events ships)
 *  7. Knowledge detection     (explanation-detector.ts) — post-generation
 *  8. Temporal tracking       (temporal-tracker.ts) — Phase 2 (no-op until trunk metadata ships)
 *  9. Session state persistence (sqlite-bridge.ts)
 *
 * Streaming variant: `runDialoguePipelineStreaming` accepts an onChunk callback
 * for real-time text display in the UI.
 */
import { ulid } from 'ulid';
import { assembleContext } from './context-assembler.js';
import { buildPrompt } from './prompt-builder.js';
import { enforcePacing } from './pacing-enforcer.js';
import { parseChoices } from './choice-parser.js';
import { checkTrunkConvergence } from './trunk-convergence.js';
import { detectExplanations } from './explanation-detector.js';
import { detectTemporalAdvance, advanceTemporalContext } from './temporal-tracker.js';
import { streamDialogueText, type StreamChunkCallback } from './ai-client.js';
import {
  sqliteInsertDialogueTurn,
  sqliteInsertChoice,
  sqliteUpdateSession,
  sqliteUpsertKnowledgeEntry,
} from '@renderer/bridge/sqlite-bridge.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { Choice, SceneType } from './types.js';

// ── Public types ──────────────────────────────────────────────────────────

export type DialoguePipelineInput = {
  sessionId: string;
  userInput: string;
};

export type DialoguePipelineStreamInput = DialoguePipelineInput & {
  onChunk: StreamChunkCallback;
  signal?: AbortSignal;
};

export type DialoguePipelineOutput = {
  assistantText: string;
  assistantTurnId: string;
  choices: Choice[];
  sceneType: SceneType;
  temporalLabel: string;
  interrupted: boolean;
  newKnowledgeKeys: string[];
};

// ── Pipeline implementation ─────────────────────────────────────────────

/**
 * runDialoguePipelineStreaming — full per-turn pipeline with streaming.
 * Called from DialogueSessionPage on each user submission.
 */
export async function runDialoguePipelineStreaming(
  input: DialoguePipelineStreamInput,
): Promise<DialoguePipelineOutput> {
  const { sessionId, userInput, onChunk, signal } = input;

  // ── Step 1: Context assembly ─────────────────────────────────────────
  const context = await assembleContext(sessionId);
  const { sessionSnapshot, dialogueHistory, trunkEvents, knowledgeFlags } = context;

  // ── Step 2: Pacing enforcement ───────────────────────────────────────
  const assistantTurnCount = dialogueHistory.filter(
    (t) => t.role === 'assistant',
  ).length;
  const pacing = enforcePacing(sessionSnapshot, assistantTurnCount, false);

  // ── Step 3: Prompt construction ──────────────────────────────────────
  const { systemPrompt, matchedLorebooks } = buildPrompt(
    context,
    pacing,
    userInput,
  );

  // ── Prepare messages for generation ──────────────────────────────────
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const turn of dialogueHistory) {
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  if (userInput || messages.length === 0) {
    messages.push({
      role: 'user',
      content: userInput || '（开始对话）',
    });
  }

  // ── Persist user turn to SQLite ──────────────────────────────────────
  const now = new Date().toISOString();
  const userTurnSeq = dialogueHistory.length + 1;
  if (userInput) {
    await sqliteInsertDialogueTurn({
      id: ulid(),
      sessionId,
      seq: userTurnSeq,
      role: 'user',
      content: userInput,
      sceneType: pacing.nextSceneType,
      createdAt: now,
    });
  }

  // ── Step 4: AI text generation (streaming) ───────────────────────────
  const modelId = useAppStore.getState().aiModel;

  let generateResult = await streamDialogueText(
    systemPrompt,
    messages,
    modelId,
    onChunk,
    signal,
  );

  // ── Step 5: Choice parsing ───────────────────────────────────────────
  let parsed = parseChoices(generateResult.fullText, pacing.nextSceneType);

  // SJ-DIAL-005:3 — retry once with stronger instructions if crisis has no choices
  if (
    parsed.isCrisisScene &&
    parsed.choices.length < 2 &&
    !generateResult.interrupted
  ) {
    const retryPrompt =
      systemPrompt +
      '\n\n## CRITICAL RETRY INSTRUCTION\nYou MUST end your response with exactly TWO choices formatted as:\nA. [description] | [consequence]\nB. [description] | [consequence]\nThis is a CRISIS scene and structured choices are REQUIRED.';

    generateResult = await streamDialogueText(
      retryPrompt,
      messages,
      modelId,
      onChunk,
      signal,
    );
    parsed = parseChoices(generateResult.fullText, pacing.nextSceneType);

    // SJ-DIAL-005:4 — fail-close: crisis scene MUST have choices after retry
    if (parsed.isCrisisScene && parsed.choices.length < 2 && !generateResult.interrupted) {
      throw new Error(
        '[dialogue-pipeline] Crisis scene failed to produce structured A/B choices after retry. ' +
        'SJ-DIAL-005:4 requires fail-close rather than narrative-only degradation.',
      );
    }
  }

  // ── Step 6: Trunk convergence (post-generation) ──────────────────────
  // Phase 2: runs with empty trunkEvents, always returns 'free' directive
  const turnsSinceLastTrunk = assistantTurnCount;
  const convergence = checkTrunkConvergence(
    sessionSnapshot,
    trunkEvents,
    generateResult.fullText,
    turnsSinceLastTrunk,
  );

  // ── Step 7: Knowledge detection (post-generation) ────────────────────
  const explanations = detectExplanations(
    generateResult.fullText,
    matchedLorebooks,
    knowledgeFlags,
  );
  const newKnowledgeKeys = explanations.map((e) => e.conceptKey);

  // Persist knowledge upgrades
  for (const explanation of explanations) {
    const existing = knowledgeFlags.find(
      (f) => f.conceptKey === explanation.conceptKey,
    );
    await sqliteUpsertKnowledgeEntry({
      id: ulid(),
      learnerId: useAppStore.getState().activeProfile?.id ?? '',
      worldId: sessionSnapshot.worldId,
      conceptKey: explanation.conceptKey,
      domain: existing?.domain ?? 'unknown',
      depth: explanation.newDepth,
      contentType: sessionSnapshot.contentType,
      truthMode: sessionSnapshot.truthMode,
      firstSeenAt: now,
      updatedAt: now,
    });
  }

  // ── Step 8: Temporal tracking (post-generation) ──────────────────────
  // Phase 2: temporal context is placeholder until trunk event metadata ships
  let temporalContext = context.temporalContext;
  if (convergence.trunkEventReached) {
    temporalContext = advanceTemporalContext(
      temporalContext,
      convergence.nextTrunkIndex,
    );
  }
  temporalContext = detectTemporalAdvance(
    generateResult.fullText,
    temporalContext,
  );

  // ── Step 9: Persist assistant turn + choices + session state ─────────
  const assistantTurnId = ulid();
  const assistantTurnSeq = userInput ? userTurnSeq + 1 : userTurnSeq;

  await sqliteInsertDialogueTurn({
    id: assistantTurnId,
    sessionId,
    seq: assistantTurnSeq,
    role: 'assistant',
    content: generateResult.fullText,
    sceneType: pacing.nextSceneType,
    createdAt: new Date().toISOString(),
  });

  // Persist parsed choices (SJ-DIAL-005:7)
  for (const choice of parsed.choices) {
    await sqliteInsertChoice({
      id: ulid(),
      sessionId,
      turnId: assistantTurnId,
      choiceKey: choice.key,
      choiceLabel: choice.label,
      choiceDescription: choice.description,
      consequencePreview: choice.consequencePreview,
      selectedAt: '', // populated when user selects
    });
  }

  // Update session pacing state
  await sqliteUpdateSession({
    id: sessionId,
    sessionStatus: 'active',
    chapterIndex: convergence.trunkEventReached
      ? sessionSnapshot.chapterIndex + 1
      : sessionSnapshot.chapterIndex,
    sceneType: pacing.nextSceneType,
    rhythmCounter: pacing.rhythmCounter,
    trunkEventIndex: convergence.nextTrunkIndex,
    updatedAt: new Date().toISOString(),
    completedAt: null,
  });

  return {
    assistantText: generateResult.fullText,
    assistantTurnId,
    choices: parsed.choices,
    sceneType: pacing.nextSceneType,
    temporalLabel: temporalContext.displayLabel,
    interrupted: generateResult.interrupted,
    newKnowledgeKeys,
  };
}

/**
 * runDialoguePipeline — non-streaming variant (for testing / background).
 * Accumulates text internally without streaming callbacks.
 */
export async function runDialoguePipeline(
  input: DialoguePipelineInput,
): Promise<DialoguePipelineOutput> {
  return runDialoguePipelineStreaming({
    ...input,
    onChunk: () => {}, // discard streaming chunks
  });
}
