import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import { ConfirmDialog } from '@nimiplatform/kit/ui';
import { NIMI_CHATGPT_PLAN_USAGE_URL } from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import type { ManagedOAuthPendingState } from './runtime-config-managed-oauth';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

type CloudConnector = RuntimeConfigStateV11['connectors'][number];

const DISCLOSURE_SEEN_KEY = 'nimi.desktop.chatgpt-plan.disclosure-seen';

const NOTE_CLASS = 'rounded-[var(--nimi-radius-md)] px-3 py-2 text-xs';
const LINK_CLASS = 'text-[var(--nimi-action-primary-bg)] underline underline-offset-2';

function openLink(url: string): void {
  void openExternalUrl(url).catch(() => undefined);
}

export function chatGPTPlanDisclosureSeen(): boolean {
  try {
    return window.localStorage.getItem(DISCLOSURE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markChatGPTPlanDisclosureSeen(): void {
  try {
    window.localStorage.setItem(DISCLOSURE_SEEN_KEY, '1');
  } catch {
    // The disclosure is shown again next time; nothing else depends on it.
  }
}

export function chatGPTPlanSignInLabel(input: {
  readonly busy: boolean;
  readonly isDraft: boolean;
  readonly hasCredential: boolean;
  readonly t: TFunction;
}): string {
  if (input.busy) return input.t('runtimeConfig.cloud.chatgptPlanSigningIn', { defaultValue: 'Waiting for ChatGPT sign-in...' });
  if (input.isDraft) return input.t('runtimeConfig.cloud.chatgptPlanContinue', { defaultValue: 'Continue with ChatGPT' });
  if (!input.hasCredential) return input.t('runtimeConfig.cloud.chatgptPlanReconnect', { defaultValue: 'Sign in to ChatGPT again' });
  return input.t('runtimeConfig.cloud.chatgptPlanReauthorize', { defaultValue: 'Sign in again' });
}

/** Browser sign-in is waiting; the link reopens the same authorization page. */
export function ChatGPTPlanPendingNotice(props: {
  readonly pending: ManagedOAuthPendingState;
  readonly onCancel: () => void;
  readonly t: TFunction;
}) {
  const { pending, onCancel, t } = props;
  return (
    <div className={`${NOTE_CLASS} bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-text-secondary)]`}>
      <p className="font-medium text-[var(--nimi-text-primary)]">
        {t('runtimeConfig.cloud.chatgptPlanPendingTitle', { defaultValue: 'Finish signing in to ChatGPT' })}
      </p>
      <p className="mt-1">
        {t('runtimeConfig.cloud.chatgptPlanPendingBody', {
          defaultValue: 'Nimi opened your browser. Approve Nimi there to use your ChatGPT plan, then return here.',
        })}
      </p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" className={LINK_CLASS} onClick={() => openLink(pending.authorizationUrl)}>
          {t('runtimeConfig.cloud.chatgptPlanPendingReopen', { defaultValue: 'Open the sign-in page again' })}
        </button>
        <button type="button" className={LINK_CLASS} onClick={onCancel}>
          {t('runtimeConfig.cloud.chatgptPlanPendingCancel', { defaultValue: 'Cancel sign-in' })}
        </button>
      </p>
    </div>
  );
}

/** Account, plan-usage disclosure and reconnect state for a saved sign-in. */
export function ChatGPTPlanAccountNotice(props: {
  readonly connector: CloudConnector;
  readonly t: TFunction;
}) {
  const { connector, t } = props;
  return (
    <div className="space-y-2">
      {!connector.hasCredential ? (
        <p className={`${NOTE_CLASS} bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]`}>
          {t('runtimeConfig.cloud.chatgptPlanReconnectNeeded', {
            defaultValue: 'ChatGPT sign-in has ended. Sign in to ChatGPT again to keep using this account.',
          })}
        </p>
      ) : null}
      <div className={`${NOTE_CLASS} bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]`}>
        {connector.accountLabel ? (
          <p className="font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.cloud.chatgptPlanAccount', { defaultValue: 'ChatGPT account: {{account}}', account: connector.accountLabel })}
          </p>
        ) : null}
        <p className={connector.accountLabel ? 'mt-1' : undefined}>
          {t('runtimeConfig.cloud.chatgptPlanUsageNote', {
            defaultValue: 'Using ChatGPT plan: eligible text requests in Nimi count toward your ChatGPT plan limits.',
          })}
        </p>
        <button type="button" className={`mt-1 ${LINK_CLASS}`} onClick={() => openLink(NIMI_CHATGPT_PLAN_USAGE_URL)}>
          {t('runtimeConfig.cloud.chatgptPlanManageUsage', { defaultValue: 'Manage usage' })}
        </button>
      </div>
    </div>
  );
}

/** Shown once after the first ChatGPT plan sign-in on this Desktop. */
export function ChatGPTPlanWelcomeDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly t: TFunction;
}) {
  const { open, onClose, t } = props;
  return (
    <ConfirmDialog
      open={open}
      title={t('runtimeConfig.cloud.chatgptPlanWelcomeTitle', { defaultValue: "You're using your ChatGPT plan" })}
      message={(
        <span className="space-y-2">
          <span className="block">
            {t('runtimeConfig.cloud.chatgptPlanWelcomeBody', {
              defaultValue: 'Eligible usage in this app uses your ChatGPT plan. Nimi runs locally and does not charge for it.',
            })}
          </span>
          <button type="button" className={LINK_CLASS} onClick={() => openLink(NIMI_CHATGPT_PLAN_USAGE_URL)}>
            {t('runtimeConfig.cloud.chatgptPlanManageUsage', { defaultValue: 'Manage usage' })}
          </button>
        </span>
      )}
      confirmLabel={t('runtimeConfig.cloud.chatgptPlanWelcomeConfirm', { defaultValue: 'Got it' })}
      cancelLabel={t('runtimeConfig.cloud.chatgptPlanWelcomeClose', { defaultValue: 'Close' })}
      onConfirm={onClose}
      onClose={onClose}
    />
  );
}
