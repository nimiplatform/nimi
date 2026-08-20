import type {
  StudioNonSuccess,
  StudioNonSuccessDiagnostics,
  StudioNonSuccessReason,
  StudioRuntimeCapabilityDescriptor,
} from '../ai-studio-core/runtime-types.js';
import {
  createStudioNonSuccess,
  studioNonSuccessReasonTitle,
  studioNonSuccessReasonUserAction,
  studioNonSuccessReasonUserMessage,
} from '../ai-studio-core/non-success-presentation.js';
import { t } from '../shell/i18n/index.js';

// App-owned presentation categories for typed SDK/Runtime failures. They never
// stand in for a successful execution.
//
// Copy resolves through the shared i18n t() at call time. The i18n module is
// import-safe under node:test contract builds (its Vite glob is guarded), so
// this module stays loadable there and t() falls back to returning keys.
export function nonSuccessReasonTitle(reason: StudioNonSuccessReason): string {
  return studioNonSuccessReasonTitle(reason, t);
}

export function nonSuccessReasonUserMessage(reason: string): string {
  return studioNonSuccessReasonUserMessage(reason, t);
}

export function nonSuccessReasonUserAction(reason: string): string {
  return studioNonSuccessReasonUserAction(reason, t);
}

export function capabilityNonSuccess(
  capability: StudioRuntimeCapabilityDescriptor,
  reason: StudioNonSuccessReason,
  message: string,
  diagnostics?: StudioNonSuccessDiagnostics,
): StudioNonSuccess {
  return createStudioNonSuccess(capability, reason, message, t, diagnostics);
}
