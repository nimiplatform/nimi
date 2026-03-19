/**
 * Creator World Store (FG-WORLD-005)
 *
 * Forge adaptation of World-Studio's workspace-store.ts.
 * Same snapshot shape (WorldStudioWorkspaceSnapshot), different storage prefix,
 * no mod awareness, no emitWorldStudioLog dependency.
 */

import { create } from 'zustand';
import type {
  EventNodeDraft,
  FinalDraftAccumulator,
  WorldStudioCreateStep,
  WorldStudioSnapshotPatch,
  WorldStudioWorkspaceSnapshot,
} from '@world-engine/contracts.js';
import { cloneDefaultSnapshot } from '@world-engine/state/workspace/defaults.js';
import { syncSnapshot } from '@world-engine/state/workspace/normalize.js';
import { asRecord, loadLocalStorageJson, saveLocalStorageJson } from '@nimiplatform/sdk/mod';

// ── Storage ────────────────────────────────────────────────

const STORAGE_PREFIX = 'nimi:forge:workspace:';

function storageKeyForUser(userId: string): string {
  return `${STORAGE_PREFIX}${String(userId || '').trim()}`;
}

function readSnapshotFromStorage(userId: string): WorldStudioWorkspaceSnapshot | null {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId || typeof window === 'undefined') return null;

  try {
    const parsed = loadLocalStorageJson<Partial<WorldStudioWorkspaceSnapshot> | null>(
      storageKeyForUser(normalizedUserId),
      null,
      (value) => (value && typeof value === 'object' ? (value as Partial<WorldStudioWorkspaceSnapshot>) : null),
    );
    if (!parsed) return null;

    const base = cloneDefaultSnapshot();
    const snapshot: WorldStudioWorkspaceSnapshot = {
      ...base,
      ...parsed,
      panel: { ...base.panel, ...(parsed.panel || {}) },
      selectedCharacters: Array.isArray(parsed.selectedCharacters)
        ? parsed.selectedCharacters.map((item) => String(item || '')).filter(Boolean)
        : [],
      parseJob: { ...base.parseJob, ...(parsed.parseJob || {}) },
      knowledgeGraph: {
        ...base.knowledgeGraph,
        ...(parsed.knowledgeGraph || {}),
        events: normalizeEventsDraft(parsed.eventsDraft || parsed.knowledgeGraph?.events || {}),
      },
      worldPatch: asRecord(parsed.worldPatch),
      worldviewPatch: asRecord(parsed.worldviewPatch),
      ruleTruthDraft: {
        worldRules: Array.isArray(parsed.ruleTruthDraft?.worldRules)
          ? parsed.ruleTruthDraft.worldRules.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
          : [],
        agentRules: Array.isArray(parsed.ruleTruthDraft?.agentRules)
          ? parsed.ruleTruthDraft.agentRules.filter((item): item is { characterName: string; payload: Record<string, unknown> } => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
          : [],
      },
      eventsDraft: normalizeEventsDraft(parsed.eventsDraft || {}),
      lorebooksDraft: normalizeArray(parsed.lorebooksDraft),
      phase1Artifact: parsed.phase1Artifact || null,
      assets: { ...base.assets, ...(parsed.assets || {}) },
      agentSync: {
        ...base.agentSync,
        ...(parsed.agentSync || {}),
        selectedCharacterIds: Array.isArray(parsed.agentSync?.selectedCharacterIds)
          ? parsed.agentSync.selectedCharacterIds.map((item) => String(item || '')).filter(Boolean)
          : [],
        draftsByCharacter: (parsed.agentSync && typeof parsed.agentSync === 'object'
          ? asRecord((parsed.agentSync as { draftsByCharacter?: unknown }).draftsByCharacter)
          : {}) as WorldStudioWorkspaceSnapshot['agentSync']['draftsByCharacter'],
      },
      eventGraphLayout: {
        ...base.eventGraphLayout,
        ...(parsed.eventGraphLayout || {}),
        expandedPrimaryIds: Array.isArray(parsed.eventGraphLayout?.expandedPrimaryIds)
          ? parsed.eventGraphLayout.expandedPrimaryIds.map((item) => String(item || '')).filter(Boolean)
          : [],
      },
      editorSnapshotVersion: String(parsed.editorSnapshotVersion || ''),
      unsavedChangesByPanel: {
        ...base.unsavedChangesByPanel,
        ...(parsed.unsavedChangesByPanel || {}),
      },
      taskState: {
        activeTask: null,
        recentTasks: [],
        expertMode: Boolean(parsed.taskState?.expertMode),
      },
    };

    return syncSnapshot(snapshot);
  } catch {
    return null;
  }
}

function persistSnapshotToStorage(userId: string, snapshot: WorldStudioWorkspaceSnapshot): void {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId || typeof window === 'undefined') return;

  const synced = syncSnapshot(snapshot);
  const {
    worldPatchText: _a,
    worldviewPatchText: _b,
    eventsText: _c,
    lorebooksText: _d,
    ...persistable
  } = synced as WorldStudioWorkspaceSnapshot & {
    worldPatchText?: string;
    worldviewPatchText?: string;
    eventsText?: string;
    lorebooksText?: string;
  };
  saveLocalStorageJson(storageKeyForUser(normalizedUserId), persistable);
}

