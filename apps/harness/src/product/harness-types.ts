import type { Material } from './session-drafts.js';
import type { FilePreview, WorkspaceItem } from './workspace-files.js';

export type PermissionMode = 'strict' | 'workspace-edit' | 'plan-readonly';
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'error';

export type ModelReview = { label: string; confirmation: string; configRef: string };
export type ReasoningChoice = { value: string; label: string };

export type HarnessSessionSummary = {
  id: string;
  title: string;
  workSessionRef?: string;
  agentBinding?: string;
  status: SessionStatus;
  hasPendingDecision: boolean;
  pinned: boolean;
  workspaceDir?: string;
  workspaceLabel?: string;
  updatedAt?: number;
  configRef?: string;
  permissionMode?: PermissionMode;
};

export type HarnessToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'waiting' | 'done' | 'error';
  output?: string;
  fileRef?: string;
  toolFailure?: 'invalid-arguments' | 'blocked' | 'interrupted' | 'other';
};

export type HarnessTranscriptEntry = {
  id?: string;
  role: string;
  text: string;
  thinking?: string;
  hasRedactedThinking?: boolean;
  toolCalls?: HarnessToolCall[];
  toolCallId?: string;
  toolName?: string;
  fileRef?: string;
  toolFailure?: 'invalid-arguments' | 'blocked' | 'interrupted' | 'other';
  fromHome?: boolean;
  timestamp?: number;
};

export type HarnessDecision = {
  id: number;
  name: string;
  args: Record<string, unknown>;
  revision?: string;
  allowSessionPermitted?: boolean;
  isControlPlane?: boolean;
  isFreeShell?: boolean;
  recentAiEditedWarning?: string[];
  effect?: 'read' | 'write';
  targetDisplayName?: string;
  operationDisplayName?: string;
};

export type HarnessPreWriteSnapshot = {
  snapshotId: string;
  sessionId: string;
  relativePath: string;
  existedBefore: boolean;
  beforeSha256: string | null;
  afterSha256: string | null;
  createdAt: number;
  restoredAt?: number;
};

export type HarnessRecentAiEdit = {
  relativePath: string;
  isControlPlane: boolean;
  editedAt: number;
};

export type HarnessActiveTool = {
  callId: string;
  name: string;
  status: 'pending' | 'running' | 'sleeping' | 'waiting' | 'done';
  output?: string;
  args?: Record<string, unknown>;
};

export type GrantedIntegration = {
  targetRef: string;
  integrationId: string;
  displayName: string;
  available: boolean;
  operations: {
    name: string;
    displayName: string;
    description: string;
    effect: 'read' | 'write';
  }[];
};

export type HarnessView = {
  sessionId: string;
  sessions: HarnessSessionSummary[];
  entries: HarnessTranscriptEntry[];
  decisions: HarnessDecision[];
  activeTools: HarnessActiveTool[];
  workspace: string;
  workspaceDir?: string;
  workspaceLabel?: string;
  workspaceRevision?: number;
  snapshots?: HarnessPreWriteSnapshot[];
  recentAiEditedFiles?: HarnessRecentAiEdit[];
  model?: string;
  configRef?: string;
  reasoningChoices: ReasoningChoice[];
  reasoningEffort: string;
  permissionMode: PermissionMode;
  sessionAllowlist: string[];
  lastModelStepAt?: number;
  contextWindowTokens?: number;
  requestCapacityFloorTokens?: number;
  running: boolean;
  needsResume: boolean;
  stopped: boolean;
  instructions: string;
  queued: { id: number; text: string }[];
  partial?: string;
  partialThinking?: string;
  failure?: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export function errorText(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': Error: /, '');
}

declare global {
  interface Window {
    nimiHarness: {
      importHome(source: string): Promise<void>;
      snapshot(): Promise<HarnessView>;
      onViewChanged(notify: () => void): () => void;
      onFocusSession?(notify: (workSessionRef: string) => void): () => void;
      importMaterial(id: string, name: string, data: Uint8Array): Promise<Material>;
      listFiles(id: string, folder: string, offset: number): Promise<{ items: WorkspaceItem[]; next: number | null }>;
      previewFile(id: string, ref: string, page?: number): Promise<FilePreview>;
      revealFile(id: string, ref: string): Promise<void>;
      revealWorkspace(id: string): Promise<void>;
      chooseWorkspace(): Promise<string | null>;
      setWorkspace(id: string, dir: string | null): Promise<void>;
      create(configRef?: string, workspaceDir?: string): Promise<void>;
      reviewModel(id: string, confirmation?: string, configRef?: string): Promise<ModelReview>;
      select(id: string): Promise<void>;
      rename(session: string, title: string): Promise<void>;
      deleteSession(session: string): Promise<void>;
      pinSession(session: string, pinned: boolean): Promise<void>;
      setPermissionMode(session: string, mode: PermissionMode): Promise<void>;
      setReasoningEffort(session: string, effort: string | null): Promise<void>;
      exportMarkdown(session: string): Promise<string>;
      listIntegrations(): Promise<GrantedIntegration[]>;
      withdraw(session: string, input: number): Promise<void>;
      setInstructions(session: string, text: string): Promise<void>;
      submit(session: string, text: string, id: string, queue: boolean): Promise<void>;
      decide(session: string, id: number, allow: boolean, feedback?: string, allowForSession?: boolean, revision?: string): Promise<void>;
      listSnapshots(session: string): Promise<HarnessPreWriteSnapshot[]>;
      restoreSnapshot(session: string, snapshotId: string): Promise<{ restored: boolean; relativePath: string }>;
      stop(session: string): Promise<void>;
      resume(session: string): Promise<void>;
    };
  }
}
