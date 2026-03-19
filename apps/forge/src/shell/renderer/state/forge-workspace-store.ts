import { create } from 'zustand';
import { canonicalizeHandleSeed } from '@renderer/features/import/engines/rule-key-canonicalizer.js';
import type {
  AgentDraftState,
  CreateWorkspaceInput,
  ForgeImportSessionType,
  ForgePublishPlan,
  ForgeSourceManifest,
  ForgeWorkspace,
  ForgeWorkspacePanel,
  ForgeWorkspaceSnapshot,
  ImportSessionSummary,
  WorkspaceAgentRuleBundle,
  WorkspaceConflictReview,
  WorldDraftState,
} from '@renderer/features/workbench/types.js';
import type {
  ConflictEntry,
  LocalAgentRuleDraft,
  LocalWorldRuleDraft,
  NovelAccumulatorState,
} from '@renderer/features/import/types.js';

const STORAGE_KEY = 'nimi:forge:workbench:v1';

type WorkbenchStoreState = {
  activeWorkspaceId: string | null;
  workspaces: Record<string, ForgeWorkspaceSnapshot>;
  orderedWorkspaceIds: string[];
};

type CharacterCardReviewPayload = {
  sessionId: string;
  sourceFile: string;
  importedAt: string;
  characterName: string;
  sourceManifest: ForgeSourceManifest;
  agentRules: LocalAgentRuleDraft[];
  worldRules: LocalWorldRuleDraft[];
};

type NovelReviewPayload = {
  sessionId: string;
  sourceFile: string;
  importedAt: string;
  sourceManifest: ForgeSourceManifest;
  accumulator: NovelAccumulatorState;
  worldRules: LocalWorldRuleDraft[];
  agentBundles: Array<{ characterName: string; rules: LocalAgentRuleDraft[] }>;
};

type WorkbenchStoreActions = {
  reset: () => void;
  createWorkspace: (input?: CreateWorkspaceInput) => string;
  ensureWorkspaceForWorld: (input: {
    worldId: string;
    title: string;
    description?: string | null;
  }) => string;
  ensureWorkspaceForDraft: (input: {
    draftId: string;
    title: string;
    description?: string | null;
    targetWorldId?: string | null;
  }) => string;
  removeWorkspace: (workspaceId: string) => void;
  setActiveWorkspace: (workspaceId: string | null) => void;
  setWorkspacePanel: (workspaceId: string, panel: ForgeWorkspacePanel) => void;
  patchWorkspace: (
    workspaceId: string,
    patch: Partial<ForgeWorkspace>,
  ) => void;
  patchWorldDraft: (
    workspaceId: string,
    patch: Partial<WorldDraftState>,
  ) => void;
  upsertImportSession: (
    workspaceId: string,
    summary: ImportSessionSummary,
  ) => void;
  saveSourceManifest: (
    workspaceId: string,
    ref: string,
    manifest: ForgeSourceManifest,
  ) => void;
  applyCharacterCardReviewDraft: (
    workspaceId: string,
    payload: CharacterCardReviewPayload,
  ) => string;
  applyNovelReviewDraft: (
    workspaceId: string,
    payload: NovelReviewPayload,
  ) => void;
  updateReviewWorldRule: (
    workspaceId: string,
    index: number,
    patch: Partial<LocalWorldRuleDraft>,
  ) => void;
  updateReviewAgentRule: (
    workspaceId: string,
    draftAgentId: string,
    index: number,
    patch: Partial<LocalAgentRuleDraft>,
  ) => void;
  updateAgentDraft: (
    workspaceId: string,
    draftAgentId: string,
    patch: Partial<AgentDraftState>,
  ) => void;
  attachMasterAgentClone: (
    workspaceId: string,
    input: {
      masterAgentId: string;
      displayName: string;
      handle: string;
      concept: string;
    },
  ) => string;
  ensureWorldAgentDraft: (
    workspaceId: string,
    input: {
      sourceAgentId: string;
      displayName: string;
      handle: string;
      concept: string;
      worldId: string | null;
    },
  ) => string;
  buildPublishPlan: (workspaceId: string) => ForgePublishPlan | null;
  markPublished: (
    workspaceId: string,
    input: {
      worldId: string | null;
      draftAgentIdMap?: Record<string, string>;
    },
  ) => void;
};

