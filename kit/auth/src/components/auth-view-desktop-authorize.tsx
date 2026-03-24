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
      <p className="text-sm text-[var(--nimi-text-muted)]">
        {authStatus === 'authenticated'
          ? '检测到当前网页已登录。是否授权当前桌面客户端使用此账号登录？'
          : '检测到已有登录会话。是否授权当前桌面客户端使用此账号登录？'}
      </p>
      <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
          {t('Auth.currentAccount')}
        </div>
        <div className="mt-1 text-sm font-semibold text-[var(--nimi-text-primary)]">{desktopCallbackUserLabel}</div>
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
        className="w-full text-center text-xs text-[var(--nimi-text-muted)] transition hover:text-[var(--nimi-text-primary)]"
        disabled={pending}
      >
        {t('Auth.useAnotherAccount')}
      </button>
    </form>
  );
}
