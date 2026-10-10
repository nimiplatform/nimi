import { Button } from '@nimiplatform/kit/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RuntimeEnvironmentCheck, RuntimeEnvironmentDependencies } from './runtime-environment-details.js';
import { useRuntimeEnvironmentObservation } from './runtime-environment-observation.js';
import { projectRuntimeEnvironmentState } from './runtime-environment-state.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function RuntimeConfigurationEnvironment(props: {
  capability: string;
  loadoutId: string;
  revision?: string;
  disabled: boolean;
  polling?: boolean;
  candidate?: boolean;
  onPrepare?: () => void;
  onReadiness?: (result: { loadoutId: string; state: string }) => void;
}) {
  const { t } = useTranslation();
  const observation = useRuntimeEnvironmentObservation({ capabilityContract: props.capability, candidateLoadoutId: props.loadoutId }, props.polling, props.revision);
  const actions = {
    checking: observation.checking,
    busy: observation.busy,
    error: observation.error ?? observation.actionError,
    reasonCode: observation.reasonCode,
    onRefresh: () => { void observation.refresh(); },
    onCancel: (id: string) => { void observation.cancelJob(id); },
  };
  const state = observation.data ? projectRuntimeEnvironmentState(observation.data.plan, observation.data.jobs).state : 'unknown';
  const readiness = observation.checking && !observation.data ? 'checking' : state;
  useEffect(() => {
    props.onReadiness?.({ loadoutId: props.loadoutId, state: readiness });
  }, [props.onReadiness, props.loadoutId, readiness]);
  const status = state === 'ready' ? 'localCapabilityStateReady' : state === 'active' ? 'localCapabilityStateInstalling' : state === 'unsupported' ? 'localCapabilityStateUnsupported' : 'configurationNeedsAttention';
  return (
    <details className="rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3 text-xs" data-testid="configuration-environment" data-loadout-id={props.loadoutId}>
      <summary className="cursor-pointer font-medium text-[var(--nimi-text-secondary)]">
        {t(`runtimeConfig.environment.${props.candidate ? 'candidateComponents' : 'configurationComponents'}`)}
        {` · ${observation.data ? t(`runtimeConfig.environment.${status}`) : readiness === 'checking' ? t('Common.loading') : t('runtimeConfig.capabilities.state.unknown')}`}
      </summary>
      <div className="mt-3 space-y-3">
        <RuntimeEnvironmentCheck actions={actions} />
        {props.onPrepare && (state === 'attention' || state === 'unknown') ? (
          <Button tone="secondary" size="sm" disabled={props.disabled || observation.checking || observation.busy} onClick={props.onPrepare}>
            {t('runtimeConfig.setupTask.repairSetup')}
          </Button>
        ) : null}
        {observation.data ? <RuntimeEnvironmentDependencies environment={observation.data.plan} jobs={observation.data.jobs} actions={actions} disabled={props.disabled} /> : null}
      </div>
    </details>
  );
}
