import { toTransportError } from './node-grpc-errors';

export interface RuntimeNodeGrpcSensitiveTransportOptions {
  readonly endpoint?: string;
  readonly tls?: {
    readonly enabled?: boolean;
  };
}

export function normalizeRuntimeNodeGrpcEndpoint(endpoint: string | undefined): string {
  const value = String(endpoint || '127.0.0.1:46371').trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('http://')) {
    return value.slice('http://'.length);
  }
  if (value.startsWith('https://')) {
    return value.slice('https://'.length);
  }
  return value;
}

export function runtimeNodeGrpcTransportAllowsSensitiveCredentials(
  options: RuntimeNodeGrpcSensitiveTransportOptions,
): boolean {
  if (options.tls?.enabled) {
    return true;
  }
  const endpoint = normalizeRuntimeNodeGrpcEndpoint(options.endpoint);
  const host = endpoint.startsWith('[')
    ? endpoint.slice(0, endpoint.indexOf(']') + 1).toLowerCase()
    : endpoint.split(':')[0]?.trim().toLowerCase() || '';
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

export function assertRuntimeNodeGrpcSensitiveTransport(
  options: RuntimeNodeGrpcSensitiveTransportOptions,
  methodId: string,
): void {
  if (runtimeNodeGrpcTransportAllowsSensitiveCredentials(options)) {
    return;
  }
  throw toTransportError(
    'SDK_TRANSPORT_INVALID',
    'Runtime bearer authorization requires TLS or a loopback-only node-grpc endpoint',
    { endpoint: normalizeRuntimeNodeGrpcEndpoint(options.endpoint), methodId },
    {
      actionHint: 'enable_tls_or_use_loopback_for_runtime_bearer',
      retryable: false,
    },
  );
}
