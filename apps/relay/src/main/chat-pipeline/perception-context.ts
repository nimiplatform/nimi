// Relay perception context — adapted from local-chat perception-context.ts
// Removed: mod SDK imports
// Adapted: local types, prompt-locale from ../prompt/

import type { InteractionSnapshot, RelationMemorySlot } from './types.js';
import { pt, type PromptLocale } from '../prompt/prompt-locale.js';
import { compactHeadTail } from './text-compaction.js';

const RECENT_TURN_LIMIT = 5;
const RECENT_TURN_PER_ITEM_MAX_CHARS = 360;
const RECENT_TURNS_MAX_CHARS = 2400;

const RELATION_MEMORY_LIMIT = 4;
const RELATION_MEMORY_PER_ITEM_MAX_CHARS = 240;
const RELATION_MEMORY_MAX_CHARS = 1400;

const SNAPSHOT_SECTION_LIMIT = 2;
const SNAPSHOT_ITEM_MAX_CHARS = 160;
const SNAPSHOT_MAX_CHARS = 1200;

const USER_TEXT_MIN_COMPACT_CHARS = 1200;
const FINAL_PROMPT_MAX_CHARS = 9000;

type CascadingReductionStep = 'recentTurns' | 'relationMemory' | 'snapshot' | 'userText' | null;

type SnapshotSections = {
  relationshipLine: string | null;
  emotionalTemperatureLine: string | null;
  topicThreads: string[];
  openLoops: string[];
  userPrefs: string[];
  commitments: string[];
};

export type PerceptionContextBudgetTrace = {
  userTextChars: number;
  promptChars: number;
  recentTurnsChars: number;
  relationMemoryChars: number;
  snapshotChars: number;
  recentTurnsCount: number;
  relationMemoryCount: number;
  snapshotItemCount: number;
  compactionApplied: boolean;
  cascadingReductionStep: CascadingReductionStep;
};

