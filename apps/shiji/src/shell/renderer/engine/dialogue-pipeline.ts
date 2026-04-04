import { ulid } from 'ulid';
import { assembleContext } from './context-assembler.js';
import { buildPrompt } from './prompt-builder.js';
import { enforcePacing } from './pacing-enforcer.js';
import { parseChoices } from './choice-parser.js';
import { detectExplanations } from './explanation-detector.js';
import { streamDialogueText, type StreamChunkCallback } from './ai-client.js';
import {
  sqliteInsertDialogueTurn,
  sqliteInsertChoice,
  sqliteUpdateSession,
  sqliteUpsertKnowledgeEntry,
} from '@renderer/bridge/sqlite-bridge.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { Choice, SceneType } from './types.js';

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

export async function runDialoguePipelineStreaming(
  input: DialoguePipelineStreamInput,
): Promise<DialoguePipelineOutput> {
  const { sessionId, userInput, onChunk, signal } = input;
  const context = await assembleContext(sessionId);
  const { sessionSnapshot, dialogueHistory, knowledgeFlags } = context;

  const assistantTurnCount = dialogueHistory.filter((turn) => turn.role === 'assistant').length;
  const pacing = enforcePacing(sessionSnapshot, assistantTurnCount, false);
  const { systemPrompt, matchedLorebooks } = buildPrompt(context, pacing, userInput);

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

  const modelId = useAppStore.getState().aiModel.trim();
  if (!modelId) {
    throw new Error('dialogue-pipeline: no AI model selected. Configure a runtime model before starting stable dialogue.');
  }

  let generateResult = await streamDialogueText(
    systemPrompt,
    messages,
    modelId,
    onChunk,
    signal,
  );

  let parsed = parseChoices(generateResult.fullText, pacing.nextSceneType);
  if (parsed.isCrisisScene && parsed.choices.length < 2 && !generateResult.interrupted) {
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

    if (parsed.isCrisisScene && parsed.choices.length < 2 && !generateResult.interrupted) {
      throw new Error(
        '[dialogue-pipeline] Crisis scene failed to produce structured A/B choices after retry. ' +
        'SJ-DIAL-005:4 requires fail-close rather than narrative-only degradation.',
      );
    }
  }

  const explanations = detectExplanations(
    generateResult.fullText,
    matchedLorebooks,
    knowledgeFlags,
  );
  const newKnowledgeKeys = explanations.map((entry) => entry.conceptKey);

  const activeProfile = useAppStore.getState().activeProfile;
  if (!activeProfile?.id) {
    throw new Error('dialogue-pipeline: knowledge persistence requires an active learner profile');
  }

  for (const explanation of explanations) {
    const existing = knowledgeFlags.find((flag) => flag.conceptKey === explanation.conceptKey);
    if (!existing) {
      throw new Error(
        `dialogue-pipeline: knowledge concept ${explanation.conceptKey} is missing pre-seeded domain metadata`,
      );
    }
    if (!existing.domain) {
      throw new Error(
        `dialogue-pipeline: knowledge concept ${explanation.conceptKey} is missing a valid domain`,
      );
    }

    await sqliteUpsertKnowledgeEntry({
      id: ulid(),
      learnerId: activeProfile.id,
      worldId: sessionSnapshot.worldId,
      conceptKey: explanation.conceptKey,
      domain: existing.domain,
      depth: explanation.newDepth,
      contentType: sessionSnapshot.contentType,
      truthMode: sessionSnapshot.truthMode,
      firstSeenAt: now,
      updatedAt: now,
    });
  }

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

  for (const choice of parsed.choices) {
    await sqliteInsertChoice({
      id: ulid(),
      sessionId,
      turnId: assistantTurnId,
      choiceKey: choice.key,
      choiceLabel: choice.label,
      choiceDescription: choice.description,
      consequencePreview: choice.consequencePreview,
      selectedAt: '',
    });
  }

  await sqliteUpdateSession({
    id: sessionId,
    sessionStatus: 'active',
    chapterIndex: sessionSnapshot.chapterIndex,
    sceneType: pacing.nextSceneType,
    rhythmCounter: pacing.rhythmCounter,
    trunkEventIndex: sessionSnapshot.trunkEventIndex,
    updatedAt: new Date().toISOString(),
    completedAt: null,
  });

  return {
    assistantText: generateResult.fullText,
    assistantTurnId,
    choices: parsed.choices,
    sceneType: pacing.nextSceneType,
    temporalLabel: '',
    interrupted: generateResult.interrupted,
    newKnowledgeKeys,
  };
}

export async function runDialoguePipeline(
  input: DialoguePipelineInput,
): Promise<DialoguePipelineOutput> {
  return runDialoguePipelineStreaming({
    ...input,
    onChunk: () => {},
  });
}
