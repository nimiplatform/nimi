import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import type {
  GetLocalAppEmbodimentSnapshotRequest,
  GetLocalAppEmbodimentSnapshotResponse,
  LocalAppEmbodimentEvent as RuntimeLocalAppEmbodimentEvent,
  SubscribeLocalAppEmbodimentEventsRequest,
} from '../../core-generated/runtime-protobuf/runtime/v1/agent_embodiment.js';
import {
  LocalAppEmbodimentEventKind,
  LocalAppEmbodimentVoicePhase,
} from '../../core-generated/runtime-protobuf/runtime/v1/agent_embodiment.js';
import { validateAgentHandle } from './local-app-runtime-platform-conversation.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  decimalCursor,
  localAppProjectionError,
  projectTimestamp,
} from './local-app-runtime-platform-validation.js';

const MAX_TIMING_MILLIS = 24 * 60 * 60 * 1000;

export type NimiLocalAppEmbodimentScopeInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
};

export type NimiLocalAppEmbodimentSubscribeInput = NimiLocalAppEmbodimentScopeInput & {
  readonly afterSequence?: string;
};

export type NimiLocalAppEmbodimentActivity = Readonly<{
  name: string;
  category: string;
  intensity: string;
  source: 'runtime';
  turnRef: string;
}>;

export type NimiLocalAppEmbodimentEmotion = Readonly<{
  name: string;
  source: string;
}>;

export type NimiLocalAppEmbodimentPosture = Readonly<{
  actionFamily: string;
  interruptMode: string;
}>;

export type NimiLocalAppEmbodimentVoiceTiming = Readonly<{
  phase: 'active' | 'completed' | 'failed' | 'interrupted' | 'canceled';
  durationMillis: number;
  deadlineOffsetMillis: number;
  turnRef: string;
  correlationRef: string;
}>;

export type NimiLocalAppEmbodimentSnapshot = Readonly<{
  sequence: string;
  observedAt: Readonly<{ seconds: string; nanos: number }>;
  provenance: 'runtime_agent_owner';
  activity: NimiLocalAppEmbodimentActivity | null;
  emotion: NimiLocalAppEmbodimentEmotion | null;
  posture: NimiLocalAppEmbodimentPosture | null;
  voiceTiming: NimiLocalAppEmbodimentVoiceTiming | null;
}>;

type NimiLocalAppEmbodimentEventBase = Readonly<{
  sequence: string;
  observedAt: Readonly<{ seconds: string; nanos: number }>;
  provenance: 'runtime_agent_owner';
}>;

export type NimiLocalAppEmbodimentEvent =
  | (NimiLocalAppEmbodimentEventBase & { readonly kind: 'activity'; readonly payload: NimiLocalAppEmbodimentActivity })
  | (NimiLocalAppEmbodimentEventBase & { readonly kind: 'emotion'; readonly payload: NimiLocalAppEmbodimentEmotion })
  | (NimiLocalAppEmbodimentEventBase & { readonly kind: 'posture'; readonly payload: NimiLocalAppEmbodimentPosture })
  | (NimiLocalAppEmbodimentEventBase & { readonly kind: 'voice-timing'; readonly payload: NimiLocalAppEmbodimentVoiceTiming });

export type NimiLocalAppEmbodimentSubscription = AsyncIterable<NimiLocalAppEmbodimentEvent> & {
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppEmbodimentShellSubscription = {
  readonly events: AsyncIterable<unknown>;
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppEmbodimentShell = {
  readonly snapshot: (input: { readonly agentHandle: string; readonly conversationAnchorId: string }) => Promise<unknown>;
  readonly subscribe: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
    readonly afterSequence: string;
  }) => Promise<NimiLocalAppEmbodimentShellSubscription>;
};

export type NimiLocalAppEmbodimentClient = {
  readonly snapshot: (input: NimiLocalAppEmbodimentScopeInput) => Promise<NimiLocalAppEmbodimentSnapshot>;
  readonly subscribe: (input: NimiLocalAppEmbodimentSubscribeInput) => Promise<NimiLocalAppEmbodimentSubscription>;
};

