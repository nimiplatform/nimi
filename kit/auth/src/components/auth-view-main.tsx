import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface } from '@nimiplatform/kit/ui';
import { motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { CircleIconButton } from './auth-menu-header.js';
import { capsuleBar, capsuleBarIconButton, capsuleBarInput, capsuleBarSubmitButton } from '../types/auth-types.js';

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
  tikTokDisabledReason?: string;
  onEmailChange: (value: string) => void;
  onContinue: (event: FormEvent) => void;
  onAlternativeToggle: () => void;
  onGoogleLogin: () => void;
  onTikTokLogin: () => void;
  testIds?: AuthViewMainTestIds;
}) {
  const { t } = useTranslation();
  const reducedMotion = useNimiReducedMotion();
  const panelMotion = nimiOverlayPanelMotion({ kind: 'popover', side: 'bottom', reducedMotion });
  const {
    email,
    pending,
    showAlternatives,
    googleDisabledReason,
    tikTokDisabledReason,
    onEmailChange,
    onContinue,
    onAlternativeToggle,
    onGoogleLogin,
    onTikTokLogin,
    testIds,
  } = props;

  return (
    <form onSubmit={onContinue} noValidate className="relative w-full">
      {/* Capsule input bar */}
      <div className={`${capsuleBar} nimi-shell-auth-main-capsule`}>
        {/* Left: alternatives dropdown trigger */}
        <button
          type="button"
          data-testid={testIds?.alternativeToggle}
          onClick={onAlternativeToggle}
          disabled={pending}
          aria-label={t('Auth.alternative')}
          aria-expanded={showAlternatives}
          className={capsuleBarIconButton}
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
          className={capsuleBarInput}
          placeholder={t('Auth.emailPlaceholder')}
          aria-label={t('Auth.emailPlaceholder')}
          required
          autoFocus
          autoComplete="username"
        />

        {/* Right: submit arrow */}
        <div className="mr-2 flex shrink-0">
          <button
            type="submit"
            data-testid={testIds?.emailSubmitArrow}
            disabled={pending || !email.trim()}
            aria-label={t('Auth.continue', { defaultValue: 'Continue' })}
            className={capsuleBarSubmitButton}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8h9M8.5 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Alternatives dropdown */}
      {showAlternatives ? (
        <motion.div
          data-testid={testIds?.alternativePanel}
          className="mt-3"
          initial={panelMotion.initial}
          animate={panelMotion.animate}
          transition={panelMotion.transition}
          style={panelMotion.style}
        >
            <Surface material="glass-regular" tone="overlay" elevation="floating" padding="none" className="rounded-2xl p-4">
              <p className="mb-3 text-center text-xs font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing,0.08em)] text-[var(--nimi-text-muted)]">
                {t('Auth.chooseAlternative')}
              </p>
              <div className="flex items-start justify-center gap-6">
                <div className="flex flex-col items-center gap-1.5">
                  <CircleIconButton
                    label={googleDisabledReason ? `Google unavailable: ${googleDisabledReason}` : 'Google'}
                    onClick={onGoogleLogin}
                    disabled={pending || Boolean(googleDisabledReason)}
                    className="h-[3.25rem] w-[3.25rem] border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)]"
                  >
                    <svg viewBox="0 0 24 24" className={`mx-auto h-6 w-6 ${googleDisabledReason ? 'opacity-40' : ''}`} aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z" fill="#FBBC05" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                  </CircleIconButton>
                  <span className="text-[length:var(--nimi-type-caption-size,0.75rem)] font-medium text-[var(--nimi-text-secondary)]">Google</span>
                  {googleDisabledReason ? (
                    <span className="text-[length:var(--nimi-type-caption-size,0.75rem)] text-[var(--nimi-text-muted)]">{googleDisabledReason}</span>
                  ) : null}
                </div>

                <div className="flex flex-col items-center gap-1.5">
                  <CircleIconButton
                    label={tikTokDisabledReason ? `TikTok unavailable: ${tikTokDisabledReason}` : 'TikTok'}
                    onClick={onTikTokLogin}
                    disabled={pending || Boolean(tikTokDisabledReason)}
                    className="h-[3.25rem] w-[3.25rem] border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)]"
                  >
                    <svg viewBox="0 0 24 24" className={`mx-auto h-5 w-5 fill-current ${tikTokDisabledReason ? 'opacity-40' : ''}`} aria-hidden="true">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                    </svg>
                  </CircleIconButton>
                  <span className="text-[length:var(--nimi-type-caption-size,0.75rem)] font-medium text-[var(--nimi-text-secondary)]">TikTok</span>
                  {tikTokDisabledReason ? (
                    <span className="text-[length:var(--nimi-type-caption-size,0.75rem)] text-[var(--nimi-text-muted)]">{tikTokDisabledReason}</span>
                  ) : null}
                </div>
              </div>
            </Surface>
        </motion.div>
      ) : null}
    </form>
  );
}