export function buildPerceptionCompactContext(input: {
  userText: string;
  snapshot: InteractionSnapshot | null;
  memorySlots: RelationMemorySlot[];
  recentTurns: Array<{ role: string; text: string }>;
  promptLocale: PromptLocale;
  template: string;
}): {
  promptParts: {
    userText: string;
    recentTurnsContext: string;
    snapshotContext: string;
    memoryContext: string;
  };
  trace: PerceptionContextBudgetTrace;
} {
  let compactionApplied = false;
  let cascadingReductionStep: CascadingReductionStep = null;
  const userText = String(input.userText || '');

  let recentTurns = input.recentTurns
    .slice(-RECENT_TURN_LIMIT)
    .map((turn) => ({
      role: String(turn.role || '').trim() || 'assistant',
      text: compactWithFlag(String(turn.text || ''), RECENT_TURN_PER_ITEM_MAX_CHARS, () => {
        compactionApplied = true;
      }),
    }));

  while (
    recentTurns.length > 0
    && renderRecentTurnsContext(recentTurns, input.promptLocale).length > RECENT_TURNS_MAX_CHARS
  ) {
    recentTurns.shift();
    compactionApplied = true;
  }

  let relationMemory = input.memorySlots
    .slice(0, RELATION_MEMORY_LIMIT)
    .map((slot) =>
      compactWithFlag(
        `- [${slot.id}] (${slot.slotType}) ${slot.key}: ${slot.value}`,
        RELATION_MEMORY_PER_ITEM_MAX_CHARS,
        () => {
          compactionApplied = true;
        },
      ),
    );

  while (
    relationMemory.length > 0
    && renderMemoryContext(relationMemory, input.promptLocale).length > RELATION_MEMORY_MAX_CHARS
  ) {
    relationMemory.pop();
    compactionApplied = true;
  }

  let snapshotSections = input.snapshot
    ? buildSnapshotSections(input.snapshot, input.promptLocale, () => {
        compactionApplied = true;
      })
    : null;

  while (
    snapshotSections
    && renderSnapshotContext(snapshotSections, input.promptLocale).length > SNAPSHOT_MAX_CHARS
  ) {
    if (!reduceSnapshotSection(snapshotSections)) break;
    compactionApplied = true;
  }

  let promptParts = {
    userText,
    recentTurnsContext: renderRecentTurnsContext(recentTurns, input.promptLocale),
    snapshotContext: snapshotSections
      ? renderSnapshotContext(snapshotSections, input.promptLocale)
      : pt(input.promptLocale, 'perception.snapshotNew'),
    memoryContext: renderMemoryContext(relationMemory, input.promptLocale),
  };

  let promptChars = renderPerceptionPrompt(input.template, promptParts).length;

  // ── Cascading reduction ─────────────────────────────────────────
  if (promptChars > FINAL_PROMPT_MAX_CHARS) {
    const currentRecentTurnsChars = promptParts.recentTurnsContext.length;
    const targetRecentTurnsChars = Math.floor(currentRecentTurnsChars / 2);
    while (
      recentTurns.length > 0
      && renderRecentTurnsContext(recentTurns, input.promptLocale).length > targetRecentTurnsChars
    ) {
      recentTurns.shift();
    }
    const nextRecentTurnsContext = renderRecentTurnsContext(recentTurns, input.promptLocale);
    if (nextRecentTurnsContext !== promptParts.recentTurnsContext) {
      promptParts = { ...promptParts, recentTurnsContext: nextRecentTurnsContext };
      compactionApplied = true;
      cascadingReductionStep = 'recentTurns';
      promptChars = renderPerceptionPrompt(input.template, promptParts).length;
    }
  }

  if (promptChars > FINAL_PROMPT_MAX_CHARS) {
    const currentRelationMemoryChars = promptParts.memoryContext.length;
    const targetRelationMemoryChars = Math.floor(currentRelationMemoryChars / 2);
    while (
      relationMemory.length > 0
      && renderMemoryContext(relationMemory, input.promptLocale).length > targetRelationMemoryChars
    ) {
      relationMemory.pop();
    }
    const nextMemoryContext = renderMemoryContext(relationMemory, input.promptLocale);
    if (nextMemoryContext !== promptParts.memoryContext) {
      promptParts = { ...promptParts, memoryContext: nextMemoryContext };
      compactionApplied = true;
      cascadingReductionStep = 'relationMemory';
      promptChars = renderPerceptionPrompt(input.template, promptParts).length;
    }
  }

  if (promptChars > FINAL_PROMPT_MAX_CHARS && snapshotSections) {
    const currentSnapshotChars = promptParts.snapshotContext.length;
    const targetSnapshotChars = Math.floor(currentSnapshotChars / 2);
    while (
      renderSnapshotContext(snapshotSections, input.promptLocale).length > targetSnapshotChars
    ) {
      if (!reduceSnapshotSection(snapshotSections)) break;
    }
    const nextSnapshotContext = renderSnapshotContext(snapshotSections, input.promptLocale);
    if (nextSnapshotContext !== promptParts.snapshotContext) {
      promptParts = { ...promptParts, snapshotContext: nextSnapshotContext };
      compactionApplied = true;
      cascadingReductionStep = 'snapshot';
      promptChars = renderPerceptionPrompt(input.template, promptParts).length;
    }
  }

  if (promptChars > FINAL_PROMPT_MAX_CHARS) {
    const currentUserTextChars = promptParts.userText.length;
    const nextUserTextChars = Math.max(
      USER_TEXT_MIN_COMPACT_CHARS,
      Math.floor(currentUserTextChars / 2),
    );
    if (currentUserTextChars > nextUserTextChars) {
      const nextUserText = compactHeadTail(promptParts.userText, nextUserTextChars);
      if (nextUserText !== promptParts.userText) {
        promptParts = { ...promptParts, userText: nextUserText };
        compactionApplied = true;
        cascadingReductionStep = 'userText';
        promptChars = renderPerceptionPrompt(input.template, promptParts).length;
      }
    }
  }

  return {
    promptParts,
    trace: {
      userTextChars: promptParts.userText.length,
      promptChars,
      recentTurnsChars: promptParts.recentTurnsContext.length,
      relationMemoryChars: promptParts.memoryContext.length,
      snapshotChars: promptParts.snapshotContext.length,
      recentTurnsCount: recentTurns.length,
      relationMemoryCount: relationMemory.length,
      snapshotItemCount: snapshotSections
        ? snapshotSections.topicThreads.length
          + snapshotSections.openLoops.length
          + snapshotSections.userPrefs.length
          + snapshotSections.commitments.length
        : 0,
      compactionApplied,
      cascadingReductionStep,
    },
  };
}

