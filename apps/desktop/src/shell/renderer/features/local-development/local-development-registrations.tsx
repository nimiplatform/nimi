import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type {
  LocalDevelopmentRegistration,
  LocalDevelopmentRun,
} from './local-development-types.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function LocalDevelopmentRegistrations() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const available = bindings.app.projection.localDevelopmentAvailable();
  const [rows, setRows] = useState<LocalDevelopmentRegistration[]>([]);
  const [runs, setRuns] = useState<LocalDevelopmentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmSelector, setConfirmSelector] = useState('');
  const [busySelector, setBusySelector] = useState('');

  const refresh = useCallback(async (showLoading = true) => {
    if (!available) return;
    if (showLoading) setLoading(true);
    const [registrations, activity] = await Promise.allSettled([
      bindings.app.commands.listLocalDevelopmentRegistrations(),
      bindings.app.commands.listLocalDevelopmentRuns(),
    ]);
    const errors: string[] = [];
    if (registrations.status === 'fulfilled') setRows(registrations.value);
    else errors.push(registrations.reason instanceof Error ? registrations.reason.message : String(registrations.reason));
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
    };
  }, [available, bindings.clock, refresh]);

  if (!available) return null;

  const remove = async (selector: string) => {
    setBusySelector(selector);
    setError('');
    try {
      await bindings.app.commands.removeLocalDevelopmentRegistration(selector);
      setRows((current) => current.filter((row) => row.selector !== selector));
      setConfirmSelector('');
      await refresh(false);
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
                {run.reasonCode ? <code className="text-[11px] leading-4 text-[var(--nimi-text-secondary)] break-all">{run.reasonCode}</code> : null}
                {run.hostGeneration > 0 ? <NimiText role="caption">{t('LocalDevelopment.activity.hostGeneration', { count: run.hostGeneration })}</NimiText> : null}
                {run.retryable ? <NimiText role="caption">{t('LocalDevelopment.activity.retryable')}</NimiText> : null}
              </div>
            </Surface>
          ))}
        </div>
      </section>

      <section className="mt-8" data-testid="local-development-registrations">
        <NimiText role="section-title">{t('LocalDevelopment.management.title')}</NimiText>
        <NimiText role="helper" className="mt-1 max-w-2xl">{t('LocalDevelopment.management.description')}</NimiText>
        {!loading && rows.length === 0 ? (
          <Surface tone="card" material="solid" padding="md" className="mt-3">
            <NimiText role="body">{t('LocalDevelopment.management.empty')}</NimiText>
          </Surface>
        ) : null}
        <div className="mt-3 grid gap-3">
          {rows.map((row) => {
            const confirming = confirmSelector === row.selector;
            return (
              <Surface key={row.selector} tone="card" material="solid" padding="md" className="grid gap-3">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <NimiText role="card-title">{row.displayName}</NimiText>
                    <p className="mt-1 font-mono text-xs leading-5 text-[var(--nimi-text-muted)] break-all">
                      {row.appId} · {row.canonicalProjectRoot}
                    </p>
                  </div>
                  <StatusBadge tone="info">{t(`LocalDevelopment.shell.${row.shell}`)}</StatusBadge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.appAccess.length === 0 ? (
                    <NimiText role="caption">{t('LocalDevelopment.field.noAppAccess')}</NimiText>
                  ) : row.appAccess.map((domain) => (
                    <code key={domain} className="rounded-md bg-[var(--nimi-surface-active)] px-2 py-1 text-[11px] text-[var(--nimi-text-secondary)]">
                      {domain}
                    </code>
                  ))}
                </div>
                <NimiText role="caption">
                  {t('LocalDevelopment.management.generations', {
                    source: row.sourceGeneration,
                    declaration: row.declarationGeneration,
                  })}
                </NimiText>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {confirming ? (
                    <>
                      <NimiText role="helper" className="mr-auto">{t('LocalDevelopment.management.removeConfirm')}</NimiText>
                      <Button tone="ghost" size="sm" onClick={() => setConfirmSelector('')} disabled={Boolean(busySelector)}>
                        {t('LocalDevelopment.action.cancel')}
                      </Button>
                      <Button data-testid={`local-development-remove-confirm:${row.selector}`} tone="danger" size="sm" loading={busySelector === row.selector} onClick={() => { void remove(row.selector); }}>
                        {t('LocalDevelopment.action.confirmRemove')}
                      </Button>
                    </>
                  ) : (
                    <Button data-testid={`local-development-remove:${row.selector}`} tone="danger" size="sm" onClick={() => setConfirmSelector(row.selector)}>
                      {t('LocalDevelopment.action.remove')}
                    </Button>
                  )}
                </div>
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
  if (['registration-removed', 'project-changed', 'failed', 'build-failed'].includes(state)) return 'danger';
  if (['registration-unavailable', 'runtime-unavailable', 'restarting'].includes(state)) return 'warning';
  return 'neutral';
}
