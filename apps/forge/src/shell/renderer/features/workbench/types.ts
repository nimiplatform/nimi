import type {
  CharacterCardSourceManifest,
  ConflictResolution,
  LocalAgentRuleDraft,
  LocalWorldRuleDraft,
  NovelSourceManifest,
} from '@renderer/features/import/types.js';

export type ForgeWorkspaceMode = 'NEW_WORLD' | 'EXISTING_WORLD';

export type ForgeWorkspaceLifecycle =
  | 'DRAFT'
  | 'REVIEWING'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHED';

export type ForgeWorkspacePanel =
  | 'OVERVIEW'
  | 'WORLD_TRUTH'
  | 'AGENTS'
  | 'IMPORT'
  | 'REVIEW'
  | 'PREVIEW'
  | 'PUBLISH';

export type ForgeImportSessionType = 'character_card' | 'novel';

export type ForgeSourceManifest = CharacterCardSourceManifest | NovelSourceManifest;

export type WorldDraftState = {
  worldId: string | null;
  draftId: string | null;
  name: string;
  description: string;
  sourceType: 'MANUAL' | 'CHARACTER_CARD' | 'NOVEL' | 'MIXED';
};

export type AgentDraftState = {
  draftAgentId: string;
  sourceAgentId: string | null;
  originMasterAgentId: string | null;
  displayName: string;
  handle: string;
  concept: string;
  ownershipType: 'MASTER_OWNED' | 'WORLD_OWNED';
  worldId: string | null;
  status: 'DRAFT' | 'LINKED' | 'PUBLISHED';
  source: 'IMPORT' | 'MASTER_LIBRARY' | 'WORLD_LIBRARY' | 'MANUAL';
  characterName: string | null;
  sessionId: string | null;
};

export type ImportSessionSummary = {
  sessionId: string;
  sessionType: ForgeImportSessionType;
  sourceFile: string;
  sourceManifestRef: string;
  status:
    | 'FILE_LOADED'
    | 'MAPPED'
    | 'EXTRACTING'
    | 'CONFLICT_CHECK'
    | 'FINAL_REVIEW'
    | 'REVIEWED';
  unresolvedConflicts: number;
  lastUpdatedAt: string;
};

export type WorkspaceConflictReview = {
  sessionId: string;
  ruleKey: string;
  characterName?: string;
  previousStatement: string;
  newStatement: string;
  resolution: ConflictResolution;
  mergedStatement?: string;
};

export type WorkspaceAgentRuleBundle = {
  draftAgentId: string;
  characterName: string;
  sourceSessionId: string | null;
  rules: LocalAgentRuleDraft[];
};

export type ForgeReviewState = {
  worldRules: LocalWorldRuleDraft[];
  agentBundles: WorkspaceAgentRuleBundle[];
  conflicts: WorkspaceConflictReview[];
  hasPendingConflicts: boolean;
  hasUnmappedCharacters: boolean;
  hasUnreviewedImports: boolean;
  notes: string[];
};

export type PublishRulePatch = LocalWorldRuleDraft;

export type PublishAgentRulePatch = {
  draftAgentId: string;
  agentId: string | null;
  characterName: string;
  rules: LocalAgentRuleDraft[];
};

export type ForgePublishPlan = {
  workspaceId: string;
  worldAction: 'CREATE' | 'UPDATE' | 'NONE';
  agents: Array<{
    draftAgentId: string;
    action: 'CREATE_WORLD_AGENT' | 'UPDATE_WORLD_AGENT';
    sourceAgentId: string | null;
    displayName: string;
    handle: string;
    concept: string;
  }>;
  worldRules: PublishRulePatch[];
  agentRules: PublishAgentRulePatch[];
  sourceManifestPolicy: 'LOCAL_ONLY';
};

export type ForgeWorkspace = {
  workspaceId: string;
  mode: ForgeWorkspaceMode;
  worldRef: { worldId: string | null; draftId: string | null };
  title: string;
  lifecycle: ForgeWorkspaceLifecycle;
  sourceManifestRefs: string[];
  selectedAgentIds: string[];
  activePanel: ForgeWorkspacePanel;
};

export type ForgeWorkspaceSnapshot = {
  workspace: ForgeWorkspace;
  worldDraft: WorldDraftState;
  agentDrafts: Record<string, AgentDraftState>;
  importSessions: ImportSessionSummary[];
  sourceManifests: Record<string, ForgeSourceManifest>;
  publishPlan: ForgePublishPlan | null;
  reviewState: ForgeReviewState;
  updatedAt: string;
};

export type CreateWorkspaceInput = {
  mode?: ForgeWorkspaceMode;
  title?: string;
  worldId?: string | null;
  draftId?: string | null;
  worldName?: string;
  worldDescription?: string;
};

export type AttachMasterAgentToWorldInput = {
  masterAgentId: string;
  workspaceId: string;
  targetWorldId?: string | null;
  mode: 'REFERENCE_TEMPLATE' | 'CLONE_TO_WORLD';
};
