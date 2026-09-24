import type {
  StudioNonSuccess,
  StudioNonSuccessDiagnostics,
  StudioNonSuccessReason,
  StudioRuntimeCapabilityDescriptor,
} from './runtime-types.js';

export type StudioTranslate = (
  key: string,
  values?: Readonly<Record<string, unknown>>,
) => string;

function reasonKeySegment(reason: string): string {
  switch (reason) {
    case 'runtime-unavailable': return 'runtimeUnavailable';
    case 'input-invalid': return 'inputInvalid';
    case 'sdk-method-unavailable': return 'sdkMethodUnavailable';
    case 'principal-unauthorized': return 'principalUnauthorized';
    case 'operation-aborted': return 'operationAborted';
    case 'runtime-canceled': return 'runtimeCanceled';
    case 'runtime-timeout': return 'runtimeTimeout';
    case 'stream-interrupted': return 'streamInterrupted';
    case 'runtime-call-failed': return 'runtimeCallFailed';
    default: return '';
  }
}

// A synchronous direct call has no Job whose final state could still arrive:
// stopping it ends it, unlike a submitted Job whose cancellation may be pending.
const DIRECT_CALL_CAPABILITIES: ReadonlySet<string> = new Set(['text.decide']);

export function isStoppedDirectCall(reason: string, capabilityId?: string): boolean {
  return reason === 'operation-aborted' && capabilityId !== undefined && DIRECT_CALL_CAPABILITIES.has(capabilityId);
}

export function studioNonSuccessReasonTitle(reason: StudioNonSuccessReason, translate: StudioTranslate, capabilityId?: string): string {
  if (isStoppedDirectCall(reason, capabilityId)) return translate('NonSuccess.title.stoppedDirectCall');
  return translate(`NonSuccess.title.${reasonKeySegment(reason)}`);
}

// A valid input that the configured implementation cannot encode completely
// is neither a malformed request nor a retryable failure.
const INPUT_LIMIT_EXCEEDED_REASON_CODE = 'AI_INPUT_LIMIT_EXCEEDED';

export function studioNonSuccessReasonUserMessage(reason: string, translate: StudioTranslate, capabilityId?: string, diagnostics?: StudioNonSuccessDiagnostics): string {
  if (capabilityId === 'vision.locate' && diagnostics?.reasonCode === 'AI_LOCAL_SELECTION_NOT_FOUND') return translate('VisionLocate.modelSelectionRequired');
  if (isStoppedDirectCall(reason, capabilityId)) return translate('NonSuccess.message.stoppedDirectCall');
  if (diagnostics?.reasonCode === INPUT_LIMIT_EXCEEDED_REASON_CODE) return translate('NonSuccess.message.inputLimitExceeded');
  if (reason === 'input-invalid' && capabilityId === 'vision.locate') return translate('VisionLocate.invalidInput');
  const segment = reasonKeySegment(reason);
  return translate(segment ? `NonSuccess.message.${segment}` : 'NonSuccess.message.fallback');
}

export function studioNonSuccessReasonUserAction(reason: string, translate: StudioTranslate, capabilityId?: string, diagnostics?: StudioNonSuccessDiagnostics): string {
  if (capabilityId === 'vision.locate' && diagnostics?.reasonCode === 'AI_LOCAL_SELECTION_NOT_FOUND') return translate('VisionLocate.selectModelAction');
  if (isStoppedDirectCall(reason, capabilityId)) return translate('NonSuccess.action.stoppedDirectCall');
  if (diagnostics?.reasonCode === INPUT_LIMIT_EXCEEDED_REASON_CODE) return translate('NonSuccess.action.inputLimitExceeded');
  if (reason === 'input-invalid' && capabilityId === 'vision.locate') return translate('VisionLocate.correctInput');
  const segment = reasonKeySegment(reason);
  return translate(segment ? `NonSuccess.action.${segment}` : 'NonSuccess.action.fallback');
}

export function studioNonSuccessActionHint(
  reason: StudioNonSuccessReason,
  translate: StudioTranslate,
): string {
  return translate(`NonSuccess.hint.${reasonKeySegment(reason)}`);
}

export function createStudioNonSuccess(
  capability: StudioRuntimeCapabilityDescriptor,
  reason: StudioNonSuccessReason,
  message: string,
  translate: StudioTranslate,
  diagnostics?: StudioNonSuccessDiagnostics,
): StudioNonSuccess {
  return {
    ok: false,
    capabilityId: capability.id,
    reason,
    message,
    actionHint: studioNonSuccessActionHint(reason, translate),
    missingSurface: capability.missingSurface,
    ...(diagnostics ? { diagnostics } : {}),
  };
}
