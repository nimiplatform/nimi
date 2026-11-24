import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import type { ToolCall } from '@earendil-works/pi-ai';
import { AgentDoc, CompactionTask, configure, createRegistry, createSession, type Session, type SubmissionId, type TaskId, DEFAULT_COMPACTION_POLICY, defineDoc, defineExtension, defineSignal, GenerationTask, Harness, hook, InboxDoc, LiveDoc, ROOT_CONVERSATION_ID, ToolResultEntry, ToolTask } from '@earendil-works/pi-durable';
import { CodingTools, createEditTool, createPowerShellTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { bool, obj, opt, str } from '@earendil-works/pi-schema';
import { NimiElectronLocalAppHostError, type NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import { extractNimiErrorFields, isJsonObject } from '@nimiplatform/sdk/types';
import { buildReasoningOptions, nimiBodySymbiosisProvider, nimiProvider, projectReasoningChoices, type ReasoningChoice } from './nimi-provider.js';
import { copyMaterial, isInsideWorkspace, listWorkspace, previewWorkspaceFile, resultReference, sessionWorkspace, validateWorkspaceDir, workspaceFile } from './workspace-files.js';
import { publishWorkspaceFile, sessionFileTools, sessionFilePath } from './session-files.js';
import { integrationTools, listGrantedIntegrations, lookupIntegrationOperation } from './integration-tools.js';
import { searchTools } from './search-tools.js';
import { transcriptionTools } from './transcribe.js';
import { progressText, textPreview } from './text-preview.js';
import { readPendingDecision, sanitizeDecisionArgsForDisplay, type PendingDecision } from './pending-decision.js';
import { needsCompaction } from './request-budget.js';
import { HomeHistory, parseHomeHandoff } from './home-handoff.js';
import { hashOutboxPayload, openDurableFullStorage, OutboxReceiptsDoc } from './durable-sqlite.js';
import { SecureWorkspaceExecutionEnv, type PreWriteSnapshotRecord, type RecentAiEditRecord } from './secure-workspace-env.js';
import { isControlPlanePath, isSensitivePath, resolveSafeWorkspacePath } from './security-policy.js';
import { logicalAgentModelId, type BodyStepMessage, type HarnessBodySymbiosisClient } from './body-symbiosis.js';

export type PermissionMode = 'strict' | 'workspace-edit' | 'plan-readonly';
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'error';

export type TranscriptToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'waiting' | 'done' | 'error';
  output?: string;
  fileRef?: string;
  toolFailure?: 'invalid-arguments' | 'blocked' | 'interrupted' | 'other';
};

export type TranscriptEntry = {
  id?: string;
  role: string;
  text: string;
  thinking?: string;
  hasRedactedThinking?: boolean;
  toolCalls?: TranscriptToolCall[];
  toolCallId?: string;
  toolName?: string;
  fileRef?: string;
  toolFailure?: 'invalid-arguments' | 'blocked' | 'interrupted' | 'other';
  fromHome?: boolean;
  timestamp?: number;
};

export type RemoteHistoryEntry = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
  toolFailure?: 'invalid-arguments' | 'blocked' | 'interrupted' | 'other';
  truncated?: boolean;
  timestamp?: number;
};

export class HarnessSubmissionError extends Error {
  constructor(readonly code: 'HARNESS_REQUEST_CONFLICT' | 'HARNESS_SESSION_BUSY' | 'HARNESS_MODEL_CHANGED', message: string) {
    super(message);
  }
}

const namespaceFile = 'harness-namespace.json';
const sessionsFile = 'harness-sessions.json';
const sessionActivityType = 'nimi.harness.session.v1';
const defaultInstructions = 'Help the user with their task. Use the provided tools for files, search, or commands when needed. Explain tool failures accurately.';

const AUTO_READ_ONLY_TOOLS = new Set([
  'read',
  'glob',
  'grep',
  'find_nimi_reads',
  'find_nimi_integrations',
  'read_nimi_receipt',
]);

const PLAN_BLOCKED_MUTATING_TOOLS = new Set([
  'write',
  'edit',
  'bash',
  'powershell',
  'open_attachment',
  'share_result_file',
]);

function sessionDatabase(folder: string, id: string) {
  return join(folder, id === 'main' ? 'session.sqlite' : `session-${id}.sqlite`);
}

type SessionRecord = {
  id: string;
  title: string;
  workSessionRef?: string;
  agentBinding?: string;
  agentHandle?: string;
  configRef?: string;
  creationKey?: string;
  workspaceDir?: string;
  pinned?: boolean;
  archived?: boolean;
  permissionMode?: PermissionMode;
  reasoningEffort?: string;
  updatedAt?: number;
};
type SessionCatalog = { selected: string; sessions: SessionRecord[] };

type SessionRuntimeMeta = {
  status: SessionStatus;
  hasPendingDecision: boolean;
  activeTool?: string;
};

// The managed catalogue supplies the session's initial choice. An explicit
// switch is committed beside the durable model identity in one transaction.
const SessionModel = defineDoc<{ configRef?: string; confirmation?: string; reviewedConflict?: number }>({
  kind: 'nimi.session-model', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({}), checkpointWhen: () => true,
});

function isModelConflict(failure?: { reason: string; detail?: string }) {
  return failure?.reason === 'model_error' && (failure.detail === 'ai-config-revision-conflict' || failure.detail === 'AI_CONFIG_REVISION_CONFLICT');
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'strict' || value === 'workspace-edit' || value === 'plan-readonly';
}

function permissionModeStrictness(mode: PermissionMode | undefined): number {
  if (mode === 'strict') return 3;
  if (mode === 'plan-readonly') return 2;
  if (mode === 'workspace-edit') return 1;
  return 3;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => canonicalizeJsonValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const val = (value as Record<string, unknown>)[key];
      if (val !== undefined) {
        sorted[key] = canonicalizeJsonValue(val);
      }
    }
    return sorted;
  }
  return value;
}

function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value ?? {}));
}