export type NimiLocalAppEmbodimentRuntime = {
  readonly getLocalAppEmbodimentSnapshot: (
    request: GetLocalAppEmbodimentSnapshotRequest,
  ) => Promise<GetLocalAppEmbodimentSnapshotResponse>;
  readonly subscribeLocalAppEmbodimentEvents: (
    request: SubscribeLocalAppEmbodimentEventsRequest,
    options?: { readonly signal?: AbortSignal },
  ) => AsyncIterable<RuntimeLocalAppEmbodimentEvent>;
};

export function createNimiLocalAppEmbodimentRuntimeClient(
  runtime: NimiLocalAppEmbodimentRuntime,
): NimiLocalAppEmbodimentClient {
  return createNimiLocalAppEmbodimentClient({
    snapshot: async (input) => {
      const response = await runtime.getLocalAppEmbodimentSnapshot(input);
      if (!response.snapshot) return localAppProjectionError('Runtime embodiment snapshot');
      return runtimeEmbodimentSnapshot(response.snapshot);
    },
    subscribe: async (input) => {
      const controller = new AbortController();
      const source = runtime.subscribeLocalAppEmbodimentEvents({
        agentHandle: input.agentHandle,
        conversationAnchorId: input.conversationAnchorId,
        afterSequence: input.afterSequence,
      }, { signal: controller.signal });
      return {
        events: (async function* () {
          for await (const event of source) yield runtimeEmbodimentEvent(event);
        })(),
        cancel: async () => controller.abort(),
      };
    },
  });
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r076
// @nimi-authority: rule.nimi.sdks.feature-clients.r105
export function createNimiLocalAppEmbodimentClient(
  shell: NimiLocalAppEmbodimentShell,
): NimiLocalAppEmbodimentClient {
  return Object.freeze({
    snapshot: async (input) => projectSnapshot(await shell.snapshot(projectScope(input, 'snapshot'))),
    subscribe: async (input) => {
      assertExactKeys(
        input,
        input.afterSequence === undefined
          ? ['agentHandle', 'conversationAnchorId']
          : ['agentHandle', 'conversationAnchorId', 'afterSequence'],
        'local-app embodiment subscribe input',
      );
      assertNoAuthorityMaterial(input);
      const subscription = await shell.subscribe({
        agentHandle: validateAgentHandle(input.agentHandle),
        conversationAnchorId: selector(input.conversationAnchorId, 'conversationAnchorId'),
        afterSequence: input.afterSequence === undefined ? '0' : decimalCursor(input.afterSequence, 'afterSequence'),
      });
      const projected: NimiLocalAppEmbodimentSubscription = {
        async *[Symbol.asyncIterator]() {
          for await (const event of subscription.events) yield projectEvent(event);
        },
        cancel: async () => subscription.cancel(),
      };
      return Object.freeze(projected);
    },
  });
}

function runtimeEmbodimentSnapshot(value: GetLocalAppEmbodimentSnapshotResponse['snapshot'] & {}): unknown {
  return {
    sequence: value.sequence,
    observedAt: value.observedAt ? runtimeTimestamp(value.observedAt) : null,
    provenance: value.provenance,
    activity: value.activity ? runtimeActivity(value.activity) : null,
    emotion: value.emotion ? runtimeEmotion(value.emotion) : null,
    posture: value.posture ? runtimePosture(value.posture) : null,
    voiceTiming: value.voiceTiming ? runtimeVoiceTiming(value.voiceTiming) : null,
  };
}

function runtimeEmbodimentEvent(value: RuntimeLocalAppEmbodimentEvent): unknown {
  const base = {
    sequence: value.sequence,
    observedAt: value.observedAt ? runtimeTimestamp(value.observedAt) : null,
    provenance: value.provenance,
  };
  switch (value.payload.oneofKind) {
    case 'activity':
      if (value.kind !== LocalAppEmbodimentEventKind.ACTIVITY) return localAppProjectionError('Runtime embodiment activity kind');
      return { ...base, kind: 'activity', payload: runtimeActivity(value.payload.activity) };
    case 'emotion':
      if (value.kind !== LocalAppEmbodimentEventKind.EMOTION) return localAppProjectionError('Runtime embodiment emotion kind');
      return { ...base, kind: 'emotion', payload: runtimeEmotion(value.payload.emotion) };
    case 'posture':
      if (value.kind !== LocalAppEmbodimentEventKind.POSTURE) return localAppProjectionError('Runtime embodiment posture kind');
      return { ...base, kind: 'posture', payload: runtimePosture(value.payload.posture) };
    case 'voiceTiming':
      if (value.kind !== LocalAppEmbodimentEventKind.VOICE_TIMING) return localAppProjectionError('Runtime embodiment voice kind');
      return { ...base, kind: 'voice-timing', payload: runtimeVoiceTiming(value.payload.voiceTiming) };
    default:
      return localAppProjectionError('Runtime embodiment payload');
  }
}

function runtimeTimestamp(value: { readonly seconds: string; readonly nanos: number }): unknown {
  return { seconds: value.seconds, nanos: value.nanos };
}

function runtimeActivity(value: {
  readonly name: string; readonly category: string; readonly intensity: string;
  readonly source: string; readonly turnRef: string;
}): unknown {
  return {
    name: value.name, category: value.category, intensity: value.intensity,
    source: value.source, turnRef: value.turnRef,
  };
}

function runtimeEmotion(value: { readonly name: string; readonly source: string }): unknown {
  return { name: value.name, source: value.source };
}

function runtimePosture(value: { readonly actionFamily: string; readonly interruptMode: string }): unknown {
  return { actionFamily: value.actionFamily, interruptMode: value.interruptMode };
}

function runtimeVoiceTiming(value: {
  readonly phase: LocalAppEmbodimentVoicePhase;
  readonly durationMs: string;
  readonly deadlineOffsetMs: string;
  readonly turnRef: string;
  readonly correlationRef: string;
}): unknown {
  const phases: Partial<Record<LocalAppEmbodimentVoicePhase, string>> = {
    [LocalAppEmbodimentVoicePhase.ACTIVE]: 'active',
    [LocalAppEmbodimentVoicePhase.COMPLETED]: 'completed',
    [LocalAppEmbodimentVoicePhase.FAILED]: 'failed',
    [LocalAppEmbodimentVoicePhase.INTERRUPTED]: 'interrupted',
    [LocalAppEmbodimentVoicePhase.CANCELED]: 'canceled',
  };
  const phase = phases[value.phase];
  if (!phase) return localAppProjectionError('Runtime embodiment voice phase');
  return {
    phase,
    durationMillis: Number(value.durationMs),
    deadlineOffsetMillis: Number(value.deadlineOffsetMs),
    turnRef: value.turnRef,
    correlationRef: value.correlationRef,
  };
}

function projectScope(input: NimiLocalAppEmbodimentScopeInput, operation: string) {
  assertExactKeys(input, ['agentHandle', 'conversationAnchorId'], `local-app embodiment ${operation} input`);
  assertNoAuthorityMaterial(input);
  return Object.freeze({
    agentHandle: validateAgentHandle(input.agentHandle),
    conversationAnchorId: selector(input.conversationAnchorId, 'conversationAnchorId'),
  });
}

function projectSnapshot(value: unknown): NimiLocalAppEmbodimentSnapshot {
  assertSafeProjection(value);
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['sequence', 'observedAt', 'provenance', 'activity', 'emotion', 'posture', 'voiceTiming'],
    'local-app embodiment snapshot',
  );
  return Object.freeze({
    ...projectBase(record),
    activity: nullablePayload(record.activity, projectActivity),
    emotion: nullablePayload(record.emotion, projectEmotion),
    posture: nullablePayload(record.posture, projectPosture),
    voiceTiming: nullablePayload(record.voiceTiming, projectVoiceTiming),
  });
}

