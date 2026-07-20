/**
 * Closed Simulator error enum and fixed message catalog.
 *
 * Authority: tables/simulator-error-codes.yaml (P-SIM-019). Messages are a
 * platform-owned fixed catalog: no scenario free text, secrets, absolute
 * paths, or raw source. Every Simulator error is non-retryable.
 */

export const SIMULATOR_ERROR_CODES = [
  'SIMULATOR_INVALID_MANIFEST',
  'SIMULATOR_SOURCE_MISMATCH',
  'SIMULATOR_UNSUPPORTED',
  'SIMULATOR_CAPABILITY_DENIED',
  'SIMULATOR_RESOURCE_EXHAUSTED',
  'SIMULATOR_INVALID_PAYLOAD',
  'SIMULATOR_INVALID_LIFECYCLE',
  'SIMULATOR_STALE_EPOCH',
  'SIMULATOR_INSTANCE_DISPOSED',
  'SIMULATOR_INSTANCE_FAILED',
  'SIMULATOR_MODULE_FAILED',
  'SIMULATOR_EFFECT_FORBIDDEN',
  'SIMULATOR_INTEGRITY_FAILURE',
] as const;

export type SimulatorErrorCode = (typeof SIMULATOR_ERROR_CODES)[number];

const FIXED_MESSAGES: Readonly<Record<SimulatorErrorCode, string>> = {
  SIMULATOR_INVALID_MANIFEST: 'manifest or module contract validation failed',
  SIMULATOR_SOURCE_MISMATCH: 'selected source identity does not match the descriptor or report',
  SIMULATOR_UNSUPPORTED: 'the requested declared behavior has no supported simulated implementation',
  SIMULATOR_CAPABILITY_DENIED: 'a declared capability is disabled by the active scenario or policy',
  SIMULATOR_RESOURCE_EXHAUSTED: 'a declared bounded resource limit was reached',
  SIMULATOR_INVALID_PAYLOAD: 'the request failed its owner-declared exact schema',
  SIMULATOR_INVALID_LIFECYCLE: 'the requested lifecycle transition is outside the closed transition table',
  SIMULATOR_STALE_EPOCH: 'the context or operation belongs to an invalidated scenario epoch',
  SIMULATOR_INSTANCE_DISPOSED: 'the target instance has completed disposal',
  SIMULATOR_INSTANCE_FAILED: 'an attributable instance fault failed the instance after ordered cleanup',
  SIMULATOR_MODULE_FAILED: 'a resolved module graph failed for the waiting instances of that module',
  SIMULATOR_EFFECT_FORBIDDEN: 'a cataloged browser effect was denied',
  SIMULATOR_INTEGRITY_FAILURE: 'deterministic, containment, or cleanup integrity can no longer be proven',
};

export interface SimulatorError {
  readonly code: SimulatorErrorCode;
  readonly message: string;
  readonly moduleId: string | null;
  readonly instanceId: string | null;
  readonly operationId: string | null;
  readonly retryable: false;
}

export type SimulatorResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: SimulatorError };

export interface SimulatorErrorContext {
  readonly moduleId?: string | null;
  readonly instanceId?: string | null;
  readonly operationId?: string | null;
}

export function simulatorError(code: SimulatorErrorCode, context: SimulatorErrorContext = {}): SimulatorError {
  return Object.freeze({
    code,
    message: FIXED_MESSAGES[code],
    moduleId: context.moduleId ?? null,
    instanceId: context.instanceId ?? null,
    operationId: context.operationId ?? null,
    retryable: false,
  });
}

export function simulatorOk<TValue>(value: TValue): SimulatorResult<TValue> {
  return Object.freeze({ ok: true, value });
}

export function simulatorFail<TValue>(error: SimulatorError): SimulatorResult<TValue> {
  return Object.freeze({ ok: false, error });
}

export function simulatorFailure<TValue>(
  code: SimulatorErrorCode,
  context: SimulatorErrorContext = {},
): SimulatorResult<TValue> {
  return simulatorFail(simulatorError(code, context));
}

export function isSimulatorErrorCode(value: unknown): value is SimulatorErrorCode {
  return typeof value === 'string' && (SIMULATOR_ERROR_CODES as readonly string[]).includes(value);
}