// ── Helpers ────────────────────────────────────────────────

function normalizeEventsDraft(value: unknown): { primary: EventNodeDraft[]; secondary: EventNodeDraft[] } {
  const record = asRecord(value);
  return {
    primary: Array.isArray(record.primary)
      ? record.primary.filter((item: unknown) => item && typeof item === 'object') as EventNodeDraft[]
      : [],
    secondary: Array.isArray(record.secondary)
      ? record.secondary.filter((item: unknown) => item && typeof item === 'object') as EventNodeDraft[]
      : [],
  };
}

function normalizeArray(value: unknown): WorldStudioWorkspaceSnapshot['lorebooksDraft'] {
  return Array.isArray(value)
    ? value.filter((item: unknown) => item && typeof item === 'object') as WorldStudioWorkspaceSnapshot['lorebooksDraft']
    : [];
}

// ── Store ──────────────────────────────────────────────────

type CreatorWorldStore = {
  snapshot: WorldStudioWorkspaceSnapshot;
  setCreateStep: (step: WorldStudioCreateStep) => void;
  patchSnapshot: (patch: WorldStudioSnapshotPatch) => void;
  patchPanel: (patch: Partial<WorldStudioWorkspaceSnapshot['panel']>) => void;
  hydrateForUser: (userId: string) => void;
  persistForUser: (userId: string) => void;
  resetSnapshot: () => void;
};

