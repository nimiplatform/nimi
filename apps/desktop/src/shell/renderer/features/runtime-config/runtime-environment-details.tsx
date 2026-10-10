import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, InlineAlert } from '@nimiplatform/kit/ui';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
} from '@nimiplatform/sdk/runtime';
import { LoaderCircle } from 'lucide-react';
import { componentPresentation } from './runtime-environment-presentation.js';
import { latestEnvironmentDependencyJob } from './runtime-environment-state.js';

export type RuntimeEnvironmentActions = {
  checking: boolean;
  busy: boolean;
  error?: string;
  reasonCode?: string;
  onRefresh: () => void;
  onCancel: (jobId: string) => void;
};

export function RuntimeEnvironmentCheck(props: { actions?: RuntimeEnvironmentActions }) {
  const { t } = useTranslation();
  return props.actions ? (
    <div className="space-y-2">
      <Button data-testid="configuration-environment-refresh" tone="ghost" size="sm" disabled={props.actions.checking || props.actions.busy} onClick={props.actions.onRefresh}>
        {props.actions.checking ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> : null}
        {t('runtimeConfig.environment.localCapabilityRefresh')}
      </Button>
      {props.actions.error ? (
        <InlineAlert tone="warning">
          <p>{t(props.actions.reasonCode === 'AI_LOADOUT_DRIVER_UNAVAILABLE'
            ? 'runtimeConfig.setupTask.environmentUnavailable'
            : 'runtimeConfig.environment.configurationCheckFailed')}</p>
          <details className="mt-1 text-xs"><summary>{t('runtimeConfig.profiles.technicalDetails')}</summary><p className="break-all">{props.actions.error}</p></details>
        </InlineAlert>
      ) : null}
    </div>
  ) : null;
}

/** Exact Runtime dependencies; a shared job is cancelled only through its explicit control. */
export function RuntimeEnvironmentDependencies(props: {
  environment: NimiRuntimeLocalEnvironmentPlan;
  jobs?: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
  actions?: RuntimeEnvironmentActions;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [cancelId, setCancelId] = useState<string | null>(null);
  return (
    <div className={props.className}>
      <ul className="divide-y divide-[var(--nimi-border-subtle)] text-xs">
        {props.environment.dependencies.map(item => {
          const job = latestEnvironmentDependencyJob(props.jobs ?? [], item);
          const active = !!job && isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state);
          const state = active ? job.state : item.state;
          const shown = componentPresentation({ ...item, state }, t);
          const ready = isNimiRuntimeLocalEnvironmentDependencyReadyState(state);
          return (
            <li key={`${item.environmentKey}:${item.consumerScope}:${item.dependencyFamily}:${item.dependencyId}`} className="py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-[var(--nimi-text-primary)]">{shown.name}</span>
                <span className={`inline-flex items-center gap-1.5 ${ready ? 'text-[var(--nimi-status-success)]' : 'text-[var(--nimi-text-secondary)]'}`}>
                  {active ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> : null}
                  {shown.state}{active && job.bytesTotal > 0 ? ` · ${Math.round(job.percent)}%` : ''}
                  {!item.required ? ` · ${t('runtimeConfig.local.optional')}` : ''}
                </span>
                {active && props.actions ? (
                  <Button tone="ghost" size="sm" disabled={props.disabled || props.actions.busy} onClick={() => setCancelId(job.jobId)}>
                    {t('runtimeConfig.environment.cancelComponent')}
                  </Button>
                ) : null}
              </div>
              <details className="mt-1 text-[var(--nimi-text-muted)]">
                <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails')}</summary>
                <div className="mt-2 grid gap-1 break-all font-mono" data-testid="runtime-environment-dependency-supply">
                  <div>{item.dependencyFamily} · {item.dependencyId}</div>
                  <div>{item.sourceKind} · {item.consumerScope}</div>
                  {item.canonicalRoot ? <div>{item.canonicalRoot}</div> : null}
                  {item.dependencyFamily.startsWith('python.') ? <div>{t('runtimeConfig.environment.localCapabilityExactLock')}</div> : null}
                  <div>{state}{item.reasonCode ? ` · ${item.reasonCode}` : ''}</div>
                  {job ? <div>{job.jobId} · {job.state}</div> : null}
                  {item.detail || job?.failureDetail ? <div className="whitespace-pre-wrap">{item.detail || job?.failureDetail}</div> : null}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={cancelId !== null}
        title={t('runtimeConfig.environment.cancelComponent')}
        message={t('runtimeConfig.environment.cancelComponentMessage')}
        confirmLabel={t('runtimeConfig.environment.cancelComponent')}
        cancelLabel={t('Common.cancel')}
        pending={props.actions?.busy ?? false}
        onConfirm={() => { if (cancelId) props.actions?.onCancel(cancelId); setCancelId(null); }}
        onClose={() => setCancelId(null)}
      />
    </div>
  );
}