function nowIso(): string {
  return new Date().toISOString();
}

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${timestamp}_${random}`;
}

function createEmptyReviewState(): ForgeWorkspaceSnapshot['reviewState'] {
  return {
    worldRules: [],
    agentBundles: [],
    conflicts: [],
    hasPendingConflicts: false,
    hasUnmappedCharacters: false,
    hasUnreviewedImports: false,
    notes: [],
  };
}

function createWorkspaceSnapshot(input?: CreateWorkspaceInput): ForgeWorkspaceSnapshot {
  const workspaceId = generateId('ws');
  const title = input?.title?.trim()
    || input?.worldName?.trim()
    || 'Untitled Workspace';
  const worldId = input?.worldId ?? null;
  const draftId = input?.draftId ?? null;
  return {
    workspace: {
      workspaceId,
      mode: input?.mode ?? (worldId ? 'EXISTING_WORLD' : 'NEW_WORLD'),
      worldRef: { worldId, draftId },
      title,
      lifecycle: 'DRAFT',
      sourceManifestRefs: [],
      selectedAgentIds: [],
      activePanel: 'OVERVIEW',
    },
    worldDraft: {
      worldId,
      draftId,
      name: input?.worldName?.trim() || title,
      description: input?.worldDescription?.trim() || '',
      sourceType: 'MANUAL',
    },
    agentDrafts: {},
    importSessions: [],
    sourceManifests: {},
    publishPlan: null,
    reviewState: createEmptyReviewState(),
    updatedAt: nowIso(),
  };
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function persistState(state: WorkbenchStoreState) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function restoreState(): WorkbenchStoreState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { activeWorkspaceId: null, workspaces: {}, orderedWorkspaceIds: [] };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { activeWorkspaceId: null, workspaces: {}, orderedWorkspaceIds: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkbenchStoreState>;
    return {
      activeWorkspaceId: typeof parsed.activeWorkspaceId === 'string'
        ? parsed.activeWorkspaceId
        : null,
      workspaces: parsed.workspaces && typeof parsed.workspaces === 'object'
        ? parsed.workspaces as WorkbenchStoreState['workspaces']
        : {},
      orderedWorkspaceIds: Array.isArray(parsed.orderedWorkspaceIds)
        ? parsed.orderedWorkspaceIds.filter((value): value is string => typeof value === 'string')
        : [],
    };
  } catch {
    return { activeWorkspaceId: null, workspaces: {}, orderedWorkspaceIds: [] };
  }
}

function touchWorkspace(
  snapshot: ForgeWorkspaceSnapshot,
  patch?: Partial<ForgeWorkspaceSnapshot>,
): ForgeWorkspaceSnapshot {
  return {
    ...snapshot,
    ...patch,
    updatedAt: nowIso(),
  };
}

function toConflictReview(sessionId: string, conflict: ConflictEntry): WorkspaceConflictReview {
  return {
    sessionId,
    ruleKey: conflict.ruleKey,
    characterName: conflict.characterName,
    previousStatement: conflict.previousStatement,
    newStatement: conflict.newStatement,
    resolution: conflict.resolution,
    mergedStatement: conflict.mergedStatement,
  };
}

function buildSessionSummary(input: {
  sessionId: string;
  sessionType: ForgeImportSessionType;
  sourceFile: string;
  status: ImportSessionSummary['status'];
  unresolvedConflicts?: number;
  importedAt?: string;
}): ImportSessionSummary {
  return {
    sessionId: input.sessionId,
    sessionType: input.sessionType,
    sourceFile: input.sourceFile,
    sourceManifestRef: input.sessionId,
    status: input.status,
    unresolvedConflicts: input.unresolvedConflicts ?? 0,
    lastUpdatedAt: input.importedAt ?? nowIso(),
  };
}

function findBundleIndex(
  bundles: WorkspaceAgentRuleBundle[],
  draftAgentId: string,
): number {
  return bundles.findIndex((bundle) => bundle.draftAgentId === draftAgentId);
}

function updateWorkspaceRecord(
  state: WorkbenchStoreState,
  workspaceId: string,
  updater: (snapshot: ForgeWorkspaceSnapshot) => ForgeWorkspaceSnapshot,
): WorkbenchStoreState {
  const existing = state.workspaces[workspaceId];
  if (!existing) {
    return state;
  }
  const nextWorkspace = updater(cloneState(existing));
  const nextState = {
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspaceId]: nextWorkspace,
    },
  };
  persistState(nextState);
  return nextState;
}

function computeReviewFlags(snapshot: ForgeWorkspaceSnapshot): ForgeWorkspaceSnapshot['reviewState'] {
  const hasPendingConflicts = snapshot.reviewState.conflicts.some(
    (conflict) => conflict.resolution === 'UNRESOLVED',
  );
  const hasUnmappedCharacters = snapshot.reviewState.agentBundles.some((bundle) => {
    const agentDraft = snapshot.agentDrafts[bundle.draftAgentId];
    return !agentDraft || agentDraft.ownershipType !== 'WORLD_OWNED';
  });
  return {
    ...snapshot.reviewState,
    hasPendingConflicts,
    hasUnmappedCharacters,
    hasUnreviewedImports: false,
  };
}

export const useForgeWorkspaceStore = create<WorkbenchStoreState & WorkbenchStoreActions>((set, get) => ({
  ...restoreState(),

  reset: () => {
    const nextState: WorkbenchStoreState = {
      activeWorkspaceId: null,
      workspaces: {},
      orderedWorkspaceIds: [],
    };
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    set(nextState);
  },

  createWorkspace: (input = {}) => {
    const snapshot = createWorkspaceSnapshot(input);
    const nextState = {
      ...get(),
      activeWorkspaceId: snapshot.workspace.workspaceId,
      workspaces: {
        ...get().workspaces,
        [snapshot.workspace.workspaceId]: snapshot,
      },
      orderedWorkspaceIds: [
        snapshot.workspace.workspaceId,
        ...get().orderedWorkspaceIds.filter((id) => id !== snapshot.workspace.workspaceId),
      ],
    };
    persistState(nextState);
    set(nextState);
    return snapshot.workspace.workspaceId;
  },

  ensureWorkspaceForWorld: ({ worldId, title, description }) => {
    const existing = Object.values(get().workspaces).find(
      (workspace) => workspace.workspace.worldRef.worldId === worldId,
    );
    if (existing) {
      get().setActiveWorkspace(existing.workspace.workspaceId);
      return existing.workspace.workspaceId;
    }
    return get().createWorkspace({
      mode: 'EXISTING_WORLD',
      title,
      worldId,
      worldName: title,
      worldDescription: description ?? '',
    });
  },

  ensureWorkspaceForDraft: ({ draftId, title, description, targetWorldId }) => {
    const existing = Object.values(get().workspaces).find(
      (workspace) => workspace.workspace.worldRef.draftId === draftId,
    );
    if (existing) {
      get().setActiveWorkspace(existing.workspace.workspaceId);
      return existing.workspace.workspaceId;
    }
    return get().createWorkspace({
      mode: targetWorldId ? 'EXISTING_WORLD' : 'NEW_WORLD',
      title,
      draftId,
      worldId: targetWorldId ?? null,
      worldName: title,
      worldDescription: description ?? '',
    });
  },

  removeWorkspace: (workspaceId) => {
    const current = get();
    const nextWorkspaces = { ...current.workspaces };
    delete nextWorkspaces[workspaceId];
    const nextState = {
      ...current,
      activeWorkspaceId: current.activeWorkspaceId === workspaceId
        ? (current.orderedWorkspaceIds.find((id) => id !== workspaceId) ?? null)
        : current.activeWorkspaceId,
      workspaces: nextWorkspaces,
      orderedWorkspaceIds: current.orderedWorkspaceIds.filter((id) => id !== workspaceId),
    };
    persistState(nextState);
    set(nextState);
  },

  setActiveWorkspace: (workspaceId) => {
    const nextState = {
      ...get(),
      activeWorkspaceId: workspaceId,
      orderedWorkspaceIds: workspaceId
        ? [workspaceId, ...get().orderedWorkspaceIds.filter((id) => id !== workspaceId)]
        : get().orderedWorkspaceIds,
    };
    persistState(nextState);
    set(nextState);
  },

  setWorkspacePanel: (workspaceId, panel) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => touchWorkspace(snapshot, {
    workspace: {
      ...snapshot.workspace,
      activePanel: panel,
    },
  }))),

  patchWorkspace: (workspaceId, patch) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => touchWorkspace(snapshot, {
    workspace: {
      ...snapshot.workspace,
      ...patch,
    },
  }))),

  patchWorldDraft: (workspaceId, patch) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => touchWorkspace(snapshot, {
    worldDraft: {
      ...snapshot.worldDraft,
      ...patch,
    },
    workspace: {
      ...snapshot.workspace,
      title: patch.name?.trim() || snapshot.workspace.title,
      worldRef: {
        worldId: patch.worldId ?? snapshot.workspace.worldRef.worldId,
        draftId: patch.draftId ?? snapshot.workspace.worldRef.draftId,
      },
    },
  }))),

  upsertImportSession: (workspaceId, summary) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
    const existingIndex = snapshot.importSessions.findIndex((item) => item.sessionId === summary.sessionId);
    const nextImportSessions = existingIndex >= 0
      ? snapshot.importSessions.map((item, index) => (index === existingIndex ? summary : item))
      : [summary, ...snapshot.importSessions];
    const nextSnapshot = touchWorkspace(snapshot, {
      importSessions: nextImportSessions,
    });
    nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
    return nextSnapshot;
  })),

  saveSourceManifest: (workspaceId, ref, manifest) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
    const nextRefs = snapshot.workspace.sourceManifestRefs.includes(ref)
      ? snapshot.workspace.sourceManifestRefs
      : [...snapshot.workspace.sourceManifestRefs, ref];
    return touchWorkspace(snapshot, {
      sourceManifests: {
        ...snapshot.sourceManifests,
        [ref]: manifest,
      },
      workspace: {
        ...snapshot.workspace,
        sourceManifestRefs: nextRefs,
      },
    });
  })),

  applyCharacterCardReviewDraft: (workspaceId, payload) => {
    const draftAgentId = generateId('draft_agent');
    set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
      const sessionSummary = buildSessionSummary({
        sessionId: payload.sessionId,
        sessionType: 'character_card',
        sourceFile: payload.sourceFile,
        status: 'REVIEWED',
        importedAt: payload.importedAt,
      });
      const nextAgentDraft: AgentDraftState = {
        draftAgentId,
        sourceAgentId: null,
        originMasterAgentId: null,
        displayName: payload.characterName,
        handle: canonicalizeHandleSeed(payload.characterName),
        concept: payload.agentRules[0]?.statement.slice(0, 200) ?? payload.characterName,
        ownershipType: 'WORLD_OWNED',
        worldId: snapshot.worldDraft.worldId,
        status: 'DRAFT',
        source: 'IMPORT',
        characterName: payload.characterName,
        sessionId: payload.sessionId,
      };

      const nextSnapshot = touchWorkspace(snapshot, {
        workspace: {
          ...snapshot.workspace,
          lifecycle: 'REVIEWING',
          activePanel: 'REVIEW',
          selectedAgentIds: [...snapshot.workspace.selectedAgentIds, draftAgentId],
          sourceManifestRefs: snapshot.workspace.sourceManifestRefs.includes(payload.sessionId)
            ? snapshot.workspace.sourceManifestRefs
            : [...snapshot.workspace.sourceManifestRefs, payload.sessionId],
        },
        worldDraft: {
          ...snapshot.worldDraft,
          sourceType: snapshot.worldDraft.sourceType === 'MANUAL'
            ? 'CHARACTER_CARD'
            : snapshot.worldDraft.sourceType === 'NOVEL'
              ? 'MIXED'
              : snapshot.worldDraft.sourceType,
          name: snapshot.worldDraft.name || payload.characterName,
        },
        agentDrafts: {
          ...snapshot.agentDrafts,
          [draftAgentId]: nextAgentDraft,
        },
        importSessions: [
          sessionSummary,
          ...snapshot.importSessions.filter((item) => item.sessionId !== payload.sessionId),
        ],
        sourceManifests: {
          ...snapshot.sourceManifests,
          [payload.sessionId]: payload.sourceManifest,
        },
        reviewState: {
          ...snapshot.reviewState,
          worldRules: payload.worldRules,
          agentBundles: [{
            draftAgentId,
            characterName: payload.characterName,
            sourceSessionId: payload.sessionId,
            rules: payload.agentRules,
          }],
          conflicts: [],
          notes: [],
        },
      });
      nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
      return nextSnapshot;
    }));
    return draftAgentId;
  },

  applyNovelReviewDraft: (workspaceId, payload) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
    const sessionSummary = buildSessionSummary({
      sessionId: payload.sessionId,
      sessionType: 'novel',
      sourceFile: payload.sourceFile,
      status: 'REVIEWED',
      unresolvedConflicts: payload.accumulator.conflicts.filter((item) => item.resolution === 'UNRESOLVED').length,
      importedAt: payload.importedAt,
    });

    const nextAgentDrafts = { ...snapshot.agentDrafts };
    const nextAgentBundles: WorkspaceAgentRuleBundle[] = payload.agentBundles.map((bundle) => {
      const existingDraft = Object.values(nextAgentDrafts).find(
        (draft) => draft.characterName === bundle.characterName,
      );
      const draftAgentId = existingDraft?.draftAgentId ?? generateId('draft_agent');
      if (!existingDraft) {
        nextAgentDrafts[draftAgentId] = {
          draftAgentId,
          sourceAgentId: null,
          originMasterAgentId: null,
          displayName: bundle.characterName,
          handle: canonicalizeHandleSeed(bundle.characterName),
          concept: bundle.rules[0]?.statement.slice(0, 200) ?? bundle.characterName,
          ownershipType: 'WORLD_OWNED',
          worldId: snapshot.worldDraft.worldId,
          status: 'DRAFT',
          source: 'IMPORT',
          characterName: bundle.characterName,
          sessionId: payload.sessionId,
        };
      }
      return {
        draftAgentId,
        characterName: bundle.characterName,
        sourceSessionId: payload.sessionId,
        rules: bundle.rules,
      };
    });

    const selectedAgentIds = [
      ...new Set([
        ...snapshot.workspace.selectedAgentIds,
        ...nextAgentBundles.map((bundle) => bundle.draftAgentId),
      ]),
    ];

    const nextSnapshot = touchWorkspace(snapshot, {
      workspace: {
        ...snapshot.workspace,
        lifecycle: 'REVIEWING',
        activePanel: 'REVIEW',
        selectedAgentIds,
        sourceManifestRefs: snapshot.workspace.sourceManifestRefs.includes(payload.sessionId)
          ? snapshot.workspace.sourceManifestRefs
          : [...snapshot.workspace.sourceManifestRefs, payload.sessionId],
      },
      worldDraft: {
        ...snapshot.worldDraft,
        sourceType: snapshot.worldDraft.sourceType === 'MANUAL'
          ? 'NOVEL'
          : snapshot.worldDraft.sourceType === 'CHARACTER_CARD'
            ? 'MIXED'
            : snapshot.worldDraft.sourceType,
        name: snapshot.worldDraft.name || payload.sourceFile.replace(/\.[^.]+$/, ''),
      },
      agentDrafts: nextAgentDrafts,
      importSessions: [
        sessionSummary,
        ...snapshot.importSessions.filter((item) => item.sessionId !== payload.sessionId),
      ],
      sourceManifests: {
        ...snapshot.sourceManifests,
        [payload.sessionId]: payload.sourceManifest,
      },
      reviewState: {
        ...snapshot.reviewState,
        worldRules: payload.worldRules,
        agentBundles: nextAgentBundles,
        conflicts: payload.accumulator.conflicts.map((conflict) => toConflictReview(payload.sessionId, conflict)),
        notes: [],
      },
    });
    nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
    return nextSnapshot;
  })),

  updateReviewWorldRule: (workspaceId, index, patch) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
    const nextWorldRules = [...snapshot.reviewState.worldRules];
    const current = nextWorldRules[index];
    if (current) {
      nextWorldRules[index] = { ...current, ...patch };
    }
    const nextSnapshot = touchWorkspace(snapshot, {
      reviewState: {
        ...snapshot.reviewState,
        worldRules: nextWorldRules,
      },
    });
    nextSnapshot.publishPlan = null;
    nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
    return nextSnapshot;
  })),

  updateReviewAgentRule: (workspaceId, draftAgentId, index, patch) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
    const nextBundles = snapshot.reviewState.agentBundles.map((bundle) => {
      if (bundle.draftAgentId !== draftAgentId) {
        return bundle;
      }
      const nextRules = [...bundle.rules];
      const current = nextRules[index];
      if (current) {
        nextRules[index] = { ...current, ...patch };
      }
      return { ...bundle, rules: nextRules };
    });
    const nextSnapshot = touchWorkspace(snapshot, {
      reviewState: {
        ...snapshot.reviewState,
        agentBundles: nextBundles,
      },
    });
    nextSnapshot.publishPlan = null;
    nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
    return nextSnapshot;
  })),

  updateAgentDraft: (workspaceId, draftAgentId, patch) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
    const current = snapshot.agentDrafts[draftAgentId];
    if (!current) {
      return snapshot;
    }
    const nextSnapshot = touchWorkspace(snapshot, {
      agentDrafts: {
        ...snapshot.agentDrafts,
        [draftAgentId]: {
          ...current,
          ...patch,
        },
      },
    });
    nextSnapshot.publishPlan = null;
    nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
    return nextSnapshot;
  })),

  attachMasterAgentClone: (workspaceId, input) => {
    const draftAgentId = generateId('draft_agent');
    set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
      const nextSnapshot = touchWorkspace(snapshot, {
        workspace: {
          ...snapshot.workspace,
          activePanel: 'AGENTS',
          selectedAgentIds: [...snapshot.workspace.selectedAgentIds, draftAgentId],
        },
        agentDrafts: {
          ...snapshot.agentDrafts,
          [draftAgentId]: {
            draftAgentId,
            sourceAgentId: null,
            originMasterAgentId: input.masterAgentId,
            displayName: input.displayName,
            handle: input.handle,
            concept: input.concept,
            ownershipType: 'WORLD_OWNED',
            worldId: snapshot.worldDraft.worldId,
            status: 'DRAFT',
            source: 'MASTER_LIBRARY',
            characterName: input.displayName,
            sessionId: null,
          },
        },
      });
      nextSnapshot.publishPlan = null;
      nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
      return nextSnapshot;
    }));
    return draftAgentId;
  },

  ensureWorldAgentDraft: (workspaceId, input) => {
    const existing = Object.values(get().workspaces[workspaceId]?.agentDrafts || {}).find(
      (draft) => draft.sourceAgentId === input.sourceAgentId,
    );
    if (existing) {
      return existing.draftAgentId;
    }
    const draftAgentId = generateId('draft_agent');
    set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
      const nextSnapshot = touchWorkspace(snapshot, {
        workspace: {
          ...snapshot.workspace,
          activePanel: 'AGENTS',
          selectedAgentIds: [...snapshot.workspace.selectedAgentIds, draftAgentId],
        },
        agentDrafts: {
          ...snapshot.agentDrafts,
          [draftAgentId]: {
            draftAgentId,
            sourceAgentId: input.sourceAgentId,
            originMasterAgentId: null,
            displayName: input.displayName,
            handle: input.handle,
            concept: input.concept,
            ownershipType: 'WORLD_OWNED',
            worldId: input.worldId,
            status: 'LINKED',
            source: 'WORLD_LIBRARY',
            characterName: input.displayName,
            sessionId: null,
          },
        },
      });
      nextSnapshot.publishPlan = null;
      nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
      return nextSnapshot;
    }));
    return draftAgentId;
  },

  buildPublishPlan: (workspaceId) => {
    const snapshot = get().workspaces[workspaceId];
    if (!snapshot) {
      return null;
    }

    const reviewState = computeReviewFlags(snapshot);
    const plan: ForgePublishPlan = {
      workspaceId,
      worldAction: snapshot.worldDraft.worldId ? 'UPDATE' : 'CREATE',
      agents: Object.values(snapshot.agentDrafts)
        .filter((draft) => draft.ownershipType === 'WORLD_OWNED')
        .map((draft) => ({
          draftAgentId: draft.draftAgentId,
          action: draft.sourceAgentId ? 'UPDATE_WORLD_AGENT' : 'CREATE_WORLD_AGENT',
          sourceAgentId: draft.sourceAgentId,
          displayName: draft.displayName,
          handle: draft.handle,
          concept: draft.concept,
        })),
      worldRules: snapshot.reviewState.worldRules,
      agentRules: snapshot.reviewState.agentBundles.map((bundle) => ({
        draftAgentId: bundle.draftAgentId,
        agentId: snapshot.agentDrafts[bundle.draftAgentId]?.sourceAgentId ?? null,
        characterName: bundle.characterName,
        rules: bundle.rules,
      })),
      sourceManifestPolicy: 'LOCAL_ONLY',
    };

    set((state) => updateWorkspaceRecord(state, workspaceId, (current) => {
      const nextLifecycle = reviewState.hasPendingConflicts
        ? 'REVIEWING'
        : 'READY_TO_PUBLISH';
      return touchWorkspace(current, {
        publishPlan: plan,
        workspace: {
          ...current.workspace,
          lifecycle: nextLifecycle,
          activePanel: 'PUBLISH',
        },
        reviewState,
      });
    }));

    return plan;
  },

  markPublished: (workspaceId, input) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) => {
    const nextAgentDrafts = Object.fromEntries(
      Object.entries(snapshot.agentDrafts).map(([draftAgentId, draft]) => [
        draftAgentId,
        {
          ...draft,
          sourceAgentId: input.draftAgentIdMap?.[draftAgentId] ?? draft.sourceAgentId,
          worldId: input.worldId ?? draft.worldId,
          status: 'PUBLISHED' as const,
        },
      ]),
    ) as Record<string, AgentDraftState>;

    const nextSnapshot = touchWorkspace(snapshot, {
      worldDraft: {
        ...snapshot.worldDraft,
        worldId: input.worldId,
      },
      agentDrafts: nextAgentDrafts,
      publishPlan: snapshot.publishPlan,
      workspace: {
        ...snapshot.workspace,
        lifecycle: 'PUBLISHED',
        activePanel: 'OVERVIEW',
        worldRef: {
          worldId: input.worldId,
          draftId: snapshot.workspace.worldRef.draftId,
        },
      },
    });
    nextSnapshot.reviewState = computeReviewFlags(nextSnapshot);
    return nextSnapshot;
  })),
}));
