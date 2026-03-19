import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleIconButton } from './auth-menu-header.js';

export type AuthViewMainTestIds = {
  emailInput?: string;
  emailSubmitArrow?: string;
  alternativeToggle?: string;
  alternativePanel?: string;
  otpButton?: string;
};

export function AuthViewMain(props: {
  email: string;
  pending: boolean;
  showAlternatives: boolean;
  googleDisabledReason?: string;
  twitterDisabledReason?: string;
  tikTokDisabledReason?: string;
  onEmailChange: (value: string) => void;
  onContinue: (event: FormEvent) => void;
  onAlternativeToggle: () => void;
  onGoogleLogin: () => void;
  onTwitterLogin: () => void;
  onTikTokLogin: () => void;
  onWeb3Login: () => void;
  testIds?: AuthViewMainTestIds;
}) {
  const { t } = useTranslation();
  const {
    email,
    pending,
    showAlternatives,
    googleDisabledReason,
    twitterDisabledReason,
    tikTokDisabledReason,
    onEmailChange,
    onContinue,
    onAlternativeToggle,
    onGoogleLogin,
    onTwitterLogin,
    onTikTokLogin,
    onWeb3Login,
    testIds,
  } = props;

  return (
    <form onSubmit={onContinue} className="relative w-full">
      {/* Capsule input bar */}
      <div className="flex items-center h-[52px] rounded-full border border-[var(--auth-input-border,#ddd4c6)] bg-[var(--auth-input-bg,rgba(255,255,255,0.9))] shadow-[var(--auth-input-shadow,0_12px_34px_rgba(157,145,123,0.09))]">
        {/* Left: alternatives dropdown trigger */}
        <button
          type="button"
          data-testid={testIds?.alternativeToggle}
          onClick={onAlternativeToggle}
          disabled={pending}
          aria-label={t('Auth.alternative')}
          className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--auth-muted,#8a8579)] transition hover:bg-[var(--auth-hover-bg,#f0ece6)] hover:text-[var(--auth-hover-text,#4b4338)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="5" cy="5" r="1.5" />
            <circle cx="13" cy="5" r="1.5" />
            <circle cx="5" cy="13" r="1.5" />
            <circle cx="13" cy="13" r="1.5" />
          </svg>
        </button>

        {/* Center: email input */}
        <input
          type="email"
          value={email}
          data-testid={testIds?.emailInput}
          onChange={(event) => onEmailChange(event.target.value)}
          className="flex-1 min-w-0 bg-transparent px-3 text-[15px] text-[var(--auth-text-secondary,#1f1b16)] placeholder:text-[var(--auth-muted,#999999)] outline-none"
          placeholder={t('Auth.emailPlaceholder')}
          required
          autoFocus
          autoComplete="username"
        />

        {/* Right: submit arrow (animated appearance) */}
        <div className={`mr-2 flex h-9 w-9 shrink-0 transition-all duration-200 ease-out ${email.trim() ? 'scale-100 opacity-100' : 'scale-75 opacity-0 pointer-events-none'}`}>
          <button
            type="submit"
            data-testid={testIds?.emailSubmitArrow}
            disabled={pending || !email.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--auth-primary,#4ECCA3)] text-white transition hover:bg-[var(--auth-primary-hover,#3dbb8f)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8h9M8.5 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Alternatives dropdown */}
      <div
        data-testid={testIds?.alternativePanel}
        className={`absolute left-0 right-0 z-20 mt-3 origin-top rounded-2xl border border-[var(--auth-dropdown-border,#e7dfd3)] bg-[var(--auth-dropdown-bg,rgba(255,255,255,0.95))] p-4 shadow-[var(--auth-dropdown-shadow,0_18px_40px_rgba(157,145,123,0.12))] backdrop-blur transition-all duration-200 ease-out ${
          showAlternatives
            ? 'scale-100 opacity-100'
            : 'scale-95 opacity-0 pointer-events-none'
        }`}
      >
        <p className="mb-3 text-center text-xs font-medium uppercase tracking-[0.22em] text-[var(--auth-muted,#8e8578)]">
          {t('Auth.chooseAlternative')}
        </p>
        <div className="flex items-center justify-center gap-4">
          <div className="relative group">
            <CircleIconButton
              label={googleDisabledReason ? `Google unavailable: ${googleDisabledReason}` : 'Google'}
              onClick={onGoogleLogin}
              disabled={pending || Boolean(googleDisabledReason)}
              className="h-[52px] w-[52px] border-[var(--auth-card-border,#e4dccf)] bg-[var(--auth-card-bg,#fffdf9)] shadow-[0_12px_24px_rgba(157,145,123,0.12)]"
            >
              <svg viewBox="0 0 24 24" className={`mx-auto h-6 w-6 ${googleDisabledReason ? 'opacity-40' : ''}`}>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            </CircleIconButton>
            {googleDisabledReason ? (
              <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--auth-tooltip-bg,#3d3729)] px-2 py-0.5 text-[10px] text-[var(--auth-tooltip-text,#ffffff)] opacity-0 transition group-hover:opacity-100">{googleDisabledReason}</span>
            ) : null}
          </div>

          <div className="relative group">
            <CircleIconButton
              label={twitterDisabledReason ? `Twitter unavailable: ${twitterDisabledReason}` : 'Twitter'}
              onClick={onTwitterLogin}
              disabled={pending || Boolean(twitterDisabledReason)}
              className="h-[52px] w-[52px] border-[var(--auth-card-border,#e4dccf)] bg-[var(--auth-card-bg,#fffdf9)] shadow-[0_12px_24px_rgba(157,145,123,0.12)]"
            >
              <svg viewBox="0 0 24 24" className={`mx-auto h-5 w-5 fill-current ${twitterDisabledReason ? 'opacity-40' : ''}`}>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </CircleIconButton>
            {twitterDisabledReason ? (
              <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--auth-tooltip-bg,#3d3729)] px-2 py-0.5 text-[10px] text-[var(--auth-tooltip-text,#ffffff)] opacity-0 transition group-hover:opacity-100">{twitterDisabledReason}</span>
            ) : null}
          </div>

          <div className="relative group">
            <CircleIconButton
              label={tikTokDisabledReason ? `TikTok unavailable: ${tikTokDisabledReason}` : 'TikTok'}
              onClick={onTikTokLogin}
              disabled={pending || Boolean(tikTokDisabledReason)}
              className="h-[52px] w-[52px] border-[var(--auth-card-border,#e4dccf)] bg-[var(--auth-card-bg,#fffdf9)] shadow-[0_12px_24px_rgba(157,145,123,0.12)]"
            >
              <svg viewBox="0 0 24 24" className={`mx-auto h-5 w-5 fill-current ${tikTokDisabledReason ? 'opacity-40' : ''}`}>
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
              </svg>
            </CircleIconButton>
            {tikTokDisabledReason ? (
              <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--auth-tooltip-bg,#3d3729)] px-2 py-0.5 text-[10px] text-[var(--auth-tooltip-text,#ffffff)] opacity-0 transition group-hover:opacity-100">{tikTokDisabledReason}</span>
            ) : null}
          </div>

          <CircleIconButton
            label={t('Auth.web3')}
            onClick={onWeb3Login}
            disabled={pending}
            className="h-[52px] w-[52px] border-[var(--auth-card-border,#e4dccf)] bg-[var(--auth-card-bg,#fffdf9)] shadow-[0_12px_24px_rgba(157,145,123,0.12)]"
          >
            <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
              <path d="M2.5 10.5h19" />
              <circle cx="17.5" cy="14" r="1.4" />
            </svg>
          </CircleIconButton>
        </div>
      </div>
    </form>
  );
}
