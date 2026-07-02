import {
  AgentCanonicalMemoryReviewReadiness,
  MemoryBankScope,
  type AgentCanonicalMemoryReviewStatus,
  type GetAgentCanonicalMemoryReviewStatusRequest,
  type GetAgentCanonicalMemoryReviewStatusResponse,
  type MemoryBankLocator,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError, type JsonObject } from '../types';
import { buildRuntimeAgentRequestContext, projectRuntimeLocalAgentIdentity } from './agent-local-identity';
import {
  createNimiRuntimeAgentMemoryExport,
  type NimiHostRuntimeAgentMemoryExportClient,
  NIMI_RUNTIME_AGENT_MEMORY_EXPORT_SCHEMA_VERSION,
  type NimiRuntimeAgentMemoryExportBank,
  type NimiRuntimeAgentMemoryExportEnvelope,
  type NimiRuntimeAgentMemoryExportInput,
  type NimiRuntimeAgentMemoryExportPayload,
  type NimiRuntimeAgentMemoryExportRecord,
} from './runtime-agent-memory-export';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
} from './runtime-agent-protected';
import {
  normalizeNimiRuntimeAgentText,
  toNimiRuntimeIsoFromTimestamp,
} from './runtime-agent-values';

export const NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_SCHEMA_VERSION = 2;

export const NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_UNSUPPORTED_LIFECYCLE_FIELDS = [
  'review',
  'redaction',
  'forgetIntent',
] as const;

export type NimiRuntimeAgentMemoryObservatoryState = 'ready' | 'empty';

export type NimiRuntimeAgentMemoryObservatoryReasonCode =
  | 'runtime-agent-memory-observatory-ready'
  | 'runtime-agent-memory-observatory-empty';

export type NimiRuntimeAgentMemoryObservatoryActionHint =
  | 'inspect_runtime_agent_memory_lineage'
  | 'continue_runtime_agent_interaction';

export type NimiRuntimeAgentMemoryObservatoryUnsupportedLifecycleField =
  typeof NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_UNSUPPORTED_LIFECYCLE_FIELDS[number];

export interface NimiRuntimeAgentMemoryObservatoryLineage {
  readonly sourceSystem: string | null;
  readonly sourceEventId: string | null;
  readonly traceId: string | null;
  readonly committedAt: string | null;
}

export type NimiRuntimeAgentMemoryObservatoryConfidence =
  | {
    readonly state: 'available';
    readonly value: number;
    readonly source: 'semantic_payload';
  }
  | {
    readonly state: 'not_projected';
    readonly reasonCode: 'runtime-agent-memory-confidence-not-projected';
  };

export interface NimiRuntimeAgentMemoryObservatoryLifecycleProjection {
  readonly state: 'not_projected';
  readonly reasonCode: 'runtime-agent-memory-lifecycle-projection-not-admitted';
}

