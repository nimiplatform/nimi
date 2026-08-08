import type { ReactNode } from 'react';
import { Button } from '@nimiplatform/kit/ui';

import { useTranslation } from '../../shell/i18n/index.js';
import {
  appAccessPageCopy,
  appAccessProbeById,
  type AppAccessGroupDefinition,
  type AppAccessProbeId,
} from './app-access-catalog.js';
import type { AppAccessGate, AppAccessProbeStates } from './app-access-state.js';
import { AppAccessProbeCard } from './app-access-probe-card.js';

export function AppAccessGroup({
  definition,
  states,
  gateFor,
  groupRunning,
  onRunProbe,
  onRunGroup,
  renderExtras,
}: {
  readonly definition: AppAccessGroupDefinition;
  readonly states: AppAccessProbeStates;
  readonly gateFor: (id: AppAccessProbeId) => AppAccessGate;
  readonly groupRunning: boolean;
  readonly onRunProbe: (id: AppAccessProbeId) => void;
  readonly onRunGroup: () => void;
  readonly renderExtras?: (id: AppAccessProbeId) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="app-access-group" data-testid={definition.testId} aria-label={t(definition.titleKey)}>
      <div className="app-access-group__head">
        <div className="app-access-group__head-text">
          <h2 className="app-access-group__title">{t(definition.titleKey)}</h2>
          <p className="app-access-group__blurb">{t(definition.blurbKey)}</p>
        </div>
        <Button
          type="button"
          tone="ghost"
          size="sm"
          data-testid={definition.runTestId}
          disabled={groupRunning}
          loading={groupRunning}
          onClick={onRunGroup}
        >
          {t(appAccessPageCopy.runGroup)}
        </Button>
      </div>
      <div className="app-access-group__cards">
        {definition.probes.map((id) => (
          <AppAccessProbeCard
            key={id}
            definition={appAccessProbeById[id]}
            state={states[id]}
            gate={gateFor(id)}
            onRun={() => onRunProbe(id)}
          >
            {renderExtras ? renderExtras(id) : undefined}
          </AppAccessProbeCard>
        ))}
      </div>
    </section>
  );
}