function projectEvent(value: unknown): NimiLocalAppEmbodimentEvent {
  assertSafeProjection(value);
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['sequence', 'observedAt', 'provenance', 'kind', 'payload'], 'local-app embodiment event');
  const base = projectBase(record);
  switch (record.kind) {
    case 'activity': return Object.freeze({ ...base, kind: 'activity' as const, payload: projectActivity(record.payload) });
    case 'emotion': return Object.freeze({ ...base, kind: 'emotion' as const, payload: projectEmotion(record.payload) });
    case 'posture': return Object.freeze({ ...base, kind: 'posture' as const, payload: projectPosture(record.payload) });
    case 'voice-timing': return Object.freeze({ ...base, kind: 'voice-timing' as const, payload: projectVoiceTiming(record.payload) });
    default: return localAppProjectionError('local-app embodiment event kind');
  }
}

function projectBase(record: Record<string, unknown>): NimiLocalAppEmbodimentEventBase {
  const observedAt = projectTimestamp(record.observedAt, 'local-app embodiment observedAt');
  if (!observedAt || record.provenance !== 'runtime_agent_owner') {
    return localAppProjectionError('local-app embodiment provenance');
  }
  return Object.freeze({
    sequence: positiveCursor(record.sequence, 'sequence'),
    observedAt: Object.freeze(observedAt),
    provenance: 'runtime_agent_owner' as const,
  });
}