async function removeIgnoreNotFound(targetPath: string, recursive = false): Promise<void> {
  try {
    await rm(targetPath, { recursive, force: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw error;
  }
}

type AuthorizedSideEffectGrant = {
  callId: string;
  toolName: string;
  actionKind: string;
  targetPath?: string;
  leaseEpoch: number;
  remainingUses: number;
};

function workspaceLabelOf(workspaceDir?: string): string | undefined {
  if (!workspaceDir) return undefined;
  return basename(workspaceDir) || workspaceDir;
}

const decision = defineSignal({ name: 'nimi-harness.tool-decision', version: 1, schema: obj({ allow: bool(), feedback: opt(str()) }) });

function createApprovalsExtension(options: {
  getPermissionMode: () => PermissionMode;
  getWorkspace: () => string;
  isExplicitDevWorkspace: () => boolean;
  sessionAllowlist: Set<string>;
  integration?: NimiElectronAppBusinessServices['integration'];
  getSymbiosis: () => HarnessBodySymbiosisClient | undefined;
  requireSymbiosis?: boolean;
  getWorkSessionRef: () => string;
  authorizedGrants: Map<string, AuthorizedSideEffectGrant>;
  signal: AbortSignal;
}) {
  return defineExtension({
    name: 'nimi-harness.approvals',
    hooks: [hook(ToolTask, {
      async beforeTool(call, api, ctx) {
        const args = (call.arguments ?? {}) as Record<string, unknown>;
        const targetPath = typeof args.path === 'string' ? args.path : undefined;
        let normalizedTargetRel: string | undefined;

        // Gate 3: Sensitive path hard-deny across read/write/edit before any approval path.
        if (targetPath && (call.name === 'read' || call.name === 'write' || call.name === 'edit')) {
          try {
            const safe = resolveSafeWorkspacePath(options.getWorkspace(), targetPath);
            normalizedTargetRel = safe.relativePosix;
            if (isSensitivePath(safe.relativePosix, options.getWorkspace())) {
              return { block: `Blocked by Harness security policy: "${safe.relativePosix}" is a protected sensitive file.` };
            }
          } catch (error) {
            return { block: error instanceof Error ? error.message : 'Workspace path rejected by Harness security policy.' };
          }
        }

        if (AUTO_READ_ONLY_TOOLS.has(call.name)) return;

        const isFreeShell = call.name === 'bash' || call.name === 'powershell';
        const isControlPlane = Boolean(
          targetPath
          && (call.name === 'write' || call.name === 'edit')
          && (() => {
            try {
              const safe = resolveSafeWorkspacePath(options.getWorkspace(), targetPath);
              return isControlPlanePath(safe.relativePosix, options.getWorkspace());
            } catch {
              return true;
            }
          })(),
        );

        // Gate 4: Free Shell is ONLY permitted inside an explicitly bound dev workspace.
        if (isFreeShell && !options.isExplicitDevWorkspace()) {
          return { block: 'Blocked: Free Shell commands are only available in an explicitly bound development workspace.' };
        }

        const mode = options.getPermissionMode();
        let isWriteIntegration = false;
        if (call.name === 'invoke_nimi_integration') {
          const opInfo = await lookupIntegrationOperation(options.integration, args.targetRef, args.operation, options.signal);
          if (!opInfo) {
            return { block: 'Blocked fail-closed: unable to verify integration operation metadata or write/read effect.' };
          }
          isWriteIntegration = opInfo.effect === 'write';
          if (mode === 'plan-readonly' && isWriteIntegration) {
            return { block: `Blocked by Plan Read-Only mode: "${opInfo.operationDisplayName}" is a write integration operation. Switch permission mode to allow changes.` };
          }
        }
        const isOutboundNetwork = call.name === 'web_fetch';
        if (mode === 'plan-readonly' && (PLAN_BLOCKED_MUTATING_TOOLS.has(call.name) || isOutboundNetwork)) {
          return { block: `Blocked by Plan Read-Only mode: "${call.name}" modifies files, runs commands, or accesses external networks. Switch permission mode to allow changes.` };
        }

        // Gate 3: Control-plane files NEVER auto-approve under workspace-edit or sessionAllowlist.
        const autoApprovedByWorkspaceEdit = mode === 'workspace-edit'
          && !isControlPlane
          && (call.name === 'write' || call.name === 'edit')
          && typeof targetPath === 'string'
          && await isInsideWorkspace(options.getWorkspace(), targetPath);

        // Gate 4: Free Shell & control-plane files ALWAYS require explicit allow_once (never sessionAllowlist).
        const autoApprovedBySession = !isFreeShell && !isControlPlane && !isOutboundNetwork && options.sessionAllowlist.has(call.name);

        if (!autoApprovedByWorkspaceEdit && !autoApprovedBySession) {
          const answer = await api.readSignal(decision, 'decision', ctx);
          if (!answer) return { sleep: { signals: [decision.key('decision')] } };
          if ('expired' in answer) return { block: 'The decision expired before approval.' };
          if (!answer.value.allow) {
            return {
              block: answer.value.feedback
                ? 'The user declined this proposal and requested changes:\n' + answer.value.feedback
                : 'The user declined this operation.',
            };
          }
        }

        // Synchronous fail-closed AuthorizeBodySideEffect fence before starting any high-risk side effect.
        // Runtime consumes each (workSessionRef, callId) once-only; we record a matching single-use
        // lease-epoch-bound in-memory execution grant ONLY for workspace env tools (never wildcard grants).
        if (PLAN_BLOCKED_MUTATING_TOOLS.has(call.name) || isWriteIntegration || isOutboundNetwork) {
          const activeSymbiosis = options.getSymbiosis();
          const actionKind = isFreeShell
            ? 'shell_exec'
            : isWriteIntegration
              ? 'integration_write'
              : isOutboundNetwork
                ? 'outbound_network'
                : 'file_write';
          if (!activeSymbiosis) {
            if (options.requireSymbiosis) {
              return { block: 'Side effect denied fail-closed: Harness PC body symbiosis lease is offline.' };
            }
          } else {
            try {
              const leaseEpoch = activeSymbiosis.getLeaseEpoch();
              await activeSymbiosis.authorizeSideEffect({
                workSessionRef: options.getWorkSessionRef(),
                callId: call.id,
                toolName: call.name,
                actionKind,
                payloadHash: hashOutboxPayload(canonicalJsonStringify(call.arguments ?? {})),
              });
              // Only workspace write/edit (with exact normalizedTargetRel) and shell tools consume
              // SecureWorkspaceExecutionEnv grants. Never mint wildcard targetPath: undefined grants!
              if (isFreeShell) {
                options.authorizedGrants.set(call.id, {
                  callId: call.id,
                  toolName: call.name,
                  actionKind: 'shell_exec',
                  leaseEpoch,
                  remainingUses: 1,
                });
              } else if ((call.name === 'write' || call.name === 'edit') && normalizedTargetRel) {
                options.authorizedGrants.set(call.id, {
                  callId: call.id,
                  toolName: call.name,
                  actionKind: 'file_write',
                  targetPath: normalizedTargetRel,
                  leaseEpoch,
                  remainingUses: 1,
                });
              }
            } catch (error) {
              return { block: error instanceof Error ? error.message : 'Side effect authorization denied by Runtime.' };
            }
          }
        }
      },
      afterTool(call) {
        options.authorizedGrants.delete(call.id);
        return undefined;
      },
    })],
  });
}

function toBodyStepWorkingMessage(msg: {
  role: string;
  content: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}): BodyStepMessage | undefined {
  if (msg.role === 'system') return undefined;
  if (msg.role === 'toolResult' || msg.role === 'tool') {
    return {
      role: 'tool',
      contentJson: JSON.stringify(msg.content),
      ...(msg.toolCallId ? { toolCallId: msg.toolCallId } : {}),
      ...(msg.toolName ? { toolName: msg.toolName } : {}),
      ...(msg.isError !== undefined ? { isError: Boolean(msg.isError) } : {}),
    };
  }
  return {
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    contentJson: JSON.stringify(msg.content),
  };
}

const EXCLUDED_COMPACTION_STOP_REASONS = new Set(['aborted', 'error', 'deferred']);

type RawTranscriptMessage = {
  role: string;
  content: unknown;
  stopReason?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

function orderKeptToolResults(messages: readonly RawTranscriptMessage[]): RawTranscriptMessage[] {
  const ordered: RawTranscriptMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'toolResult') continue;
    ordered.push(message);
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const calls = (message.content as Array<{ type?: string; id?: string }>).filter(
      part => part?.type === 'toolCall' && typeof part.id === 'string',
    );
    if (calls.length === 0) continue;
    const results = new Map<string, number>();
    for (let next = index + 1; next < messages.length && messages[next]!.role !== 'assistant'; next++) {
      const candidate = messages[next]!;
      if (candidate.role === 'toolResult' && candidate.toolCallId && !results.has(candidate.toolCallId)) {
        results.set(candidate.toolCallId, next);
      }
    }
    for (const call of calls) {
      const resultIndex = call.id ? results.get(call.id) : undefined;
      if (resultIndex !== undefined) {
        ordered.push(messages[resultIndex]!);
      }
    }
  }
  return ordered;
}

function createCompactionExtension(options: {
  getWorkSessionRef: () => string;
  getAgentBinding: () => string;
  getAgentHandle: () => string;
  getSymbiosis: () => HarnessBodySymbiosisClient | undefined;
  requireSymbiosis?: boolean;
  onBudgetUpdated?: (budgetTokens: number) => void;
}) {
  return defineExtension({
    name: 'nimi-harness.runtime-compaction',
    hooks: [hook(CompactionTask, {
      async beforeCompact(compaction, api, ctx) {
        const activeSymbiosis = options.getSymbiosis();
        if (!activeSymbiosis || !activeSymbiosis.isRunning()) {
          // Never fall back to pi-durable's built-in system-prompt summarizer in symbiosis mode!
          return options.requireSymbiosis ? { decline: true as const } : undefined;
        }
        const summarizedNonSystem: BodyStepMessage[] = [];
        for (const msg of compaction.messages) {
          const converted = toBodyStepWorkingMessage(msg as RawTranscriptMessage);
          if (converted) summarizedNonSystem.push(converted);
        }

        // Read authoritative committed entries >= compaction.firstKept directly from SQLite via HookApi,
        // matching pi-durable@1.6.0 active-view derivation (skip prior compaction heads, apply edits,
        // filter excluded stopReasons, and fail closed if pagination cap is exceeded).
        type ScannedEntry = {
          id: number;
          head?: unknown;
          model?: readonly RawTranscriptMessage[];
          edits?: readonly { target: number; action: string; messages?: readonly RawTranscriptMessage[] }[];
        };
        const rawKeptEntries: ScannedEntry[] = [];
        let cursor: Parameters<typeof api.entries>[2] = undefined;
        const maxPages = 100;
        let exhausted = false;
        for (let page = 0; page < maxPages; page++) {
          const batch = await api.entries(
            { minEntryId: compaction.firstKept, order: 'ascending' } as Parameters<typeof api.entries>[0],
            200,
            cursor,
            ctx,
          );
          for (const entry of batch.items) {
            if (entry.id < compaction.firstKept) continue;
            rawKeptEntries.push(entry as unknown as ScannedEntry);
          }
          if (!batch.next) {
            exhausted = true;
            break;
          }
          cursor = batch.next;
        }
        if (!exhausted) {
          // Fail closed rather than sending a silently truncated keptTailMessages to Runtime's rolling MAC ledger!
          return { decline: true as const };
        }

        const editsByTarget = new Map<number, { action: string; messages?: readonly RawTranscriptMessage[] }>();
        for (const entry of rawKeptEntries) {
          for (const edit of entry.edits ?? []) {
            editsByTarget.set(edit.target, edit);
          }
        }
        const activeKeptRaw: RawTranscriptMessage[] = [];
        for (const entry of rawKeptEntries) {
          // pi-durable selectActive drops prior head markers (compaction/reset headers) from range entries.
          if (entry.head !== undefined) continue;
          const edit = editsByTarget.get(entry.id);
          if (edit?.action === 'omit') continue;
          const contributed = edit?.action === 'replace' ? (edit.messages ?? []) : (entry.model ?? []);
          for (const msg of contributed) {
            if (msg.role === 'assistant' && msg.stopReason && EXCLUDED_COMPACTION_STOP_REASONS.has(msg.stopReason)) {
              continue;
            }
            activeKeptRaw.push(msg);
          }
        }

        const keptTailMessages: BodyStepMessage[] = [];
        for (const msg of orderKeptToolResults(activeKeptRaw)) {
          const converted = toBodyStepWorkingMessage(msg);
          if (converted) keptTailMessages.push(converted);
        }

        // Runtime's single-anchor rolling ledger verifies workingMessages[:LastCommittedCount]
        // AND verifies keptTailMessages is an exact suffix of workingMessages!
        const workingMessages = [...summarizedNonSystem, ...keptTailMessages];
        const agentBinding = options.getAgentBinding();
        const result = await activeSymbiosis.executeCompactionWithRetries({
          agentHandle: options.getAgentHandle() || agentBinding,
          workSessionRef: options.getWorkSessionRef(),
          agentBinding,
          workingMessages,
          keptTailMessages,
        }, 2);
        if (result.effectiveContextBudgetTokens > 0) {
          options.onBudgetUpdated?.(result.effectiveContextBudgetTokens);
        }
        return { summary: result.summary };
      },
    })],
  });
}

const requestBudget = defineExtension({
  name: 'nimi-harness.request-budget',
  hooks: [hook(GenerationTask, {
    beforeRequest: ({ messages }) => needsCompaction(messages) ? { messages, compact: true } : undefined,
  })],
});

export interface OpenHarnessOptions {
  readonly dataRoot?: string;
  readonly symbiosis?: HarnessBodySymbiosisClient;
  readonly requireSymbiosis?: boolean;
  readonly defaultAgentBinding?: string;
  readonly defaultAgentHandle?: string;
  readonly defaultAgentDisplayName?: string;
  readonly allowSourceLocalDev?: boolean;
  readonly allowInsecureTestFallback?: boolean;
}

export async function openHarness(
  services: NimiElectronAppBusinessServices,
  signal: AbortSignal,
  viewChanged?: () => void,
  options?: OpenHarnessOptions,
) {
  const namespace = await resolveNamespace(services.storage, signal);
  const folder = options?.dataRoot ? join(options.dataRoot, namespace) : join(homedir(), '.nimi-harness', namespace);
  const forbiddenWorkspaceRoots = options?.dataRoot ? [folder, options.dataRoot] : [folder];
  let symbiosisClient = options?.symbiosis;
  let defaultAgentBinding = options?.defaultAgentBinding;
  let defaultAgentHandle = options?.defaultAgentHandle;
  let defaultAgentDisplayName = options?.defaultAgentDisplayName;
  const reportedInitialMilestone = new Set<string>();
  let pendingRouteSubmit: Promise<void> = Promise.resolve();

  const resolveDefaultPartner = async (): Promise<{ agentHandle: string; agentBinding?: string; displayName?: string } | undefined> => {
    if (defaultAgentHandle) {
      return {
        agentHandle: defaultAgentHandle,
        ...(defaultAgentBinding ? { agentBinding: defaultAgentBinding } : {}),
        ...(defaultAgentDisplayName ? { displayName: defaultAgentDisplayName } : {}),
      };
    }
    type PartnerRef = { agentHandle?: string; agentBinding?: string; displayName?: string };
    const candidateListers = [
      (services as { agents?: { listReferences?: () => Promise<readonly PartnerRef[]> } }).agents?.listReferences,
      (services as { agentWork?: { listReferences?: () => Promise<readonly PartnerRef[]> } }).agentWork?.listReferences,
    ];
    for (const listRefs of candidateListers) {
      if (typeof listRefs !== 'function') continue;
      try {
        const refs = await listRefs();
        const first = Array.isArray(refs)
          ? refs.find(ref => typeof ref?.agentHandle === 'string' && ref.agentHandle.trim().length > 0)
          : undefined;
        if (first?.agentHandle) {
          const resolvedHandle = first.agentHandle.trim();
          defaultAgentHandle = resolvedHandle;
          if (typeof first.agentBinding === 'string' && first.agentBinding.trim()) {
            defaultAgentBinding = first.agentBinding.trim();
          }
          if (typeof first.displayName === 'string' && first.displayName.trim()) {
            defaultAgentDisplayName = first.displayName.trim();
          }
          return {
            agentHandle: resolvedHandle,
            ...(defaultAgentBinding ? { agentBinding: defaultAgentBinding } : {}),
            ...(defaultAgentDisplayName ? { displayName: defaultAgentDisplayName } : {}),
          };
        }
      } catch {
        // Try next available reference list surface.
      }
    }
    return undefined;
  };
  let catalog: SessionCatalog;
  try {
    const document = (await services.storage.readJson(sessionsFile)).value;
    if (!isJsonObject(document)
      || typeof document.selected !== 'string' || !Array.isArray(document.sessions)) {
      throw new Error('Invalid Harness session catalog.');
    }
    const sessions = document.sessions.map((item: unknown): SessionRecord => {
      if (!isJsonObject(item) || typeof item.id !== 'string'
        || !/^(?:main|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.test(item.id)
        || typeof item.title !== 'string' || !item.title.trim()) throw new Error('Invalid Harness session catalog.');
      if (item.configRef !== undefined && (typeof item.configRef !== 'string' || !/^(main|[0-9a-f]{32})$/.test(item.configRef))) throw new Error('Invalid stored configuration reference.');
      const creationKey = item.creationKey;
      if (creationKey !== undefined && (typeof creationKey !== 'string' || !/^[0-9a-f]{64}$/.test(creationKey))) throw new Error('Invalid stored session creation receipt.');
      if (item.workspaceDir !== undefined && (typeof item.workspaceDir !== 'string' || !isAbsolute(item.workspaceDir) || /[\x00-\x1f]/u.test(item.workspaceDir))) {
        throw new Error('Invalid stored workspace directory.');
      }
      if (item.pinned !== undefined && typeof item.pinned !== 'boolean') throw new Error('Invalid stored pin state.');
      if (item.archived !== undefined && typeof item.archived !== 'boolean') throw new Error('Invalid stored archive state.');
      if (item.permissionMode !== undefined && !isPermissionMode(item.permissionMode)) throw new Error('Invalid stored permission mode.');
      if (item.reasoningEffort !== undefined && (typeof item.reasoningEffort !== 'string' || !item.reasoningEffort.trim() || item.reasoningEffort.length > 32)) {
        throw new Error('Invalid stored reasoning effort.');
      }
      if (item.updatedAt !== undefined && (typeof item.updatedAt !== 'number' || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < 0)) {
        throw new Error('Invalid stored session timestamp.');
      }
      return {
        id: item.id,
        title: item.title,
        ...(typeof item.workSessionRef === 'string' && item.workSessionRef.trim() ? { workSessionRef: item.workSessionRef.trim() } : {}),
        ...(typeof item.agentBinding === 'string' && item.agentBinding.trim() ? { agentBinding: item.agentBinding.trim() } : {}),
        ...(typeof item.agentHandle === 'string' && item.agentHandle.trim() ? { agentHandle: item.agentHandle.trim() } : {}),
        ...(item.configRef ? { configRef: item.configRef as string } : {}),
        ...(typeof creationKey === 'string' ? { creationKey } : {}),
        ...(typeof item.workspaceDir === 'string' ? { workspaceDir: item.workspaceDir } : {}),
        ...(typeof item.pinned === 'boolean' ? { pinned: item.pinned } : {}),
        ...(typeof item.archived === 'boolean' ? { archived: item.archived } : {}),
        ...(isPermissionMode(item.permissionMode) ? { permissionMode: item.permissionMode } : {}),
        ...(typeof item.reasoningEffort === 'string' ? { reasoningEffort: item.reasoningEffort } : {}),
        ...(typeof item.updatedAt === 'number' ? { updatedAt: item.updatedAt } : {}),
      };
    });
    if (new Set(sessions.map(item => item.id)).size !== sessions.length || !sessions.some(item => item.id === document.selected)) {
      throw new Error('Invalid Harness session selection.');
    }
    catalog = { selected: document.selected, sessions };
  } catch (error) {
    if (!(error instanceof NimiElectronLocalAppHostError) || error.reasonCode !== 'not-found') throw error;
    catalog = { selected: 'main', sessions: [{ id: 'main', title: 'First session' }] };
    signal.throwIfAborted();
    await services.storage.writeJson(sessionsFile, catalog);
  }
  const progressChanges = new EventTarget();
  const opened = new Map<string, ReturnType<typeof openSession>>();
  const sessionMeta = new Map<string, SessionRuntimeMeta>();
  const lastActivity = new Map<string, { marker: string; revision: number; wasRunning: boolean }>();
  let mutations = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutations.then(() => { signal.throwIfAborted(); return operation(); });
    mutations = result.then(() => undefined, () => undefined);
    return result;
  };
  const save = async (next: SessionCatalog) => {
    signal.throwIfAborted();
    await services.storage.writeJson(sessionsFile, next);
    signal.throwIfAborted();
    catalog = next;
    viewChanged?.();
  };
  const recordOf = (id: string) => {
    signal.throwIfAborted();
    const item = catalog.sessions.find(record => record.id === id);
    if (!item) throw new Error('Unknown Harness session.');
    return item;
  };
  const workspaceOf = (id: string) => {
    const item = recordOf(id);
    return item.workspaceDir ?? sessionWorkspace(folder, id);
  };

  function syncSessionActivity(id: string, meta: SessionRuntimeMeta, latestTaskId?: number, lastStepAt?: number) {
    const prevMeta = sessionMeta.get(id);
    sessionMeta.set(id, meta);
    if (prevMeta?.status !== meta.status || prevMeta?.hasPendingDecision !== meta.hasPendingDecision) {
      viewChanged?.();
    }
    if (!services.activity?.put || signal.aborted) return;
    const prev = lastActivity.get(id);
    const catalogItem = catalog.sessions.find(item => item.id === id);
    const title = (catalogItem?.title ?? 'Nimi Harness').replace(/\s+/gu, ' ').trim();
    const key = `session:${id}`;
    const objectRef = catalogItem?.workSessionRef ? `work-session:${catalogItem.workSessionRef}` : key;
    if (meta.status === 'waiting') {
      const marker = `waiting:${latestTaskId ?? meta.activeTool ?? 'tool'}`;
      if (prev?.marker === marker) return;
      const revision = Math.max(Date.now(), (prev?.revision ?? 0) + 1);
      lastActivity.set(id, { marker, revision, wasRunning: true });
      void services.activity.put({
        key,
        revision,
        kind: 'activity',
        attention: true,
        title: `Approval needed: ${title}`,
        summary: meta.activeTool ? `Waiting for approval to run ${meta.activeTool}` : 'Waiting for tool approval',
        type: sessionActivityType,
        objectRef,
        occurredAt: new Date(),
      }).catch(() => {});
      return;
    }
    if (meta.status === 'running') {
      lastActivity.set(id, { marker: prev?.marker ?? '', revision: prev?.revision ?? 0, wasRunning: true });
      return;
    }
    if (prev?.wasRunning) {
      const marker = `${meta.status}:${lastStepAt ?? latestTaskId ?? Date.now()}`;
      if (prev.marker === marker) return;
      const revision = Math.max(Date.now(), (prev.revision ?? 0) + 1);
      lastActivity.set(id, { marker, revision, wasRunning: false });
      void services.activity.put({
        key,
        revision,
        kind: 'activity',
        attention: false,
        title,
        summary: meta.status === 'error' ? 'Task ended with an error' : 'Reply ready',
        type: sessionActivityType,
        objectRef,
        occurredAt: new Date(lastStepAt ?? Date.now()),
      }).catch(() => {});
    }
  }

  const session = (id: string) => {
    const item = recordOf(id);
    let pending = opened.get(id);
    if (!pending) {
      // Serialize a first writer with cold receipt reads of an existing file.
      pending = mutate(() => openSession({
        folder,
        forbiddenWorkspaceRoots,
        sessionId: id,
        workSessionRef: item.workSessionRef,
        agentBinding: item.agentBinding ?? defaultAgentBinding,
        agentHandle: item.agentHandle ?? defaultAgentHandle,
        agentDisplayName: defaultAgentDisplayName,
        symbiosis: symbiosisClient,
        requireSymbiosis: options?.requireSymbiosis,
        allowSourceLocalDev: options?.allowSourceLocalDev,
        allowInsecureTestFallback: options?.allowInsecureTestFallback,
        services,
        signal,
        configRef: item.configRef,
        workspaceDir: item.workspaceDir,
        permissionMode: item.permissionMode ?? 'strict',
        reasoningEffort: item.reasoningEffort,
        onStatus: (meta, latestTaskId, lastStepAt) => {
          const prevStatus = sessionMeta.get(id)?.status;
          syncSessionActivity(id, meta, latestTaskId, lastStepAt);
          const currentRecord = catalog.sessions.find(s => s.id === id);
          // NEVER report an unbound local placeholder (e.g. initial 'main') to Runtime!
          const ref = currentRecord?.workSessionRef;
          if (ref && symbiosisClient?.isReadyForProjections()) {
            const mappedStatus = meta.status === 'waiting'
              ? 'waiting_approval'
              : meta.status === 'running'
                ? 'running'
                : meta.status === 'error'
                  ? 'error'
                  : 'idle';
            const turnJustCompleted = prevStatus === 'running' && meta.status === 'idle';
            void (async () => {
              let pendingAttention:
                | {
                  attentionId: string;
                  attentionKind: string;
                  summaryJson: string;
                  expiresAt: string;
                }
                | undefined;
              if (meta.status === 'waiting') {
                const pendingDec = await pendingDecision(id, latestTaskId).catch(() => ({ state: 'none' as const }));
                if (pendingDec.state === 'review') {
                  pendingAttention = {
                    attentionId: `${ref}:task:${pendingDec.taskId}`,
                    attentionKind: 'tool_approval',
                    summaryJson: JSON.stringify({
                      summary: pendingDec.summary || `Approval needed: ${pendingDec.tool}`,
                      tool: pendingDec.tool,
                      ...(pendingDec.diffPreview?.path ? { targetPath: pendingDec.diffPreview.path } : {}),
                      revision: pendingDec.revision,
                    }),
                    expiresAt: new Date(pendingDec.expiresAt).toISOString(),
                  };
                }
              }
              let milestoneKind: string | undefined;
              let topicSummary: string | undefined;
              let deliverablePaths: readonly string[] | undefined;
              if (turnJustCompleted) {
                milestoneKind = reportedInitialMilestone.has(ref) ? 'completed' : 'initial_goal';
                reportedInitialMilestone.add(ref);
                const resolvedSess = await opened.get(id)?.catch(() => undefined);
                const milestoneInfo = resolvedSess?.getLatestMilestoneSummary();
                topicSummary = milestoneInfo?.topicSummary || currentRecord?.title || item.title;
                if (milestoneInfo?.deliverablePaths.length) {
                  deliverablePaths = milestoneInfo.deliverablePaths;
                }
              }
              await symbiosisClient?.reportProjection({
                workSessionRef: ref,
                status: mappedStatus,
                title: currentRecord?.title ?? item.title,
                workspaceRoot: currentRecord?.workspaceDir,
                permissionMode: currentRecord?.permissionMode ?? 'strict',
                ...(milestoneKind ? { milestoneKind } : {}),
                ...(topicSummary ? { topicSummary } : {}),
                ...(deliverablePaths ? { deliverablePaths } : {}),
                ...(pendingAttention ? { pendingAttention } : {}),
                ...(prevStatus === 'waiting' && meta.status !== 'waiting' ? { clearPendingAttention: true } : {}),
              });
            })().catch(() => {});
          }
        },
        onProgress: () => {
          progressChanges.dispatchEvent(new Event(id));
          if (catalog.selected === id) viewChanged?.();
        },
      }));
      opened.set(id, pending);
      void pending.catch(() => { if (opened.get(id) === pending) opened.delete(id); });
    }
    return pending;
  };

  type Reader = Pick<Session, 'commit' | 'snapshot'>;
  async function readSession<T>(id: string, empty: T, read: (reader: Reader) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (!catalog.sessions.some(item => item.id === id)) throw new Error('Unknown Harness session.');
    const active = opened.get(id);
    if (active) return read((await active).reader);
    return mutate(async () => {
      const file = sessionDatabase(folder, id);
      try { await stat(file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
        throw error;
      }
      // A cold read has no tool registry, model binding or task scheduler.
      const reader = createSession((await openDurableFullStorage(file)).storage);
      try { return await read(reader); } finally { await reader.close(context); }
    });
  }

  const inputStatus = (id: string, requestId: string) => readSession(id, 'not-found' as const, reader => reader.commit(async tx => {
    const input = await tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId);
    return input?.type === 'input' ? input.status : 'not-found' as const;
  }, context));

  const waitKey = decision.key('decision');
  const pendingDecision = (id: string, taskId?: number) => readSession<PendingDecision>(id, { state: 'none' }, async reader => {
    if (!(await reader.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context))?.tools?.length) return { state: 'none' };
    return reader.commit(tx => readPendingDecision(tx, id, waitKey.signal, { workspaceRoot: workspaceOf(id), ...(taskId !== undefined ? { taskId } : {}) }), context);
  });

  async function addSession(configRef?: string, creationKey?: string, workspaceDir?: string) {
    const resolvedWorkspace = workspaceDir ? await validateWorkspaceDir(workspaceDir, forbiddenWorkspaceRoots) : undefined;
    let resolvedConfigRef: string | undefined;
    if (!options?.requireSymbiosis) {
      const config = await services.aiConfig.get(configRef ? { configRef } : { includeRecords: true });
      if (!config.record) throw new Error('Choose an available configuration before creating a session.');
      resolvedConfigRef = config.record.configRef;
    }
    const item: SessionRecord = {
      id: randomUUID(),
      title: 'New session',
      ...(resolvedConfigRef ? { configRef: resolvedConfigRef } : {}),
      ...(creationKey ? { creationKey } : {}),
      ...(resolvedWorkspace ? { workspaceDir: resolvedWorkspace } : {}),
      updatedAt: Date.now(),
    };
    await save({ selected: creationKey ? catalog.selected : item.id, sessions: [...catalog.sessions, item] });
    return { id: item.id, title: item.title };
  }

  async function readAllHistoryEntries(reader: Reader): Promise<RemoteHistoryEntry[]> {
    return reader.commit(async tx => {
      type ScanPage = Awaited<ReturnType<typeof tx.scanEntries>>;
      const rawEntries: Array<ScanPage['items'][number]> = [];
      let cursor: ScanPage['next'] = undefined;
      for (let page = 0; page < 20; page++) {
        const batch = await tx.scanEntries({ conversationId: ROOT_CONVERSATION_ID, order: 'ascending' }, 100, cursor);
        rawEntries.push(...batch.items);
        if (!batch.next) break;
        cursor = batch.next;
      }
      const flattened: RemoteHistoryEntry[] = [];
      for (const entry of rawEntries) {
        if (HomeHistory.is(entry)) {
          const homeMessages = entry.data?.messages ?? [];
          homeMessages.forEach((msg, idx) => {
            const preview = textPreview(msg.text, 8192);
            flattened.push({
              id: `${entry.id}:home:${idx}`,
              role: msg.role,
              text: preview.text,
              ...(preview.truncated ? { truncated: true } : {}),
            });
          });
          continue;
        }
        (entry.model ?? []).forEach((message, idx) => {
          if (message.role === 'system') return;
          if (message.role === 'user') {
            const raw = typeof message.content === 'string'
              ? message.content
              : message.content.map(part => part.type === 'text' ? part.text : '[image]').join('\n');
            const preview = textPreview(raw, 8192);
            if (!preview.text) return;
            flattened.push({
              id: `${entry.id}:${idx}`,
              role: 'user',
              text: preview.text,
              ...(preview.truncated ? { truncated: true } : {}),
              ...(typeof message.timestamp === 'number' ? { timestamp: message.timestamp } : {}),
            });
            return;
          }
          if (message.role === 'assistant') {
            const raw = message.content
              .filter(part => part.type === 'text')
              .map(part => part.text)
              .join('\n')
              .trim();
            if (!raw) return;
            const preview = textPreview(raw, 8192);
            flattened.push({
              id: `${entry.id}:${idx}`,
              role: 'assistant',
              text: preview.text,
              ...(preview.truncated ? { truncated: true } : {}),
              ...(typeof message.timestamp === 'number' ? { timestamp: message.timestamp } : {}),
            });
            return;
          }
          if (message.role === 'toolResult') {
            const diagnostics = ToolResultEntry.is(entry) ? entry.data?.diagnostics ?? [] : [];
            let toolFailure: RemoteHistoryEntry['toolFailure'];
            let raw = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
            if (message.isError) {
              if (diagnostics.some(item => item.code === 'interrupted')) toolFailure = 'interrupted';
              else if (diagnostics.some(item => item.severity === 'error' && item.code === 'invalid_arguments')) toolFailure = 'invalid-arguments';
              else if (diagnostics.some(item => item.severity === 'error' && item.code === 'blocked')) toolFailure = 'blocked';
              else toolFailure = 'other';
              const errors = diagnostics.flatMap(item => item.severity === 'error' && typeof item.message === 'string' ? [item.message] : []);
              if (errors.length) raw = errors.join('\n');
            }
            const preview = textPreview(raw || '(no output)', 4096);
            flattened.push({
              id: `${entry.id}:${idx}`,
              role: 'tool',
              text: preview.text,
              toolName: message.toolName,
              ...(toolFailure ? { toolFailure } : {}),
              ...(preview.truncated ? { truncated: true } : {}),
              ...(typeof message.timestamp === 'number' ? { timestamp: message.timestamp } : {}),
            });
          }
        });
      }
      return flattened;
    }, context);
  }

  return {
    list(offset: number) {
      signal.throwIfAborted();
      const sessions = catalog.sessions.slice(offset, offset + 32).map(({ id, title }) => ({ id, title }));
      const next = offset + sessions.length;
      return { sessions, nextOffset: next < catalog.sessions.length ? next : null };
    },
    listDetailed(offset: number) {
      signal.throwIfAborted();
      const sessions = catalog.sessions.slice(offset, offset + 32).map(item => {
        const meta = sessionMeta.get(item.id);
        const workspaceLabel = workspaceLabelOf(item.workspaceDir);
        return {
          id: item.id,
          title: item.title,
          status: meta?.status ?? 'idle' as SessionStatus,
          hasPendingDecision: meta?.hasPendingDecision ?? false,
          ...(workspaceLabel ? { workspaceLabel } : {}),
          ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
        };
      });
      const next = offset + sessions.length;
      return { sessions, nextOffset: next < catalog.sessions.length ? next : null };
    },
    async getHistory(id: string, cursor = 0, limit = 30) {
      const skip = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
      const pageLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(50, limit)) : 30;
      return readSession(id, { sessionId: id, entries: [] as RemoteHistoryEntry[], nextCursor: null as number | null }, async reader => {
        const all = await readAllHistoryEntries(reader);
        const end = Math.max(0, all.length - skip);
        const start = Math.max(0, end - pageLimit);
        const entries = all.slice(start, end);
        const nextCursor = start > 0 ? skip + entries.length : null;
        return { sessionId: id, entries, nextCursor };
      });
    },
    async readProgress(id: string, after: string, observation: AbortSignal) {
      // Subscribe before reading so a commit racing the read cannot be lost.
      // A fresh connection always receives a full public snapshot.
      const deadline = Date.now() + 6000;
      for (;;) {
        observation.throwIfAborted();
        signal.throwIfAborted();
        let changed!: () => void;
        const wake = new Promise<void>(resolve => { changed = resolve; });
        progressChanges.addEventListener(id, changed, { once: true });
        observation.addEventListener('abort', changed, { once: true });
        signal.addEventListener('abort', changed, { once: true });
        const timeout = setTimeout(changed, Math.max(0, deadline - Date.now()));
        try {
          const empty = { stage: 'idle', turn: 0, text: '', truncated: false };
          const snapshot = await readSession(id, empty, async reader => {
            const live = await reader.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context);
            if (live?.run) {
              const waitingSlot = live.tools?.find(slot => slot.status === 'sleeping');
              const runningSlot = live.tools?.find(slot => slot.status === 'running' || slot.status === 'pending');
              const stage = waitingSlot ? 'waiting' : live.tools?.length ? 'tools' : 'generating';
              const activeTool = waitingSlot?.name ?? runningSlot?.name;
              const text = live.generation?.message?.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('') ?? '';
              return {
                stage,
                turn: live.run.turns,
                ...progressText(text),
                ...(activeTool ? { activeTool } : {}),
                ...(stage === 'waiting' ? { hasPendingDecision: true } : {}),
              };
            }
            return reader.commit(async tx => {
              if (live?.runFailure) return { ...empty, stage: 'unanswered' };
              const [entry] = (await tx.scanEntries({ conversationId: ROOT_CONVERSATION_ID, order: 'descending' }, 1)).items;
              if (!entry) return empty;
              const answer = entry.model?.find(message => message.role === 'assistant');
              if (!answer || answer.role !== 'assistant') return empty;
              const text = answer.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('');
              return { ...empty, stage: 'done', ...progressText(text) };
            }, context);
          });
          const json = JSON.stringify(snapshot);
          if (!after || Date.now() >= deadline || createHash('sha256').update(json).digest('hex') !== after) return json;
          await wake;
        } finally {
          clearTimeout(timeout);
          observation.removeEventListener('abort', changed);
          signal.removeEventListener('abort', changed);
          progressChanges.removeEventListener(id, changed);
        }
      }
    },
    importMaterial: (id: string, name: string, data: Uint8Array) => copyMaterial(workspaceOf(id), name, data, signal),
    listFiles: (id: string, folderName: string, offset: number) => listWorkspace(workspaceOf(id), folderName, offset, signal),
    previewFile: (id: string, ref: string, page?: number) => previewWorkspaceFile(workspaceOf(id), ref, signal, page),
    revealFile: async (id: string, ref: string) => (await workspaceFile(workspaceOf(id), ref, signal)).path,
    revealWorkspace: async (id: string) => {
      const dir = workspaceOf(id);
      const item = recordOf(id);
      if (!item.workspaceDir) await mkdir(dir, { recursive: true, mode: 0o700 });
      const info = await lstat(dir);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error('Workspace path must be a real non-symlink directory.');
      }
      return dir;
    },
    incomingFile(id: string) {
      signal.throwIfAborted();
      if (!catalog.sessions.some(item => item.id === id)) throw new Error('Unknown Harness session.');
      const fileId = randomUUID();
      return { fileId, relativePath: sessionFilePath(id, 'in', fileId) };
    },
    async outgoingFile(id: string, fileId: string) {
      signal.throwIfAborted();
      if (!catalog.sessions.some(item => item.id === id)) throw new Error('Unknown Harness session.');
      const record = await services.storage.assets.stat(sessionFilePath(id, 'out', fileId));
      return { relativePath: record.relativePath, source: { mediaType: record.mediaType ?? 'application/octet-stream', sizeBytes: record.sizeBytes, sha256: record.sha256 } };
    },
    async outgoingWorkspaceFile(id: string, ref: string) {
      signal.throwIfAborted();
      const workspace = workspaceOf(id);
      return publishWorkspaceFile(services.storage.assets, workspace, id, ref, signal);
    },
    inputStatus,
    readAnswer(id: string, requestId: string) {
      type Answer = { status: 'not-found' | 'queued' | 'placed' | 'unanswered' } | { status: 'done'; text: string; truncated: boolean };
      return readSession<Answer>(id, { status: 'not-found' }, reader => reader.commit(async tx => {
        const input = await tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId);
        if (input?.type !== 'input') return { status: 'not-found' };
        if (input.status !== 'done') return { status: input.status };
        const entry = await tx.entry(input.answer);
        if (!entry) throw new Error('The answer entry is unavailable.');
        const text = (entry.model ?? []).flatMap(message => message.role === 'assistant'
          ? message.content.filter(part => part.type === 'text').map(part => part.text).join('')
          : []).join('\n');
        return { status: 'done', ...textPreview(text) };
      }, context));
    },
    pendingDecision,
    async resolveDecision(id: string, taskId: number, revision: string, allow: boolean, feedback?: string) {
      const pending = await pendingDecision(id, taskId);
      if (pending.state !== 'review' || pending.taskId !== taskId || pending.revision !== revision) return 'stale' as const;
      return (await session(id)).resolveDecision(taskId, revision, allow, feedback);
    },
    async stopInput(id: string, requestId: string) {
      // Inspect cold receipts without starting a scheduler or creating a database.
      const status = await inputStatus(id, requestId);
      if (status === 'not-found') return 'not-found' as const;
      if (status === 'done' || status === 'unanswered') return 'settled' as const;
      return (await session(id)).stopInput(requestId);
    },
    async snapshot() {
      const selected = catalog.selected;
      const activeSnapshot = await (await session(selected)).snapshot();
      const selectedRecord = catalog.sessions.find(item => item.id === selected);
      const selectedStatus: SessionStatus = activeSnapshot.decisions.length > 0
        ? 'waiting'
        : activeSnapshot.running
          ? 'running'
          : activeSnapshot.failure
            ? 'error'
            : 'idle';
      sessionMeta.set(selected, {
        status: selectedStatus,
        hasPendingDecision: activeSnapshot.decisions.length > 0,
        activeTool: activeSnapshot.activeTools.find(slot => slot.status === 'sleeping' || slot.status === 'running')?.name,
      });
      return {
        ...activeSnapshot,
        sessionId: selected,
        workspaceDir: selectedRecord?.workspaceDir,
        workspaceLabel: workspaceLabelOf(selectedRecord?.workspaceDir),
        sessions: catalog.sessions.map(item => {
          const meta = sessionMeta.get(item.id);
          return {
            id: item.id,
            title: item.title,
            status: meta?.status ?? 'idle' as SessionStatus,
            hasPendingDecision: meta?.hasPendingDecision ?? false,
            pinned: Boolean(item.pinned),
            ...(item.workSessionRef ? { workSessionRef: item.workSessionRef } : {}),
            ...(item.agentBinding ? { agentBinding: item.agentBinding } : {}),
            ...(item.workspaceDir ? { workspaceDir: item.workspaceDir, workspaceLabel: workspaceLabelOf(item.workspaceDir) } : {}),
            ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
            ...(item.configRef ? { configRef: item.configRef } : {}),
            ...(item.permissionMode ? { permissionMode: item.permissionMode } : {}),
          };
        }),
      };
    },
    async select(id: string) {
      if (!catalog.sessions.some(item => item.id === id)) throw new Error('Unknown Harness session.');
      await mutate(() => save({ ...catalog, selected: id }));
    },
    rename: (id: string, title: string) => mutate(async () => {
      if (!catalog.sessions.some(item => item.id === id)) throw new Error('Unknown Harness session.');
      await save({
        ...catalog,
        sessions: catalog.sessions.map(item => item.id === id ? { ...item, title, updatedAt: Date.now() } : item),
      });
    }),
    pinSession: (id: string, pinned: boolean) => mutate(async () => {
      if (!catalog.sessions.some(item => item.id === id)) throw new Error('Unknown Harness session.');
      await save({
        ...catalog,
        sessions: catalog.sessions.map(item => item.id === id ? { ...item, pinned } : item),
      });
    }),
    setWorkspace: (id: string, dir: string | null) => mutate(async () => {
      const existing = recordOf(id);
      const nextCustom = dir === null ? undefined : await validateWorkspaceDir(dir, forbiddenWorkspaceRoots);
      const nextWorkspace = nextCustom ?? sessionWorkspace(folder, id);
      if (!nextCustom) await mkdir(nextWorkspace, { recursive: true, mode: 0o700 });
      const active = opened.get(id);
      if (active) {
        await (await active).setWorkspace(nextWorkspace, Boolean(nextCustom));
      }
      await save({
        ...catalog,
        sessions: catalog.sessions.map(item => {
          if (item.id !== id) return item;
          const updated: SessionRecord = { ...existing, updatedAt: Date.now() };
          if (nextCustom) updated.workspaceDir = nextCustom;
          else delete updated.workspaceDir;
          return updated;
        }),
      });
    }),
    setPermissionMode: (id: string, mode: PermissionMode) => mutate(async () => {
      if (!isPermissionMode(mode)) throw new Error('Invalid permission mode.');
      const existing = recordOf(id);
      if (existing.workSessionRef && symbiosisClient?.isRunning()) {
        await symbiosisClient.getAgentSessionClient().updateSession({
          workSessionRef: existing.workSessionRef,
          permissionMode: mode,
        } as never);
      }
      const active = opened.get(id);
      if (active) (await active).setPermissionMode(mode);
      await save({
        ...catalog,
        sessions: catalog.sessions.map(item => item.id === id ? { ...item, permissionMode: mode } : item),
      });
    }),
    setReasoningEffort: (id: string, effort: string | null) => mutate(async () => {
      recordOf(id);
      const normalized = effort && effort !== 'default' ? effort : undefined;
      const active = opened.get(id);
      if (active) (await active).setReasoningEffort(normalized);
      await save({
        ...catalog,
        sessions: catalog.sessions.map(item => {
          if (item.id !== id) return item;
          const updated = { ...item };
          if (normalized) updated.reasoningEffort = normalized;
          else delete updated.reasoningEffort;
          return updated;
        }),
      });
    }),
    deleteSession: (id: string) => mutate(async () => {
      const target = recordOf(id);
      if (target.workSessionRef && symbiosisClient?.isRunning()) {
        await symbiosisClient.getAgentSessionClient().deleteSession({
          workSessionRef: target.workSessionRef,
          confirmed: true,
        }).catch(() => {});
      }
      const active = opened.get(id);
      opened.delete(id);
      sessionMeta.delete(id);
      lastActivity.delete(id);
      if (active) {
        const resolved = await active.catch(() => undefined);
        await resolved?.close().catch(() => {});
      }
      const db = sessionDatabase(folder, id);
      await Promise.all([
        removeIgnoreNotFound(db, false),
        removeIgnoreNotFound(db + '-wal', false),
        removeIgnoreNotFound(db + '-shm', false),
        removeIgnoreNotFound(join(folder, 'snapshots', id), true),
      ]);
      // Never delete a user's bound local project folder; only remove sandboxed directories.
      if (!target.workspaceDir) {
        await removeIgnoreNotFound(sessionWorkspace(folder, id), true);
      }
      let remaining = catalog.sessions.filter(item => item.id !== id);
      if (remaining.length === 0) {
        remaining = [{ id: randomUUID(), title: 'New session', updatedAt: Date.now() }];
      }
      const nextSelected = catalog.selected === id ? remaining[0].id : catalog.selected;
      await save({ selected: nextSelected, sessions: remaining });
    }),
    async exportMarkdown(id: string) {
      const record = recordOf(id);
      const workspace = workspaceOf(id);
      const lines: string[] = [
        `# ${record.title}`,
        '',
        `- **Session ID**: \`${record.id}\``,
        `- **Workspace**: \`${workspace}\``,
        `- **Exported**: ${new Date().toISOString()}`,
        '',
        '---',
        '',
      ];
      const entries = await readSession(id, [] as TranscriptEntry[], async reader => {
        const items = await readAllHistoryEntries(reader);
        return items.map(item => ({
          id: item.id,
          role: item.role,
          text: item.text,
          toolName: item.toolName,
          toolFailure: item.toolFailure,
          timestamp: item.timestamp,
        }));
      });
      for (const entry of entries) {
        if (entry.role === 'user') {
          lines.push('## User', '', entry.text, '');
        } else if (entry.role === 'assistant') {
          lines.push('## Assistant', '', entry.text, '');
        } else if (entry.role === 'tool' || entry.role === 'toolResult') {
          const label = entry.toolName ? `Tool: \`${entry.toolName}\`` : 'Tool result';
          const status = entry.toolFailure ? ` (${entry.toolFailure})` : '';
          lines.push(`### ${label}${status}`, '', '```', entry.text, '```', '');
        }
      }
      return lines.join('\n');
    },
    listIntegrations: () => listGrantedIntegrations(services.integration, signal),
    async setInstructions(id: string, text: string) { return (await session(id)).setInstructions(text); },
    async withdraw(id: string, input: number) { return (await session(id)).withdraw(input); },
    create: (configRef?: string, workspaceDir?: string) => mutate(() => addSession(configRef, undefined, workspaceDir)),
    importHome: (source: unknown) => mutate(async () => {
      if (options?.requireSymbiosis) {
        throw new Error('Legacy Home JSON import is retired in Brain-Body Symbiosis mode; continue conversations directly through Runtime.');
      }
      const copy = parseHomeHandoff(source);
      const digest = createHash('sha256').update('home-chat-v1\0').update(JSON.stringify(copy)).digest('hex');
      const existing = catalog.sessions.find(item => item.creationKey === digest);
      if (existing) {
        await save({ ...catalog, selected: existing.id });
        return;
      }
      // Stage the new conversation privately. Only publish it in History once both
      // the passive transcript and the ordinary account-scoped composer draft exist.
      // An interrupted import can finish staging in the same unpublished database.
      const id = [digest.slice(0, 8), digest.slice(8, 12), '8' + digest.slice(13, 16),
        'a' + digest.slice(17, 20), digest.slice(20, 32)].join('-');
      const config = await services.aiConfig.get({ includeRecords: true });
      const configRef = config.record?.configRef;
      const staged = await openSession({
        folder,
        sessionId: id,
        services,
        signal,
        configRef,
        permissionMode: 'strict',
        onProgress: () => {},
      });
      try {
        await staged.importHistory(copy.messages);
      } finally { await staged.close(); }
      signal.throwIfAborted();
      if (copy.draft) await services.storage.writeJson('desktop-draft-' + id + '.json', {
        text: copy.draft, files: [], requestId: randomUUID(),
      });
      await save({
        selected: id,
        sessions: [...catalog.sessions, { id, title: copy.title, ...(configRef ? { configRef } : {}), creationKey: digest, updatedAt: Date.now() }],
      });
    }),
    createRemote: (consumerRef: string, requestId: string, configRef?: string) => mutate(async () => {
      const creationKey = createHash('sha256').update(JSON.stringify([consumerRef, requestId])).digest('hex');
      const existing = catalog.sessions.find(item => item.creationKey === creationKey);
      return existing ? { id: existing.id, title: existing.title } : addSession(configRef, creationKey);
    }),
    async submit(id: string, text: string, requestId: string, queue = false) {
      const currentRecord = recordOf(id);
      if (options?.requireSymbiosis && !currentRecord.workSessionRef) {
        if (!symbiosisClient || !symbiosisClient.isRunning()) {
          throw new Error('Harness PC body symbiosis lease is offline. Reconnect to Nimi Runtime before submitting.');
        }
        const resolvedPartner = currentRecord.agentHandle
          ? { agentHandle: currentRecord.agentHandle, agentBinding: currentRecord.agentBinding ?? defaultAgentBinding }
          : await resolveDefaultPartner();
        if (!resolvedPartner?.agentHandle) {
          throw new Error('No authorized Nimi Partner is available yet. Open Nimi Home to create or authorize a Partner before submitting.');
        }
        // Hold a route-submit barrier until catalog.sessions persists workSessionRef so
        // an outbox NEW_INTENT arriving concurrently binds to this exact session (no duplicate!).
        let releaseBarrier!: () => void;
        const prevBarrier = pendingRouteSubmit;
        const myBarrier = new Promise<void>(r => { releaseBarrier = r; });
        pendingRouteSubmit = prevBarrier.then(() => myBarrier);
        await prevBarrier;
        let routed: Awaited<ReturnType<ReturnType<HarnessBodySymbiosisClient['getAgentSessionClient']>['routeAndSubmitInput']>>;
        let resolvedRef = '';
        try {
          routed = await symbiosisClient.getAgentSessionClient().routeAndSubmitInput({
            agentHandle: resolvedPartner.agentHandle,
            requestId,
            text,
            explicitWorkSessionRef: '',
            entrySurface: 'harness_new_session',
            workspaceRoot: currentRecord.workspaceDir ?? workspaceOf(id),
            workspaceWritable: (currentRecord.permissionMode ?? 'strict') !== 'plan-readonly',
            attachmentPaths: [],
            cardSourceSessionRef: '',
            cardSourceMaxSeq: '0',
            handoffBriefText: '',
            replyToMessageRef: '',
            delegationObjectId: '',
            selectedCandidateRef: '',
            trustTierHint: 'trusted',
          });
          resolvedRef = routed.resolvedWorkSessionRef?.trim() ?? '';
          if (!resolvedRef) {
            throw new Error('Runtime did not allocate a canonical work_session_ref for this session.');
          }
          const conflicting = catalog.sessions.find(entry => entry.id !== id && entry.workSessionRef === resolvedRef);
          if (conflicting) {
            throw new Error(`Runtime routed new session to an already bound work_session_ref (${resolvedRef}).`);
          }
          const resolvedBinding = routed.workSessionRecord?.agentBinding?.trim() || resolvedPartner.agentBinding || defaultAgentBinding;
          const resolvedHandle = resolvedPartner.agentHandle;
          await mutate(async () => {
            const item = catalog.sessions.find(entry => entry.id === id);
            if (!item) return;
            const nextTitle = item.title === 'New session' || item.title === 'First session'
              ? [...text.trim()].slice(0, 44).join('')
              : item.title;
            await save({
              ...catalog,
              sessions: catalog.sessions.map(entry => entry.id === id ? {
                ...entry,
                title: nextTitle,
                workSessionRef: resolvedRef,
                ...(resolvedBinding ? { agentBinding: resolvedBinding } : {}),
                ...(resolvedHandle ? { agentHandle: resolvedHandle } : {}),
                updatedAt: Date.now(),
              } : entry),
            });
          });
          const active = opened.get(id);
          if (active) {
            await (await active).bindRuntimeSession(resolvedRef, resolvedBinding, resolvedHandle);
          }
        } finally {
          releaseBarrier();
        }
        // Runtime enqueues NEW_INTENT via outbox for this session; submit locally using outboxId
        // if present (idempotent with handleBodyNewIntent's OutboxReceiptsDoc) so UI updates immediately.
        const outboxId = routed.outboxId?.trim() || undefined;
        const effectiveRequestId = outboxId || requestId;
        await (await session(id)).submit(text, effectiveRequestId, queue, outboxId);
        return;
      }
      await (await session(id)).submit(text, requestId, queue);
      await mutate(async () => {
        const item = catalog.sessions.find(entry => entry.id === id);
        if (!item) return;
        const nextTitle = item.title === 'New session' ? [...text.trim()].slice(0, 44).join('') : item.title;
        await save({
          ...catalog,
          sessions: catalog.sessions.map(entry => entry.id === id ? { ...entry, title: nextTitle, updatedAt: Date.now() } : entry),
        });
      });
    },
    async reviewModel(id: string, confirmation?: string, configRef?: string) {
      return (await session(id)).reviewModel(confirmation, configRef);
    },
    async decide(id: string, taskId: number, allow: boolean, feedback?: string, allowForSession = false, revision?: string) {
      return (await session(id)).decide(taskId, allow, feedback, allowForSession, revision);
    },
    async listSnapshots(id: string): Promise<readonly PreWriteSnapshotRecord[]> {
      return (await session(id)).listSnapshots();
    },
    async restoreSnapshot(id: string, snapshotId: string): Promise<{ restored: boolean; relativePath: string }> {
      return (await session(id)).restoreSnapshot(snapshotId);
    },
    async stop(id: string) { return (await session(id)).stop(); },
    async resume(id: string) { return (await session(id)).resume(); },
    async attachSymbiosis(nextSymbiosis: HarnessBodySymbiosisClient, agentBinding?: string, agentHandle?: string, agentDisplayName?: string) {
      symbiosisClient = nextSymbiosis;
      if (agentBinding) defaultAgentBinding = agentBinding;
      if (agentHandle) defaultAgentHandle = agentHandle;
      if (agentDisplayName) defaultAgentDisplayName = agentDisplayName;
      // Rebind every already-opened session so a renderer snapshot racing ahead of
      // symbiosis startup never strands an opened session offline.
      await Promise.allSettled([...opened.values()].map(async pending => {
        const resolved = await pending;
        await resolved.attachSymbiosis(nextSymbiosis, agentBinding, agentHandle, agentDisplayName);
      }));
      viewChanged?.();
    },
    async selectByWorkSessionRef(workSessionRef: string) {
      const trimmed = workSessionRef.trim();
      if (!trimmed) return false;
      const found = catalog.sessions.find(item => item.workSessionRef === trimmed || item.id === trimmed);
      if (!found) return false;
      await mutate(() => save({ ...catalog, selected: found.id }));
      return true;
    },
    async handleBodyPurgeSession(workSessionRef: string) {
      const trimmed = workSessionRef.trim();
      const target = catalog.sessions.find(item => item.workSessionRef === trimmed || item.id === trimmed);
      if (!target) return;
      await mutate(async () => {
        const current = catalog.sessions.find(item => item.id === target.id);
        if (!current) return;
        const active = opened.get(current.id);
        opened.delete(current.id);
        sessionMeta.delete(current.id);
        lastActivity.delete(current.id);
        if (active) {
          const resolved = await active.catch(() => undefined);
          await resolved?.close().catch(() => {});
        }
        const db = sessionDatabase(folder, current.id);
        // Fail-closed: ignore ENOENT only; rethrow EBUSY/EPERM BEFORE removing catalog entry
        // so the outbox consumer does NOT ACK an incomplete purge and retries cleanly.
        await Promise.all([
          removeIgnoreNotFound(db, false),
          removeIgnoreNotFound(db + '-wal', false),
          removeIgnoreNotFound(db + '-shm', false),
          removeIgnoreNotFound(join(folder, 'snapshots', current.id), true),
        ]);
        if (!current.workspaceDir) {
          await removeIgnoreNotFound(sessionWorkspace(folder, current.id), true);
        }
        let remaining = catalog.sessions.filter(item => item.id !== current.id);
        if (remaining.length === 0) {
          remaining = [{ id: randomUUID(), title: 'New session', updatedAt: Date.now() }];
        }
        const nextSelected = catalog.selected === current.id ? remaining[0].id : catalog.selected;
        await save({ selected: nextSelected, sessions: remaining });
      });
    },
    async handleBodyPurgeAgent(agentBinding: string) {
      const trimmed = agentBinding.trim();
      await mutate(async () => {
        const matches = catalog.sessions.filter(item => item.agentBinding === trimmed);
        if (matches.length === 0) return;
        const purgedIds = new Set<string>();
        for (const item of matches) {
          const active = opened.get(item.id);
          opened.delete(item.id);
          sessionMeta.delete(item.id);
          lastActivity.delete(item.id);
          if (active) {
            const resolved = await active.catch(() => undefined);
            await resolved?.close().catch(() => {});
          }
          const db = sessionDatabase(folder, item.id);
          // Fail-closed: if physical deletion fails, persist already-purged subset and rethrow
          // so outbox does NOT ACK the PURGE_AGENT tombstone until every session is erased.
          try {
            await Promise.all([
              removeIgnoreNotFound(db, false),
              removeIgnoreNotFound(db + '-wal', false),
              removeIgnoreNotFound(db + '-shm', false),
              removeIgnoreNotFound(join(folder, 'snapshots', item.id), true),
            ]);
            if (!item.workspaceDir) {
              await removeIgnoreNotFound(sessionWorkspace(folder, item.id), true);
            }
            purgedIds.add(item.id);
          } catch (error) {
            if (purgedIds.size > 0) {
              let remaining = catalog.sessions.filter(entry => !purgedIds.has(entry.id));
              if (remaining.length === 0) {
                remaining = [{ id: randomUUID(), title: 'New session', updatedAt: Date.now() }];
              }
              const nextSelected = purgedIds.has(catalog.selected) ? remaining[0].id : catalog.selected;
              await save({ selected: nextSelected, sessions: remaining }).catch(() => {});
            }
            throw error;
          }
        }
        let remaining = catalog.sessions.filter(item => !purgedIds.has(item.id));
        if (remaining.length === 0) {
          remaining = [{ id: randomUUID(), title: 'New session', updatedAt: Date.now() }];
        }
        const nextSelected = purgedIds.has(catalog.selected) ? remaining[0].id : catalog.selected;
        await save({ selected: nextSelected, sessions: remaining });
      });
    },
    async revokeAllGrants() {
      await Promise.allSettled([...opened.values()].map(async pending => {
        const resolved = await pending.catch(() => undefined);
        resolved?.revokeGrants();
      }));
    },
    async handleBodyInvalidateMemory(workSessionRef: string) {
      const trimmed = workSessionRef.trim();
      const target = catalog.sessions.find(item => item.workSessionRef === trimmed || item.id === trimmed);
      if (!target) return;
      const active = opened.get(target.id);
      if (active) {
        const resolved = await active;
        resolved.revokeGrants();
        // Do NOT swallow errors: outbox ACK MUST only fire after active run stop succeeds.
        await resolved.stop();
      }
    },
    async handleBodyNewIntent(env: { outboxId: string; workSessionRef: string; agentBinding: string; payloadJson: string }) {
      // Wait for any in-flight standalone routeAndSubmitInput to persist its workSessionRef
      // before checking catalog.sessions, eliminating dual local session creation races.
      await pendingRouteSubmit;
      let parsed: {
        text?: string;
        title?: string;
        workspaceRoot?: string;
        permissionMode?: string;
        agentHandle?: string;
        handoffBriefText?: string;
        handoffHistory?: { role: 'user' | 'assistant'; text: string }[];
        attachmentPaths?: string[];
      } = {};
      try {
        const raw = JSON.parse(env.payloadJson || '{}') as Record<string, unknown>;
        if (raw && typeof raw === 'object') {
          const rawHistory = Array.isArray(raw.handoffHistory) ? raw.handoffHistory : [];
          const handoffHistory: { role: 'user' | 'assistant'; text: string }[] = [];
          for (const entry of rawHistory) {
            if (!entry || typeof entry !== 'object') continue;
            const rec = entry as Record<string, unknown>;
            const role = rec.role === 'assistant' ? 'assistant' : rec.role === 'user' ? 'user' : undefined;
            const entryText = typeof rec.text === 'string' ? rec.text : typeof rec.content === 'string' ? rec.content : '';
            if (role && entryText.trim()) {
              handoffHistory.push({ role, text: entryText });
            }
          }
          const rawAttachments = Array.isArray(raw.attachmentPaths) ? raw.attachmentPaths : [];
          const attachmentPaths = rawAttachments.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
          parsed = {
            text: typeof raw.text === 'string' ? raw.text : undefined,
            title: typeof raw.title === 'string' ? raw.title : undefined,
            workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot : undefined,
            permissionMode: typeof raw.permissionMode === 'string' ? raw.permissionMode : undefined,
            agentHandle: typeof raw.agentHandle === 'string' ? raw.agentHandle : undefined,
            handoffBriefText: typeof raw.handoffBriefText === 'string' ? raw.handoffBriefText : undefined,
            ...(handoffHistory.length > 0 ? { handoffHistory } : {}),
            ...(attachmentPaths.length > 0 ? { attachmentPaths } : {}),
          };
        }
      } catch {
        // Keep empty payload if malformed; do not crash outbox loop.
      }
      const targetRef = env.workSessionRef.trim();
      const incomingPerm: PermissionMode | undefined = isPermissionMode(parsed.permissionMode) ? parsed.permissionMode : undefined;
      let sessionId = catalog.sessions.find(item => item.workSessionRef === targetRef || item.id === targetRef)?.id;
      if (!sessionId) {
        let validatedWorkspace: string | undefined;
        if (parsed.workspaceRoot) {
          validatedWorkspace = await validateWorkspaceDir(parsed.workspaceRoot, forbiddenWorkspaceRoots).catch(() => undefined);
        }
        const newId = randomUUID();
        const title = parsed.title?.trim() || (parsed.text ? [...parsed.text.trim()].slice(0, 44).join('') : 'New task');
        const perm: PermissionMode = incomingPerm ?? 'strict';
        await mutate(async () => {
          const existing = catalog.sessions.find(item => item.workSessionRef === targetRef);
          if (existing) {
            sessionId = existing.id;
            return;
          }
          const nextRec: SessionRecord = {
            id: newId,
            title,
            workSessionRef: targetRef || newId,
            ...(env.agentBinding ? { agentBinding: env.agentBinding } : {}),
            ...(parsed.agentHandle ? { agentHandle: parsed.agentHandle } : {}),
            ...(validatedWorkspace ? { workspaceDir: validatedWorkspace } : {}),
            permissionMode: perm,
            updatedAt: Date.now(),
          };
          await save({ selected: newId, sessions: [...catalog.sessions, nextRec] });
          sessionId = newId;
        });
      } else {
        // Enforce permission downgrade on existing sessions (never silently escalate privileges).
        await mutate(async () => {
          const existing = catalog.sessions.find(item => item.id === sessionId);
          if (!existing) return;
          const currentPerm = existing.permissionMode ?? 'strict';
          const downgradedPerm = incomingPerm && permissionModeStrictness(incomingPerm) > permissionModeStrictness(currentPerm)
            ? incomingPerm
            : currentPerm;
          const needsUpdate = downgradedPerm !== currentPerm
            || (!existing.agentBinding && Boolean(env.agentBinding))
            || (!existing.agentHandle && Boolean(parsed.agentHandle));
          if (!needsUpdate) return;
          if (downgradedPerm !== currentPerm) {
            const active = opened.get(existing.id);
            if (active) (await active).setPermissionMode(downgradedPerm);
          }
          await save({
            ...catalog,
            sessions: catalog.sessions.map(item => item.id === existing.id ? {
              ...item,
              permissionMode: downgradedPerm,
              ...(!item.agentBinding && env.agentBinding ? { agentBinding: env.agentBinding } : {}),
              ...(!item.agentHandle && parsed.agentHandle ? { agentHandle: parsed.agentHandle } : {}),
              updatedAt: Date.now(),
            } : item),
          });
        });
      }
      if (sessionId) {
        const openedSess = await session(sessionId);
        if (parsed.handoffHistory && parsed.handoffHistory.length > 0) {
          await openedSess.importHistory(parsed.handoffHistory);
        }
        const promptParts: string[] = [];
        if (parsed.handoffBriefText?.trim()) {
          promptParts.push(`[Handoff Context]\n${parsed.handoffBriefText.trim()}`);
        }
        if (parsed.attachmentPaths && parsed.attachmentPaths.length > 0) {
          const activeWs = workspaceOf(sessionId);
          const safeAttachments: string[] = [];
          for (const rawAtt of parsed.attachmentPaths) {
            const inside = await isInsideWorkspace(activeWs, rawAtt).catch(() => false);
            if (inside) {
              const rel = relative(resolve(activeWs), resolve(activeWs, rawAtt)).split(sep).join('/');
              if (rel && !isSensitivePath(rel, activeWs)) {
                safeAttachments.push(`- ${rel}`);
              }
            } else {
              safeAttachments.push(`- ${basename(rawAtt) || 'attachment'} (outside active workspace; import into workspace to inspect)`);
            }
          }
          if (safeAttachments.length > 0) {
            promptParts.push(`[Attached Workspace Files]\n${safeAttachments.join('\n')}`);
          }
        }
        if (parsed.text?.trim()) {
          promptParts.push(parsed.text.trim());
        }
        const finalText = promptParts.join('\n\n').trim();
        if (finalText) {
          await openedSess.submit(finalText, env.outboxId, true, env.outboxId);
        }
      }
    },
    listBodyProjectionsForReconcile() {
      // ONLY report sessions that hold an authoritative Runtime workSessionRef.
      // Never report unbound local placeholders (such as initial 'main') that cause 404 on startup!
      return catalog.sessions
        .filter(item => Boolean(item.workSessionRef))
        .map(item => {
          const meta = sessionMeta.get(item.id);
          return {
            workSessionRef: item.workSessionRef!,
            status: meta?.status === 'waiting' ? 'waiting_approval' : (meta?.status ?? 'idle'),
            title: item.title,
            ...(item.workspaceDir ? { workspaceRoot: item.workspaceDir } : {}),
            permissionMode: item.permissionMode ?? 'strict',
          };
        });
    },
    async close() {
      await mutations;
      const results = await Promise.allSettled([...opened.values()].map(async pending => (await pending).close()));
      opened.clear();
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
  };
}

