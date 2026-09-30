import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import { NIMI_CHATGPT_PLAN_USAGE_URL } from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';

/** Feedback action that opens OpenAI's usage page after a plan usage limit. */
export function chatGPTPlanManageUsageFeedbackAction(
  t: TFunction,
): Pick<InlineFeedbackState, 'actionLabel' | 'onAction'> {
  return {
    actionLabel: t('Chat.chatgptPlanManageUsage', { defaultValue: 'Manage usage' }),
    onAction: () => {
      void openExternalUrl(NIMI_CHATGPT_PLAN_USAGE_URL).catch(() => undefined);
    },
  };
}
