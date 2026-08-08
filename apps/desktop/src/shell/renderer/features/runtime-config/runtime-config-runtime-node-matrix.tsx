import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface, cn } from '@nimiplatform/kit/ui';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import { SectionTitle } from './runtime-config-primitives';
import { localSpeechReasonSummary } from './runtime-config-model-center-utils';
import {
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
  TONE_STYLES,
  type RuntimeTone,
} from './runtime-config-runtime-page-ui';

type RuntimeNodeMatrixRow = RuntimeConfigStateV11['local']['nodeMatrix'][number];

type RuntimeNodeCapabilityMatrixProps = {
  rows: RuntimeNodeMatrixRow[];
  expanded: boolean;
  onToggleExpanded: () => void;
};

function asProviderHintRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function RuntimeNodeCapabilityMatrix({
  rows,
  expanded,
  onToggleExpanded,
}: RuntimeNodeCapabilityMatrixProps) {
  const { t } = useTranslation();
  const providerStatusSummary = useMemo(() => {
    const grouped = new Map<
      string,
      {
        provider: string;
        total: number;
        available: number;
        reasonCodes: Set<string>;
      }
    >();
    for (const row of rows) {
      const provider = String(row.provider || '').trim() || 'unknown';
      const current = grouped.get(provider) || {
        provider,
        total: 0,
        available: 0,
        reasonCodes: new Set<string>(),
      };
      current.total += 1;
      if (row.available) current.available += 1;
      else if (row.reasonCode) current.reasonCodes.add(String(row.reasonCode));
      grouped.set(provider, current);
    }
    return [...grouped.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }, [rows]);

  if (rows.length === 0 && providerStatusSummary.length === 0) {
    return null;
  }

  return (
    <section className="mt-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <SectionTitle>
            {t('runtimeConfig.runtime.nodeMatrix', { defaultValue: 'Node Capability Matrix' })}
          </SectionTitle>
          <p className={cn('mt-1 text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.runtime.nodeMatrixSubtitle', {
              defaultValue: 'Low-level node diagnostics - advanced troubleshooting',
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleExpanded}
          className={cn('shrink-0 text-xs font-medium transition-colors hover:text-[var(--nimi-text-primary)]', TOKEN_TEXT_MUTED)}
        >
          {expanded
            ? t('runtimeConfig.runtime.collapse', { defaultValue: 'Collapse' })
            : t('runtimeConfig.runtime.expand', { defaultValue: 'Expand' })}
        </button>
      </div>
      <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
        {providerStatusSummary.length > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {providerStatusSummary.map((summary) => {
              const allAvailable = summary.available === summary.total && summary.total > 0;
              const noneAvailable = summary.available === 0 && summary.total > 0;
              const tone: RuntimeTone = allAvailable ? 'success' : noneAvailable ? 'danger' : 'warning';
              const toneStyle = TONE_STYLES[tone];
              return (
                <div key={`provider-summary-${summary.provider}`} className="inline-flex items-center gap-2">
                  <span className={cn('text-[length:var(--nimi-type-caption-size)] font-medium', TOKEN_TEXT_SECONDARY)}>
                    {summary.provider}
                  </span>
                  <span className={cn('font-mono text-[length:var(--nimi-type-caption-size)]', toneStyle.subtleText)}>
                    {summary.available}/{summary.total}
                  </span>
                  {summary.reasonCodes.size > 0 ? (
                    <span
                      className={cn('min-w-0 max-w-[180px] truncate font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}
                      title={[...summary.reasonCodes].join(', ')}
                    >
                      {[...summary.reasonCodes].join(', ')}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {expanded ? (
          rows.length === 0 ? (
            <p className={cn('mt-3 text-sm', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.runtime.noNodeAvailabilityData', {
                defaultValue: 'No node availability data. Run Refresh to probe the local runtime.',
              })}
            </p>
          ) : (
            <div className={cn(providerStatusSummary.length > 0 ? 'mt-4 border-t border-[var(--nimi-border-subtle)]/60 pt-3' : '', 'divide-y divide-[var(--nimi-border-subtle)]/50')}>
              {rows.map((row) => {
                const providerHintExtra = asProviderHintRecord(row.providerHints?.extra);
                const runtimeSupportClass = String(providerHintExtra.runtime_support_class || '').trim();
                const runtimeSupportDetail = String(providerHintExtra.runtime_support_detail || '').trim();
                const speechReasonSummary = localSpeechReasonSummary(row.reasonCode);
                const tone: RuntimeTone = row.available ? 'success' : 'danger';
                const toneStyle = TONE_STYLES[tone];
                const metaBits = [
                  `provider=${row.provider || 'unknown'}`,
                  `adapter=${row.adapter}`,
                  row.backend ? `backend=${row.backend}` : null,
                  runtimeSupportClass ? `runtimeSupport=${runtimeSupportClass}` : null,
                ].filter(Boolean).join(' - ');
                const hostLimitWarning = runtimeSupportClass === 'attached_only' || runtimeSupportClass === 'unsupported';
                return (
                  <div key={`node-matrix-${row.nodeId}`} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', row.available ? 'bg-[var(--nimi-status-success)]' : 'bg-[var(--nimi-status-danger)]')} />
                        <span className={cn('truncate text-xs font-medium', TOKEN_TEXT_PRIMARY)}>
                          {row.capability}
                        </span>
                        <span className={cn('truncate font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>
                          {row.nodeId}
                        </span>
                      </div>
                      <span className={cn('shrink-0 text-[length:var(--nimi-type-caption-size)] font-medium', toneStyle.subtleText)}>
                        {row.available ? 'available' : 'unavailable'}
                      </span>
                    </div>
                    <p className={cn('mt-1 truncate font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)} title={metaBits}>
                      {metaBits}
                    </p>
                    {runtimeSupportDetail ? (
                      <p className={cn('truncate font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)} title={runtimeSupportDetail}>
                        {runtimeSupportDetail}
                      </p>
                    ) : null}
                    {row.policyGate ? (
                      <p className={cn('font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>policyGate={row.policyGate}</p>
                    ) : null}
                    {!row.available && speechReasonSummary ? (
                      <p className="mt-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning)]">{speechReasonSummary}</p>
                    ) : null}
                    {!row.available && row.reasonCode ? (
                      <p
                        className="mt-1 truncate font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning)]"
                        title={String(row.reasonCode)}
                      >
                        reason={row.reasonCode}
                      </p>
                    ) : null}
                    {hostLimitWarning ? (
                      <p className="mt-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning)]">
                        {t('runtimeConfig.runtime.managedEngineUnavailable', {
                          defaultValue: 'Managed local engine is unavailable on this host. Configure an attached endpoint to use this provider.',
                        })}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </Surface>
    </section>
  );
}