async function readSessionModel(
  services: NimiElectronAppBusinessServices,
  signal: AbortSignal,
  configRef: string | undefined,
  getReasoningEffort: () => string | undefined,
  agentBinding?: string,
) {
  let config;
  try { config = await services.aiConfig.get(configRef ? { configRef } : { includeRecords: true }); }
  catch (cause) {
    signal.throwIfAborted();
    const code = extractNimiErrorFields(cause).reasonCode;
    if (code === 'ai-config-not-found' || code === 'AI_CONFIG_NOT_FOUND') return undefined;
    throw cause;
  }
  signal.throwIfAborted();
  const selection = config.effectiveSelections.find(item => item.capabilityContract === 'text.generate');
  const resource = selection?.resource;
  if (!config.record || selection?.state !== 'ready' || !resource) {
    return undefined;
  }
  const label = resource.oneofKind === 'local' ? resource.local.label : resource.cloud.target.label;
  // v2.1 invariant: stable logical model ID prevents failNoModel when switching
  // a LocalAgent's underlying model in Nimi Home while preserving guard confirmation.
  const modelId = logicalAgentModelId(agentBinding ?? config.record.configRef);
  const imageInput = resource.oneofKind === 'local' ? resource.local.configuredFeatures.includes('input.image')
    : resource.cloud.target.supportedFeatures.includes('input.image');
  const guard = {
    configRef: config.record.configRef, expectedRevision: config.record.revision,
    ...(resource.oneofKind === 'local' && selection.localLoadoutRevision ? {
      expectedLocalLoadoutRef: resource.local.loadoutRef,
      expectedLocalLoadoutRevision: selection.localLoadoutRevision,
    } : {}),
  };
  const provider = nimiProvider(
    services.ai,
    modelId,
    label,
    Boolean(selection.reasoningInput),
    imageInput,
    selection.contextWindowTokens,
    guard,
    () => buildReasoningOptions(selection.reasoningInput, getReasoningEffort()),
  );
  const confirmation = createHash('sha256').update(JSON.stringify([modelId, guard])).digest('hex');
  return {
    label,
    selection,
    modelId,
    provider,
    confirmation,
    configRef: config.record.configRef,
    revision: config.record.revision,
    localLoadoutRef: guard.expectedLocalLoadoutRef,
    localLoadoutRevision: guard.expectedLocalLoadoutRevision,
    reasoningChoices: projectReasoningChoices(selection.reasoningInput),
  };
}

