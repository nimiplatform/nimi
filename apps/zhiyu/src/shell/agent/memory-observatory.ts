import type {
  NimiRuntimeAgentMemoryObservatoryConfidence,
  NimiRuntimeAgentMemoryObservatoryRecord,
  NimiRuntimeAgentMemoryObservatorySnapshot,
} from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuLocalAgentStatus } from './local-agent-status';

const APP_ID = 'nimi.zhiyu';
const DEFAULT_MAX_RECORDS = 50;
const UNSUPPORTED_LIFECYCLE_FIELDS = ['review', 'redaction', 'forgetIntent'] as const;

export type ZhiyuMemoryObservatoryStatus = ZhiyuEvidence['memory'];
type ZhiyuMemoryObservatoryUnavailableState = Exclude<ZhiyuMemoryObservatoryStatus['state'], 'ready' | 'empty'>;

export interface ZhiyuMemoryObservatoryReadInput {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly exportedAt: string;
  readonly maxRecords: number;
}

export type ZhiyuMemoryObservatoryReader = (
  input: ZhiyuMemoryObservatoryReadInput,
) => Promise<NimiRuntimeAgentMemoryObservatorySnapshot>;

export interface ZhiyuMemoryObservatoryProbeOptions {
  readonly exportedAt?: string;
  readonly maxRecords?: number;
  readonly readMemoryObservatory?: ZhiyuMemoryObservatoryReader;
}

export async function probeZhiyuRuntimeMemoryObservatory(
  localAgent: ZhiyuLocalAgentStatus,
  options: ZhiyuMemoryObservatoryProbeOptions = {},
): Promise<ZhiyuMemoryObservatoryStatus> {
  const identity = localAgentIdentity(localAgent);
  if (!identity) {
    return memoryUnavailable({
      reasonCode: 'zhiyu-local-agent-required',
      actionHint: 'select_runtime_owned_partner',
      source: localAgent.source,
      message: 'Zhiyu requires a Runtime-owned LocalAgent before reading Memory Observatory.',
      ownerUserId: localAgent.ownerUserId,
      runtimeSourceRef: localAgent.runtimeSourceRef,
      localAgentRef: localAgent.localAgentRef,
    });
  }

  if (!options.readMemoryObservatory) {
    return memoryUnavailable({
      reasonCode: 'zhiyu-memory-observatory-capability-not-admitted',
      actionHint: 'admit_zhiyu_memory_observatory_capability',
      source: 'sdk',
      message: 'Memory Observatory is not admitted on the Zhiyu local-app carrier.',
      ...identity,
    });
  }

  try {
    const snapshot = await options.readMemoryObservatory({
      ...identity,
      exportedAt: stringOr(options.exportedAt, new Date().toISOString()),
      maxRecords: normalizeMaxRecords(options.maxRecords),
    });
    return memoryAvailable(snapshot, identity);
  } catch (error) {
    return normalizeMemoryError(error, identity);
  }
}

function memoryAvailable(
  snapshot: NimiRuntimeAgentMemoryObservatorySnapshot,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
): ZhiyuMemoryObservatoryStatus {
  return {
    transport: 'electron-ipc',
    ready: true,
    state: snapshot.state,
    reasonCode: snapshot.reasonCode,
    actionHint: snapshot.actionHint,
    source: 'runtime',
    message: snapshot.state === 'empty'
      ? 'Runtime Agent memory is reachable and currently empty.'
      : 'Runtime Agent memory was projected through SDK Memory Observatory.',
    ...identity,
    observedAt: snapshot.observedAt,
    recordCount: snapshot.recordCount,
    bankCount: snapshot.bankCount,
    bankReviewStatuses: snapshot.bankReviewStatuses.map((status) => ({ ...status })),
    unsupportedLifecycleFields: [...snapshot.unsupportedLifecycleFields],
    records: snapshot.records.map(projectMemoryRecord),
  };
}

function projectMemoryRecord(
  record: NimiRuntimeAgentMemoryObservatoryRecord,
): ZhiyuMemoryObservatoryStatus['records'][number] {
  return {
    memoryId: record.memoryId,
    bankKey: record.bankKey,
    authorityClass: record.authorityClass,
    canonicalClass: record.canonicalClass,
    kind: record.kind,
    payloadKind: record.payloadKind,
    summary: record.summary,
    timelineAt: record.timelineAt,
    lineage: record.lineage,
    confidence: projectConfidence(record.confidence),
    reviewState: record.review.state,
    redactionState: record.redaction.state,
    forgetIntentState: record.forgetIntent.state,
  };
}

function projectConfidence(
  confidence: NimiRuntimeAgentMemoryObservatoryConfidence,
): ZhiyuMemoryObservatoryStatus['records'][number]['confidence'] {
  if (confidence.state === 'available') {
    return {
      state: confidence.state,
      value: confidence.value,
      source: confidence.source,
      reasonCode: null,
    };
  }
  return {
    state: confidence.state,
    value: null,
    source: null,
    reasonCode: confidence.reasonCode,
  };
}

function normalizeMemoryError(
  error: unknown,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
): ZhiyuMemoryObservatoryStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = stringOr(record.reasonCode, 'zhiyu-memory-observatory-unavailable');
  const actionHint = stringOr(record.actionHint, 'check_runtime_agent_memory_observatory');
  const source = stringOr(record.source, 'sdk');
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Runtime Agent Memory Observatory is unavailable.';
  return memoryUnavailable({
    state: memoryFailureState({ reasonCode, actionHint, source, message }),
    reasonCode,
    actionHint,
    source,
    message,
    ...identity,
  });
}

function memoryUnavailable(input: {
  readonly state?: ZhiyuMemoryObservatoryUnavailableState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
}): ZhiyuMemoryObservatoryStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: input.state ?? 'blocked',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    observedAt: null,
    recordCount: 0,
    bankCount: 0,
    bankReviewStatuses: [],
    unsupportedLifecycleFields: [...UNSUPPORTED_LIFECYCLE_FIELDS],
    records: [],
  };
}

function memoryFailureState(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
}): ZhiyuMemoryObservatoryUnavailableState {
  const text = [
    input.reasonCode,
    input.actionHint,
    input.source,
    input.message,
  ].join(' ').toLowerCase();
  if (text.includes('max_records_exceeded') || text.includes('partial') || text.includes('truncat')) {
    return 'partial';
  }
  if (text.includes('grant') && (
    text.includes('missing')
    || text.includes('no_active')
    || text.includes('unbound')
    || text.includes('required')
  )) {
    return 'grant-missing';
  }
  if (text.includes('denied') || text.includes('forbidden') || text.includes('permission')) {
    return 'denied';
  }
  if (text.includes('provider') && (
    text.includes('unavailable')
    || text.includes('missing')
    || text.includes('unbound')
    || text.includes('not')
    || text.includes('no-provider')
  )) {
    return 'no-provider';
  }
  if (text.includes('runtime') && (
    text.includes('unavailable')
    || text.includes('endpoint')
    || text.includes('bridge')
  )) {
    return 'runtime-unavailable';
  }
  return 'blocked';
}

function localAgentIdentity(localAgent: ZhiyuLocalAgentStatus): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} | null {
  if (!localAgent.ready) {
    return null;
  }
  const ownerUserId = stringOr(localAgent.ownerUserId, '');
  const runtimeSourceRef = stringOr(localAgent.runtimeSourceRef, '');
  const localAgentRef = stringOr(localAgent.localAgentRef, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}

function normalizeMaxRecords(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_RECORDS;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
