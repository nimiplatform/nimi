import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SelectField } from '@nimiplatform/kit/ui';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, CircleAlert, Clock3, RefreshCw } from 'lucide-react';
import type { NimiIntegrationCall, NimiIntegrationTarget } from '@nimiplatform/sdk/app';
import { integrationOperationPresentation } from './integration-operation-presentation.js';

const statuses = ['accepted', 'completed', 'failed', 'canceled', 'unconfirmed'] as const;
const pageSize = 20;
// SelectField drops empty-string options (Radix reserves '' for the
// placeholder), so the unfiltered choice uses a sentinel value.
const ALL_APPS_OPTION_VALUE = '__all_apps__';
const ALL_RESULTS_OPTION_VALUE = '__all_results__';

export function IntegrationCallsView({
  calls,
  targets,
  busy,
  refresh,
  global = false,
}: {
  calls: readonly NimiIntegrationCall[];
  targets: readonly NimiIntegrationTarget[];
  busy: boolean;
  refresh: () => void;
  global?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [app, setApp] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Audit names are captured at invocation, not reconstructed from today's registrations.
  const apps = [...new Set(calls.map((call) => call.consumerDisplayName))];
  const filtered = calls.filter(
    (call) =>
      (!app || (call.consumerDisplayName || '__unknown__') === app) && (!status || call.status === status),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const formatTime = (time: string | null) =>
    time ? new Date(time).toLocaleString(i18n.language) : t('Integrations.unknownTime');
  return (
    <section data-testid="integration-calls">
      {!global ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">{t('Integrations.usageRecords')}</h2>
          <Button
            tone="secondary"
            size="sm"
            disabled={busy}
            onClick={refresh}
            leadingIcon={<RefreshCw size={14} />}
          >
            {t('Integrations.refresh')}
          </Button>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          {t('Integrations.app')}
          <SelectField
            data-testid="integration-calls-filter-app"
            aria-label={t('Integrations.filterApp')}
            className="w-auto"
            value={app || ALL_APPS_OPTION_VALUE}
            options={[
              { value: ALL_APPS_OPTION_VALUE, label: t('Integrations.allApps') },
              ...apps.map((name) => ({
                value: name || '__unknown__',
                label: name || t('Integrations.unknownAttribution'),
              })),
              ...(app && !apps.some((name) => (name || '__unknown__') === app)
                ? [{ value: app, label: app }]
                : []),
            ]}
            onValueChange={(next) => {
              setApp(next === ALL_APPS_OPTION_VALUE ? '' : next);
              setPage(0);
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t('Integrations.result')}
          <SelectField
            data-testid="integration-calls-filter-result"
            aria-label={t('Integrations.filterResult')}
            className="w-auto"
            value={status || ALL_RESULTS_OPTION_VALUE}
            options={[
              { value: ALL_RESULTS_OPTION_VALUE, label: t('Integrations.allResults') },
              ...statuses.map((value) => ({ value, label: t(`Integrations.states.${value}`) })),
            ]}
            onValueChange={(next) => {
              setStatus(next === ALL_RESULTS_OPTION_VALUE ? '' : next);
              setPage(0);
            }}
          />
        </label>
        {app || status ? (
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              setApp('');
              setStatus('');
              setPage(0);
            }}
          >
            {t('Integrations.clearFilters')}
          </Button>
        ) : null}
        <p className="ml-auto text-xs text-[var(--nimi-text-muted)]">
          {t('Integrations.filteredRecordsHelp')}
        </p>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--nimi-border-subtle)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color-mix(in_srgb,var(--nimi-surface-active)_45%,transparent)] text-xs text-[var(--nimi-text-secondary)]">
            <tr>
              {['time', 'app', ...(global ? ['target'] : []), 'operation', 'result'].map((key) => (
                <th key={key} scope="col" className="px-4 py-3 font-medium">
                  {t(`Integrations.${key}`)}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">{t('Integrations.callDetails')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((call) => {
              const target = targets.find((item) => item.targetRef === call.targetRef);
              const op = target?.operations.find((item) => item.name === call.operation);
              const operation =
                target && op ? integrationOperationPresentation(target.kind, op, t).name : call.operation;
              const open = expanded === call.callId;
              const StatusIcon = {
                accepted: Clock3,
                completed: CheckCircle2,
                failed: CircleAlert,
                canceled: Circle,
                unconfirmed: CircleAlert,
              }[call.status];
              const tone = {
                accepted: 'text-[var(--nimi-status-info)]',
                completed: 'text-[var(--nimi-status-success)]',
                failed: 'text-[var(--nimi-status-danger)]',
                canceled: 'text-[var(--nimi-text-muted)]',
                unconfirmed: 'text-[var(--nimi-status-warning)]',
              }[call.status];
              return (
                <Fragment key={call.callId}>
                  <tr
                    className={`border-t border-[var(--nimi-border-subtle)] align-top ${open ? 'bg-[var(--nimi-surface-active)]' : ''}`}
                  >
                    <td className="px-4 py-3 text-xs tabular-nums">
                      <time dateTime={call.createdAt || undefined}>{formatTime(call.createdAt)}</time>
                    </td>
                    <td className="px-4 py-3">
                      {call.consumerDisplayName || t('Integrations.unknownAttribution')}
                    </td>
                    {global ? (
                      <td className="px-4 py-3">
                        <p>{call.targetDisplayName || t('Integrations.unknownAttribution')}</p>
                        {call.accountLabel ? (
                          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
                            {call.accountLabel}
                          </p>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="max-w-64 break-words px-4 py-3">{operation}</td>
                    <td className={`px-4 py-3 ${tone}`}>
                      <span className="inline-flex items-center gap-2">
                        <StatusIcon size={15} className="shrink-0" aria-hidden="true" />
                        {t(`Integrations.states.${call.status}`)}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <Button
                        tone="ghost"
                        size="sm"
                        aria-label={t('Integrations.callDetailsFor', { id: call.callId })}
                        aria-expanded={open}
                        aria-controls={`detail-${call.callId}`}
                        onClick={() => setExpanded(open ? null : call.callId)}
                      >
                        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </Button>
                    </td>
                  </tr>
                  {open ? (
                    <tr id={`detail-${call.callId}`}>
                      <td
                        colSpan={global ? 6 : 5}
                        className="border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-5 py-4"
                      >
                        {call.errorCode ? (
                          <p className="mb-3 text-sm leading-6" role="status">
                            {t(`Integrations.errors.${call.errorCode}`, {
                              defaultValue: t('Integrations.unknownCallError'),
                            })}
                          </p>
                        ) : null}
                        {call.status === 'unconfirmed' ? (
                          <p className="mb-3 text-sm text-[var(--nimi-status-warning)]">
                            {t('Integrations.unconfirmedHelp')}
                          </p>
                        ) : null}
                        <dl className="grid gap-x-4 gap-y-2 break-words text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
                          <dt>{t('Integrations.target')}</dt>
                          <dd>
                            {call.targetDisplayName || t('Integrations.unknownAttribution')}
                            {call.accountLabel && !call.targetDisplayName.includes(call.accountLabel)
                              ? ` · ${call.accountLabel}`
                              : ''}
                          </dd>
                          <dt>{t('Integrations.operation')}</dt>
                          <dd className="break-all">
                            <code>{call.operation}</code>
                          </dd>
                          <dt>{t('Integrations.callReference')}</dt>
                          <dd className="break-all">
                            <code>{call.callId}</code>
                          </dd>
                          <dt>{t('Integrations.time')}</dt>
                          <dd>{formatTime(call.createdAt)}</dd>
                          {call.updatedAt ? (
                            <>
                              <dt>{t('Integrations.lastUpdated')}</dt>
                              <dd>{formatTime(call.updatedAt)}</dd>
                            </>
                          ) : null}
                          {call.errorCode ? (
                            <>
                              <dt>{t('Integrations.errorCode')}</dt>
                              <dd className="break-all">
                                <code>{call.errorCode}</code>
                              </dd>
                            </>
                          ) : null}
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!filtered.length ? (
        <p role="status" className="py-10 text-center text-sm text-[var(--nimi-text-secondary)]">
          {t(calls.length ? 'Integrations.noMatchingCalls' : 'Integrations.noCalls')}
        </p>
      ) : null}
      {filtered.length > pageSize ? (
        <div className="mt-4 flex items-center justify-end gap-3">
          <Button
            tone="secondary"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('Integrations.previousPage')}
          </Button>
          <span className="text-xs">
            {t('Integrations.pageCount', { page: currentPage + 1, count: lastPage + 1 })}
          </span>
          <Button
            tone="secondary"
            size="sm"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('Integrations.nextPage')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
