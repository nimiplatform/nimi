import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthView } from './auth-helpers.js';
import {
  buttonBase,
  buttonGhost,
  buttonOutline,
} from './auth-helpers.js';

// ---------------------------------------------------------------------------
// CircleIconButton — small round icon button used in the main view
// ---------------------------------------------------------------------------

export function CircleIconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="h-[40px] w-[40px] rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AuthMenuHeader — header bar with back/close buttons and dynamic title
// ---------------------------------------------------------------------------

export function AuthMenuHeader(props: {
  view: AuthView;
  pending: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { view, pending, onBack, onClose } = props;

  if (view === 'main') {
    return (
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          className={`${buttonBase} ${buttonOutline} h-5 w-5 rounded-full border-input px-0 text-[10px] text-muted-foreground hover:border-foreground/50 hover:text-foreground`}
          disabled
          title="Help"
        >
          ?
        </button>
        <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: '#1A1A1A', fontFamily: 'var(--font-ui)' }}>{t('Auth.connectToNimi')}</h1>
        <button
          type="button"
          className={`${buttonBase} ${buttonGhost} h-auto w-auto p-0 text-xl leading-none text-muted-foreground hover:text-foreground`}
          onClick={onClose}
          disabled={pending}
        >
          ×
        </button>
      </div>
    );
  }

  const title = view === 'email_login'
    ? t('Auth.emailLogin')
    : view === 'desktop_authorize'
      ? t('Auth.authorizeDesktop')
    : view === 'email_register'
      ? t('Auth.signUp')
      : view === 'email_2fa'
        ? t('Auth.verification')
        : view === 'email_otp'
          ? t('Auth.emailLogin')
          : t('Auth.verifyOtp');

  return (
    <div className="mb-6 flex items-center justify-between">
      <button
        type="button"
        className={`${buttonBase} ${buttonGhost} h-7 w-7 rounded-full border border-border px-0 text-sm text-muted-foreground hover:border-input hover:text-foreground`}
        onClick={onBack}
        disabled={pending}
      >
        ←
      </button>
      <h2 className='text-[20px] font-semibold tracking-tight' style={{ color: '#1A1A1A', fontFamily: 'var(--font-ui)' }}>{title}</h2>
      <button
        type="button"
        className={`${buttonBase} ${buttonGhost} h-7 w-7 rounded-full px-0 text-sm text-muted-foreground hover:text-foreground`}
        onClick={onClose}
        disabled={pending}
      >
        ×
      </button>
    </div>
  );
}