function compactionSettings(tokens?: number) {
  const margin = tokens === undefined ? undefined : Math.floor(tokens / 4);
  return {
    keepRecentTokens: 0,
    // v2.1 invariant: ALWAYS disable background async compaction to eliminate
    // background queueing and isStale races; compaction runs synchronously via
    // CompactionTask beforeCompact hook.
    backgroundTokens: 0,
    ...(margin === undefined ? {} : {
      reserveTokens: Math.min(margin, DEFAULT_COMPACTION_POLICY.reserveTokens),
    }),
  };
}

type OpenSessionOptions = {
  folder: string;
  forbiddenWorkspaceRoots?: readonly string[];
  sessionId: string;
  workSessionRef?: string;
  services: NimiElectronAppBusinessServices;
  signal: AbortSignal;
  configRef?: string;
  workspaceDir?: string;
  agentBinding?: string;
  agentHandle?: string;
  agentDisplayName?: string;
  symbiosis?: HarnessBodySymbiosisClient;
  requireSymbiosis?: boolean;
  allowSourceLocalDev?: boolean;
  allowInsecureTestFallback?: boolean;
  permissionMode: PermissionMode;
  reasoningEffort?: string;
  onStatus?: (meta: SessionRuntimeMeta, latestTaskId?: number, lastStepAt?: number) => void;
  onProgress: () => void;
};

