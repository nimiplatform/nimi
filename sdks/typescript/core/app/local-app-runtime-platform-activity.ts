import type { JsonObject } from '../../types/json.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import type {
  AppActivityRecord as RuntimeAppActivityRecord,
  CompleteAppActivityOpenRequestRequest,
  CompleteAppActivityOpenRequestResponse,
  ListAppActivitiesRequest,
  ListAppActivitiesResponse,
  MarkAppActivityReadRequest,
  MarkAppActivityReadResponse,
  OpenAppActivityRequest,
  OpenAppActivityResponse,
  PutAppActivityRequest,
  PutAppActivityResponse,
  SubscribeAppActivityChangesRequest,
  SubscribeAppActivityChangesResponse,
  SubscribeAppActivityOpenRequestsRequest,
  SubscribeAppActivityOpenRequestsResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/app_activity.js';
import {
  AppActivityChangeKind,
  AppActivityKind,
  AppActivityOpenCompletion,
  AppActivityOpenOutcome,
  AppActivityOpenReason,
  AppActivitySourceKind,
  AppActivityTodoState,
} from '../../core-generated/runtime-protobuf/runtime/v1/app_activity.js';
import { validateAgentHandle } from './local-app-runtime-platform-conversation.js';
import {
  asRecord,
  assertExactKeys,
  assertExactMethodNamespace,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  decimalCursor,
  localAppError,
  localAppProjectionError,
  projectTimestamp,
} from './local-app-runtime-platform-validation.js';

// Contract bounds mirrored from the Runtime App activity owner.
const MAX_KEY_BYTES = 256;
const MAX_TITLE_BYTES = 512;
const MAX_SUMMARY_BYTES = 4096;
const MAX_DATA_JSON_BYTES = 32 * 1024;
const MAX_PAGE_SIZE = 100;
const OBJECT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~+=-]{0,255}$/u;
const ACTIVITY_TYPE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+\.v[1-9][0-9]{0,5}$/u;
const RESERVED_RUNTIME_TYPE_PREFIX = 'nimi.runtime.';

export const NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE = 'nimi.runtime.agent-conversation.turn-completed.v1';

export type NimiAppActivityKind = 'activity' | 'todo';
export type NimiAppActivityTodoState = 'open' | 'completed' | 'cancelled';

export type NimiAppActivitySource = Readonly<{
  kind: 'app' | 'runtime-agent';
  /** Account-scoped, non-authorizing grouping and filter reference. */
  sourceRef: string;
  appId: string | null;
  displayName: string | null;
  available: boolean;
}>;

export type NimiAppActivityAgent = Readonly<{
  /** Non-authorizing grouping reference; never an Agent handle. */
  agentRef: string;
  displayName: string;
}>;

export type NimiAppActivityUserView = Readonly<{
  readThroughRevision: number;
  unread: boolean;
  needsAttention: boolean;
}>;

export type NimiAppActivityRecord = Readonly<{
  activityId: string;
  source: NimiAppActivitySource;
  key: string;
  revision: number;
  kind: NimiAppActivityKind;
  todoState: NimiAppActivityTodoState | null;
  attention: boolean;
  title: string;
  summary: string | null;
  objectRef: string | null;
  type: string;
  /** Publisher-owned product content; never authority. */
  data: Readonly<JsonObject> | null;
  agent: NimiAppActivityAgent | null;
  occurredAt: string;
  publishedAt: string;
  updatedAt: string;
  /** Account change sequence of this projection. */
  changeSeq: string;
  userView: NimiAppActivityUserView;
}>;

export type NimiAppActivityPutInput = {
  readonly key: string;
  readonly revision: number;
  readonly kind: NimiAppActivityKind;
  readonly todoState?: NimiAppActivityTodoState;
  readonly attention: boolean;
  readonly title: string;
  readonly summary?: string;
  readonly objectRef?: string;
  readonly type: string;
  readonly data?: JsonObject;
  readonly occurredAt: string | Date;
  readonly agentHandle?: NimiLocalAppAgentHandle;
};

export type NimiAppActivityPutResult = Readonly<{
  record: NimiAppActivityRecord;
  /** False when an identical same-revision retry returned the existing record. */
  changed: boolean;
}>;

export type NimiAppActivityFilter = {
  readonly sourceRef?: string;
  readonly kind?: NimiAppActivityKind;
  readonly todoStates?: readonly NimiAppActivityTodoState[];
  readonly agentRef?: string;
  readonly occurredAfter?: string;
  readonly occurredBefore?: string;
};

export type NimiAppActivityListInput = {
  readonly filter?: NimiAppActivityFilter;
  readonly pageSize?: number;
  readonly pageToken?: string;
};

export type NimiAppActivityPage = Readonly<{
  records: readonly NimiAppActivityRecord[];
  nextPageToken: string | null;
  baselineChangeSeq: string;
}>;

export type NimiAppActivityChange =
  | Readonly<{ changeSeq: string; kind: 'upsert'; activityId: string; record: NimiAppActivityRecord }>
  | Readonly<{ changeSeq: string; kind: 'remove'; activityId: string }>;

