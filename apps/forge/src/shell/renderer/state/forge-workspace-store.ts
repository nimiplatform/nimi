import { create } from 'zustand';
import type {
  AgentDraftState,
  CreateWorkspaceInput,
  ForgePublishPlan,
  ForgeSourceManifest,
  ForgeWorkspace,
  ForgeWorkspacePanel,
  ImportSessionSummary,
  WorkspaceAgentRuleBundle,
  WorldDraftState,
} from '@renderer/features/workbench/types.js';
import type {
  LocalAgentRuleDraft,
  LocalWorldRuleDraft,
} from '@renderer/features/import/types.js';
import {
  STORAGE_KEY,
  computeReviewFlags,
  createCharacterCardReviewSnapshot,
  createNovelReviewSnapshot,
  createWorkspaceSnapshot,
  generateId,
  persistState,
  restoreState,
  touchWorkspace,
  updateWorkspaceRecord,
  type CharacterCardReviewPayload,
  type NovelReviewPayload,
  type WorkbenchStoreState,
} from './forge-workspace-store-helpers.js';

function getWindowStorage(): Pick<Storage, 'removeItem'> | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const storage = window.localStorage;
  if (!storage || typeof storage.removeItem !== 'function') {
    return null;
  }
  return storage;
}

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

function findBundleIndex(
  bundles: WorkspaceAgentRuleBundle[],
  draftAgentId: string,
): number {
  return bundles.findIndex((bundle) => bundle.draftAgentId === draftAgentId);
}

export const useForgeWorkspaceStore = create<WorkbenchStoreState & WorkbenchStoreActions>((set, get) => ({
  ...restoreState(),

  reset: () => {
    const nextState: WorkbenchStoreState = {
      activeWorkspaceId: null,
      workspaces: {},
      orderedWorkspaceIds: [],
    };
    const storage = getWindowStorage();
    if (storage) {
      storage.removeItem(STORAGE_KEY);
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
    set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) =>
      createCharacterCardReviewSnapshot(snapshot, payload, draftAgentId)));
    return draftAgentId;
  },

  applyNovelReviewDraft: (workspaceId, payload) => set((state) => updateWorkspaceRecord(state, workspaceId, (snapshot) =>
    createNovelReviewSnapshot(snapshot, payload))),

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
