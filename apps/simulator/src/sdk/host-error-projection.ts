import type {
  NimiTestingHostFailure,
  NimiTestingHostFailureDisposition,
} from '@nimiplatform/sdk/testing';

import type { SimulatorError, SimulatorErrorCode } from '../state-engine/errors.ts';

type SimulatorSdkUnreachableErrorCode =
  | 'SIMULATOR_INVALID_MANIFEST'
  | 'SIMULATOR_SOURCE_MISMATCH'
  | 'SIMULATOR_INVALID_LIFECYCLE';

export class SimulatorSdkErrorScopeViolation extends Error {
  readonly code = 'SIMULATOR_SDK_ERROR_SCOPE_VIOLATION';

  constructor() {
    super('A non-facade Simulator failure reached the SDK host projection');
    this.name = 'SimulatorSdkErrorScopeViolation';
  }
}

export function projectSimulatorSdkHostFailure(error: SimulatorError): NimiTestingHostFailure {
  if (isSdkUnreachableCode(error.code)) throw new SimulatorSdkErrorScopeViolation();
  return Object.freeze({ disposition: dispositionFor(error.code) });
}

function isSdkUnreachableCode(code: SimulatorErrorCode): code is SimulatorSdkUnreachableErrorCode {
  return code === 'SIMULATOR_INVALID_MANIFEST'
    || code === 'SIMULATOR_SOURCE_MISMATCH'
    || code === 'SIMULATOR_INVALID_LIFECYCLE';
}

function dispositionFor(
  code: Exclude<SimulatorErrorCode, SimulatorSdkUnreachableErrorCode>,
): NimiTestingHostFailureDisposition {
  switch (code) {
    case 'SIMULATOR_UNSUPPORTED':
      return 'unsupported';
    case 'SIMULATOR_CAPABILITY_DENIED':
      return 'capability-denied';
    case 'SIMULATOR_RESOURCE_EXHAUSTED':
      return 'resource-exhausted';
    case 'SIMULATOR_INVALID_PAYLOAD':
      return 'invalid-input';
    case 'SIMULATOR_STALE_EPOCH':
    case 'SIMULATOR_INSTANCE_DISPOSED':
    case 'SIMULATOR_INSTANCE_FAILED':
    case 'SIMULATOR_MODULE_FAILED':
      return 'host-unavailable';
    case 'SIMULATOR_EFFECT_FORBIDDEN':
      return 'effect-forbidden';
    case 'SIMULATOR_INTEGRITY_FAILURE':
      return 'internal';
  }
}