function projectActivity(value: unknown): NimiLocalAppEmbodimentActivity {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['name', 'category', 'intensity', 'source', 'turnRef'], 'embodiment activity');
  if (record.source !== 'runtime') return localAppProjectionError('embodiment activity source');
  return Object.freeze({
    name: text(record.name, 'activity.name'),
    category: text(record.category, 'activity.category'),
    intensity: optionalText(record.intensity, 'activity.intensity'),
    source: 'runtime' as const,
    turnRef: selector(record.turnRef, 'activity.turnRef'),
  });
}

function projectEmotion(value: unknown): NimiLocalAppEmbodimentEmotion {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['name', 'source'], 'embodiment emotion');
  return Object.freeze({ name: text(record.name, 'emotion.name'), source: text(record.source, 'emotion.source') });
}

function projectPosture(value: unknown): NimiLocalAppEmbodimentPosture {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['actionFamily', 'interruptMode'], 'embodiment posture');
  return Object.freeze({
    actionFamily: text(record.actionFamily, 'posture.actionFamily'),
    interruptMode: text(record.interruptMode, 'posture.interruptMode'),
  });
}

function projectVoiceTiming(value: unknown): NimiLocalAppEmbodimentVoiceTiming {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['phase', 'durationMillis', 'deadlineOffsetMillis', 'turnRef', 'correlationRef'],
    'embodiment voice timing',
  );
  if (!['active', 'completed', 'failed', 'interrupted', 'canceled'].includes(String(record.phase)) ||
    !boundedMillis(record.durationMillis) || !boundedMillis(record.deadlineOffsetMillis)) {
    return localAppProjectionError('embodiment voice timing');
  }
  return Object.freeze({
    phase: record.phase as NimiLocalAppEmbodimentVoiceTiming['phase'],
    durationMillis: record.durationMillis as number,
    deadlineOffsetMillis: record.deadlineOffsetMillis as number,
    turnRef: selector(record.turnRef, 'voiceTiming.turnRef'),
    correlationRef: selector(record.correlationRef, 'voiceTiming.correlationRef'),
  });
}

function nullablePayload<T>(value: unknown, project: (value: unknown) => T): T | null {
  return value === null ? null : project(value);
}

function positiveCursor(value: unknown, field: string): string {
  const cursor = decimalCursor(value, field);
  if (cursor === '0') return localAppProjectionError(field);
  return cursor;
}

function selector(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.trim() !== value ||
    /[\u0000\r\n]/u.test(value)) return localAppProjectionError(field);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)) return localAppProjectionError(field);
  return value;
}

function optionalText(value: unknown, field: string): string {
  if (value === '') return '';
  return text(value, field);
}

function boundedMillis(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMING_MILLIS;
}
