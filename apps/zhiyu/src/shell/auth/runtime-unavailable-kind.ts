import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimePlatformUnavailableProjection } from './runtime-platform';

export type ZhiyuRuntimeUnavailableKind = 'connection' | 'session';

const RUNTIME_CONNECTION_REASON_CODES: readonly string[] = [
  'electron-runtime-endpoint-unavailable',
  ReasonCode.RUNTIME_UNAVAILABLE,
];

const RUNTIME_CONNECTION_ACTION_HINTS: readonly string[] = [
  'start_external_runtime_daemon',
  'start_fixed_runtime_service',
];

// Only an unreachable Runtime is fixed by opening Nimi, so only that kind is
// re-checked automatically. Permission, session, and host admission failures
// keep their typed reason and point the user back to Nimi instead.
export function zhiyuRuntimeUnavailableKind(
  projection: RuntimePlatformUnavailableProjection | undefined,
): ZhiyuRuntimeUnavailableKind {
  if (!projection) return 'connection';
  if (/permission|forbidden|scope/i.test(projection.reasonCode)) return 'session';
  return RUNTIME_CONNECTION_REASON_CODES.includes(projection.reasonCode)
    || RUNTIME_CONNECTION_ACTION_HINTS.includes(projection.actionHint ?? '')
    ? 'connection'
    : 'session';
}
