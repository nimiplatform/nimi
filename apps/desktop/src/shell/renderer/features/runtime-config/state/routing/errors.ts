export type RuntimeRouteResolutionErrorCode =
  | 'RUNTIME_ROUTE_CAPABILITY_MISSING'
  | 'RUNTIME_ROUTE_MODEL_MISSING'
  | 'RUNTIME_ROUTE_CAPABILITY_MISMATCH'
  | 'RUNTIME_ROUTE_CONNECTOR_MISSING'
  | 'RUNTIME_ROUTE_CONNECTOR_TOKEN_MISSING';

export class RuntimeRouteResolutionError extends Error {
  readonly code: RuntimeRouteResolutionErrorCode;
  readonly metadata?: Record<string, unknown>;

  constructor(code: RuntimeRouteResolutionErrorCode, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.name = 'RuntimeRouteResolutionError';
    this.code = code;
    this.metadata = metadata;
  }
}

export function throwRouteError(
  code: RuntimeRouteResolutionErrorCode,
  message: string,
  metadata?: Record<string, unknown>,
): never {
  throw new RuntimeRouteResolutionError(code, message, metadata);
}
