import { ReasonCode, createNimiError, type NimiError } from '../../types/index.js';
import { sha256Ascii } from './sha256.js';
import type { NimiTestingHostFailureDisposition } from './host-types.js';

interface HostErrorCatalogEntry {
  readonly code: string;
  readonly message: string;
  readonly actionHint: string;
}

const HOST_ERROR_CATALOG: Readonly<Record<NimiTestingHostFailureDisposition, HostErrorCatalogEntry>> = {
  unsupported: {
    code: ReasonCode.SDK_HOST_UNSUPPORTED,
    message: 'The requested operation is not implemented by this SDK host',
    actionHint: 'use_a_declared_supported_operation',
  },
  'capability-denied': {
    code: ReasonCode.SDK_HOST_CAPABILITY_DENIED,
    message: 'The SDK host denied the requested capability',
    actionHint: 'use_an_admitted_capability',
  },
  'resource-exhausted': {
    code: ReasonCode.SDK_HOST_RESOURCE_EXHAUSTED,
    message: 'The SDK host reached its bounded resource limit',
    actionHint: 'release_owned_resources_before_retrying',
  },
  'invalid-input': {
    code: ReasonCode.SDK_INVALID_INPUT,
    message: 'The SDK host rejected the operation input',
    actionHint: 'correct_the_operation_input',
  },
  'host-unavailable': {
    code: ReasonCode.SDK_HOST_UNAVAILABLE,
    message: 'The injected SDK host is no longer available',
    actionHint: 'wait_for_a_live_renderer_instance',
  },
  'effect-forbidden': {
    code: ReasonCode.SDK_HOST_EFFECT_FORBIDDEN,
    message: 'The SDK host forbids this effect in the current execution context',
    actionHint: 'use_an_admitted_host_effect',
  },
  internal: {
    code: ReasonCode.SDK_HOST_INTERNAL,
    message: 'The injected SDK host failed its local execution contract',
    actionHint: 'inspect_host_diagnostics',
  },
  aborted: {
    code: ReasonCode.OPERATION_ABORTED,
    message: 'The SDK host operation was cancelled by the caller',
    actionHint: 'retry_when_the_caller_is_ready',
  },
};

export function createNimiTestingHostError(input: {
  readonly opaqueTraceSeed: string;
  readonly errorSequence: number;
  readonly methodId: string;
  readonly disposition: NimiTestingHostFailureDisposition;
}): NimiError {
  const catalog = HOST_ERROR_CATALOG[input.disposition];
  const traceDigest = sha256Ascii([
    input.opaqueTraceSeed,
    String(input.errorSequence),
    input.methodId,
    input.disposition,
  ].join(':'));
  return createNimiError({
    message: catalog.message,
    code: catalog.code,
    reasonCode: catalog.code,
    actionHint: catalog.actionHint,
    traceId: `sdk_host_${traceDigest.slice(0, 32)}`,
    retryable: false,
    source: 'sdk',
    details: {
      methodId: input.methodId,
      disposition: input.disposition,
    },
  });
}