export type NimiAppActivitySubscription = AsyncIterable<NimiAppActivityChange> & {
  readonly cancel: () => Promise<void>;
};

export type NimiAppActivityOpenReason =
  | 'opened'
  | 'not-openable'
  | 'activity-unavailable'
  | 'source-unavailable'
  | 'object-unavailable'
  | 'source-not-ready'
  | 'canceled'
  | 'host-unavailable'
  | 'launch-failed';

export type NimiAppActivityOpenResult = Readonly<{
  outcome: 'opened' | 'unavailable' | 'failed';
  reason: NimiAppActivityOpenReason;
}>;

export type NimiAppActivityOpenRequest = Readonly<{
  activityId: string;
  objectRef: string;
  type: string;
}>;

/**
 * Registered by a source App. Resolve `opened` only after the App actually
 * entered the requested object; resolve `object-unavailable` when the object
 * no longer exists for the current account.
 */
export type NimiAppActivityOpenHandler = (
  request: NimiAppActivityOpenRequest,
) => Promise<'opened' | 'object-unavailable'>;

export type NimiAppActivityOpenRegistration = {
  readonly stop: () => Promise<void>;
};

export type NimiAppActivityShellSubscription = {
  readonly events: AsyncIterable<unknown>;
  readonly cancel: () => Promise<void>;
};

/**
 * Host-neutral structural contract implemented by Kit's local-app standard
 * shell. Values are JSON projections; `dataJson` carries publisher content as
 * text so carriers never interpret its keys.
 */
export type NimiLocalAppActivityShell = {
  readonly put: (input: JsonObject) => Promise<unknown>;
  readonly list: (input: JsonObject) => Promise<unknown>;
  readonly subscribe: (input: { readonly afterChangeSeq: string }) => Promise<NimiAppActivityShellSubscription>;
  readonly markRead: (input: { readonly activityId: string; readonly displayedRevision: number }) => Promise<unknown>;
  readonly open: (input: { readonly activityId: string }) => Promise<unknown>;
  readonly openRequests: {
    readonly subscribe: () => Promise<NimiAppActivityShellSubscription>;
    readonly complete: (input: {
      readonly deliveryId: string;
      readonly completion: 'opened' | 'object-unavailable';
    }) => Promise<unknown>;
  };
};

export type NimiLocalAppActivityClient = {
  readonly put: (input: NimiAppActivityPutInput) => Promise<NimiAppActivityPutResult>;
  readonly list: (input?: NimiAppActivityListInput) => Promise<NimiAppActivityPage>;
  readonly subscribe: (input: { readonly afterChangeSeq: string }) => Promise<NimiAppActivitySubscription>;
  readonly markRead: (input: { readonly activityId: string; readonly displayedRevision: number }) => Promise<NimiAppActivityRecord>;
  readonly open: (input: { readonly activityId: string }) => Promise<NimiAppActivityOpenResult>;
  readonly onOpenRequest: (handler: NimiAppActivityOpenHandler) => NimiAppActivityOpenRegistration;
};