export const useCreatorWorldStore = create<CreatorWorldStore>((set, get) => ({
  snapshot: cloneDefaultSnapshot(),

  setCreateStep: (step) =>
    set((state) => ({
      snapshot: { ...state.snapshot, createStep: step },
    })),

  patchSnapshot: (patch) =>
    set((state) => {
      const snapshot = syncSnapshot({
        ...state.snapshot,
        ...patch,
        panel: {
          ...state.snapshot.panel,
          ...(patch.panel || {}),
        },
        parseJob: {
          ...state.snapshot.parseJob,
          ...(patch.parseJob || {}),
        },
        knowledgeGraph: {
          ...state.snapshot.knowledgeGraph,
          ...(patch.knowledgeGraph || {}),
          events: {
            ...state.snapshot.knowledgeGraph.events,
            ...((patch.knowledgeGraph as { events?: { primary?: EventNodeDraft[]; secondary?: EventNodeDraft[] } } | undefined)?.events || {}),
          },
        },
        ruleTruthDraft: {
          worldRules: Array.isArray(patch.ruleTruthDraft?.worldRules)
            ? (patch.ruleTruthDraft.worldRules as WorldStudioWorkspaceSnapshot['ruleTruthDraft']['worldRules'])
            : state.snapshot.ruleTruthDraft.worldRules,
          agentRules: Array.isArray(patch.ruleTruthDraft?.agentRules)
            ? (patch.ruleTruthDraft.agentRules as WorldStudioWorkspaceSnapshot['ruleTruthDraft']['agentRules'])
            : state.snapshot.ruleTruthDraft.agentRules,
        },
        eventsDraft: {
          primary: Array.isArray(patch.eventsDraft?.primary)
            ? (patch.eventsDraft.primary as EventNodeDraft[])
            : state.snapshot.eventsDraft.primary,
          secondary: Array.isArray(patch.eventsDraft?.secondary)
            ? (patch.eventsDraft.secondary as EventNodeDraft[])
            : state.snapshot.eventsDraft.secondary,
        },
        lorebooksDraft: Array.isArray(patch.lorebooksDraft)
          ? (patch.lorebooksDraft as WorldStudioWorkspaceSnapshot['lorebooksDraft'])
          : state.snapshot.lorebooksDraft,
        assets: {
          worldCover: {
            ...state.snapshot.assets.worldCover,
            ...((patch.assets?.worldCover || {}) as Partial<WorldStudioWorkspaceSnapshot['assets']['worldCover']>),
          },
          characterPortraits: {
            ...state.snapshot.assets.characterPortraits,
            ...((patch.assets?.characterPortraits || {}) as WorldStudioWorkspaceSnapshot['assets']['characterPortraits']),
          },
          locationImages: {
            ...state.snapshot.assets.locationImages,
            ...((patch.assets?.locationImages || {}) as WorldStudioWorkspaceSnapshot['assets']['locationImages']),
          },
        },
        agentSync: {
          ...state.snapshot.agentSync,
          ...(patch.agentSync || {}),
          draftsByCharacter: (() => {
            const current = state.snapshot.agentSync.draftsByCharacter;
            const incoming =
              patch.agentSync && typeof patch.agentSync === 'object'
                ? asRecord((patch.agentSync as { draftsByCharacter?: unknown }).draftsByCharacter)
                : null;
            if (!incoming) return current;
            const merged = { ...current };
            Object.entries(incoming).forEach(([name, value]) => {
              const normalizedName = String(name || '').trim();
              if (!normalizedName || !value || typeof value !== 'object') return;
              const record = asRecord(value);
              const previous = merged[normalizedName] || {
                characterName: normalizedName,
                handle: '',
                concept: '',
                backstory: '',
                coreValues: '',
                relationshipStyle: '',
              };
              merged[normalizedName] = {
                ...previous,
                ...record,
                characterName: normalizedName,
                handle: String(record.handle ?? previous.handle ?? ''),
                concept: String(record.concept ?? previous.concept ?? ''),
                backstory: String(record.backstory ?? previous.backstory ?? ''),
                coreValues: String(record.coreValues ?? previous.coreValues ?? ''),
                relationshipStyle: String(record.relationshipStyle ?? previous.relationshipStyle ?? ''),
              };
            });
            return merged;
          })(),
        },
        eventGraphLayout: {
          ...state.snapshot.eventGraphLayout,
          ...(patch.eventGraphLayout || {}),
        },
        embeddingIndex: {
          ...state.snapshot.embeddingIndex,
          ...(patch.embeddingIndex || {}),
          entries: (() => {
            if (!patch.embeddingIndex || typeof patch.embeddingIndex !== 'object') {
              return state.snapshot.embeddingIndex.entries;
            }
            const record = patch.embeddingIndex as { entries?: unknown };
            if (!Object.prototype.hasOwnProperty.call(record, 'entries')) {
              return state.snapshot.embeddingIndex.entries;
            }
            return asRecord(record.entries) as WorldStudioWorkspaceSnapshot['embeddingIndex']['entries'];
          })(),
        },
        finalDraftAccumulator: (() => {
          if (!patch.finalDraftAccumulator || typeof patch.finalDraftAccumulator !== 'object') {
            return state.snapshot.finalDraftAccumulator;
          }
          const incoming = patch.finalDraftAccumulator as Partial<FinalDraftAccumulator>;
          return {
            ...state.snapshot.finalDraftAccumulator,
            ...incoming,
            world:
              incoming.world && typeof incoming.world === 'object'
                ? asRecord(incoming.world)
                : state.snapshot.finalDraftAccumulator.world,
            worldview:
              incoming.worldview && typeof incoming.worldview === 'object'
                ? asRecord(incoming.worldview)
                : state.snapshot.finalDraftAccumulator.worldview,
            worldLorebooks: Array.isArray(incoming.worldLorebooks)
              ? (incoming.worldLorebooks as FinalDraftAccumulator['worldLorebooks'])
              : state.snapshot.finalDraftAccumulator.worldLorebooks,
            futureHistoricalEvents: Array.isArray(incoming.futureHistoricalEvents)
              ? (incoming.futureHistoricalEvents as FinalDraftAccumulator['futureHistoricalEvents'])
              : state.snapshot.finalDraftAccumulator.futureHistoricalEvents,
            agentDraftsByCharacter:
              incoming.agentDraftsByCharacter && typeof incoming.agentDraftsByCharacter === 'object'
                ? (asRecord(incoming.agentDraftsByCharacter) as FinalDraftAccumulator['agentDraftsByCharacter'])
                : state.snapshot.finalDraftAccumulator.agentDraftsByCharacter,
            revisions: Array.isArray(incoming.revisions)
              ? (incoming.revisions as FinalDraftAccumulator['revisions'])
              : state.snapshot.finalDraftAccumulator.revisions,
            lastUpdatedChunk: Number.isInteger(Number(incoming.lastUpdatedChunk))
              ? Number(incoming.lastUpdatedChunk)
              : state.snapshot.finalDraftAccumulator.lastUpdatedChunk,
          };
        })(),
        taskState: {
          ...state.snapshot.taskState,
          ...(patch.taskState || {}),
          recentTasks: Array.isArray(patch.taskState?.recentTasks)
            ? (patch.taskState.recentTasks as WorldStudioWorkspaceSnapshot['taskState']['recentTasks'])
            : state.snapshot.taskState.recentTasks,
        },
        editorSnapshotVersion:
          typeof patch.editorSnapshotVersion === 'string'
            ? patch.editorSnapshotVersion
            : state.snapshot.editorSnapshotVersion,
        unsavedChangesByPanel: {
          ...state.snapshot.unsavedChangesByPanel,
          ...(patch.unsavedChangesByPanel || {}),
        },
        selectedCharacters: Array.isArray(patch.selectedCharacters)
          ? patch.selectedCharacters.map((item) => String(item || '')).filter((item) => item.length > 0)
          : state.snapshot.selectedCharacters,
      });
      return { snapshot };
    }),

  patchPanel: (patch) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        panel: { ...state.snapshot.panel, ...patch },
      },
    })),

  hydrateForUser: (userId) => {
    const loaded = readSnapshotFromStorage(userId);
    if (loaded) {
      set({ snapshot: loaded });
    } else {
      set({ snapshot: cloneDefaultSnapshot() });
    }
  },

  persistForUser: (userId) => {
    persistSnapshotToStorage(userId, get().snapshot);
  },

  resetSnapshot: () => set({ snapshot: cloneDefaultSnapshot() }),
}));
