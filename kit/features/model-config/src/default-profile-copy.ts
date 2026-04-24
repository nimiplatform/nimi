// Default ModelConfigProfileCopy builder.
//
// Produces a complete ModelConfigProfileCopy populated entirely from the
// `ModelConfig.profile.*` i18n namespace; consumers pass the bundle result
// or spread it to override a specific string.

import type { ModelConfigProfileCopy } from './types.js';

export type ModelConfigCopyFormatter = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * Build a fully-populated ModelConfigProfileCopy from a translation function.
 * Every field references the `ModelConfig.profile.*` i18n namespace.
 */
export function defaultModelConfigProfileCopy(
  t: ModelConfigCopyFormatter,
): ModelConfigProfileCopy {
  return {
    sectionTitle: t('ModelConfig.profile.sectionTitle'),
    summaryLabel: t('ModelConfig.profile.summaryLabel'),
    emptySummaryLabel: t('ModelConfig.profile.emptySummaryLabel'),
    applyButtonLabel: t('ModelConfig.profile.applyButtonLabel'),
    changeButtonLabel: t('ModelConfig.profile.changeButtonLabel'),
    manageButtonTitle: t('ModelConfig.profile.manageButtonTitle'),
    modalTitle: t('ModelConfig.profile.modalTitle'),
    modalHint: t('ModelConfig.profile.modalHint'),
    loadingLabel: t('ModelConfig.profile.loadingLabel'),
    emptyLabel: t('ModelConfig.profile.emptyLabel'),
    currentBadgeLabel: t('ModelConfig.profile.currentBadgeLabel'),
    cancelLabel: t('ModelConfig.profile.cancelLabel'),
    confirmLabel: t('ModelConfig.profile.confirmLabel'),
    applyingLabel: t('ModelConfig.profile.applyingLabel'),
    reloadLabel: t('ModelConfig.profile.reloadLabel'),
    importLabel: t('ModelConfig.profile.importLabel'),
  };
}
