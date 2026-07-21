import { normalizeNimiRuntimeReasonCode } from '@nimiplatform/sdk/runtime';
import { i18n } from '../../i18n';
import { assetUnhealthyReasonSummary } from './runtime-config-model-center-utils';

// Localized, human-readable message for a runtime reason code.
//
// Resolution order:
//   1. A desktop-localized message keyed by the canonical reason code
//      (`runtimeConfig.reasonMessages.<CODE>`) — this is what gives zh users
//      Chinese copy instead of the SDK's English default.
//   2. The SDK English default (via `assetUnhealthyReasonSummary`) when no
//      localized entry exists yet.
//   3. '' for an unmapped code, so the caller renders generic copy.
//
// The raw machine code is never returned as user-facing text.
export function localizedAssetUnhealthyReason(reasonCode: string | undefined): string {
  // An unmapped code has no English default; return '' so the caller renders
  // generic copy. (Short-circuiting here also avoids calling i18n.t with an
  // empty defaultValue, which i18next resolves to a humanized key, not ''.)
  const englishDefault = assetUnhealthyReasonSummary(reasonCode);
  if (!englishDefault) {
    return '';
  }
  const normalized = normalizeNimiRuntimeReasonCode(reasonCode);
  if (!normalized) {
    return englishDefault;
  }
  return i18n.t(`runtimeConfig.reasonMessages.${normalized}`, { defaultValue: englishDefault });
}