export function assertNimiLocalAppActivityShell(value: unknown): asserts value is NimiLocalAppActivityShell {
  const record = asRecord(value);
  if (!record || Object.keys(record).sort().join('|') !== ['list', 'markRead', 'open', 'openRequests', 'put', 'subscribe'].join('|')) {
    localAppError(
      'Host-injected local-app standardShell activity namespace is invalid.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  for (const method of ['put', 'list', 'subscribe', 'markRead', 'open'] as const) {
    if (typeof record[method] !== 'function') {
      localAppError(
        'Host-injected local-app standardShell activity namespace is invalid.',
        'SDK_LOCAL_APP_CARRIER_REQUIRED',
        'use_host_injected_standard_shell',
      );
    }
  }
  assertExactMethodNamespace(record.openRequests, ['subscribe', 'complete'], 'activity.openRequests');
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r113
// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-002
export function createNimiLocalAppActivityClient(shell: NimiLocalAppActivityShell): NimiLocalAppActivityClient {
  assertNimiLocalAppActivityShell(shell);
  return Object.freeze({
    put: async (input: NimiAppActivityPutInput) => projectPutResult(await shell.put(validatePutInput(input))),
    list: async (input?: NimiAppActivityListInput) => projectPage(await shell.list(validateListInput(input ?? {}))),
    subscribe: async (input: { readonly afterChangeSeq: string }) => {
      assertExactKeys(input, ['afterChangeSeq'], 'App activity subscribe input');
      const subscription = await shell.subscribe({ afterChangeSeq: decimalCursor(input.afterChangeSeq, 'afterChangeSeq') });
      const projected: NimiAppActivitySubscription = {
        async *[Symbol.asyncIterator]() {
          for await (const event of subscription.events) yield projectChange(event);
        },
        cancel: async () => subscription.cancel(),
      };
      return Object.freeze(projected);
    },
    markRead: async (input: { readonly activityId: string; readonly displayedRevision: number }) => {
      assertExactKeys(input, ['activityId', 'displayedRevision'], 'App activity markRead input');
      return projectRecord(await shell.markRead({
        activityId: activityId(input.activityId),
        displayedRevision: positiveRevision(input.displayedRevision, 'displayedRevision'),
      }));
    },
    open: async (input: { readonly activityId: string }) => {
      assertExactKeys(input, ['activityId'], 'App activity open input');
      return projectOpenResult(await shell.open({ activityId: activityId(input.activityId) }));
    },
    onOpenRequest: (handler: NimiAppActivityOpenHandler) => registerOpenHandler(shell, handler),
  });
}

function validatePutInput(input: NimiAppActivityPutInput): JsonObject {
  assertExactKeys(input, [
    'key', 'revision', 'kind', 'todoState', 'attention', 'title', 'summary', 'objectRef', 'type', 'data',
    'occurredAt', 'agentHandle',
  ], 'App activity put input');
  assertNoAuthorityMaterial({ ...input, data: undefined });
  const kind = input.kind;
  if (kind !== 'activity' && kind !== 'todo') invalidInput('kind');
  if (kind === 'todo') {
    if (!isTodoState(input.todoState)) invalidInput('todoState');
    if (input.objectRef === undefined) invalidInput('objectRef is required for a todo');
  } else if (input.todoState !== undefined) {
    invalidInput('todoState is only valid for a todo');
  }
  if (typeof input.attention !== 'boolean') invalidInput('attention');
  const payload: JsonObject = {
    key: line(input.key, 'key', MAX_KEY_BYTES),
    revision: positiveRevision(input.revision, 'revision'),
    kind,
    todoState: kind === 'todo' ? input.todoState as string : null,
    attention: input.attention,
    title: line(input.title, 'title', MAX_TITLE_BYTES),
    summary: input.summary === undefined ? null : text(input.summary, 'summary', MAX_SUMMARY_BYTES),
    objectRef: input.objectRef === undefined ? null : objectRef(input.objectRef),
    type: activityType(input.type),
    dataJson: input.data === undefined ? null : dataJson(input.data),
    occurredAt: occurredAt(input.occurredAt),
    agentHandle: input.agentHandle === undefined ? null : validateAgentHandle(input.agentHandle),
  };
  return payload;
}

function validateListInput(input: NimiAppActivityListInput): JsonObject {
  assertExactKeys(input, ['filter', 'pageSize', 'pageToken'], 'App activity list input');
  const filter = input.filter ?? {};
  assertExactKeys(filter, ['sourceRef', 'kind', 'todoStates', 'agentRef', 'occurredAfter', 'occurredBefore'], 'App activity filter');
  if (filter.kind !== undefined && filter.kind !== 'activity' && filter.kind !== 'todo') invalidInput('filter.kind');
  const todoStates = filter.todoStates === undefined ? [] : [...filter.todoStates];
  if (todoStates.some((state) => !isTodoState(state)) || new Set(todoStates).size !== todoStates.length) {
    invalidInput('filter.todoStates');
  }
  const pageSize = input.pageSize ?? 50;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) invalidInput('pageSize');
  return {
    filter: {
      sourceRef: filter.sourceRef === undefined ? null : prefixedRef(filter.sourceRef, 'src_', 'filter.sourceRef'),
      kind: filter.kind ?? null,
      todoStates,
      agentRef: filter.agentRef === undefined ? null : prefixedRef(filter.agentRef, 'agr_', 'filter.agentRef'),
      occurredAfter: filter.occurredAfter === undefined ? null : isoTimestamp(filter.occurredAfter, 'filter.occurredAfter'),
      occurredBefore: filter.occurredBefore === undefined ? null : isoTimestamp(filter.occurredBefore, 'filter.occurredBefore'),
    },
    pageSize,
    pageToken: input.pageToken === undefined ? null : line(input.pageToken, 'pageToken', 512),
  };
}

function registerOpenHandler(shell: NimiLocalAppActivityShell, handler: NimiAppActivityOpenHandler): NimiAppActivityOpenRegistration {
  if (typeof handler !== 'function') invalidInput('open handler');
  let stopped = false;
  let current: NimiAppActivityShellSubscription | undefined;
  let wake: (() => void) | undefined;
  const pause = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  const loop = async () => {
    let backoff = 250;
    while (!stopped) {
      try {
        const subscription = await shell.openRequests.subscribe();
        current = subscription;
        if (stopped) {
          await subscription.cancel();
          return;
        }
        backoff = 250;
        for await (const raw of subscription.events) {
          const request = projectOpenRequest(raw);
          let completion: 'opened' | 'object-unavailable';
          try {
            completion = await handler(request.request);
          } catch {
            // A failed navigation is never confirmed; the consumer receives
            // the Runtime deadline result instead of opened.
            continue;
          }
          if (completion !== 'opened' && completion !== 'object-unavailable') continue;
          if (stopped) return;
          await shell.openRequests.complete({ deliveryId: request.deliveryId, completion }).catch(() => undefined);
        }
      } catch {
        // A new subscription accepts only fresh or never-delivered requests;
        // Runtime cancels requests assigned to a lost source session.
      } finally {
        current = undefined;
      }
      if (stopped) return;
      await pause(backoff);
      backoff = Math.min(backoff * 2, 5_000);
    }
  };
  void loop();
  return Object.freeze({
    stop: async () => {
      stopped = true;
      wake?.();
      await current?.cancel().catch(() => undefined);
    },
  });
}

function projectPutResult(value: unknown): NimiAppActivityPutResult {
  assertSafeProjection(value);
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['record', 'changed'], 'App activity put result');
  if (typeof record.changed !== 'boolean') return localAppProjectionError('App activity put changed');
  return Object.freeze({ record: projectRecord(record.record), changed: record.changed });
}

