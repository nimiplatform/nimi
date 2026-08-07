import type { ReactNode } from 'react';
import { Button } from '@nimiplatform/kit/ui';

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
  return (
    <section className="app-access-group" data-testid={definition.testId} aria-label={definition.title}>
      <div className="app-access-group__head">
        <div className="app-access-group__head-text">
          <h2 className="app-access-group__title">{definition.title}</h2>
          <p className="app-access-group__blurb">{definition.blurb}</p>
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
          {appAccessPageCopy.runGroup}
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
