import type {
  RuntimeCallOptions,
  RuntimeClientConfig,
  RuntimeMetadata,
  RuntimeStreamCallOptions,
} from '../types';

function normalize(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text.length > 0 ? text : undefined;
}

export function mergeRuntimeMetadata(
  config: RuntimeClientConfig,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
): RuntimeMetadata {
  const defaults = config.defaults || {};
  const metadata = options?.metadata || {};

  return {
    protocolVersion: normalize(metadata.protocolVersion || defaults.protocolVersion || '1.0.0'),
    participantProtocolVersion: normalize(metadata.participantProtocolVersion || defaults.participantProtocolVersion || '1.0.0'),
    participantId: normalize(metadata.participantId || defaults.participantId || config.appId),
    domain: normalize(metadata.domain || 'runtime.rpc'),
    appId: normalize(metadata.appId || config.appId),
    traceId: normalize(metadata.traceId),
    idempotencyKey: normalize(options?.idempotencyKey || metadata.idempotencyKey),
    callerKind: metadata.callerKind || defaults.callerKind || 'third-party-app',
    callerId: normalize(metadata.callerId || defaults.callerId || config.appId),
    surfaceId: normalize(metadata.surfaceId || defaults.surfaceId),
    extra: metadata.extra || undefined,
  };
}