function projectPage(value: unknown): NimiAppActivityPage {
  assertSafeProjection(value);
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['records', 'nextPageToken', 'baselineChangeSeq'], 'App activity page');
  if (!Array.isArray(record.records) || record.records.length > MAX_PAGE_SIZE) {
    return localAppProjectionError('App activity page records');
  }
  const nextPageToken = record.nextPageToken === null ? null : projectionLine(record.nextPageToken, 'App activity page token', 512);
  return Object.freeze({
    records: Object.freeze(record.records.map(projectRecord)),
    nextPageToken,
    baselineChangeSeq: decimalCursor(record.baselineChangeSeq, 'baselineChangeSeq'),
  });
}

function projectChange(value: unknown): NimiAppActivityChange {
  assertSafeProjection(value);
  const record = asRecord(value);
  if (record?.kind === 'remove') {
    assertExactProjectionKeys(record, ['changeSeq', 'kind', 'activityId'], 'App activity remove change');
    return Object.freeze({
      changeSeq: positiveCursor(record.changeSeq, 'changeSeq'),
      kind: 'remove' as const,
      activityId: projectionActivityId(record.activityId),
    });
  }
  assertExactProjectionKeys(record, ['changeSeq', 'kind', 'activityId', 'record'], 'App activity upsert change');
  if (record.kind !== 'upsert') return localAppProjectionError('App activity change kind');
  const projected = projectRecord(record.record);
  const changeSeq = positiveCursor(record.changeSeq, 'changeSeq');
  if (projected.activityId !== record.activityId || projected.changeSeq !== changeSeq) {
    return localAppProjectionError('App activity change binding');
  }
  return Object.freeze({ changeSeq, kind: 'upsert' as const, activityId: projected.activityId, record: projected });
}

export function projectNimiAppActivityRecord(value: unknown): NimiAppActivityRecord {
  return projectRecord(value);
}

function projectRecord(value: unknown): NimiAppActivityRecord {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'activityId', 'source', 'key', 'revision', 'kind', 'todoState', 'attention', 'title', 'summary', 'objectRef',
    'type', 'dataJson', 'agent', 'occurredAt', 'publishedAt', 'updatedAt', 'changeSeq', 'userView',
  ], 'App activity record');
  const { dataJson, ...frame } = record;
  assertSafeProjection(frame);
  const kind = record.kind;
  if (kind !== 'activity' && kind !== 'todo') return localAppProjectionError('App activity kind');
  const todoState = record.todoState === null ? null : record.todoState;
  if ((kind === 'todo') !== (todoState !== null) || (todoState !== null && !isTodoState(todoState))) {
    return localAppProjectionError('App activity todo state');
  }
  if (typeof record.attention !== 'boolean') return localAppProjectionError('App activity attention');
  const revision = projectionRevision(record.revision, 'revision');
  const objectRefValue = record.objectRef === null ? null : projectionObjectRef(record.objectRef);
  if (kind === 'todo' && objectRefValue === null) return localAppProjectionError('App activity todo object');
  return Object.freeze({
    activityId: projectionActivityId(record.activityId),
    source: projectSource(record.source),
    key: projectionLine(record.key, 'App activity key', MAX_KEY_BYTES),
    revision,
    kind,
    todoState: todoState as NimiAppActivityTodoState | null,
    attention: record.attention,
    title: projectionLine(record.title, 'App activity title', MAX_TITLE_BYTES),
    summary: record.summary === null ? null : projectionText(record.summary, 'App activity summary', MAX_SUMMARY_BYTES),
    objectRef: objectRefValue,
    type: projectionType(record.type),
    data: dataJson === null ? null : projectData(dataJson),
    agent: record.agent === null ? null : projectAgent(record.agent),
    occurredAt: projectInstant(record.occurredAt, 'occurredAt'),
    publishedAt: projectInstant(record.publishedAt, 'publishedAt'),
    updatedAt: projectInstant(record.updatedAt, 'updatedAt'),
    changeSeq: positiveCursor(record.changeSeq, 'changeSeq'),
    userView: projectUserView(record.userView, revision),
  });
}

function projectSource(value: unknown): NimiAppActivitySource {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['kind', 'sourceRef', 'appId', 'displayName', 'available'], 'App activity source');
  if (record.kind !== 'app' && record.kind !== 'runtime-agent') return localAppProjectionError('App activity source kind');
  if (typeof record.available !== 'boolean') return localAppProjectionError('App activity source availability');
  const appId = record.appId === null ? null : projectionLine(record.appId, 'App activity source appId', 160);
  const displayName = record.displayName === null ? null : projectionLine(record.displayName, 'App activity source name', 256);
  if (record.kind === 'runtime-agent' && (appId !== null || displayName !== null)) {
    return localAppProjectionError('App activity Runtime source');
  }
  return Object.freeze({
    kind: record.kind,
    sourceRef: projectionPrefixedRef(record.sourceRef, 'src_', 'App activity sourceRef'),
    appId,
    displayName,
    available: record.available,
  });
}

