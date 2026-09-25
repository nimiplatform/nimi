import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { RuntimeSetupTaskFailure } from './runtime-setup-task-store.js';

export type RuntimeSetupFailureNotice = Pick<RuntimeSetupTaskFailure, 'message' | 'reasonCode'>;

// Desktop's protected Runtime carrier reports only the typed reason, so a
// Runtime failure's message is usually the bare reason code. Reasons a person
// can act on get plain guidance instead; null keeps the reported text.
function setupFailureGuidance(reasonCode: string | undefined, t: TFunction): string | null {
  switch (reasonCode) {
    case 'AI_LOADOUT_MODEL_ASSET_NOT_FOUND':
      return t('runtimeConfig.setupTask.modelFilesMissing', {
        defaultValue: 'The files for this model could not be found. They may have been deleted or moved. You can download or import them again, or choose another model.',
      });
    case 'AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED':
      return t('runtimeConfig.setupTask.localModelRecordsOutdated', {
        defaultValue: "Model records on this device were saved by an earlier version of Nimi and need a format upgrade before local models can be used again. Cloud services aren't affected.",
      });
    default:
      return null;
  }
}

/** One line for compact surfaces: the guidance when there is one, otherwise the reported text. */
export function runtimeSetupFailureText(failure: RuntimeSetupFailureNotice, t: TFunction): string {
  return setupFailureGuidance(failure.reasonCode, t) ?? failure.message;
}

/**
 * A setup failure inside an alert. Guidance keeps its reason code under
 * technical details; any other failure shows the reported text, plus its
 * reason code when that differs from the text.
 */
export function RuntimeSetupFailureMessage(props: { readonly failure: RuntimeSetupFailureNotice }) {
  const { t } = useTranslation();
  const { message, reasonCode } = props.failure;
  const guidance = setupFailureGuidance(reasonCode, t);
  if (!guidance) {
    return <div>{reasonCode && reasonCode !== message ? `${message} (${reasonCode})` : message}</div>;
  }
  return (
    <>
      <div>{guidance}</div>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
        <span className="break-all font-mono">{reasonCode}</span>
      </details>
    </>
  );
}
