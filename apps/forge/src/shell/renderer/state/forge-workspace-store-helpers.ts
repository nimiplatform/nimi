import { canonicalizeHandleSeed } from '@renderer/features/import/engines/rule-key-canonicalizer.js';
import type {
  AgentDraftState,
  CreateWorkspaceInput,
  ForgeImportSessionType,
  ForgeSourceManifest,
  ForgeWorkspace,
  ForgeWorkspaceSnapshot,
  ImportSessionSummary,
  WorkspaceAgentRuleBundle,
  WorkspaceConflictReview,
} from '@renderer/features/workbench/types.js';
import type {
  ConflictEntry,
  LocalAgentRuleDraft,
  LocalWorldRuleDraft,
  NovelAccumulatorState,
} from '@renderer/features/import/types.js';

export const STORAGE_KEY = 'nimi:forge:workbench:v1';

export type WorkbenchStoreState = {
  activeWorkspaceId: string | null;
  workspaces: Record<string, ForgeWorkspaceSnapshot>;
  orderedWorkspaceIds: string[];
};

export type CharacterCardReviewPayload = {
  sessionId: string;
  sourceFile: string;
  importedAt: string;
  characterName: string;
  sourceManifest: ForgeSourceManifest;
  agentRules: LocalAgentRuleDraft[];
  worldRules: LocalWorldRuleDraft[];
};

export type NovelReviewPayload = {
  sessionId: string;
  sourceFile: string;
  importedAt: string;
  sourceManifest: ForgeSourceManifest;
  accumulator: NovelAccumulatorState;
  worldRules: LocalWorldRuleDraft[];
  agentBundles: Array<{ characterName: string; rules: LocalAgentRuleDraft[] }>;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function generateId(prefix: string): string {
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

export function createWorkspaceSnapshot(input?: CreateWorkspaceInput): ForgeWorkspaceSnapshot {
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
      tagline: '',
      motto: null,
      overview: '',
      description: input?.worldDescription?.trim() || '',
      genre: '',
      themes: [],
      era: '',
      bannerUrl: null,
      iconUrl: null,
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

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getWindowStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const storage = window.localStorage;
  if (!storage) {
    return null;
  }
  if (
    typeof storage.getItem !== 'function'
    || typeof storage.setItem !== 'function'
    || typeof storage.removeItem !== 'function'
  ) {
    return null;
  }
  return storage;
}

export function persistState(state: WorkbenchStoreState) {
  const storage = getWindowStorage();
  if (!storage) {
    return;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function restoreState(): WorkbenchStoreState {
  const storage = getWindowStorage();
  if (!storage) {
    return { activeWorkspaceId: null, workspaces: {}, orderedWorkspaceIds: [] };
  }

  const raw = storage.getItem(STORAGE_KEY);
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

export function touchWorkspace(
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

function readFirstMeaningfulLine(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function buildDraftConcept(
  fallbackName: string,
  rules: LocalAgentRuleDraft[],
  description?: string,
): string {
  const ruleStatement = rules[0]?.statement.slice(0, 200).trim() ?? '';
  const descriptionLine = readFirstMeaningfulLine(description ?? '').slice(0, 200);
  return ruleStatement || descriptionLine || fallbackName;
}

function buildDraftScenario(rules: LocalAgentRuleDraft[]): string {
  const contextualRule = rules.find((rule) => rule.layer === 'CONTEXTUAL');
  return contextualRule?.statement.trim() ?? '';
}

function buildNovelWorldDescription(accumulator: NovelAccumulatorState): string {
  const summaries = accumulator.chapterArtifacts
    .map((artifact) => artifact.chapterSummary.trim())
    .filter(Boolean);
  const uniqueSummaries = Array.from(new Set(summaries));
  return uniqueSummaries.slice(0, 3).join('\n\n');
}

export function buildSessionSummary(input: {
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

export function createCharacterCardReviewSnapshot(
  snapshot: ForgeWorkspaceSnapshot,
  payload: CharacterCardReviewPayload,
  draftAgentId: string,
): ForgeWorkspaceSnapshot {
  if (payload.sourceManifest.sourceType !== 'character_card') {
    throw new Error('FORGE_CHARACTER_CARD_MANIFEST_REQUIRED');
  }
  const card = payload.sourceManifest.normalizedCard.data;
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
    concept: buildDraftConcept(
      payload.characterName,
      payload.agentRules,
      card.description,
    ),
    description: card.description.trim(),
    scenario: card.scenario.trim(),
    greeting: card.first_mes.trim(),
    avatarUrl: null,
    voiceDemoUrl: null,
    voiceDemoResourceId: null,
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
      tagline: snapshot.worldDraft.tagline || '',
      overview: snapshot.worldDraft.overview || '',
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
}

export function createNovelReviewSnapshot(
  snapshot: ForgeWorkspaceSnapshot,
  payload: NovelReviewPayload,
): ForgeWorkspaceSnapshot {
  const unresolvedConflictCount = payload.accumulator.conflicts.filter(
    (item) => item.resolution === 'UNRESOLVED',
  ).length;
  const sessionSummary = buildSessionSummary({
    sessionId: payload.sessionId,
    sessionType: 'novel',
    sourceFile: payload.sourceFile,
    status: 'REVIEWED',
    unresolvedConflicts: unresolvedConflictCount,
    importedAt: payload.importedAt,
  });

  const nextAgentDrafts = { ...snapshot.agentDrafts };
  const nextAgentBundles: WorkspaceAgentRuleBundle[] = payload.agentBundles.map((bundle) => {
    const existingDraft = Object.values(nextAgentDrafts).find(
      (draft) => draft.characterName === bundle.characterName,
    );
    const draftAgentId = existingDraft?.draftAgentId ?? generateId('draft_agent');
    const discoveredCharacter = payload.accumulator.characters[bundle.characterName];
    if (!existingDraft) {
      nextAgentDrafts[draftAgentId] = {
        draftAgentId,
        sourceAgentId: null,
        originMasterAgentId: null,
        displayName: bundle.characterName,
        handle: canonicalizeHandleSeed(bundle.characterName),
        concept: buildDraftConcept(bundle.characterName, bundle.rules, discoveredCharacter?.description),
        description: discoveredCharacter?.description.trim() ?? '',
        scenario: buildDraftScenario(bundle.rules),
        greeting: '',
        avatarUrl: null,
        voiceDemoUrl: null,
        voiceDemoResourceId: null,
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
      lifecycle: unresolvedConflictCount > 0 ? 'REVIEWING' : 'DRAFT',
      activePanel: 'AGENTS',
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
      tagline: snapshot.worldDraft.tagline || '',
      overview: snapshot.worldDraft.overview || '',
      description: snapshot.worldDraft.description || buildNovelWorldDescription(payload.accumulator),
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
}

export function updateWorkspaceRecord(
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

export function computeReviewFlags(snapshot: ForgeWorkspaceSnapshot): ForgeWorkspaceSnapshot['reviewState'] {
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
