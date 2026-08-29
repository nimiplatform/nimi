import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
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
  voiceRef: string;
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

// @nimi-authority: rule.nimi.sdks.feature-clients.r076
// @nimi-authority: rule.nimi.sdks.feature-clients.r105
// Candidate projection remains outside the active NimiLocalAppClient shape
// until the single WP6 carrier/client cutover.
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
    ['phase', 'durationMillis', 'deadlineOffsetMillis', 'turnRef', 'voiceRef'],
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
    voiceRef: selector(record.voiceRef, 'voiceTiming.voiceRef'),
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
