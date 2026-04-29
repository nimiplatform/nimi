// Wave 1 + Wave 2 — Degraded Surface
// Per app-shell-contract.md NAV-SHELL-DEGRADED-001..005 this surface is the
// SOLE renderer when composition state is loading / degraded:* / error:* /
// relaunch-pending. It is mutually exclusive with embodiment-stage and
// companion-surface; no ready surface elements are rendered concurrently.
//
// Wave 2: every label / summary / recovery / diagnostics row is i18n-driven
// via `Avatar.degraded.<state>.{badge,title,summary[,_with_reason],recovery}`
// keys declared in spec/kernel/tables/i18n-keys.yaml. No hardcoded English.

import { useTranslation } from '../i18n/index.js';
import { reloadAvatarShell } from '../shell-reload.js';
import type { CompositionDerivation } from '../app-shell/composition-state.js';

export type DegradedSurfaceProps = {
  composition: CompositionDerivation;
};

// Map composition state → i18n key prefix. `unknown` covers the defensive
// fallthrough for ready / fixture_active states which should never reach this
// surface but must still produce coherent copy if they do.
function stateKeyPrefix(state: CompositionDerivation['state']): string {
  switch (state) {
    case 'loading':
      return 'Avatar.degraded.loading';
    case 'degraded_reauth_required':
      return 'Avatar.degraded.degraded_reauth_required';
    case 'degraded_runtime_unavailable':
      return 'Avatar.degraded.degraded_runtime_unavailable';
    case 'degraded_launch_context_invalid':
      return 'Avatar.degraded.degraded_launch_context_invalid';
    case 'error_bootstrap_fatal':
      return 'Avatar.degraded.error_bootstrap_fatal';
    case 'relaunch_pending':
      return 'Avatar.degraded.relaunch_pending';
    case 'ready':
    case 'fixture_active':
    default:
      return 'Avatar.degraded.unknown';
  }
}

// States whose summaries can carry a Runtime-supplied reason string. Other
// states render their plain summary unconditionally.
const REASON_AWARE_STATES = new Set<CompositionDerivation['state']>([
  'degraded_reauth_required',
  'degraded_runtime_unavailable',
  'error_bootstrap_fatal',
]);

export function DegradedSurface(props: DegradedSurfaceProps) {
  const { composition } = props;
  const { t } = useTranslation();
  const tone = composition.variant;
  const keyPrefix = stateKeyPrefix(composition.state);
  const trimmedReason = (composition.reason ?? '').trim();

  const summary =
    REASON_AWARE_STATES.has(composition.state) && trimmedReason.length > 0
      ? t(`${keyPrefix}.summary_with_reason`, { reason: trimmedReason })
      : t(`${keyPrefix}.summary`);

  return (
    <section
      className={`avatar-degraded-surface avatar-degraded-surface--${tone}`}
      data-testid="avatar-degraded-surface"
      data-composition-state={composition.state}
      role="alert"
      aria-label={t('Avatar.degraded.surface_aria')}
    >
      <div className="avatar-degraded-surface__banner">
        <span className={`avatar-degraded-surface__badge avatar-degraded-surface__badge--${tone}`}>
          {t(`${keyPrefix}.badge`)}
        </span>
      </div>
      <h1 className="avatar-degraded-surface__title">{t(`${keyPrefix}.title`)}</h1>
      <p className="avatar-degraded-surface__summary">{summary}</p>
      <p className="avatar-degraded-surface__recovery">{t(`${keyPrefix}.recovery`)}</p>
      <div className="avatar-degraded-surface__actions">
        <button
          type="button"
          className="avatar-degraded-surface__reload"
          onClick={() => reloadAvatarShell()}
          data-testid="avatar-degraded-reload"
        >
          {t('Avatar.degraded.reload')}
        </button>
      </div>
      {composition.reason && composition.variant !== 'loading' && composition.variant !== 'relaunch' ? (
        <details className="avatar-degraded-surface__diagnostics">
          <summary>{t('Avatar.degraded.diagnostics.summary')}</summary>
          <dl>
            <div>
              <dt>{t('Avatar.degraded.diagnostics.composition_state')}</dt>
              <dd>{composition.state}</dd>
            </div>
            <div>
              <dt>{t('Avatar.degraded.diagnostics.reason')}</dt>
              <dd>{composition.reason}</dd>
            </div>
            {composition.reasonCode ? (
              <div>
                <dt>{t('Avatar.degraded.diagnostics.reason_code')}</dt>
                <dd>{composition.reasonCode}</dd>
              </div>
            ) : null}
            {composition.accountReasonCode ? (
              <div>
                <dt>{t('Avatar.degraded.diagnostics.account_reason_code')}</dt>
                <dd>{composition.accountReasonCode}</dd>
              </div>
            ) : null}
            {composition.actionHint ? (
              <div>
                <dt>{t('Avatar.degraded.diagnostics.action_hint')}</dt>
                <dd>{composition.actionHint}</dd>
              </div>
            ) : null}
            {composition.stage ? (
              <div>
                <dt>{t('Avatar.degraded.diagnostics.stage')}</dt>
                <dd>{composition.stage}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