function projectAgent(value: unknown): NimiAppActivityAgent {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['agentRef', 'displayName'], 'App activity Agent association');
  return Object.freeze({
    agentRef: projectionPrefixedRef(record.agentRef, 'agr_', 'App activity agentRef'),
    displayName: projectionLine(record.displayName, 'App activity Agent name', 256),
  });
}

function projectUserView(value: unknown, revision: number): NimiAppActivityUserView {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['readThroughRevision', 'unread', 'needsAttention'], 'App activity user view');
  const readThroughRevision = record.readThroughRevision;
  if (typeof readThroughRevision !== 'number' || !Number.isSafeInteger(readThroughRevision) || readThroughRevision < 0 ||
    readThroughRevision > revision || typeof record.unread !== 'boolean' || typeof record.needsAttention !== 'boolean' ||
    record.unread !== (revision > readThroughRevision) || (record.needsAttention && !record.unread)) {
    return localAppProjectionError('App activity user view');
  }
  return Object.freeze({ readThroughRevision, unread: record.unread, needsAttention: record.needsAttention });
}

function projectOpenResult(value: unknown): NimiAppActivityOpenResult {
  assertSafeProjection(value);
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['outcome', 'reason'], 'App activity open result');
  const outcome = record.outcome;
  const reason = record.reason;
  const reasons: Record<string, readonly NimiAppActivityOpenReason[]> = {
    opened: ['opened'],
    unavailable: ['not-openable', 'activity-unavailable', 'source-unavailable', 'object-unavailable', 'host-unavailable'],
    failed: ['source-not-ready', 'canceled', 'launch-failed'],
  };
  if (typeof outcome !== 'string' || !reasons[outcome] || !reasons[outcome]!.includes(reason as NimiAppActivityOpenReason)) {
    return localAppProjectionError('App activity open result');
  }
  return Object.freeze({ outcome: outcome as NimiAppActivityOpenResult['outcome'], reason: reason as NimiAppActivityOpenReason });
}

function projectOpenRequest(value: unknown): { readonly deliveryId: string; readonly request: NimiAppActivityOpenRequest } {
  assertSafeProjection(value);
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['deliveryId', 'activityId', 'objectRef', 'type'], 'App activity open request');
  return {
    deliveryId: projectionPrefixedRef(record.deliveryId, 'aod_', 'App activity delivery'),
    request: Object.freeze({
      activityId: projectionActivityId(record.activityId),
      objectRef: projectionObjectRef(record.objectRef),
      type: projectionType(record.type),
    }),
  };
}

function projectData(value: unknown): Readonly<JsonObject> {
  if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).byteLength > MAX_DATA_JSON_BYTES) {
    return localAppProjectionError('App activity data');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return localAppProjectionError('App activity data');
  }
  if (!asRecord(parsed)) return localAppProjectionError('App activity data');
  // Publisher data is product content: its keys are not authority fields.
  assertSafeProjection(parsed, new Set(), true);
  return deepFreeze(parsed as JsonObject);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function projectInstant(value: unknown, field: string): string {
  const timestamp = projectTimestamp(value, `App activity ${field}`);
  if (!timestamp) return localAppProjectionError(`App activity ${field}`);
  const millis = Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1_000_000);
  if (!Number.isSafeInteger(millis)) return localAppProjectionError(`App activity ${field}`);
  return new Date(millis).toISOString();
}

// ----- Runtime typed-client variant used by trusted Host implementations -----

export type NimiLocalAppActivityRuntime = {
  readonly putAppActivity: (request: PutAppActivityRequest) => Promise<PutAppActivityResponse>;
  readonly listAppActivities: (request: ListAppActivitiesRequest) => Promise<ListAppActivitiesResponse>;
  readonly subscribeAppActivityChanges: (
    request: SubscribeAppActivityChangesRequest,
    options?: { readonly signal?: AbortSignal },
  ) => AsyncIterable<SubscribeAppActivityChangesResponse>;
  readonly markAppActivityRead: (request: MarkAppActivityReadRequest) => Promise<MarkAppActivityReadResponse>;
  readonly openAppActivity: (
    request: OpenAppActivityRequest,
    options?: { readonly signal?: AbortSignal },
  ) => AsyncIterable<OpenAppActivityResponse>;
  readonly subscribeAppActivityOpenRequests: (
    request: SubscribeAppActivityOpenRequestsRequest,
    options?: { readonly signal?: AbortSignal },
  ) => AsyncIterable<SubscribeAppActivityOpenRequestsResponse>;
  readonly completeAppActivityOpenRequest: (
    request: CompleteAppActivityOpenRequestRequest,
  ) => Promise<CompleteAppActivityOpenRequestResponse>;
};

/**
 * Host-side open orchestration: the Host consumes the Host-private open
 * request id to ask Desktop to launch or focus the exact source, and returns
 * only the typed result to renderer code.
 */
