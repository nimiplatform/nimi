import { ReasonCode, type Ack } from '../../core-generated/runtime-protobuf/runtime/v1/common.js';
import {
  RealtimeAdapterKind,
  RealtimeBackpressureState,
  RealtimeLifecycle,
  RealtimeTerminalReason,
  type RealtimeControlStatus,
} from '../../core-generated/runtime-protobuf/runtime/v1/realtime_control.js';
import type { Timestamp } from '../../core-generated/runtime-protobuf/google/protobuf/timestamp.js';
import { localAppProjectionError } from './local-app-runtime-platform-validation.js';

export function projectRuntimeAck(value: Ack | undefined) {
  if (!value) return invalidRuntimeRealtimeProjection('Realtime acknowledgement');
  return {
    ok: value.ok,
    reasonCode: projectRuntimeReasonCode(value.reasonCode),
    actionHint: value.actionHint,
  };
}

export function projectRuntimeRealtimeControl(value: RealtimeControlStatus | undefined) {
  if (!value) return invalidRuntimeRealtimeProjection('Realtime control status');
  return {
    realtimeSessionId: value.realtimeSessionId,
    channelId: value.channelId,
    subscriptionId: value.subscriptionId,
    adapterKind: projectRuntimeEnum(value.adapterKind, {
      [RealtimeAdapterKind.REALM]: 'realm',
      [RealtimeAdapterKind.LOCAL_AGENT]: 'local-agent',
      [RealtimeAdapterKind.AI]: 'ai',
    }, 'Realtime adapter kind'),
    lifecycle: projectRuntimeEnum(value.lifecycle, {
      [RealtimeLifecycle.OPENING]: 'opening',
      [RealtimeLifecycle.READY]: 'ready',
      [RealtimeLifecycle.DEGRADED]: 'degraded',
      [RealtimeLifecycle.RECONNECTING]: 'reconnecting',
      [RealtimeLifecycle.CLOSED]: 'closed',
      [RealtimeLifecycle.FAILED]: 'failed',
    }, 'Realtime lifecycle'),
    generation: value.generation,
    sequence: value.sequence,
    correlationId: value.correlationId,
    backpressure: projectRuntimeEnum(value.backpressure, {
      [RealtimeBackpressureState.NORMAL]: 'normal',
      [RealtimeBackpressureState.PRESSURED]: 'pressured',
      [RealtimeBackpressureState.BLOCKED]: 'blocked',
    }, 'Realtime backpressure'),
    bufferedItems: value.bufferedItems,
    bufferCapacity: value.bufferCapacity,
    terminalReason: value.terminalReason === RealtimeTerminalReason.UNSPECIFIED
      ? ''
      : projectRuntimeEnum(value.terminalReason, {
        [RealtimeTerminalReason.CANCELLED]: 'cancelled',
        [RealtimeTerminalReason.UNAUTHENTICATED]: 'unauthenticated',
        [RealtimeTerminalReason.PERMISSION_DENIED]: 'permission-denied',
        [RealtimeTerminalReason.NOT_FOUND]: 'not-found',
        [RealtimeTerminalReason.UNAVAILABLE]: 'unavailable',
        [RealtimeTerminalReason.PROTOCOL_FAILURE]: 'protocol-failure',
        [RealtimeTerminalReason.RESOURCE_EXHAUSTED]: 'resource-exhausted',
        [RealtimeTerminalReason.SLOW_CONSUMER]: 'slow-consumer',
        [RealtimeTerminalReason.RUNTIME_SHUTDOWN]: 'runtime-shutdown',
        [RealtimeTerminalReason.STALE_GENERATION]: 'stale-generation',
        [RealtimeTerminalReason.OWNER_FAILED]: 'owner-failed',
      }, 'Realtime terminal reason'),
    actionHint: value.actionHint,
    occurredAt: projectRuntimeOptionalTimestamp(value.occurredAt),
  };
}

export function projectRuntimeTimestamp(value: Timestamp | undefined) {
  if (!value) return invalidRuntimeRealtimeProjection('Realtime timestamp');
  return { seconds: value.seconds, nanos: value.nanos };
}

export function projectRuntimeOptionalTimestamp(value: Timestamp | undefined) {
  return value ? projectRuntimeTimestamp(value) : null;
}

export function projectRuntimeReasonCode(value: ReasonCode): string {
  return value === ReasonCode.REASON_CODE_UNSPECIFIED
    ? ''
    : ReasonCode[value] ?? invalidRuntimeRealtimeProjection('Realtime reason code');
}

export function projectRuntimeEnum<T extends string>(
  value: number,
  values: Readonly<Record<number, T>>,
  label: string,
): T {
  return values[value] ?? invalidRuntimeRealtimeProjection(label);
}

export function invalidRuntimeRealtimeProjection(label: string): never {
  return localAppProjectionError(`${label} is invalid.`);
}
