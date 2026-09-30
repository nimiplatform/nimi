import { NIMI_CHATGPT_PLAN_USAGE_URL } from '@nimiplatform/sdk/runtime';
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
const DIRECT_CALL_CAPABILITIES: ReadonlySet<string> = new Set(['text.decide', 'text.generate']);

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
const TEXT_BEHAVIOR_UNSUPPORTED_REASON_CODE = 'AI_TEXT_BEHAVIOR_UNSUPPORTED';
const MEDIA_OPTION_UNSUPPORTED_REASON_CODE = 'AI_MEDIA_OPTION_UNSUPPORTED';
const MEDIA_CODEC_UNAVAILABLE_REASON_CODE = 'AI_MEDIA_CODEC_UNAVAILABLE';
const VOICE_INPUT_INVALID_REASON_CODE = 'AI_VOICE_INPUT_INVALID';
const VOICE_TARGET_MISMATCH_REASON_CODE = 'AI_VOICE_TARGET_MODEL_MISMATCH';
// The cloud service refused the request under its rate or usage limit, which
// for a ChatGPT plan Connector is the plan's usage limit for this app.
const PROVIDER_RATE_LIMITED_REASON_CODE = 'AI_PROVIDER_RATE_LIMITED';

// A committed target that Runtime can no longer run is recovered by choosing a
// target again (or repairing its Connector in Desktop), never by retrying the
// same request.
const TARGET_RESELECTION_KEY_SEGMENTS: ReadonlyMap<string, string> = new Map([
  ['AI_REMOTE_MODEL_CATALOG_STALE', 'catalogStale'],
  ['CAPABILITY_CATALOG_MISMATCH', 'catalogMismatch'],
  ['AI_CONNECTOR_DISABLED', 'connectorDisabled'],
  ['AI_CONNECTOR_CREDENTIAL_MISSING', 'connectorCredentialMissing'],
  ['AI_CONNECTOR_NOT_FOUND', 'connectorNotFound'],
  ['AI_CONFIG_INVALID', 'configInvalid'],
  ['AI_MODEL_NOT_FOUND', 'modelNotFound'],
]);

function targetReselectionKeySegment(diagnostics?: StudioNonSuccessDiagnostics): string {
  return diagnostics ? TARGET_RESELECTION_KEY_SEGMENTS.get(diagnostics.reasonCode) ?? '' : '';
}

export function studioNonSuccessNeedsTargetReselection(diagnostics?: StudioNonSuccessDiagnostics): boolean {
  return targetReselectionKeySegment(diagnostics) !== '';
}

export function studioNonSuccessReasonUserMessage(reason: string, translate: StudioTranslate, capabilityId?: string, diagnostics?: StudioNonSuccessDiagnostics): string {
  if (capabilityId === 'audio.synthesize' && diagnostics?.reasonCode === VOICE_INPUT_INVALID_REASON_CODE) return translate('NonSuccess.message.voiceInputRequired');
  if (capabilityId === 'audio.synthesize' && diagnostics?.reasonCode === VOICE_TARGET_MISMATCH_REASON_CODE) return translate('NonSuccess.message.voiceTargetMismatch');
  if (capabilityId === 'vision.locate' && diagnostics?.reasonCode === 'AI_LOCAL_SELECTION_NOT_FOUND') return translate('VisionLocate.modelSelectionRequired');
  if (isStoppedDirectCall(reason, capabilityId)) return translate('NonSuccess.message.stoppedDirectCall');
  if (diagnostics?.reasonCode === INPUT_LIMIT_EXCEEDED_REASON_CODE) return translate('NonSuccess.message.inputLimitExceeded');
  if (diagnostics?.reasonCode === TEXT_BEHAVIOR_UNSUPPORTED_REASON_CODE) return translate('NonSuccess.message.textBehaviorUnsupported');
  if (diagnostics?.reasonCode === MEDIA_CODEC_UNAVAILABLE_REASON_CODE) return translate('NonSuccess.message.mediaCodecUnavailable');
  if (capabilityId === 'vision.locate' && diagnostics?.reasonCode === MEDIA_OPTION_UNSUPPORTED_REASON_CODE) return translate('VisionLocate.geometryUnsupported');
  if (diagnostics?.reasonCode === MEDIA_OPTION_UNSUPPORTED_REASON_CODE) return translate('NonSuccess.message.mediaOptionUnsupported');
  if (diagnostics?.reasonCode === PROVIDER_RATE_LIMITED_REASON_CODE) return translate('NonSuccess.message.providerRateLimited');
  const reselection = targetReselectionKeySegment(diagnostics);
  if (reselection) return translate(`NonSuccess.message.${reselection}`);
  if (reason === 'input-invalid' && capabilityId === 'vision.locate') return translate('VisionLocate.invalidInput');
  const segment = reasonKeySegment(reason);
  return translate(segment ? `NonSuccess.message.${segment}` : 'NonSuccess.message.fallback');
}

export function studioNonSuccessReasonUserAction(reason: string, translate: StudioTranslate, capabilityId?: string, diagnostics?: StudioNonSuccessDiagnostics): string {
  if (capabilityId === 'audio.synthesize' && diagnostics?.reasonCode === VOICE_INPUT_INVALID_REASON_CODE) return translate('NonSuccess.action.voiceInputRequired');
  if (capabilityId === 'audio.synthesize' && diagnostics?.reasonCode === VOICE_TARGET_MISMATCH_REASON_CODE) return translate('NonSuccess.action.voiceTargetMismatch');
  if (capabilityId === 'vision.locate' && diagnostics?.reasonCode === 'AI_LOCAL_SELECTION_NOT_FOUND') return translate('VisionLocate.selectModelAction');
  if (isStoppedDirectCall(reason, capabilityId)) return translate('NonSuccess.action.stoppedDirectCall');
  if (diagnostics?.reasonCode === INPUT_LIMIT_EXCEEDED_REASON_CODE) return translate('NonSuccess.action.inputLimitExceeded');
  if (diagnostics?.reasonCode === TEXT_BEHAVIOR_UNSUPPORTED_REASON_CODE) return translate('NonSuccess.action.textBehaviorUnsupported');
  if (diagnostics?.reasonCode === MEDIA_CODEC_UNAVAILABLE_REASON_CODE) return translate('NonSuccess.action.mediaCodecUnavailable');
  if (capabilityId === 'vision.locate' && diagnostics?.reasonCode === MEDIA_OPTION_UNSUPPORTED_REASON_CODE) return translate('VisionLocate.chooseSupportedGeometry');
  if (diagnostics?.reasonCode === MEDIA_OPTION_UNSUPPORTED_REASON_CODE) return translate('NonSuccess.action.mediaOptionUnsupported');
  if (diagnostics?.reasonCode === PROVIDER_RATE_LIMITED_REASON_CODE) return translate('NonSuccess.action.providerRateLimited', { usageUrl: NIMI_CHATGPT_PLAN_USAGE_URL });
  const reselection = targetReselectionKeySegment(diagnostics);
  if (reselection) return translate(`NonSuccess.action.${reselection}`);
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
