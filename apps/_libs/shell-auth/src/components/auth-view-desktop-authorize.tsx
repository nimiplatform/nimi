import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonBase, buttonDefault } from '../types/auth-types.js';

export function AuthViewDesktopAuthorize(props: {
  authStatus: string;
  desktopCallbackUserLabel: string;
  pending: boolean;
  onSubmit: (event: FormEvent) => void;
  onUseAnotherAccount: () => void;
}) {
  const { t } = useTranslation();
  const { authStatus, desktopCallbackUserLabel, pending, onSubmit, onUseAnotherAccount } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-[var(--auth-muted,#8a8579)]">
        {authStatus === 'authenticated'
          ? '检测到当前网页已登录。是否授权当前桌面客户端使用此账号登录？'
          : '检测到已有登录会话。是否授权当前桌面客户端使用此账号登录？'}
      </p>
      <div className="rounded-xl border border-[var(--auth-card-border,#e4dccf)] bg-[var(--auth-card-bg,rgba(255,255,255,0.72))] px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--auth-muted,#8a8579)]">
          {t('Auth.currentAccount')}
        </div>
        <div className="mt-1 text-sm font-semibold text-[var(--auth-text,#3b352c)]">{desktopCallbackUserLabel}</div>
      </div>
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} w-full rounded-xl py-3 text-sm font-semibold`}
        disabled={pending}
      >
        {pending ? t('Auth.authorizing') : t('Auth.authorizeDesktopButton')}
      </button>
      <button
        type="button"
        onClick={onUseAnotherAccount}
        className="w-full text-center text-xs text-[var(--auth-muted,#8a8579)] transition hover:text-[var(--auth-text,#3b352c)]"
        disabled={pending}
      >
        {t('Auth.useAnotherAccount')}
      </button>
    </form>
  );
}
