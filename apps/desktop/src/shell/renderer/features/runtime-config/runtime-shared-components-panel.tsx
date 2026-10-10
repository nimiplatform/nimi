import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Surface } from '@nimiplatform/kit/ui';
import { formatBytes } from '../../components/download-format.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { RuntimeEnvironmentCheck, RuntimeEnvironmentDependencies } from './runtime-environment-details.js';
import { useRuntimeEnvironmentObservation } from './runtime-environment-observation.js';
import { applyRuntimeEnvironmentPlan, canApplyRuntimeEnvironmentPlan, projectRuntimeEnvironmentState, runtimeEnvironmentConfirmation } from './runtime-environment-state.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.r023
export function RuntimeSharedComponentsPanel(props: { writesDisabled: boolean }) {
  const { t } = useTranslation();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const observation = useRuntimeEnvironmentObservation({ mediaCodec: true });
  const [pending, setPending] = useState<NonNullable<typeof observation.data>['plan'] | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string>();
  const actions = {
    checking: observation.checking,
    busy: observation.busy || applying,
    error: observation.error ?? observation.actionError ?? applyError,
    onRefresh: () => { setApplyError(undefined); void observation.refresh(); },
    onCancel: (id: string) => { void observation.cancelJob(id); },
  };
  const presentation = observation.data ? projectRuntimeEnvironmentState(observation.data.plan, observation.data.jobs) : null;
  const confirmation = pending ? runtimeEnvironmentConfirmation(pending) : null;
  const apply = async () => {
    if (!pending || props.writesDisabled || applying) return;
    setApplying(true);
    setApplyError(undefined);
    try {
      await applyRuntimeEnvironmentPlan(client, { mediaCodec: true }, pending);
      setPending(null);
      await observation.refresh();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
      setPending(null);
    } finally { setApplying(false); }
  };
  return (
    <Surface tone="card" className="space-y-4 overflow-hidden p-5" data-testid="runtime-shared-components">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('runtimeConfig.environment.localCapabilitySharedTitle')}</h2>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.environment.sharedComponentsDescription')}</p>
        </div>
        <RuntimeEnvironmentCheck actions={actions} />
      </div>
      {observation.data && presentation ? (
        <div className="space-y-3 rounded-xl border border-[var(--nimi-border-subtle)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">{t('runtimeConfig.environment.localCapabilityMEDIACODEC')}</h3>
              <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
                {presentation.state === 'ready' ? t('runtimeConfig.environment.localCapabilityStateReady')
                  : presentation.state === 'active' ? t('runtimeConfig.environment.localCapabilityStateInstalling')
                    : presentation.state === 'unsupported' ? t('runtimeConfig.environment.localCapabilityStateUnsupported')
                      : t('runtimeConfig.environment.configurationNeedsAttention')}
              </p>
            </div>
            {canApplyRuntimeEnvironmentPlan(observation.data.plan, observation.data.jobs) ? (
              <Button tone="secondary" size="sm" disabled={props.writesDisabled || actions.busy || actions.checking || !!actions.error} onClick={() => setPending(observation.data!.plan)}>
                {t('runtimeConfig.environment.localCapabilitySetup')}
              </Button>
            ) : null}
          </div>
          <details className="text-xs text-[var(--nimi-text-secondary)]" open={presentation.state === 'active' || presentation.state === 'attention' ? true : undefined}>
            <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails')}</summary>
            <RuntimeEnvironmentDependencies environment={observation.data.plan} jobs={observation.data.jobs} actions={actions} disabled={props.writesDisabled} className="mt-3" />
          </details>
        </div>
      ) : null}
      <ConfirmDialog
        open={pending !== null}
        title={t('runtimeConfig.environment.localCapabilityConfirmTitle', { capability: t('runtimeConfig.environment.localCapabilityMEDIACODEC') })}
        message={confirmation ? t('runtimeConfig.environment.localCapabilityConfirmMessage', {
          capability: t('runtimeConfig.environment.localCapabilityMEDIACODEC'),
          count: pending?.dependencies.filter(d => d.required).length ?? 0,
          aggregateSize: confirmation.aggregateSizeKnown ? formatBytes(confirmation.aggregateSizeBytes) : t('runtimeConfig.environment.localCapabilityAggregateSizeUnknown'),
          mutationPolicy: confirmation.noSystemMutation ? t('runtimeConfig.environment.localCapabilityNoSystemMutation') : t('runtimeConfig.environment.localCapabilitySystemMutationPolicyUnknown'),
        }) : ''}
        confirmLabel={t('runtimeConfig.environment.localCapabilityConfirm')}
        cancelLabel={t('Common.cancel')}
        pending={applying}
        onConfirm={() => void apply()}
        onClose={() => { if (!applying) setPending(null); }}
      />
    </Surface>
  );
}