export type NimiLocalAppActivityHostLaunch = (openRequestId: string) => Promise<
  | { readonly status: 'requested' }
  | { readonly status: 'unavailable' | 'failed'; readonly reason: 'host-unavailable' | 'source-unavailable' | 'launch-failed' }
>;

/**
 * Builds the JSON shell projection from the typed Runtime client. Kit Hosts
 * that reach Runtime through the SDK typed client use this; native carriers
 * produce the identical JSON projection.
 */
export function createNimiLocalAppActivityRuntimeShell(
  runtime: NimiLocalAppActivityRuntime,
  launch: NimiLocalAppActivityHostLaunch,
): NimiLocalAppActivityShell {
  return {
    put: async (input) => {
      const payload = asRecord(input) ?? {};
      const response = await runtime.putAppActivity(runtimePutRequest(payload));
      if (!response.record) return localAppProjectionError('Runtime App activity put');
      return { record: runtimeActivityRecordJson(response.record), changed: response.changed };
    },
    list: async (input) => {
      const payload = asRecord(input) ?? {};
      const response = await runtime.listAppActivities(runtimeListRequest(payload));
      return {
        records: response.records.map(runtimeActivityRecordJson),
        nextPageToken: response.nextPageToken || null,
        baselineChangeSeq: response.baselineChangeSeq,
      };
    },
    subscribe: async (input) => {
      const controller = new AbortController();
      const source = runtime.subscribeAppActivityChanges({ afterChangeSeq: input.afterChangeSeq }, { signal: controller.signal });
      return {
        events: (async function* () {
          for await (const change of source) yield runtimeActivityChangeJson(change);
        })(),
        cancel: async () => controller.abort(),
      };
    },
    markRead: async (input) => {
      const response = await runtime.markAppActivityRead({
        activityId: input.activityId, displayedRevision: String(input.displayedRevision),
      });
      if (!response.record) return localAppProjectionError('Runtime App activity markRead');
      return runtimeActivityRecordJson(response.record);
    },
    open: async (input) => runNimiLocalAppActivityOpen(runtime, launch, input.activityId),
    openRequests: {
      subscribe: async () => {
        const controller = new AbortController();
        const source = runtime.subscribeAppActivityOpenRequests({}, { signal: controller.signal });
        return {
          events: (async function* () {
            for await (const request of source) {
              yield {
                deliveryId: request.deliveryId, activityId: request.activityId,
                objectRef: request.objectRef, type: request.activityType,
              };
            }
          })(),
          cancel: async () => controller.abort(),
        };
      },
      complete: async (input) => {
        const response = await runtime.completeAppActivityOpenRequest({
          deliveryId: input.deliveryId,
          completion: input.completion === 'opened'
            ? AppActivityOpenCompletion.OPENED
            : AppActivityOpenCompletion.OBJECT_UNAVAILABLE,
        });
        return { accepted: response.accepted };
      },
    },
  };
}

/**
 * Consumer-side open orchestration shared by typed-client Hosts: the pending
 * event triggers the Desktop launch, and only the Runtime result reports the
 * source App's confirmation.
 */
/**
 * After the Desktop launch or focus fails, a source App that is already
 * running may still confirm the object; the Host waits this long for the
 * Runtime result before reporting the launch failure.
 */
export const NIMI_APP_ACTIVITY_LAUNCH_FAILURE_GRACE_MS = 5_000;

