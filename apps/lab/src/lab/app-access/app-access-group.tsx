import type { ReactNode } from 'react';
import { Button, StatusBadge } from '@nimiplatform/kit/ui';
import {
  Boxes,
  Database,
  MessagesSquare,
  Play,
  ShieldX,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { useTranslation } from '../../shell/i18n/index.js';
import {
  appAccessPageCopy,
  appAccessProbeById,
  type AppAccessGroupDefinition,
  type AppAccessGroupId,
  type AppAccessProbeId,
} from './app-access-catalog.js';
import type { AppAccessGate, AppAccessProbeStates } from './app-access-state.js';
import { AppAccessProbeCard } from './app-access-probe-card.js';

const groupIcons: Record<AppAccessGroupId, LucideIcon> = {
  storage: Database,
  realm: Boxes,
  'ai-consumption': Sparkles,
  'agent-conversation': MessagesSquare,
  boundary: ShieldX,
};

export function appAccessGroupIcon(id: AppAccessGroupId): LucideIcon {
  return groupIcons[id];
}

export function AppAccessGroup({
  definition,
  states,
  gateFor,
  activeRun,
  anyRunActive,
  onRunProbe,
  onRunGroup,
  renderExtras,
}: {
  readonly definition: AppAccessGroupDefinition;
  readonly states: AppAccessProbeStates;
  readonly gateFor: (id: AppAccessProbeId) => AppAccessGate;
  /** This group is the one currently executing (including a run-all pass). */
  readonly activeRun: boolean;
  /** Some group is executing; sibling group runs stay disabled meanwhile. */
  readonly anyRunActive: boolean;
  readonly onRunProbe: (id: AppAccessProbeId) => void;
  readonly onRunGroup: () => void;
  readonly renderExtras?: (id: AppAccessProbeId) => ReactNode;
}) {
  const { t } = useTranslation();
  const Icon = groupIcons[definition.id];
  const passedCount = definition.probes.filter((id) => states[id].status === 'passed').length;
  const touchedCount = definition.probes.filter((id) => states[id].status !== 'not-run').length;
  return (
    <section className="app-access-group" data-testid={definition.testId} aria-label={t(definition.titleKey)}>
      <div className="app-access-group__head">
        <span className="app-access-group__icon" aria-hidden="true">
          <Icon size={17} strokeWidth={1.9} />
        </span>
        <div className="app-access-group__head-text">
          <h2 className="app-access-group__title" tabIndex={-1} data-app-access-section-title>{t(definition.titleKey)}</h2>
          <p className="app-access-group__blurb">{t(definition.blurbKey)}</p>
        </div>
        <div className="app-access-group__head-actions">
          {touchedCount > 0 ? (
            <StatusBadge tone={passedCount === definition.probes.length ? 'success' : 'neutral'} shape="soft">
              {t('AppAccess.page.groupProgress', { passed: passedCount, total: definition.probes.length })}
            </StatusBadge>
          ) : null}
          <Button
            type="button"
            tone="secondary"
            size="sm"
            leadingIcon={<Play size={13} strokeWidth={2.2} aria-hidden="true" />}
            data-testid={definition.runTestId}
            disabled={anyRunActive}
            loading={activeRun}
            onClick={onRunGroup}
          >
            {t(appAccessPageCopy.runGroup)}
          </Button>
        </div>
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