function compactWithFlag(text: string, limit: number, onCompact: () => void): string {
  const normalized = String(text || '');
  if (normalized.length <= limit) return normalized;
  onCompact();
  return compactHeadTail(normalized, limit);
}

function buildSnapshotSections(
  snapshot: InteractionSnapshot,
  locale: PromptLocale,
  onCompact: () => void,
): SnapshotSections {
  return {
    relationshipLine: pt(locale, 'perception.relationship', { value: snapshot.relationshipState }),
    emotionalTemperatureLine: pt(locale, 'perception.emotionalTemp', {
      value: snapshot.emotionalTemperature,
    }),
    topicThreads: snapshot.topicThreads
      .slice(0, SNAPSHOT_SECTION_LIMIT)
      .map((value) =>
        compactWithFlag(
          pt(locale, 'perception.recentTopics', { value }),
          SNAPSHOT_ITEM_MAX_CHARS,
          onCompact,
        ),
      ),
    openLoops: snapshot.openLoops
      .slice(0, SNAPSHOT_SECTION_LIMIT)
      .map((value) =>
        compactWithFlag(
          pt(locale, 'perception.openLoops', { value }),
          SNAPSHOT_ITEM_MAX_CHARS,
          onCompact,
        ),
      ),
    userPrefs: snapshot.userPrefs
      .slice(0, SNAPSHOT_SECTION_LIMIT)
      .map((value) =>
        compactWithFlag(
          pt(locale, 'perception.userPrefs', { value }),
          SNAPSHOT_ITEM_MAX_CHARS,
          onCompact,
        ),
      ),
    commitments: snapshot.assistantCommitments
      .slice(0, SNAPSHOT_SECTION_LIMIT)
      .map((value) =>
        compactWithFlag(
          pt(locale, 'perception.commitments', { value }),
          SNAPSHOT_ITEM_MAX_CHARS,
          onCompact,
        ),
      ),
  };
}

function renderRecentTurnsContext(
  recentTurns: Array<{ role: string; text: string }>,
  locale: PromptLocale,
): string {
  if (recentTurns.length === 0) return pt(locale, 'perception.turnsNone');
  const lines = recentTurns.map((turn) => `- ${turn.role}: ${turn.text}`);
  return `${pt(locale, 'perception.turnsHeader')}\n${lines.join('\n')}`;
}

function renderMemoryContext(memoryLines: string[], locale: PromptLocale): string {
  if (memoryLines.length === 0) return pt(locale, 'perception.memoryNone');
  return `${pt(locale, 'perception.memoryHeader')}\n${memoryLines.join('\n')}`;
}

function renderSnapshotContext(snapshotSections: SnapshotSections, locale: PromptLocale): string {
  const lines = [
    snapshotSections.relationshipLine,
    snapshotSections.emotionalTemperatureLine,
    ...snapshotSections.topicThreads,
    ...snapshotSections.openLoops,
    ...snapshotSections.userPrefs,
    ...snapshotSections.commitments,
  ].filter(Boolean);
  return `${pt(locale, 'perception.snapshotPrefix')}\n${lines.join('\n')}`;
}

function renderPerceptionPrompt(
  template: string,
  promptParts: {
    userText: string;
    recentTurnsContext: string;
    snapshotContext: string;
    memoryContext: string;
  },
): string {
  return template
    .replace('{userText}', promptParts.userText)
    .replace('{recentTurnsContext}', promptParts.recentTurnsContext)
    .replace('{snapshotContext}', promptParts.snapshotContext)
    .replace('{memoryContext}', promptParts.memoryContext);
}

function reduceSnapshotSection(snapshotSections: SnapshotSections): boolean {
  if (snapshotSections.topicThreads.length > 0) {
    snapshotSections.topicThreads.pop();
    return true;
  }
  if (snapshotSections.openLoops.length > 0) {
    snapshotSections.openLoops.pop();
    return true;
  }
  if (snapshotSections.userPrefs.length > 0) {
    snapshotSections.userPrefs.pop();
    return true;
  }
  if (snapshotSections.commitments.length > 0) {
    snapshotSections.commitments.pop();
    return true;
  }
  return false;
}