async function openSession(opts: OpenSessionOptions) {
  const { folder, sessionId, services, signal, configRef, onProgress, onStatus } = opts;
  let effectiveWorkSessionRef = opts.workSessionRef ?? sessionId;
  let effectiveAgentBinding = opts.agentBinding ?? 'default';
  let effectiveAgentHandle = opts.agentHandle ?? effectiveAgentBinding;
  let effectiveAgentDisplayName = opts.agentDisplayName?.trim() || 'Nimi Partner';
  let activeSymbiosis: HarnessBodySymbiosisClient | undefined = opts.symbiosis;
  let currentWorkspace = opts.workspaceDir ?? sessionWorkspace(folder, sessionId);
  let explicitDevWorkspace = Boolean(opts.workspaceDir);
  let currentPermissionMode: PermissionMode = opts.permissionMode;
  let currentReasoningEffort: string | undefined = opts.reasoningEffort;
  let selectedRef: string | undefined = configRef;
  let effectiveContextBudgetTokens: number | undefined;
  const sessionAllowlist = new Set<string>();
  const authorizedGrants = new Map<string, AuthorizedSideEffectGrant>();
  const outboxIdByPayloadHash = new Map<string, string>();

  if (opts.workspaceDir) {
    currentWorkspace = await validateWorkspaceDir(opts.workspaceDir, opts.forbiddenWorkspaceRoots);
  } else {
    await mkdir(currentWorkspace, { recursive: true, mode: 0o700 });
  }
  signal.throwIfAborted();

  const buildSecureEnv = (workspaceRoot: string, isExplicitDev: boolean) => new SecureWorkspaceExecutionEnv({
    sessionId,
    workspaceRoot,
    explicitDevWorkspace: isExplicitDev,
    dataRoot: folder,
    allowSourceLocalDev: opts.allowSourceLocalDev,
    allowInsecureTestFallback: opts.allowInsecureTestFallback,
    ...(opts.symbiosis || opts.requireSymbiosis ? {
      authorizeSideEffect: async ({ actionKind, relativePath }) => {
        if (!activeSymbiosis || !activeSymbiosis.isRunning()) {
          if (opts.requireSymbiosis || activeSymbiosis) {
            throw new Error('Side effect denied fail-closed: Harness PC body symbiosis lease is offline.');
          }
          return;
        }
        // Verify that beforeTool already synchronously authorized this exact side effect
        // on the CURRENT active leaseEpoch with Runtime's once-only AuthorizeBodySideEffect.
        const currentEpoch = activeSymbiosis.getLeaseEpoch();
        const normalizedRel = relativePath.toLowerCase();
        for (const [grantId, grant] of authorizedGrants.entries()) {
          if (grant.remainingUses <= 0 || grant.leaseEpoch !== currentEpoch) continue;
          const kindMatches = actionKind === 'shell_exec'
            ? grant.actionKind === 'shell_exec'
            : grant.actionKind === 'file_write';
          const pathMatches = actionKind === 'shell_exec'
            || (Boolean(grant.targetPath) && grant.targetPath!.toLowerCase() === normalizedRel);
          if (kindMatches && pathMatches) {
            grant.remainingUses -= 1;
            if (grant.remainingUses <= 0) authorizedGrants.delete(grantId);
            return;
          }
        }
        throw new Error(`Side effect denied fail-closed: missing Runtime tool authorization grant for ${actionKind} (${relativePath}).`);
      },
    } : {}),
  });

  let secureEnv = buildSecureEnv(currentWorkspace, explicitDevWorkspace);

  const models = createModels();
  const registry = createRegistry();
  registry.install(process.platform === 'win32' ? defineExtension({
    name: 'coding-tools', tools: [createReadTool(), createWriteTool(), createEditTool(), createPowerShellTool({ programs: ['powershell'] })],
  }) : CodingTools);
  registry.install(searchTools(() => currentWorkspace, signal, {
    readWorkspaceFile: (rel, maxBytes) => secureEnv.readWorkspaceFileSecure(rel, maxBytes),
  }));
  registry.install(sessionFileTools(services.storage.assets, () => currentWorkspace, sessionId, signal));
  registry.install(transcriptionTools(services.ai, () => currentWorkspace, sessionId, signal, () => selectedRef));
  registry.install(integrationTools(services.integration, signal));
  registry.install(createApprovalsExtension({
    getPermissionMode: () => currentPermissionMode,
    getWorkspace: () => currentWorkspace,
    isExplicitDevWorkspace: () => explicitDevWorkspace,
    sessionAllowlist,
    integration: services.integration,
    getSymbiosis: () => activeSymbiosis,
    requireSymbiosis: opts.requireSymbiosis,
    getWorkSessionRef: () => effectiveWorkSessionRef,
    authorizedGrants,
    signal,
  }));
  registry.install(createCompactionExtension({
    getWorkSessionRef: () => effectiveWorkSessionRef,
    getAgentBinding: () => effectiveAgentBinding,
    getAgentHandle: () => effectiveAgentHandle,
    getSymbiosis: () => activeSymbiosis,
    requireSymbiosis: opts.requireSymbiosis,
    onBudgetUpdated: budget => { effectiveContextBudgetTokens = budget; },
  }));
  registry.install(requestBudget);
  // A writable durable instance schedules every pending conversation in its
  // database. Separate databases let Resume and Stop affect the named session.
  const database = sessionDatabase(folder, sessionId);
  // v2.1 durability invariant: ALWAYS open pi-durable SQLite with verified WAL + synchronous=FULL (2).
  const durableDb = await openDurableFullStorage(database);
  const harness = await Harness.open(durableDb.storage, {
    models,
    registry,
    env: () => secureEnv,
    settings: { compaction: compactionSettings() },
  }, context);
  try {
    signal.throwIfAborted();
    const saved = await harness.snapshot(SessionModel, ROOT_CONVERSATION_ID, context);
    const savedReceipts = await harness.snapshot(OutboxReceiptsDoc, ROOT_CONVERSATION_ID, context);
    if (savedReceipts?.byRequestId) {
      for (const rec of Object.values(savedReceipts.byRequestId)) {
        if (rec.outboxId && rec.payloadHash) {
          outboxIdByPayloadHash.set(rec.payloadHash, rec.outboxId);
        }
      }
    }
    let reviewedConflict = saved?.reviewedConflict;
    selectedRef = saved?.configRef ?? configRef;
    const conversation = await harness.root(context, {
      agent: {
        cwd: currentWorkspace,
        instructions: defaultInstructions,
      },
    });
    const watch = await conversation.watch(context);
    watch.start(async () => {});
    const storedAgent = await harness.snapshot(AgentDoc, conversation.id, context);
    let instructions = storedAgent?.instructions ?? defaultInstructions;
    let needsResume = Boolean((await harness.snapshot(LiveDoc, conversation.id, context))?.run);
    if (storedAgent && storedAgent.cwd !== currentWorkspace && !needsResume) {
      await harness.commit(async tx => {
        await configure(tx, conversation.id, { cwd: currentWorkspace });
      }, context);
    }

    let bound: Awaited<ReturnType<typeof readSessionModel>>;
    const resolveOutboxIdForUserContent = (content: unknown): string | undefined => {
      if (typeof content === 'string') {
        return outboxIdByPayloadHash.get(hashOutboxPayload(content));
      }
      if (Array.isArray(content)) {
        const text = (content as Array<{ type?: string; text?: string }>)
          .filter(part => part?.type === 'text' && typeof part.text === 'string')
          .map(part => part.text!)
          .join('\n');
        if (text) return outboxIdByPayloadHash.get(hashOutboxPayload(text));
      }
      return undefined;
    };
    const applySymbiosisProvider = async (nextSymbiosis: HarnessBodySymbiosisClient) => {
      activeSymbiosis = nextSymbiosis;
      const logicalId = logicalAgentModelId(effectiveAgentBinding);
      const budgetTokens = nextSymbiosis.getEffectiveContextBudgetTokens();
      const symbiosisProvider = nimiBodySymbiosisProvider({
        symbiosis: nextSymbiosis,
        agentHandle: effectiveAgentHandle,
        agentBinding: effectiveAgentBinding,
        workSessionRef: effectiveWorkSessionRef,
        label: effectiveAgentDisplayName,
        workspaceName: () => workspaceLabelOf(currentWorkspace) ?? 'workspace',
        permissionMode: () => currentPermissionMode,
        contextWindow: budgetTokens,
        onBudgetUpdated: budget => { effectiveContextBudgetTokens = budget; },
        resolveOutboxId: resolveOutboxIdForUserContent,
      });
      const confirmation = createHash('sha256').update(JSON.stringify(['body-symbiosis', logicalId])).digest('hex');
      const currentAgent = await harness.snapshot(AgentDoc, conversation.id, context);
      const currentSaved = await harness.snapshot(SessionModel, conversation.id, context);
      if (!currentAgent?.model || currentAgent.model.modelId !== logicalId || currentSaved?.confirmation !== confirmation) {
        await harness.commit(async tx => {
          await configure(tx, conversation.id, {
            model: { provider: 'nimi', modelId: logicalId },
            compaction: compactionSettings(budgetTokens),
          });
          Object.assign(await tx.doc(SessionModel, conversation.id), {
            configRef: selectedRef ?? 'main',
            confirmation,
          });
        }, context);
      }
      models.setProvider(symbiosisProvider);
      bound = {
        label: effectiveAgentDisplayName,
        selection: { contextWindowTokens: budgetTokens } as NonNullable<Awaited<ReturnType<typeof readSessionModel>>>['selection'],
        modelId: logicalId,
        provider: symbiosisProvider,
        confirmation,
        configRef: selectedRef ?? 'main',
        revision: 'symbiosis',
        localLoadoutRef: undefined,
        localLoadoutRevision: undefined,
        reasoningChoices: [],
      };
    };

    if (activeSymbiosis) {
      // Fork 3 canonical cutover: inference routes exclusively through StreamLocalAgentBodyStep
      // using stable logical model ID local-agent:<agentBinding>.
      await applySymbiosisProvider(activeSymbiosis);
    } else if (!opts.requireSymbiosis) {
      const current = await readSessionModel(services, signal, selectedRef, () => currentReasoningEffort, opts.agentBinding);
      const capture = watch.value.entries.flatMap(entry => entry.model ?? []).flatMap(message =>
        message.role === 'assistant' ? message.diagnostics?.filter(item => item.type === 'nimi.config-captured') ?? [] : [],
      ).at(-1)?.details;
      const samePreviousSelection = saved?.confirmation ? saved.confirmation === current?.confirmation
        : !capture || (capture.configRef === current?.configRef && capture.revision === current?.revision
          && capture.localLoadoutRef === current?.localLoadoutRef && capture.localLoadoutRevision === current?.localLoadoutRevision);
      bound = current && samePreviousSelection && (!storedAgent?.model || storedAgent.model.modelId === current.modelId) ? current : undefined;
      if (bound) {
        const initial = bound;
        if (!saved?.confirmation || !storedAgent?.model) {
          await harness.commit(async tx => {
            await configure(tx, conversation.id, {
              model: { provider: 'nimi', modelId: initial.modelId },
              compaction: compactionSettings(initial.selection.contextWindowTokens),
            });
            Object.assign(await tx.doc(SessionModel, conversation.id), { configRef: initial.configRef, confirmation: initial.confirmation });
          }, context);
        }
        selectedRef = initial.configRef;
        models.setProvider(initial.provider);
      }
    }

    const reportStatus = async () => {
      if (signal.aborted || !onStatus) return;
      try {
        const live = await harness.snapshot(LiveDoc, conversation.id, context);
        const waitingSlot = live?.tools?.find(slot => slot.status === 'sleeping');
        const runningSlot = live?.tools?.find(slot => slot.status === 'running' || slot.status === 'pending');
        const conflict = isModelConflict(live?.runFailure);
        const reviewNeeded = conflict && live?.runFailure?.taskId !== reviewedConflict;
        const hasError = Boolean(reviewNeeded || (live?.runFailure && live.runFailure.reason !== 'aborted'));
        const status: SessionStatus = waitingSlot
          ? 'waiting'
          : live?.run
            ? 'running'
            : hasError
              ? 'error'
              : 'idle';
        const lastMessage = watch.value.entries.flatMap(entry => entry.model ?? []).reverse().find(message => message.role === 'assistant');
        onStatus(
          { status, hasPendingDecision: Boolean(waitingSlot), activeTool: waitingSlot?.name ?? runningSlot?.name },
          waitingSlot?.taskId ?? live?.run?.taskId ?? live?.runFailure?.taskId,
          lastMessage?.timestamp,
        );
      } catch {
        // Ignore transient status reads during close.
      }
    };

    harness.observeCommits({
      advance: publication => {
        if (publication.changes.length) {
          onProgress();
          void reportStatus();
        }
      },
      end: onProgress,
    });

    return {
      reader: harness,
      async attachSymbiosis(nextSymbiosis: HarnessBodySymbiosisClient, agentBinding?: string, agentHandle?: string, agentDisplayName?: string) {
        if (agentBinding) effectiveAgentBinding = agentBinding;
        if (agentHandle) effectiveAgentHandle = agentHandle;
        if (agentDisplayName && agentDisplayName.trim()) effectiveAgentDisplayName = agentDisplayName.trim();
        await applySymbiosisProvider(nextSymbiosis);
      },
      async bindRuntimeSession(workSessionRef: string, agentBinding?: string, agentHandle?: string) {
        effectiveWorkSessionRef = workSessionRef;
        if (agentBinding) effectiveAgentBinding = agentBinding;
        if (agentHandle) effectiveAgentHandle = agentHandle;
        if (activeSymbiosis) {
          await applySymbiosisProvider(activeSymbiosis);
        }
      },
      setPermissionMode(mode: PermissionMode) {
        currentPermissionMode = mode;
      },
      setReasoningEffort(effort: string | undefined) {
        currentReasoningEffort = effort;
      },
      async setWorkspace(nextWorkspace: string, isExplicitDev = true) {
        signal.throwIfAborted();
        await harness.commit(async tx => {
          signal.throwIfAborted();
          if ((await tx.doc(LiveDoc, conversation.id)).run) {
            throw new Error('Stop the active task before changing the workspace folder.');
          }
          await configure(tx, conversation.id, { cwd: nextWorkspace });
        }, context);
        currentWorkspace = nextWorkspace;
        explicitDevWorkspace = isExplicitDev;
        secureEnv = buildSecureEnv(currentWorkspace, explicitDevWorkspace);
      },
      listSnapshots(): readonly PreWriteSnapshotRecord[] {
        return secureEnv.getSnapshots();
      },
      async restoreSnapshot(snapshotId: string): Promise<{ restored: boolean; relativePath: string }> {
        signal.throwIfAborted();
        const res = await secureEnv.restorePreWriteSnapshot(snapshotId);
        onProgress();
        return res;
      },
      async importHistory(messages: ReturnType<typeof parseHomeHandoff>['messages']) {
        if (!messages.length || watch.value.entries.some(entry => HomeHistory.is(entry))) return;
        await harness.commit(async tx => {
          signal.throwIfAborted();
          await tx.appendEntry(HomeHistory, conversation.id, {
            data: { messages },
            model: [{
              role: 'user', timestamp: Date.now(), content:
                'Previous Nimi Home dialogue in chronological order. Use it as historical context for the next user message.\n' + JSON.stringify(messages),
            }],
          });
        }, context);
      },
      revokeGrants() {
        authorizedGrants.clear();
      },
      getLatestMilestoneSummary() {
        const lastAssistant = watch.value.entries
          .flatMap(entry => entry.model ?? [])
          .reverse()
          .find(msg => msg.role === 'assistant');
        const assistantText = lastAssistant && lastAssistant.role === 'assistant'
          ? lastAssistant.content
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join(' ')
            .replace(/\s+/gu, ' ')
            .trim()
          : '';
        const topicSummary = assistantText ? assistantText.slice(0, 240) : '';
        const deliverablePaths = secureEnv.getRecentAiEditedFiles().slice(0, 12).map(f => f.relativePath);
        return { topicSummary, deliverablePaths };
      },
      close: () => {
        sessionAllowlist.clear();
        authorizedGrants.clear();
        return harness.close(context);
      },
      async resolveDecision(taskId: number, revision: string, allow: boolean, feedback?: string) {
        signal.throwIfAborted();
        const trimmedFeedback = !allow && typeof feedback === 'string' && feedback.trim() ? feedback.trim().slice(0, 4000) : undefined;
        const result = await harness.commit(async tx => {
          const pending = await readPendingDecision(tx, sessionId, decision.key('decision').signal, {
            recentAiEditedPaths: secureEnv.getRecentAiEditedFiles().map(f => f.relativePath),
            workspaceRoot: currentWorkspace,
            taskId,
          });
          if (pending.state !== 'review' || pending.taskId !== taskId || pending.revision !== revision) return 'closed';
          if (Date.now() > pending.expiresAt) return 'expired';
          if (allow && !pending.remoteApprovalAllowed) return 'open-on-pc-required';
          signal.throwIfAborted();
          return tx.signal(taskId as TaskId, decision, 'decision', trimmedFeedback ? { allow, feedback: trimmedFeedback } : { allow });
        }, context);
        if (result !== 'delivered') return 'stale' as const;
        signal.throwIfAborted();
        needsResume = false;
        harness.resume();
        return 'recorded' as const;
      },
      async reviewModel(confirmation?: string, requestedRef?: string) {
        if (opts.requireSymbiosis) {
          throw new Error('Model routing is managed by Nimi Home and Runtime in Brain-Body Symbiosis mode; switch the active Partner model in Nimi Home.');
        }
        const next = await readSessionModel(services, signal, requestedRef ?? selectedRef, () => currentReasoningEffort);
        if (!next) throw new Error('Choose a configuration with an available text model.');
        const preview = { label: next.label, confirmation: next.confirmation, configRef: next.configRef };
        if (confirmation === undefined) return preview;
        if (next.confirmation !== confirmation) throw new Error('The model settings changed again. Review the latest selection.');
        const acknowledged = await harness.commit(async tx => {
          signal.throwIfAborted();
          const live = await tx.doc(LiveDoc, conversation.id);
          if (live.run) throw new Error('Stop the active task before switching models.');
          await configure(tx, conversation.id, {
            model: { provider: 'nimi', modelId: next.modelId },
            compaction: compactionSettings(next.selection.contextWindowTokens),
          });
          const selection = await tx.doc(SessionModel, conversation.id);
          Object.assign(selection, { configRef: next.configRef, confirmation: next.confirmation });
          if (live.runFailure && isModelConflict(live.runFailure)) selection.reviewedConflict = live.runFailure.taskId;
          return selection.reviewedConflict;
        }, context);
        reviewedConflict = acknowledged;
        models.setProvider(next.provider);
        bound = next;
        selectedRef = next.configRef;
        return preview;
      },
      async setInstructions(text: string) {
        const next = text || defaultInstructions;
        await harness.commit(async tx => {
          signal.throwIfAborted();
          if ((await tx.doc(LiveDoc, conversation.id)).run) throw new Error('Finish or stop the current task before changing its instructions.');
          await configure(tx, conversation.id, { instructions: next });
        }, context);
        instructions = next;
      },
      async snapshot() {
        signal.throwIfAborted();
        const live = await harness.snapshot(LiveDoc, conversation.id, context);
        const activeCalls = new Map<string, ToolCall>();
        const toolCallNodes = new Map<string, TranscriptToolCall>();
        const liveSlotByCallId = new Map((live?.tools ?? []).map(slot => [slot.callId, slot]));
        let workspaceRevision: number | undefined;
        const entries: TranscriptEntry[] = [];

        for (const entry of watch.value.entries) {
          if (HomeHistory.is(entry)) {
            (entry.data?.messages ?? []).forEach((message, idx) => {
              entries.push({ id: `${entry.id}:home:${idx}`, role: message.role as string, text: message.text, fromHome: true });
            });
            continue;
          }
          (entry.model ?? []).forEach((message, msgIdx) => {
            if (message.role === 'system') return;
            const entryId = `${entry.id}:${msgIdx}`;
            if (message.role === 'user') {
              const text = typeof message.content === 'string'
                ? message.content
                : message.content.map(part => part.type === 'text' ? part.text : '[image]').filter(Boolean).join('\n');
              if (text) entries.push({ id: entryId, role: 'user', text, timestamp: message.timestamp });
              return;
            }
            if (message.role === 'assistant') {
              const textParts: string[] = [];
              const thinkingParts: string[] = [];
              let hasRedactedThinking = false;
              const calls: TranscriptToolCall[] = [];
              for (const part of message.content) {
                if (part.type === 'text' && part.text) {
                  textParts.push(part.text);
                } else if (part.type === 'thinking') {
                  if (part.thinking) thinkingParts.push(part.thinking);
                  if (part.redacted) hasRedactedThinking = true;
                } else if (part.type === 'toolCall') {
                  activeCalls.set(part.id, part);
                  const slot = liveSlotByCallId.get(part.id);
                  const status: TranscriptToolCall['status'] = slot?.status === 'sleeping'
                    ? 'waiting'
                    : slot && slot.status !== 'done'
                      ? 'running'
                      : 'done';
                  const node: TranscriptToolCall = {
                    id: part.id,
                    name: part.name,
                    args: (part.arguments ?? {}) as Record<string, unknown>,
                    status,
                    ...(slot?.output ? { output: slot.output } : {}),
                  };
                  toolCallNodes.set(part.id, node);
                  calls.push(node);
                }
              }
              const text = textParts.join('\n');
              const thinking = thinkingParts.join('\n').trim() || undefined;
              if (text || thinking || hasRedactedThinking || calls.length > 0) {
                entries.push({
                  id: entryId,
                  role: 'assistant',
                  text,
                  ...(thinking ? { thinking } : {}),
                  ...(hasRedactedThinking ? { hasRedactedThinking: true } : {}),
                  ...(calls.length ? { toolCalls: calls } : {}),
                  timestamp: message.timestamp,
                });
              }
              return;
            }
            if (message.role === 'toolResult') {
              workspaceRevision = entry.id;
              const call = activeCalls.get(message.toolCallId);
              activeCalls.delete(message.toolCallId);
              const diagnostics = ToolResultEntry.is(entry) ? entry.data?.diagnostics ?? [] : [];
              let toolFailure: 'invalid-arguments' | 'blocked' | 'interrupted' | 'other' | undefined;
              let text = message.content.map(part => part.type === 'text' ? part.text : '').filter(Boolean).join('\n');
              if (message.isError) {
                if (diagnostics.some(item => item.code === 'interrupted')) toolFailure = 'interrupted';
                else if (diagnostics.some(item => item.severity === 'error' && item.code === 'invalid_arguments')) toolFailure = 'invalid-arguments';
                else if (diagnostics.some(item => item.severity === 'error' && item.code === 'blocked')) toolFailure = 'blocked';
                else toolFailure = 'other';
                const errors = diagnostics.flatMap(item => item.severity === 'error' && typeof item.message === 'string' ? [item.message] : []);
                if (errors.length) text = errors.join('\n');
              }
              const changedFile = call?.name === 'write' || call?.name === 'edit';
              const fileRef = call?.name === message.toolName && ((changedFile && (!message.isError || toolFailure === 'interrupted')) || (call.name === 'read' && !message.isError))
                ? resultReference(currentWorkspace, call.arguments.path) : undefined;
              const linked = toolCallNodes.get(message.toolCallId);
              if (linked) {
                linked.status = message.isError ? 'error' : 'done';
                linked.output = textPreview(text, 8192).text;
                if (fileRef) linked.fileRef = fileRef;
                if (toolFailure) linked.toolFailure = toolFailure;
              }
              entries.push({
                id: entryId,
                role: 'toolResult',
                text,
                toolCallId: message.toolCallId,
                toolName: message.toolName,
                toolFailure,
                ...(fileRef ? { fileRef } : {}),
                timestamp: message.timestamp,
              });
            }
          });
        }

        const recentAiEditedFiles: readonly RecentAiEditRecord[] = secureEnv.getRecentAiEditedFiles();
        const recentAiEditedPaths = recentAiEditedFiles.map(item => item.relativePath);
        const decisions = (await Promise.all((live?.tools ?? []).map(async slot => {
          if (slot.status !== 'sleeping' || !slot.taskId) return;
          const call = activeCalls.get(slot.callId);
          const task = await harness.getTask(slot.taskId, context);
          if (!call || task?.state.status !== 'sleeping') return;
          let integrationMeta: { effect: 'read' | 'write'; targetDisplayName: string; operationDisplayName: string } | undefined;
          if (call.name === 'invoke_nimi_integration' || call.name === 'read_nimi_integration') {
            const args = call.arguments as Record<string, unknown>;
            const found = await lookupIntegrationOperation(services.integration, args.targetRef, args.operation, signal);
            if (found) {
              integrationMeta = {
                effect: found.effect,
                targetDisplayName: found.displayName,
                operationDisplayName: found.operationDisplayName,
              };
            }
          }
          const argsObj = (call.arguments ?? {}) as Record<string, unknown>;
          const isFreeShell = call.name === 'bash' || call.name === 'powershell';
          const targetPath = typeof argsObj.path === 'string' ? argsObj.path : undefined;
          const isControlPlane = Boolean(targetPath && (call.name === 'write' || call.name === 'edit') && isControlPlanePath(targetPath, currentWorkspace));
          const argumentsJson = JSON.stringify(call.arguments ?? {});
          const revision = createHash('sha256').update(JSON.stringify([sessionId, slot.taskId, call.id, call.name, argumentsJson])).digest('hex');
          return {
            id: slot.taskId,
            name: call.name,
            args: sanitizeDecisionArgsForDisplay(argsObj),
            revision,
            allowSessionPermitted: !isFreeShell && !isControlPlane,
            isControlPlane,
            isFreeShell,
            ...(isFreeShell && recentAiEditedPaths.length ? { recentAiEditedWarning: recentAiEditedPaths } : {}),
            ...(integrationMeta ? integrationMeta : {}),
          };
        }))).filter(item => item !== undefined);

        const partial = live?.generation?.message?.content.flatMap(item => item.type === 'text' ? [item.text] : []).join('');
        const partialThinking = live?.generation?.message?.content.flatMap(item => item.type === 'thinking' && item.thinking ? [item.thinking] : []).join('') || undefined;
        const activeTools = (live?.tools ?? []).map(slot => {
          const call = activeCalls.get(slot.callId);
          return {
            callId: slot.callId,
            name: slot.name,
            status: slot.status,
            ...(slot.output ? { output: slot.output } : {}),
            ...(call ? { args: call.arguments as Record<string, unknown> } : {}),
          };
        });
        const inbox = await harness.snapshot(InboxDoc, conversation.id, context);
        const queued = (inbox?.items ?? []).flatMap(item => item.mode === 'followUp' && typeof item.content === 'string' ? [{ id: item.id, text: item.content }] : []);
        const lastMessage = watch.value.entries.flatMap(entry => entry.model ?? []).reverse().find(message => message.role === 'assistant');
        const conflict = isModelConflict(live?.runFailure);
        const reviewNeeded = conflict && live?.runFailure?.taskId !== reviewedConflict;
        const usage = lastMessage?.role === 'assistant' && !lastMessage.diagnostics?.some(item => item.type === 'nimi.usage-unreported')
          ? { inputTokens: lastMessage.usage.input, outputTokens: lastMessage.usage.output } : undefined;
        const reasoningChoices: ReasoningChoice[] = bound?.reasoningChoices ?? [];
        const effectiveEffort = currentReasoningEffort && reasoningChoices.some(choice => choice.value === currentReasoningEffort)
          ? currentReasoningEffort
          : 'default';
        signal.throwIfAborted();
        return {
          entries,
          decisions,
          partial,
          partialThinking,
          activeTools,
          workspace: currentWorkspace,
          workspaceRevision,
          snapshots: secureEnv.getSnapshots(),
          recentAiEditedFiles,
          queued,
          instructions: instructions === defaultInstructions ? '' : instructions,
          needsResume: Boolean(live?.run) && needsResume,
          stopped: !live?.run && live?.runFailure?.reason === 'aborted',
          configRef: selectedRef,
          model: reviewNeeded ? undefined : bound?.label,
          reasoningChoices,
          reasoningEffort: effectiveEffort,
          permissionMode: currentPermissionMode,
          sessionAllowlist: [...sessionAllowlist],
          lastModelStepAt: lastMessage?.timestamp,
          contextWindowTokens: effectiveContextBudgetTokens ?? bound?.selection.contextWindowTokens,
          requestCapacityFloorTokens: bound?.selection.requestCapacityFloorTokens,
          usage,
          running: Boolean(live?.run),
          failure: conflict ? (reviewNeeded ? 'ai-config-revision-conflict' : undefined)
            : live?.runFailure && live.runFailure.reason !== 'aborted' ? live.runFailure.detail ?? live.runFailure.reason : undefined,
        };
      },
      async stopInput(requestId: string) {
        const observe = () => harness.commit(async tx => {
          const input = await tx.submissionByRequest(conversation.id, requestId);
          if (input?.type !== 'input') return { status: 'not-found' } as const;
          const live = await tx.doc(LiveDoc, conversation.id);
          return {
            status: input.status, submission: input.id,
            task: live.run?.inputs.includes(input.id) ? live.run.taskId : undefined,
          };
        }, context);
        signal.throwIfAborted();
        let target = await observe();
        if (target.status === 'queued') {
          signal.throwIfAborted();
          const result = await harness.abortSubmission(target.submission, context, conversation.id);
          if (result === 'aborted') return 'requested' as const;
          target = await observe(); // Placement may have won the withdrawal race.
        }
        if (target.status === 'not-found') return 'not-found' as const;
        if (target.status === 'done' || target.status === 'unanswered') return 'settled' as const;
        if (target.task === undefined) return 'check-again' as const;
        signal.throwIfAborted();
        // A generation may finish or hand off between these calls. Its durable task
        // ID can never select the newer run, even when the session is reused.
        if (await harness.abortTask(target.task, context) === 'terminal') return 'check-again' as const;
        signal.throwIfAborted();
        needsResume = false;
        harness.resume(); // On a reopened session, schedule only after the abort mark is durable.
        return 'requested' as const;
      },
      async submit(text: string, requestId: string, queue: boolean, outboxId?: string) {
        signal.throwIfAborted();
        const payloadHash = hashOutboxPayload(text);
        if (outboxId) {
          outboxIdByPayloadHash.set(payloadHash, outboxId);
        }
        await harness.commit(async tx => {
          signal.throwIfAborted();
          // v2.1 idempotency invariant: inspect durable OutboxReceiptsDoc first so
          // re-delivered outbox_ids after withdraw return their receipt instead of
          // HARNESS_REQUEST_CONFLICT or re-running the withdrawn prompt.
          const receipts = await tx.doc(OutboxReceiptsDoc, conversation.id);
          const existingReceipt = receipts.byRequestId[requestId];
          if (existingReceipt) {
            if (existingReceipt.payloadHash !== payloadHash) {
              throw new HarnessSubmissionError('HARNESS_REQUEST_CONFLICT', 'This request ID already identifies another input.');
            }
            if (outboxId && !existingReceipt.outboxId) {
              existingReceipt.outboxId = outboxId;
              existingReceipt.updatedAt = Date.now();
            }
            return;
          }
          const prior = await tx.submissionByRequest(conversation.id, requestId);
          if (prior) {
            const savedEntry = prior.type === 'input' && prior.entry !== undefined
              ? (await tx.entry(prior.entry))?.model?.[0]
              : undefined;
            const pendingItem = prior.type === 'input' && prior.status === 'queued'
              ? (await tx.doc(InboxDoc, conversation.id)).items.find(item => item.id === prior.id) : undefined;
            const accepted = savedEntry?.role === 'user' ? savedEntry.content : pendingItem && pendingItem.mode !== 'write' ? pendingItem.content : undefined;
            if (accepted === undefined && prior.type === 'input' && prior.status === 'unanswered') {
              // Reconcile a crash between abortSubmission and OutboxReceiptsDoc update cleanly.
              receipts.byRequestId[requestId] = {
                requestId,
                ...(outboxId ? { outboxId } : {}),
                payloadHash,
                submissionId: typeof prior.id === 'number' ? prior.id : null,
                withdrawState: 'withdrawn',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              return;
            }
            if (accepted !== text) {
              throw new HarnessSubmissionError('HARNESS_REQUEST_CONFLICT', 'This request ID already identifies another or unavailable input.');
            }
            return;
          }
          const live = await tx.doc(LiveDoc, conversation.id);
          if (live.run && (!queue || needsResume)) throw new HarnessSubmissionError('HARNESS_SESSION_BUSY', 'Resume or stop the current task before starting another.');
          const selection = await tx.doc(SessionModel, conversation.id);
          const reviewNeeded = isModelConflict(live.runFailure) && live.runFailure?.taskId !== selection.reviewedConflict;
          if (!bound || reviewNeeded || selection.confirmation !== bound.confirmation || (await tx.doc(AgentDoc, conversation.id)).model?.modelId !== bound.modelId) {
            throw new HarnessSubmissionError('HARNESS_MODEL_CHANGED', 'The configured model changed. This session needs an explicit model switch.');
          }
          signal.throwIfAborted();
          // pi-durable ordering invariant: submit(tx, ...) runs BEFORE persisting our companion receipt doc.
          const submissionId = await conversation.submit(tx, { type: 'input', content: text, requestId, whenBusy: queue ? 'followUp' : 'reject' });
          const now = Date.now();
          receipts.byRequestId[requestId] = {
            requestId,
            ...(outboxId ? { outboxId } : {}),
            payloadHash,
            submissionId: typeof submissionId === 'number' ? submissionId : null,
            withdrawState: 'active',
            createdAt: now,
            updatedAt: now,
          };
        }, context);
      },
      // Gate 5: Unified local + remote atomic mandatory revision CAS inside a single commit tx.
      async decide(id: number, allow: boolean, feedback?: string, allowForSession = false, expectedRevision?: string) {
        signal.throwIfAborted();
        if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
          throw new Error('Decision revision is required to prevent stale approvals.');
        }
        const trimmedFeedback = !allow && typeof feedback === 'string' && feedback.trim() ? feedback.trim().slice(0, 4000) : undefined;
        let allowedToolForSession: string | undefined;
        const result = await harness.commit(async tx => {
          const pending = await readPendingDecision(tx, sessionId, decision.key('decision').signal, {
            recentAiEditedPaths: secureEnv.getRecentAiEditedFiles().map(f => f.relativePath),
            allowLargeLocal: true,
            workspaceRoot: currentWorkspace,
            taskId: id,
          });
          if (pending.state !== 'review' || pending.taskId !== id) {
            return 'stale' as const;
          }
          if (pending.revision !== expectedRevision) {
            return 'revision-mismatch' as const;
          }
          if (Date.now() > pending.expiresAt) {
            return 'expired' as const;
          }
          if (allow && allowForSession && pending.allowSessionPermitted) {
            allowedToolForSession = pending.tool;
          }
          signal.throwIfAborted();
          return tx.signal(id as TaskId, decision, 'decision', trimmedFeedback ? { allow, feedback: trimmedFeedback } : { allow });
        }, context);
        if (result === 'revision-mismatch') throw new Error('This operation changed before your decision was applied. Review the updated proposal.');
        if (result === 'expired') throw new Error('This approval request expired before a decision was recorded.');
        if (result !== 'delivered') throw new Error('This operation is no longer waiting for a decision.');
        // Only mutate sessionAllowlist AFTER atomic CAS + signal delivery succeeded!
        if (allowedToolForSession) {
          sessionAllowlist.add(allowedToolForSession);
        }
        needsResume = false;
        harness.resume();
        return result;
      },
      resume() { signal.throwIfAborted(); needsResume = false; harness.resume(); onProgress(); },
      async withdraw(input: number) {
        signal.throwIfAborted();
        const result = await harness.abortSubmission(input as SubmissionId, context, conversation.id);
        if (result === 'already_placed') throw new Error('This follow-up has already started. Use Stop to end the task.');
        if (result !== 'aborted' && result !== 'settled') throw new Error('This follow-up is unavailable.');
        await harness.commit(async tx => {
          const receipts = await tx.doc(OutboxReceiptsDoc, conversation.id);
          for (const rec of Object.values(receipts.byRequestId)) {
            if (rec.submissionId === input) {
              rec.withdrawState = 'withdrawn';
              rec.updatedAt = Date.now();
            }
          }
        }, context);
      },
      async stop() {
        signal.throwIfAborted();
        if (!needsResume) return conversation.abort(context);
        const live = await harness.snapshot(LiveDoc, conversation.id, context);
        if (!live?.run) return;
        await harness.abortTask(live.run.taskId, context);
        signal.throwIfAborted();
        needsResume = false;
        await conversation.abort(context);
      },
    };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}

async function resolveNamespace(storage: NimiElectronAppBusinessServices['storage'], signal: AbortSignal): Promise<string> {
  let value;
  try {
    ({ value } = await storage.readJson(namespaceFile));
  } catch (error) {
    if (!(error instanceof NimiElectronLocalAppHostError) || error.reasonCode !== 'not-found') throw error;
    signal.throwIfAborted();
    ({ value } = await storage.writeJson(namespaceFile, randomUUID()));
  }
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) {
    throw new Error('Invalid Nimi Harness storage namespace.');
  }
  return value;
}
