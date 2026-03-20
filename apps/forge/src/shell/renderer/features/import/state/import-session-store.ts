/**
 * Import Session Store — Zustand store for both import pipelines
 *
 * Manages the unified state for Character Card V2 and Novel import flows.
 * Novel import state persists to localStorage for crash recovery.
 */

import { create } from 'zustand';
import { updateConflictResolution } from './novel-accumulator.js';

import type {
  ImportSessionState,
  CardImportStep,
  TavernCardV2,
  ValidationResult,
  LocalAgentRuleDraft,
  LocalWorldRuleDraft,
  NovelImportState,
  NovelImportMode,
  NovelAccumulatorState,
  ChapterExtractionArtifact,
  ConflictEntry,
  CharacterCardSourceManifest,
  NovelSourceManifest,
  LorebookClassification,
} from '../types.js';

function generateSessionId(): string {
  // Simple ULID-like ID using timestamp + random
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `imp_${timestamp}_${random}`;
}

function createInitialCardImport(): ImportSessionState['cardImport'] {
  return {
    card: null,
    sourceManifest: null,
    validation: null,
    mappedAgentRules: [],
    mappedWorldRules: [],
    step: 'IDLE',
  };
}

function createInitialNovelImport(): ImportSessionState['novelImport'] {
  return {
    machineState: 'IDLE',
    mode: 'auto',
    sourceManifest: null,
    accumulator: null,
    currentChapterResult: null,
    progress: { current: 0, total: 0 },
    error: null,
  };
}