export interface NimiRuntimeAgentMemoryObservatoryRecord {
  readonly memoryId: string;
  readonly bankKey: string;
  readonly authorityClass: 'canonical-agent-memory';
  readonly canonicalClass: string | null;
  readonly kind: string | null;
  readonly payloadKind: NimiRuntimeAgentMemoryExportPayload['kind'];
  readonly summary: string;
  readonly timelineAt: string | null;
  readonly lineage: NimiRuntimeAgentMemoryObservatoryLineage;
  readonly confidence: NimiRuntimeAgentMemoryObservatoryConfidence;
  readonly review: NimiRuntimeAgentMemoryObservatoryLifecycleProjection;
  readonly redaction: NimiRuntimeAgentMemoryObservatoryLifecycleProjection;
  readonly forgetIntent: NimiRuntimeAgentMemoryObservatoryLifecycleProjection;
  readonly replicationOutcome: string | null;
  readonly policyReason: string | null;
  readonly recallScore: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export type NimiRuntimeAgentMemoryObservatoryBankReviewReadiness =
  | 'eligible'
  | 'waiting_for_window'
  | 'executor_unavailable'
  | 'recoverable_run_blocking'
  | 'bank_unavailable'
  | 'unknown';

export interface NimiRuntimeAgentMemoryObservatoryBankReviewStatus {
  readonly bankKey: string;
  readonly readiness: NimiRuntimeAgentMemoryObservatoryBankReviewReadiness;
  readonly eligibleNow: boolean;
  readonly reviewExecutorAvailable: boolean;
  readonly lastReviewRunId: string | null;
  readonly checkpointBasis: string | null;
  readonly lastCompletedAt: string | null;
  readonly nextEligibleAt: string | null;
  readonly recoverableReviewRunId: string | null;
  readonly source: 'runtime-agent-review-status';
}

export interface NimiRuntimeAgentMemoryObservatorySnapshot {
  readonly schemaVersion: typeof NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_SCHEMA_VERSION;
  readonly sourceSchemaVersion: typeof NIMI_RUNTIME_AGENT_MEMORY_EXPORT_SCHEMA_VERSION;
  readonly observedAt: string;
  readonly agentId: string;
  readonly state: NimiRuntimeAgentMemoryObservatoryState;
  readonly reasonCode: NimiRuntimeAgentMemoryObservatoryReasonCode;
  readonly actionHint: NimiRuntimeAgentMemoryObservatoryActionHint;
  readonly recordCount: number;
  readonly bankCount: number;
  readonly banks: readonly NimiRuntimeAgentMemoryExportBank[];
  readonly bankReviewStatuses: readonly NimiRuntimeAgentMemoryObservatoryBankReviewStatus[];
  readonly records: readonly NimiRuntimeAgentMemoryObservatoryRecord[];
  readonly unsupportedLifecycleFields: typeof NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_UNSUPPORTED_LIFECYCLE_FIELDS;
}

export interface NimiHostRuntimeAgentMemoryObservatoryClient extends Omit<NimiHostRuntimeAgentMemoryExportClient, 'agent'> {
  readonly agent: NimiHostRuntimeAgentMemoryExportClient['agent'] & {
    getAgentCanonicalMemoryReviewStatus(
      request: GetAgentCanonicalMemoryReviewStatusRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetAgentCanonicalMemoryReviewStatusResponse>;
  };
}

export interface NimiRuntimeAgentMemoryObservatoryProjectionOptions {
  readonly bankReviewStatuses?: readonly NimiRuntimeAgentMemoryObservatoryBankReviewStatus[];
}

const NOT_PROJECTED_LIFECYCLE: NimiRuntimeAgentMemoryObservatoryLifecycleProjection = {
  state: 'not_projected',
  reasonCode: 'runtime-agent-memory-lifecycle-projection-not-admitted',
};

export function projectNimiRuntimeAgentMemoryObservatory(
  envelope: NimiRuntimeAgentMemoryExportEnvelope,
  options: NimiRuntimeAgentMemoryObservatoryProjectionOptions = {},
): NimiRuntimeAgentMemoryObservatorySnapshot {
  const state = envelope.records.length > 0 ? 'ready' : 'empty';
  return {
    schemaVersion: NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_SCHEMA_VERSION,
    sourceSchemaVersion: envelope.schemaVersion,
    observedAt: envelope.exportedAt,
    agentId: envelope.agentId,
    state,
    reasonCode: state === 'ready'
      ? 'runtime-agent-memory-observatory-ready'
      : 'runtime-agent-memory-observatory-empty',
    actionHint: state === 'ready'
      ? 'inspect_runtime_agent_memory_lineage'
      : 'continue_runtime_agent_interaction',
    recordCount: envelope.records.length,
    bankCount: envelope.banks.length,
    banks: envelope.banks,
    bankReviewStatuses: [...(options.bankReviewStatuses ?? [])],
    records: envelope.records.map(projectMemoryObservatoryRecord),
    unsupportedLifecycleFields: NIMI_RUNTIME_AGENT_MEMORY_OBSERVATORY_UNSUPPORTED_LIFECYCLE_FIELDS,
  };
}

export async function createNimiRuntimeAgentMemoryObservatory(
  client: NimiHostRuntimeAgentMemoryObservatoryClient,
  input: NimiRuntimeAgentMemoryExportInput,
): Promise<NimiRuntimeAgentMemoryObservatorySnapshot> {
  const envelope = await createNimiRuntimeAgentMemoryExport(client, input);
  const bankReviewStatuses = await readNimiRuntimeAgentMemoryBankReviewStatuses(client, input, envelope.banks);
  return projectNimiRuntimeAgentMemoryObservatory(envelope, { bankReviewStatuses });
}

function projectMemoryObservatoryRecord(
  record: NimiRuntimeAgentMemoryExportRecord,
): NimiRuntimeAgentMemoryObservatoryRecord {
  return {
    memoryId: record.memoryId,
    bankKey: record.bankKey,
    authorityClass: 'canonical-agent-memory',
    canonicalClass: record.canonicalClass,
    kind: record.kind,
    payloadKind: record.payload.kind,
    summary: record.summary,
    timelineAt: record.provenance?.committedAt ?? record.updatedAt ?? record.createdAt,
    lineage: {
      sourceSystem: record.provenance?.sourceSystem ?? null,
      sourceEventId: record.provenance?.sourceEventId ?? null,
      traceId: record.provenance?.traceId ?? null,
      committedAt: record.provenance?.committedAt ?? null,
    },
    confidence: projectMemoryObservatoryConfidence(record.payload),
    review: NOT_PROJECTED_LIFECYCLE,
    redaction: NOT_PROJECTED_LIFECYCLE,
    forgetIntent: NOT_PROJECTED_LIFECYCLE,
    replicationOutcome: record.replicationOutcome,
    policyReason: record.policyReason,
    recallScore: record.recallScore,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function projectMemoryObservatoryConfidence(
  payload: NimiRuntimeAgentMemoryExportPayload,
): NimiRuntimeAgentMemoryObservatoryConfidence {
  if (payload.kind === 'semantic') {
    return {
      state: 'available',
      value: payload.confidence,
      source: 'semantic_payload',
    };
  }
  return {
    state: 'not_projected',
    reasonCode: 'runtime-agent-memory-confidence-not-projected',
  };
}

async function readNimiRuntimeAgentMemoryBankReviewStatuses(
  client: NimiHostRuntimeAgentMemoryObservatoryClient,
  input: NimiRuntimeAgentMemoryExportInput,
  banks: readonly NimiRuntimeAgentMemoryExportBank[],
): Promise<readonly NimiRuntimeAgentMemoryObservatoryBankReviewStatus[]> {
  if (banks.length === 0) {
    return [];
  }
  const identity = projectRuntimeLocalAgentIdentity(input);
  const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
    input.getSubjectUserId,
    'Runtime Agent Memory Observatory requires authenticated subject user id.',
  );
  const requestContext = buildRuntimeAgentRequestContext({
    runtimeAppId: client.appId,
    subjectUserId,
    ...identity,
  });
  const scoped = <T>(operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>): Promise<T> =>
    withNimiRuntimeAgentScopes({
      runtime: client,
      subjectUserId,
      withScopes: input.withScopes,
    }, ['runtime.agent.read'], operation);
  const statuses: NimiRuntimeAgentMemoryObservatoryBankReviewStatus[] = [];
  for (const bank of banks) {
    const locator = memoryObservatoryBankLocator(bank);
    let response: GetAgentCanonicalMemoryReviewStatusResponse;
    try {
      response = await scoped((callOptions) => client.agent.getAgentCanonicalMemoryReviewStatus({
        context: requestContext,
        agentId: requestContext.localAgentRef,
        bank: locator,
      }, callOptions));
    } catch (error) {
      throw createNimiError({
        message: error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Runtime Agent Memory Observatory failed to read canonical review status.',
        reasonCode: 'SDK_RUNTIME_AGENT_MEMORY_OBSERVATORY_REVIEW_STATUS_READ_FAILED',
        actionHint: 'check_runtime_agent_memory_review_status',
        source: 'sdk',
      });
    }
    statuses.push(projectBankReviewStatus(bank, response.status));
  }
  return statuses;
}

function projectBankReviewStatus(
  bank: NimiRuntimeAgentMemoryExportBank,
  status: AgentCanonicalMemoryReviewStatus | undefined,
): NimiRuntimeAgentMemoryObservatoryBankReviewStatus {
  if (!status) {
    memoryObservatoryError(
      'Runtime Agent Memory Observatory received a review status response without status.',
      'SDK_RUNTIME_AGENT_MEMORY_OBSERVATORY_REVIEW_STATUS_INVALID',
      'check_runtime_agent_memory_review_status',
      { bankKey: bank.bankKey },
    );
  }
  const statusBankKey = memoryObservatoryBankKey(status.bank);
  if (statusBankKey !== bank.bankKey) {
    memoryObservatoryError(
      `Runtime Agent Memory Observatory review status bank does not match export bank ${bank.bankKey}.`,
      'SDK_RUNTIME_AGENT_MEMORY_OBSERVATORY_REVIEW_STATUS_BANK_MISMATCH',
      'check_runtime_agent_memory_review_status',
      { expectedBankKey: bank.bankKey, actualBankKey: statusBankKey },
    );
  }
  return {
    bankKey: bank.bankKey,
    readiness: formatBankReviewReadiness(status.readiness),
    eligibleNow: status.eligibleNow,
    reviewExecutorAvailable: status.reviewExecutorAvailable,
    lastReviewRunId: normalizeNimiRuntimeAgentText(status.lastReviewRunId) || null,
    checkpointBasis: normalizeNimiRuntimeAgentText(status.checkpointBasis) || null,
    lastCompletedAt: toNimiRuntimeIsoFromTimestamp(status.lastCompletedAt),
    nextEligibleAt: toNimiRuntimeIsoFromTimestamp(status.nextEligibleAt),
    recoverableReviewRunId: normalizeNimiRuntimeAgentText(status.recoverableReviewRunId) || null,
    source: 'runtime-agent-review-status',
  };
}

function memoryObservatoryBankKey(locator: MemoryBankLocator | undefined): string {
  const owner = locator?.owner;
  switch (owner?.oneofKind) {
    case 'agentCore':
      return `agent-core:${requireLocatorPart('agentId', owner.agentCore.agentId)}`;
    case 'agentDyadic':
      return `agent-dyadic:${requireLocatorPart('agentId', owner.agentDyadic.agentId)}:${requireLocatorPart('userId', owner.agentDyadic.userId)}`;
    case 'worldShared':
      return `world-shared:${requireLocatorPart('worldId', owner.worldShared.worldId)}`;
    case 'appPrivate':
      return `app-private:${requireLocatorPart('accountId', owner.appPrivate.accountId)}:${requireLocatorPart('appId', owner.appPrivate.appId)}`;
    case 'workspacePrivate':
      return `workspace-private:${requireLocatorPart('accountId', owner.workspacePrivate.accountId)}:${requireLocatorPart('workspaceId', owner.workspacePrivate.workspaceId)}`;
    default:
      memoryObservatoryError(
        'Runtime Agent Memory Observatory review status is missing its bank owner.',
        'SDK_RUNTIME_AGENT_MEMORY_OBSERVATORY_REVIEW_STATUS_INVALID',
        'check_runtime_agent_memory_review_status',
      );
  }
}

function memoryObservatoryBankLocator(bank: NimiRuntimeAgentMemoryExportBank): MemoryBankLocator {
  switch (bank.scope) {
    case 'agent-core':
      return {
        scope: MemoryBankScope.AGENT_CORE,
        owner: { oneofKind: 'agentCore', agentCore: { agentId: requireBankPart(bank.bankKey, bank.agentId, 'agentId') } },
      };
    case 'agent-dyadic':
      return {
        scope: MemoryBankScope.AGENT_DYADIC,
        owner: {
          oneofKind: 'agentDyadic',
          agentDyadic: {
            agentId: requireBankPart(bank.bankKey, bank.agentId, 'agentId'),
            userId: requireBankPart(bank.bankKey, bank.userId, 'userId'),
          },
        },
      };
    case 'world-shared':
      return {
        scope: MemoryBankScope.WORLD_SHARED,
        owner: { oneofKind: 'worldShared', worldShared: { worldId: requireBankPart(bank.bankKey, bank.worldId, 'worldId') } },
      };
    case 'app-private':
      return {
        scope: MemoryBankScope.APP_PRIVATE,
        owner: {
          oneofKind: 'appPrivate',
          appPrivate: {
            accountId: requireBankPart(bank.bankKey, bank.accountId, 'accountId'),
            appId: requireBankPart(bank.bankKey, bank.appId, 'appId'),
          },
        },
      };
    case 'workspace-private':
      return {
        scope: MemoryBankScope.WORKSPACE_PRIVATE,
        owner: {
          oneofKind: 'workspacePrivate',
          workspacePrivate: {
            accountId: requireBankPart(bank.bankKey, bank.accountId, 'accountId'),
            workspaceId: requireBankPart(bank.bankKey, bank.workspaceId, 'workspaceId'),
          },
        },
      };
    default:
      memoryObservatoryError(
        `Runtime Agent Memory Observatory cannot build a locator for bank ${bank.bankKey}.`,
        'SDK_RUNTIME_AGENT_MEMORY_OBSERVATORY_BANK_INVALID',
        'check_runtime_agent_memory_export_bank',
        { bankKey: bank.bankKey, scope: bank.scope },
      );
  }
}

function requireBankPart(bankKey: string, value: string | null, field: string): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    memoryObservatoryError(
      `Runtime Agent Memory Observatory bank ${bankKey} is missing ${field}.`,
      'SDK_RUNTIME_AGENT_MEMORY_OBSERVATORY_BANK_INVALID',
      'check_runtime_agent_memory_export_bank',
      { bankKey, field },
    );
  }
  return normalized;
}

function requireLocatorPart(field: string, value: string | undefined): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    memoryObservatoryError(
      `Runtime Agent Memory Observatory review status bank is missing ${field}.`,
      'SDK_RUNTIME_AGENT_MEMORY_OBSERVATORY_REVIEW_STATUS_INVALID',
      'check_runtime_agent_memory_review_status',
      { field },
    );
  }
  return normalized;
}

function formatBankReviewReadiness(
  readiness: AgentCanonicalMemoryReviewReadiness,
): NimiRuntimeAgentMemoryObservatoryBankReviewReadiness {
  switch (readiness) {
    case AgentCanonicalMemoryReviewReadiness.ELIGIBLE:
      return 'eligible';
    case AgentCanonicalMemoryReviewReadiness.WAITING_FOR_WINDOW:
      return 'waiting_for_window';
    case AgentCanonicalMemoryReviewReadiness.EXECUTOR_UNAVAILABLE:
      return 'executor_unavailable';
    case AgentCanonicalMemoryReviewReadiness.RECOVERABLE_RUN_BLOCKING:
      return 'recoverable_run_blocking';
    case AgentCanonicalMemoryReviewReadiness.BANK_UNAVAILABLE:
      return 'bank_unavailable';
    case AgentCanonicalMemoryReviewReadiness.UNSPECIFIED:
    default:
      return 'unknown';
  }
}

function memoryObservatoryError(
  message: string,
  reasonCode: string,
  actionHint: string,
  details?: JsonObject,
): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
    details,
  });
}