export async function runNimiLocalAppActivityOpen(
  runtime: Pick<NimiLocalAppActivityRuntime, 'openAppActivity'>,
  launch: NimiLocalAppActivityHostLaunch,
  activityIdValue: string,
  launchFailureGraceMs = NIMI_APP_ACTIVITY_LAUNCH_FAILURE_GRACE_MS,
): Promise<{ readonly outcome: string; readonly reason: string }> {
  const controller = new AbortController();
  const iterator = runtime.openAppActivity({ activityId: activityIdValue }, { signal: controller.signal })[Symbol.asyncIterator]();
  let launchFailure: { readonly outcome: string; readonly reason: string } | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let graceElapsed: Promise<{ kind: 'grace' }> | undefined;
  let launching: Promise<{ kind: 'launch'; value: Awaited<ReturnType<NimiLocalAppActivityHostLaunch>> }> | undefined;
  let pending = iterator.next().then(value => ({ kind: 'stream' as const, value }));
  try {
    while (true) {
      // Keep reading Runtime while Desktop starts the source. A slow launch
      // acknowledgement must not hide the source confirmation or owner deadline.
      const outcome = await Promise.race([pending, ...(launching ? [launching] : []), ...(graceElapsed ? [graceElapsed] : [])]);
      if (outcome.kind === 'grace') return launchFailure!;
      if (outcome.kind === 'launch') {
        launching = undefined;
        if (outcome.value.status !== 'requested') {
          launchFailure = { outcome: outcome.value.status, reason: outcome.value.reason };
          graceElapsed = new Promise(resolve => {
            graceTimer = setTimeout(() => resolve({ kind: 'grace' }), launchFailureGraceMs);
          });
        }
        continue;
      }
      const next = outcome.value;
      if (next.done) return launchFailure ?? { outcome: 'failed', reason: 'source-not-ready' };
      const event = next.value.event;
      if (event.oneofKind === 'openRequestId') {
        launching = launch(event.openRequestId)
          .catch(() => ({ status: 'failed' as const, reason: 'launch-failed' as const }))
          .then(value => ({ kind: 'launch' as const, value }));
        pending = iterator.next().then(value => ({ kind: 'stream' as const, value }));
        continue;
      }
      if (event.oneofKind === 'result' && event.result) return runtimeOpenResultJson(event.result.outcome, event.result.reason);
      return localAppProjectionError('Runtime App activity open event');
    }
  } finally {
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    controller.abort();
    pending.catch(() => undefined);
    // Generator cancellation must not delay the already authoritative result.
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}

function runtimePutRequest(payload: Record<string, unknown>): PutAppActivityRequest {
  const kind = payload.kind === 'todo' ? AppActivityKind.TODO : AppActivityKind.ACTIVITY;
  const occurredAt = typeof payload.occurredAt === 'string' ? Date.parse(payload.occurredAt) : Number.NaN;
  if (!Number.isFinite(occurredAt)) return invalidInput('occurredAt');
  return {
    key: String(payload.key ?? ''),
    revision: String(payload.revision ?? '0'),
    kind,
    todoState: todoStateEnum(payload.todoState),
    attention: payload.attention === true,
    title: String(payload.title ?? ''),
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    objectRef: typeof payload.objectRef === 'string' ? payload.objectRef : '',
    activityType: String(payload.type ?? ''),
    dataJson: typeof payload.dataJson === 'string' ? payload.dataJson : '',
    occurredAt: { seconds: String(Math.floor(occurredAt / 1000)), nanos: (occurredAt % 1000) * 1_000_000 },
    agentHandle: typeof payload.agentHandle === 'string' ? payload.agentHandle : '',
  };
}

function runtimeListRequest(payload: Record<string, unknown>): ListAppActivitiesRequest {
  const filter = asRecord(payload.filter) ?? {};
  const timestamp = (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? { seconds: String(Math.floor(millis / 1000)), nanos: (millis % 1000) * 1_000_000 } : undefined;
  };
  return {
    filter: {
      sourceRef: typeof filter.sourceRef === 'string' ? filter.sourceRef : '',
      kind: filter.kind === 'todo' ? AppActivityKind.TODO : filter.kind === 'activity' ? AppActivityKind.ACTIVITY : AppActivityKind.UNSPECIFIED,
      todoStates: Array.isArray(filter.todoStates) ? filter.todoStates.map(todoStateEnum) : [],
      agentRef: typeof filter.agentRef === 'string' ? filter.agentRef : '',
      occurredAfter: timestamp(filter.occurredAfter),
      occurredBefore: timestamp(filter.occurredBefore),
    },
    pageSize: typeof payload.pageSize === 'number' ? payload.pageSize : 0,
    pageToken: typeof payload.pageToken === 'string' ? payload.pageToken : '',
  };
}

function todoStateEnum(value: unknown): AppActivityTodoState {
  switch (value) {
    case 'open': return AppActivityTodoState.OPEN;
    case 'completed': return AppActivityTodoState.COMPLETED;
    case 'cancelled': return AppActivityTodoState.CANCELLED;
    default: return AppActivityTodoState.UNSPECIFIED;
  }
}

/** Converts one Runtime record into the shared JSON shell projection. */
export function runtimeActivityRecordJson(record: RuntimeAppActivityRecord): JsonObject {
  const source = record.source;
  const todoStates: Partial<Record<AppActivityTodoState, string>> = {
    [AppActivityTodoState.OPEN]: 'open',
    [AppActivityTodoState.COMPLETED]: 'completed',
    [AppActivityTodoState.CANCELLED]: 'cancelled',
  };
  const timestamp = (value: { readonly seconds: string; readonly nanos: number } | undefined) => (
    value ? { seconds: value.seconds, nanos: value.nanos } : null
  );
  return {
    activityId: record.activityId,
    source: source ? {
      kind: source.kind === AppActivitySourceKind.RUNTIME_AGENT ? 'runtime-agent' : source.kind === AppActivitySourceKind.APP ? 'app' : 'unknown',
      sourceRef: source.sourceRef,
      appId: source.appId || null,
      displayName: source.displayName || null,
      available: source.available,
    } : null,
    key: record.key,
    revision: Number(record.revision),
    kind: record.kind === AppActivityKind.TODO ? 'todo' : record.kind === AppActivityKind.ACTIVITY ? 'activity' : 'unknown',
    todoState: todoStates[record.todoState] ?? null,
    attention: record.attention,
    title: record.title,
    summary: record.summary || null,
    objectRef: record.objectRef || null,
    type: record.activityType,
    dataJson: record.dataJson || null,
    agent: record.agent ? { agentRef: record.agent.agentRef, displayName: record.agent.displayName } : null,
    occurredAt: timestamp(record.occurredAt),
    publishedAt: timestamp(record.publishedAt),
    updatedAt: timestamp(record.updatedAt),
    changeSeq: record.changeSeq,
    userView: {
      readThroughRevision: Number(record.userView?.readThroughRevision ?? '0'),
      unread: record.userView?.unread ?? false,
      needsAttention: record.userView?.needsAttention ?? false,
    },
  };
}

export function runtimeActivityChangeJson(change: SubscribeAppActivityChangesResponse): JsonObject {
  if (change.kind === AppActivityChangeKind.REMOVE) {
    return { changeSeq: change.changeSeq, kind: 'remove', activityId: change.activityId };
  }
  if (change.kind !== AppActivityChangeKind.UPSERT || !change.record) {
    return localAppProjectionError('Runtime App activity change');
  }
  return {
    changeSeq: change.changeSeq, kind: 'upsert', activityId: change.activityId,
    record: runtimeActivityRecordJson(change.record),
  };
}

export function runtimeOpenResultJson(outcome: AppActivityOpenOutcome, reason: AppActivityOpenReason): { readonly outcome: string; readonly reason: string } {
  const outcomes: Partial<Record<AppActivityOpenOutcome, string>> = {
    [AppActivityOpenOutcome.OPENED]: 'opened',
    [AppActivityOpenOutcome.UNAVAILABLE]: 'unavailable',
    [AppActivityOpenOutcome.FAILED]: 'failed',
  };
  const reasons: Partial<Record<AppActivityOpenReason, string>> = {
    [AppActivityOpenReason.OPENED]: 'opened',
    [AppActivityOpenReason.NOT_OPENABLE]: 'not-openable',
    [AppActivityOpenReason.SOURCE_UNAVAILABLE]: 'source-unavailable',
    [AppActivityOpenReason.OBJECT_UNAVAILABLE]: 'object-unavailable',
    [AppActivityOpenReason.SOURCE_NOT_READY]: 'source-not-ready',
    [AppActivityOpenReason.CANCELED]: 'canceled',
    [AppActivityOpenReason.ACTIVITY_UNAVAILABLE]: 'activity-unavailable',
  };
  const outcomeText = outcomes[outcome];
  const reasonText = reasons[reason];
  if (!outcomeText || !reasonText) return localAppProjectionError('Runtime App activity open result');
  return { outcome: outcomeText, reason: reasonText };
}

// ----- validation helpers -----

function invalidInput(field: string): never {
  return localAppError(`App activity input is invalid: ${field}.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_app_activity_input');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function line(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || byteLength(value) > maxBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)) invalidInput(field);
  return value as string;
}

function text(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || byteLength(value) > maxBytes ||
    /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) invalidInput(field);
  return value as string;
}

function projectionLine(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || byteLength(value) > maxBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)) return localAppProjectionError(field);
  return value;
}

function projectionText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || byteLength(value) > maxBytes ||
    /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) return localAppProjectionError(field);
  return value;
}

function positiveRevision(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalidInput(field);
  return value as number;
}

function projectionRevision(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return localAppProjectionError(`App activity ${field}`);
  return value;
}

function positiveCursor(value: unknown, field: string): string {
  const cursor = decimalCursor(value, field);
  if (cursor === '0') return localAppProjectionError(field);
  return cursor;
}

function isTodoState(value: unknown): value is NimiAppActivityTodoState {
  return value === 'open' || value === 'completed' || value === 'cancelled';
}

function objectRef(value: unknown): string {
  if (typeof value !== 'string' || !OBJECT_REF_PATTERN.test(value)) invalidInput('objectRef');
  return value as string;
}

function projectionObjectRef(value: unknown): string {
  if (typeof value !== 'string' || !OBJECT_REF_PATTERN.test(value)) return localAppProjectionError('App activity objectRef');
  return value;
}

function activityType(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !ACTIVITY_TYPE_PATTERN.test(value) ||
    value.startsWith(RESERVED_RUNTIME_TYPE_PREFIX)) invalidInput('type');
  return value as string;
}

function projectionType(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !ACTIVITY_TYPE_PATTERN.test(value)) {
    return localAppProjectionError('App activity type');
  }
  return value;
}

function dataJson(value: unknown): string {
  if (!asRecord(value)) invalidInput('data must be a plain JSON object');
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return invalidInput('data');
  }
  if (byteLength(encoded) > MAX_DATA_JSON_BYTES) invalidInput('data exceeds 32 KiB');
  return encoded;
}

function occurredAt(value: unknown): string {
  const millis = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(millis)) invalidInput('occurredAt');
  return new Date(millis).toISOString();
}

function isoTimestamp(value: unknown, field: string): string {
  const millis = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(millis)) invalidInput(field);
  return new Date(millis).toISOString();
}

function prefixedRef(value: unknown, prefix: string, field: string): string {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 64 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    invalidInput(field);
  }
  return value as string;
}

function projectionPrefixedRef(value: unknown, prefix: string, field: string): string {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 64 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return localAppProjectionError(field);
  }
  return value;
}

function activityId(value: unknown): string {
  if (typeof value !== 'string' || !/^act_[0-9A-Z]{26}$/u.test(value)) invalidInput('activityId');
  return value as string;
}

function projectionActivityId(value: unknown): string {
  if (typeof value !== 'string' || !/^act_[0-9A-Z]{26}$/u.test(value)) return localAppProjectionError('App activity activityId');
  return value;
}