const NOVEL_STORAGE_PREFIX = 'nimi:forge:import:novel:';
const NOVEL_IMPORT_STATES: NovelImportState[] = [
  'IDLE',
  'FILE_LOADED',
  'CHUNKING',
  'EXTRACTING',
  'CHAPTER_REVIEW',
  'ACCUMULATING',
  'PAUSED',
  'COMPLETED',
];
const NOVEL_IMPORT_MODES: NovelImportMode[] = ['auto', 'hybrid', 'manual'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeNovelImportState(
  value: unknown,
): ImportSessionState['novelImport'] | null {
  if (!isRecord(value)) {
    return null;
  }
  const progress = isRecord(value.progress) ? value.progress : {};
  const current = Number(progress.current);
  const total = Number(progress.total);
  const machineState = typeof value.machineState === 'string' && NOVEL_IMPORT_STATES.includes(value.machineState as NovelImportState)
    ? value.machineState as NovelImportState
    : 'IDLE';
  const mode = typeof value.mode === 'string' && NOVEL_IMPORT_MODES.includes(value.mode as NovelImportMode)
    ? value.mode as NovelImportMode
    : 'auto';
  return {
    machineState,
    mode,
    sourceManifest: isRecord(value.sourceManifest) ? value.sourceManifest as NovelSourceManifest : null,
    accumulator: isRecord(value.accumulator) ? value.accumulator as NovelAccumulatorState : null,
    currentChapterResult: isRecord(value.currentChapterResult)
      ? value.currentChapterResult as ChapterExtractionArtifact
      : null,
    progress: {
      current: Number.isFinite(current) && current >= 0 ? current : 0,
      total: Number.isFinite(total) && total >= 0 ? total : 0,
    },
    error: typeof value.error === 'string' ? value.error : null,
  };
}

type ImportSessionActions = {
  // Session lifecycle
  startCardImportSession: () => void;
  startNovelImportSession: () => void;
  resetSession: () => void;

  // Card import actions
  setCardParsed: (
    card: TavernCardV2 | null,
    validation: ValidationResult,
    sourceManifest?: CharacterCardSourceManifest | null,
  ) => void;
  setCardMapped: (agentRules: LocalAgentRuleDraft[], worldRules: LocalWorldRuleDraft[]) => void;
  setCardStep: (step: CardImportStep) => void;
  updateCardAgentRule: (index: number, patch: Partial<LocalAgentRuleDraft>) => void;
  updateCardWorldRule: (index: number, patch: Partial<LocalWorldRuleDraft>) => void;
  updateCardEntryClassification: (
    entryIndex: number,
    patch: Partial<LorebookClassification>,
    classificationSource?: CharacterCardSourceManifest['characterBookEntries'][number]['classificationSource'],
  ) => void;

  // Novel import actions
  setNovelState: (state: NovelImportState) => void;
  setNovelMode: (mode: NovelImportMode) => void;
  setNovelManifest: (manifest: NovelSourceManifest | null) => void;
  setNovelAccumulator: (acc: NovelAccumulatorState) => void;
  setNovelProgress: (current: number, total: number) => void;
  setNovelChapterResult: (result: ChapterExtractionArtifact | null) => void;
  setNovelError: (error: string | null) => void;
  updateNovelConflict: (
    conflictIndex: number,
    resolution: ConflictEntry['resolution'],
    mergedStatement?: string,
  ) => void;
  persistNovelSession: () => void;
  restoreNovelSession: (sessionId: string) => boolean;

  // Shared
  setTarget: (worldId: string | null, worldName: string | null) => void;
};

export const useImportSessionStore = create<ImportSessionState & ImportSessionActions>(
  (set, get) => ({
    // ── Initial state ─────────────────────────────────────────
    sessionId: '',
    sessionType: null,
    cardImport: createInitialCardImport(),
    novelImport: createInitialNovelImport(),
    targetWorldId: null,
    targetWorldName: null,

    // ── Session lifecycle ─────────────────────────────────────
    startCardImportSession: () =>
      set({
        sessionId: generateSessionId(),
        sessionType: 'character_card',
        cardImport: createInitialCardImport(),
        novelImport: createInitialNovelImport(),
        targetWorldId: null,
        targetWorldName: null,
      }),

    startNovelImportSession: () =>
      set({
        sessionId: generateSessionId(),
        sessionType: 'novel',
        cardImport: createInitialCardImport(),
        novelImport: createInitialNovelImport(),
        targetWorldId: null,
        targetWorldName: null,
      }),

    resetSession: () =>
      set({
        sessionId: '',
        sessionType: null,
        cardImport: createInitialCardImport(),
        novelImport: createInitialNovelImport(),
        targetWorldId: null,
        targetWorldName: null,
      }),

    // ── Card import actions ───────────────────────────────────
    setCardParsed: (card, validation, sourceManifest = null) =>
      set((state) => ({
        cardImport: {
          ...state.cardImport,
          card,
          sourceManifest,
          validation,
          step: 'PARSED',
        },
      })),

    setCardMapped: (agentRules, worldRules) =>
      set((state) => ({
        cardImport: {
          ...state.cardImport,
          mappedAgentRules: agentRules,
          mappedWorldRules: worldRules,
          step: 'MAPPED',
        },
      })),

    setCardStep: (step) =>
      set((state) => ({
        cardImport: { ...state.cardImport, step },
      })),

    updateCardAgentRule: (index, patch) =>
      set((state) => {
        const rules = [...state.cardImport.mappedAgentRules];
        const current = rules[index];
        if (index >= 0 && index < rules.length && current) {
          rules[index] = { ...current, ...patch };
        }
        return { cardImport: { ...state.cardImport, mappedAgentRules: rules } };
      }),

    updateCardWorldRule: (index, patch) =>
      set((state) => {
        const rules = [...state.cardImport.mappedWorldRules];
        const current = rules[index];
        if (index >= 0 && index < rules.length && current) {
          rules[index] = { ...current, ...patch };
        }
        return { cardImport: { ...state.cardImport, mappedWorldRules: rules } };
      }),

    updateCardEntryClassification: (entryIndex, patch, classificationSource = 'user_override') =>
      set((state) => {
        const manifest = state.cardImport.sourceManifest;
        if (!manifest) {
          return {};
        }

        return {
          cardImport: {
            ...state.cardImport,
            sourceManifest: {
              ...manifest,
              characterBookEntries: manifest.characterBookEntries.map((item) => (
                item.entryIndex === entryIndex
                  ? {
                      ...item,
                      classification: {
                        ...item.classification,
                        ...patch,
                      },
                      classificationSource,
                    }
                  : item
              )),
            },
          },
        };
      }),

    // ── Novel import actions ──────────────────────────────────
    setNovelState: (machineState) =>
      set((state) => ({
        novelImport: { ...state.novelImport, machineState, error: null },
      })),

    setNovelMode: (mode) =>
      set((state) => ({
        novelImport: { ...state.novelImport, mode },
      })),

    setNovelManifest: (sourceManifest) =>
      set((state) => ({
        novelImport: { ...state.novelImport, sourceManifest },
      })),

    setNovelAccumulator: (acc) =>
      set((state) => ({
        novelImport: { ...state.novelImport, accumulator: acc },
      })),

    setNovelProgress: (current, total) =>
      set((state) => ({
        novelImport: { ...state.novelImport, progress: { current, total } },
      })),

    setNovelChapterResult: (result) =>
      set((state) => ({
        novelImport: { ...state.novelImport, currentChapterResult: result },
      })),

    setNovelError: (error) =>
      set((state) => ({
        novelImport: { ...state.novelImport, error, machineState: error ? 'PAUSED' : state.novelImport.machineState },
      })),

    updateNovelConflict: (conflictIndex, resolution, mergedStatement) =>
      set((state) => {
        const acc = state.novelImport.accumulator;
        if (!acc) return {};
        const nextAccumulator = updateConflictResolution(
          acc,
          conflictIndex,
          resolution,
          mergedStatement,
        );
        return {
          novelImport: {
            ...state.novelImport,
            accumulator: nextAccumulator,
          },
        };
      }),

    persistNovelSession: () => {
      const { sessionId, novelImport, targetWorldId, targetWorldName } = get();
      if (!sessionId || !novelImport.accumulator) return;
      try {
        const payload = JSON.stringify({
          sessionId,
          novelImport,
          targetWorldId,
          targetWorldName,
        });
        localStorage.setItem(`${NOVEL_STORAGE_PREFIX}${sessionId}`, payload);
      } catch {
        // localStorage quota exceeded — silently fail
      }
    },

    restoreNovelSession: (sessionId: string) => {
      try {
        const raw = localStorage.getItem(`${NOVEL_STORAGE_PREFIX}${sessionId}`);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) return false;
        const novelImport = sanitizeNovelImportState(parsed.novelImport);
        if (!novelImport) return false;

        set({
          sessionId: typeof parsed.sessionId === 'string' && parsed.sessionId.trim()
            ? parsed.sessionId
            : sessionId,
          sessionType: 'novel',
          novelImport,
          targetWorldId: typeof parsed.targetWorldId === 'string' && parsed.targetWorldId.trim()
            ? parsed.targetWorldId
            : null,
          targetWorldName: typeof parsed.targetWorldName === 'string' && parsed.targetWorldName.trim()
            ? parsed.targetWorldName
            : null,
        });
        return true;
      } catch {
        return false;
      }
    },

    // ── Shared ────────────────────────────────────────────────
    setTarget: (worldId, worldName) =>
      set({ targetWorldId: worldId, targetWorldName: worldName }),
  }),
);
