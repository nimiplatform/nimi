// First-Run Wizard Chrome — the shared full-window onboarding takeover frame.
//
// Every phase and terminal screen renders inside this chrome: a soft diagonal
// light gradient background, the letter-spaced uppercase "NIMI" wordmark, the
// Support pill, the slim step indicator, and the single centered
// white card. The chrome owns no product-control state; it only places the
// Product Control content the workflow hands it.

import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NIMI_FIRST_RUN_PHASES, type NimiFirstRunPhase } from '@nimiplatform/sdk/runtime';
import { SupportDegradedEntry } from '../features/support/support-degraded-entry.js';

const STEP_LABEL_KEYS: Record<NimiFirstRunPhase, string> = {
  storage: 'FirstRun.steps.storage',
};

const STEP_LABEL_DEFAULTS: Record<NimiFirstRunPhase, string> = {
  storage: 'Storage',
};

type FirstRunWizardChromeProps = {
  /**
   * The phase whose step is highlighted in the indicator. `null` on terminal
   * screens (repair / blocked / ready), which carry no active step.
   */
  readonly activePhase: NimiFirstRunPhase | null;
  readonly children: ReactNode;
};

/**
 * Renders the onboarding takeover frame around the supplied phase content.
 */
export function FirstRunWizardChrome(props: FirstRunWizardChromeProps): ReactElement {
  const { t } = useTranslation();
  const activeIndex = props.activePhase ? NIMI_FIRST_RUN_PHASES.indexOf(props.activePhase) : -1;
  const terminal = props.activePhase === null;

  return (
    <div
      data-testid="first-run-wizard-chrome"
      className="relative flex min-h-full w-full flex-col overflow-hidden bg-[linear-gradient(135deg,#e8f1fb_0%,#eef0fb_48%,#f2ecfb_100%)] text-[var(--nimi-text-primary)]"
    >
      <style>{`
        @keyframes nimi-first-run-spin { to { transform: rotate(360deg); } }
        .nimi-first-run-spin { transform-origin: 12px 12px; animation: nimi-first-run-spin 0.9s linear infinite; }
        @keyframes nimi-first-run-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        .nimi-first-run-pulse { animation: nimi-first-run-pulse 1.6s ease-in-out infinite; }
      `}</style>

      {/* Top chrome row: wordmark + Support pill. */}
      <div className="flex items-start justify-between px-6 pt-8 sm:px-8">
        <span
          data-testid="first-run-wordmark"
          className="select-none text-sm font-semibold uppercase tracking-[0.42em] text-[var(--nimi-text-primary)]"
        >
          {t('FirstRun.wordmark', { defaultValue: 'NIMI' })}
        </span>
        <div data-testid="first-run-support-pill" className="[&_button]:rounded-full [&_button]:bg-white [&_button]:shadow-sm">
          <SupportDegradedEntry />
        </div>
      </div>

      {terminal ? null : (
        <nav
          data-testid="first-run-step-indicator"
          aria-label={t('FirstRun.stepIndicatorLabel', { defaultValue: 'Setup steps' })}
          className="mx-auto mt-7 flex w-full max-w-md items-stretch gap-3 px-6 sm:px-8"
        >
          {NIMI_FIRST_RUN_PHASES.map((phase, index) => {
            const active = index === activeIndex;
            return (
              <div
                key={phase}
                data-testid={`first-run-step-${phase}`}
                data-active={active ? 'true' : 'false'}
                className="flex flex-1 flex-col items-center gap-1.5"
              >
                <span
                  className={
                    active
                      ? 'text-xs font-semibold text-[var(--nimi-action-primary-bg)]'
                      : 'text-xs font-medium text-[color-mix(in_srgb,var(--nimi-text-muted)_88%,transparent)]'
                  }
                >
                  {t(STEP_LABEL_KEYS[phase], { defaultValue: STEP_LABEL_DEFAULTS[phase] })}
                </span>
                <span
                  className={
                    active
                      ? 'h-[3px] w-full rounded-full bg-[var(--nimi-action-primary-bg)]'
                      : 'h-[3px] w-full rounded-full bg-[color-mix(in_srgb,var(--nimi-text-muted)_22%,transparent)]'
                  }
                />
              </div>
            );
          })}
        </nav>
      )}

      {/* Centered content card. */}
      <div className={terminal ? 'flex flex-1 items-start justify-center px-6 pb-8 pt-24' : 'flex flex-1 items-center justify-center px-6 py-8'}>
        <div
          data-testid="first-run-wizard-card"
          className={
            terminal
              ? 'w-full max-w-lg rounded-xl bg-[var(--nimi-surface-card)] p-5 shadow-[0_12px_30px_-16px_rgba(30,41,90,0.18)]'
              : 'w-full max-w-xl rounded-2xl bg-[var(--nimi-surface-card)] p-6 shadow-[0_18px_44px_-12px_rgba(30,41,90,0.16)]'
          }
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
