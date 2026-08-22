import type { ReactNode } from 'react';
import { AppCardSurface, Button, InlineAlert, StatusBadge } from '@nimiplatform/kit/ui';
import { CheckCircle2, ShieldAlert } from 'lucide-react';

import { useTranslation } from '../../shell/i18n/index.js';
import {
  appAccessPageCopy,
  type AppAccessProbeDefinition,
} from './app-access-catalog.js';
import type { AppAccessGate, AppAccessProbeState } from './app-access-state.js';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

function badgeFor(state: AppAccessProbeState, gated: boolean): { readonly tone: BadgeTone; readonly labelKey: string } {
  if (gated && state.status === 'not-run') return { tone: 'info', labelKey: 'AppAccess.status.setupNeeded' };
  switch (state.status) {
    case 'running': return { tone: 'info', labelKey: 'AppAccess.status.running' };
    case 'passed': return { tone: 'success', labelKey: 'AppAccess.status.passed' };
    case 'failed': return { tone: 'danger', labelKey: 'AppAccess.status.failed' };
    default: return { tone: 'neutral', labelKey: 'AppAccess.status.notRun' };
  }
}

export function AppAccessProbeCard({
  definition,
  state,
  gate,
  onRun,
  children,
}: {
  readonly definition: AppAccessProbeDefinition;
  readonly state: AppAccessProbeState;
  readonly gate: AppAccessGate;
  readonly onRun: () => void;
  readonly children?: ReactNode;
}) {
  const { t } = useTranslation();
  const gated = !gate.runnable;
  const badge = badgeFor(state, gated);
  // Passed headlines are literal run evidence; every other status stores a
  // catalog i18n key in state.headline.
  const headline = state.status === 'passed' ? state.headline : t(state.headline);
  return (
    <AppCardSurface
      as="article"
      kind="operational-solid"
      className="app-access-probe-card"
      data-testid={definition.testId}
      data-state={state.status}
    >
      <div className="app-access-probe-card__head">
        <StatusBadge tone={badge.tone} shape="soft" className="app-access-probe-card__status">{t(badge.labelKey)}</StatusBadge>
        <Button
          type="button"
          tone="secondary"
          size="sm"
          className="app-access-probe-card__run"
          data-testid={definition.runTestId}
          disabled={gated || state.status === 'running'}
          loading={state.status === 'running'}
          onClick={onRun}
        >
          {t('AppAccess.probeCard.run')}
        </Button>
      </div>
      <h3 className="app-access-probe-card__title">{t(definition.titleKey)}</h3>
      <p className="app-access-probe-card__proves">{t(definition.provesKey)}</p>
      {definition.requiresKey ? (
        <InlineAlert role="note" tone="warning" icon={<ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />}>
          {t('AppAccess.probeCard.requires', { requires: t(definition.requiresKey) })}
        </InlineAlert>
      ) : null}
      {children}
      <div
        className="app-access-probe-card__result"
        data-testid={definition.resultTestId}
        data-state={state.status}
      >
        {gated && state.status === 'not-run' ? (
          <InlineAlert role="note" tone="info">{t(gate.guidanceKey)}</InlineAlert>
        ) : state.status === 'failed' ? (
          <>
            <p className="app-access-probe-card__failure">{headline}</p>
            <details className="app-access-diag">
              <summary>{t(appAccessPageCopy.technicalDetails)}</summary>
              <dl className="app-access-diag__grid">
                <div>
                  <dt>{t('AppAccess.details.reasonCode')}</dt>
                  <dd><code>{state.reasonCode}</code></dd>
                </div>
                {state.detail ? (
                  <div>
                    <dt>{t('AppAccess.details.detail')}</dt>
                    <dd>{state.detail}</dd>
                  </div>
                ) : null}
              </dl>
            </details>
          </>
        ) : (
          <>
            <p className={`app-access-probe-card__headline app-access-probe-card__headline--${state.status}`}>
              {state.status === 'passed' ? <CheckCircle2 size={14} strokeWidth={2.2} aria-hidden="true" /> : null}
              <span>{headline}</span>
            </p>
            {state.facts.length > 0 ? (
              <ul className="app-access-probe-card__facts">
                {state.facts.map((fact) => <li key={fact}>{fact}</li>)}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </AppCardSurface>
  );
}
