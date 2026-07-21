import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type {
  LocalDevelopmentAuthorization,
  LocalDevelopmentRun,
} from './local-development-types.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function LocalDevelopmentAuthorizations() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const available = bindings.app.projection.localDevelopmentAvailable();
  const [rows, setRows] = useState<LocalDevelopmentAuthorization[]>([]);
  const [runs, setRuns] = useState<LocalDevelopmentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmSelector, setConfirmSelector] = useState('');
  const [busySelector, setBusySelector] = useState('');

  const refresh = useCallback(async (showLoading = true) => {
    if (!available) return;
    if (showLoading) setLoading(true);
    const [authorizations, activity] = await Promise.allSettled([
      bindings.app.commands.listLocalDevelopmentAuthorizations(),
      bindings.app.commands.listLocalDevelopmentRuns(),
    ]);
    const errors: string[] = [];
    if (authorizations.status === 'fulfilled') setRows(authorizations.value);
    else errors.push(authorizations.reason instanceof Error ? authorizations.reason.message : String(authorizations.reason));
    if (activity.status === 'fulfilled') setRuns(activity.value);
    else errors.push(activity.reason instanceof Error ? activity.reason.message : String(activity.reason));
    setError(errors.join(' '));
    if (showLoading) setLoading(false);
  }, [available, bindings.app.commands]);

  useEffect(() => {
    if (!available) {
      setLoading(false);
      return;
    }
    let active = true;
    let cancelNext: (() => void) | null = null;
    const poll = async (showLoading: boolean) => {
      await refresh(showLoading);
      if (!active) return;
      cancelNext = bindings.clock.schedule(2_000, (result) => {
        cancelNext = null;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        void poll(false);
      });
    };
    void poll(true);
    return () => {
      active = false;
      cancelNext?.();
      cancelNext = null;
    };
  }, [available, bindings.clock, refresh]);

  if (!available) return null;

  const revoke = async (selector: string) => {
    setBusySelector(selector);
    setError('');
    try {
      const revoked = await bindings.app.commands.revokeLocalDevelopmentAuthorization(selector);
      setRows((current) => current.map((row) => row.selector === selector ? revoked : row));
      setConfirmSelector('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusySelector('');
    }
  };

  return (
    <>
      <section className="mt-8" data-testid="local-development-activity">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <NimiText role="section-title">{t('LocalDevelopment.activity.title')}</NimiText>
            <NimiText role="helper" className="mt-1 max-w-2xl">
              {t('LocalDevelopment.activity.description')}
            </NimiText>
          </div>
          <Button tone="secondary" size="sm" loading={loading} onClick={() => { void refresh(); }}>
            {t('LocalDevelopment.action.refresh')}
          </Button>
        </div>
        {error ? <InlineAlert tone="danger" className="mt-3">{error}</InlineAlert> : null}
        {!loading && runs.length === 0 ? (
          <Surface tone="card" material="solid" padding="md" className="mt-3">
            <NimiText role="body">{t('LocalDevelopment.activity.empty')}</NimiText>
          </Surface>
        ) : null}
        <div className="mt-3 grid gap-3">
          {runs.map((run, index) => (
            <Surface
              key={`${run.appId}:${run.shell}:${run.state}:${run.hostGeneration}:${index}`}
              tone="card"
              material="solid"
              padding="md"
              className="grid gap-2"
              data-state={run.state}
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <NimiText role="card-title">{run.displayName}</NimiText>
                  <p className="mt-1 font-mono text-xs leading-5 text-[var(--nimi-text-muted)] break-all">
                    {run.appId} · {run.canonicalProjectRoot}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={runStateTone(run.state)}>{t(`LocalDevelopment.state.${run.state}`)}</StatusBadge>
                  <StatusBadge tone="info">{t(`LocalDevelopment.shell.${run.shell}`)}</StatusBadge>
                </div>
              </div>
              <NimiText role="body" className="text-[13px]">{run.message}</NimiText>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {run.reasonCode ? (
                  <code className="text-[11px] leading-4 text-[var(--nimi-text-secondary)] break-all">{run.reasonCode}</code>
                ) : null}
                {run.hostGeneration > 0 ? (
                  <NimiText role="caption">{t('LocalDevelopment.activity.hostGeneration', { count: run.hostGeneration })}</NimiText>
                ) : null}
                {run.retryable ? <NimiText role="caption">{t('LocalDevelopment.activity.retryable')}</NimiText> : null}
              </div>
            </Surface>
          ))}
        </div>
      </section>

      <section className="mt-8" data-testid="local-development-authorizations">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <NimiText role="section-title">{t('LocalDevelopment.management.title')}</NimiText>
          <NimiText role="helper" className="mt-1 max-w-2xl">
            {t('LocalDevelopment.management.description')}
          </NimiText>
        </div>
      </div>
      {!loading && rows.length === 0 ? (
        <Surface tone="card" material="solid" padding="md" className="mt-3">
          <NimiText role="body">{t('LocalDevelopment.management.empty')}</NimiText>
        </Surface>
      ) : null}
      <div className="mt-3 grid gap-3">
        {rows.map((row) => {
          const confirming = confirmSelector === row.selector;
          const active = row.state === 'active';
          return (
            <Surface key={row.selector} tone="card" material="solid" padding="md" className="grid gap-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <NimiText role="card-title">{row.displayName}</NimiText>
                  <p className="mt-1 font-mono text-xs leading-5 text-[var(--nimi-text-muted)] break-all">
                    {row.appId} · {row.canonicalProjectRoot}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={active ? 'success' : 'neutral'}>{t(`LocalDevelopment.state.${row.state}`)}</StatusBadge>
                  <StatusBadge tone="info">{t(`LocalDevelopment.shell.${row.shell}`)}</StatusBadge>
                </div>
              </div>
              {row.permissionRequirements.length === 0 ? (
                <NimiText role="caption">{t('LocalDevelopment.field.noExtraPermissions')}</NimiText>
              ) : (
                <div className="grid gap-1.5">
                  {row.permissionRequirements.map((requirement) => (
                    <div key={requirement.permissionId} className="rounded-md bg-[var(--nimi-surface-active)] px-2 py-1 text-[11px] text-[var(--nimi-text-secondary)]">
                      <code className="font-mono break-all">{requirement.permissionId}</code>
                      <span className="ml-2">{requirement.reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {active ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {confirming ? (
                    <>
                      <NimiText role="helper" className="mr-auto">{t('LocalDevelopment.management.revokeConfirm')}</NimiText>
                      <Button tone="ghost" size="sm" onClick={() => setConfirmSelector('')} disabled={Boolean(busySelector)}>
                        {t('LocalDevelopment.action.cancel')}
                      </Button>
                      <Button data-testid={`local-development-revoke-confirm:${row.selector}`} tone="danger" size="sm" loading={busySelector === row.selector} onClick={() => { void revoke(row.selector); }}>
                        {t('LocalDevelopment.action.confirmRevoke')}
                      </Button>
                    </>
                  ) : (
                    <Button data-testid={`local-development-revoke:${row.selector}`} tone="danger" size="sm" onClick={() => setConfirmSelector(row.selector)}>
                      {t('LocalDevelopment.action.revoke')}
                    </Button>
                  )}
                </div>
              ) : null}
            </Surface>
          );
        })}
      </div>
      </section>
    </>
  );
}

function runStateTone(state: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'running') return 'success';
  if (['denied', 'revoked', 'project-changed', 'failed', 'build-failed'].includes(state)) return 'danger';
  if (['pending-approval', 'runtime-unavailable', 'authorization-required', 'restarting'].includes(state)) return 'warning';
  return 'neutral';
}
