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

export function studioNonSuccessReasonTitle(reason: StudioNonSuccessReason, translate: StudioTranslate): string {
  return translate(`NonSuccess.title.${reasonKeySegment(reason)}`);
}

export function studioNonSuccessReasonUserMessage(reason: string, translate: StudioTranslate): string {
  const segment = reasonKeySegment(reason);
  return translate(segment ? `NonSuccess.message.${segment}` : 'NonSuccess.message.fallback');
}

export function studioNonSuccessReasonUserAction(reason: string, translate: StudioTranslate): string {
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
