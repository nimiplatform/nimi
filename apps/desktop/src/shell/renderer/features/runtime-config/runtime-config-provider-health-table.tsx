import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIProviderHealthSnapshot, AIProviderSubHealth } from '@nimiplatform/sdk/runtime/generated';
import { cn } from '@nimiplatform/kit/ui';
import {
  relativeTimeShort,
  timestampToIso,
} from './runtime-config-global-audit-view-model.js';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';

type StateTone = 'success' | 'warning' | 'danger' | 'neutral';

function providerStateTone(state: string): StateTone {
  const lower = String(state || '').toLowerCase();
  if (lower === 'healthy') return 'success';
  if (lower === 'unhealthy' || lower === 'unreachable' || lower === 'error') return 'danger';
  if (lower === 'degraded' || lower === 'warning' || lower === 'stale') return 'warning';
  return 'neutral';
}

const STATE_BADGE_CLASS: Record<StateTone, { pill: string; dot: string; text: string }> = {
  success: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
    dot: 'bg-[var(--nimi-status-success)]',
    text: 'text-[var(--nimi-status-success)]',
  },
  warning: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
    dot: 'bg-[var(--nimi-status-warning)]',
    text: 'text-[var(--nimi-status-warning)]',
  },
  danger: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
    dot: 'bg-[var(--nimi-status-danger)]',
    text: 'text-[var(--nimi-status-danger)]',
  },
  neutral: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] text-[var(--nimi-text-secondary)]',
    dot: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_65%,transparent)]',
    text: 'text-[var(--nimi-text-secondary)]',
  },
};

function humanizeReason(reason: string | undefined | null): string {
  if (!reason) return '';
  const text = String(reason).trim();
  const lower = text.toLowerCase();

  if (lower.includes('connection refused') || lower.includes('actively refused')) {
    const portMatch = text.match(/:(\d{2,5})\b/);
    return portMatch ? `Connection refused (port ${portMatch[1]})` : 'Connection refused';
  }
  if (lower.includes('no such host') || lower.includes('name or service not known')) {
    return 'DNS resolution failed';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline exceeded')) {
    return 'Request timed out';
  }
  if (lower.includes('unauthorized') || lower.includes(' 401')) return 'Unauthorized (401)';
  if (lower.includes('forbidden') || lower.includes(' 403')) return 'Forbidden (403)';
  if (lower.includes('not found') || lower.includes(' 404')) return 'Not found (404)';
  if (lower.includes(' 500') || lower.includes('internal server error')) return 'Server error (500)';
  if (lower.includes(' 503') || lower.includes('service unavailable')) return 'Service unavailable (503)';

  const firstLine = (text.split('\n')[0] || text).trim();
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}\u2026` : firstLine;
}

function InfoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function StateBadge({ state }: { state: string }) {
  const tone = providerStateTone(state);
  const style = STATE_BADGE_CLASS[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', style.pill)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {state || 'unknown'}
    </span>
  );
}

type ProviderHealthTableProps = {
  providerHealth: AIProviderHealthSnapshot[];
};

export function ProviderHealthTable({ providerHealth }: ProviderHealthTableProps) {
  const { t } = useTranslation();
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const toggleProvider = (name: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleError = (key: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (providerHealth.length === 0) return null;

  return (
    <div className="mt-6">
      <p className={cn('mb-3 text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
        {t('runtimeConfig.runtime.aiProviders', { defaultValue: 'AI Providers' })}
      </p>
      <div className="overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40">
        <table className="w-full text-xs">
          <thead>
            <tr className={cn('text-left text-[10px] font-medium uppercase tracking-[0.12em]', TOKEN_TEXT_MUTED)}>
              <th className="px-4 py-2.5">{t('runtimeConfig.runtime.name', { defaultValue: 'Name' })}</th>
              <th className="px-4 py-2.5">{t('runtimeConfig.runtime.state', { defaultValue: 'State' })}</th>
              <th className="px-4 py-2.5 w-24">{t('runtimeConfig.runtime.failures', { defaultValue: 'Failures' })}</th>
              <th className="px-4 py-2.5">{t('runtimeConfig.runtime.lastChecked', { defaultValue: 'Last Checked' })}</th>
            </tr>
          </thead>
          <tbody>
            {providerHealth.map((provider) => (
              <ProviderRow
                key={provider.providerName}
                provider={provider}
                expanded={expandedProviders.has(provider.providerName)}
                onToggle={() => toggleProvider(provider.providerName)}
                errorExpanded={expandedErrors.has(provider.providerName)}
                onToggleError={() => toggleError(provider.providerName)}
                isErrorExpanded={(key) => expandedErrors.has(key)}
                onToggleErrorKey={(key) => toggleError(key)}
                showFullErrorLabel={t('runtimeConfig.runtime.showFullError', { defaultValue: 'Show full error' })}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LastCheckedCell({
  lastCheckedText,
  state,
  reason,
  errorKey,
  expanded,
  onToggle,
  showFullErrorLabel,
}: {
  lastCheckedText: string;
  state: string;
  reason: string;
  errorKey: string;
  expanded: boolean;
  onToggle: () => void;
  showFullErrorLabel: string;
}) {
  const tone = providerStateTone(state);
  const isIssue = tone === 'danger' || tone === 'warning';
  const hasReason = Boolean(reason && reason.trim());
  const humanReason = hasReason ? humanizeReason(reason) : '';

  if (!isIssue || !hasReason) {
    return <span className="shrink-0">{lastCheckedText}</span>;
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="shrink-0">{lastCheckedText}</span>
      <span className={cn('shrink-0', TOKEN_TEXT_MUTED)}>·</span>
      <span
        className={cn('min-w-0 truncate text-[11px]', STATE_BADGE_CLASS[tone].text)}
        title={humanReason}
      >
        {humanReason}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        aria-label={showFullErrorLabel}
        aria-expanded={expanded}
        aria-controls={`error-detail-${errorKey}`}
        className={cn(
          'ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)]',
          expanded && 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)]',
        )}
      >
        <InfoIcon />
      </button>
    </div>
  );
}

function ErrorDetailRow({
  errorKey,
  reason,
  indent,
}: {
  errorKey: string;
  reason: string;
  indent?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (!clip?.writeText) return;
    void clip.writeText(reason).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };

  return (
    <tr className="bg-[color-mix(in_srgb,var(--nimi-status-danger)_4%,var(--nimi-surface-panel))]/60">
      <td colSpan={4} id={`error-detail-${errorKey}`} className={cn(indent ? 'px-4 pl-9' : 'px-4', 'py-3')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn('mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
              Raw error
            </p>
            <pre className={cn('whitespace-pre-wrap break-words rounded-md bg-[var(--nimi-surface-card)] px-3 py-2 font-mono text-[11px] leading-relaxed', TOKEN_TEXT_PRIMARY)}>
              {reason}
            </pre>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCopy();
            }}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1 text-[11px] font-medium transition-colors hover:border-[var(--nimi-border-strong)]',
              copied ? 'text-[var(--nimi-status-success)]' : TOKEN_TEXT_SECONDARY,
            )}
            aria-label={copied ? 'Copied' : 'Copy error'}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </td>
    </tr>
  );
}

function ProviderRow({
  provider,
  expanded,
  onToggle,
  errorExpanded,
  onToggleError,
  isErrorExpanded,
  onToggleErrorKey,
  showFullErrorLabel,
}: {
  provider: AIProviderHealthSnapshot;
  expanded: boolean;
  onToggle: () => void;
  errorExpanded: boolean;
  onToggleError: () => void;
  isErrorExpanded: (key: string) => boolean;
  onToggleErrorKey: (key: string) => void;
  showFullErrorLabel: string;
}) {
  const hasSubs = provider.subHealth.length > 0;

  return (
    <>
      <tr
        className={cn(
          'border-t border-[var(--nimi-border-subtle)]/60 transition-colors hover:bg-white/50',
          hasSubs && 'cursor-pointer',
        )}
        onClick={hasSubs ? onToggle : undefined}
      >
        <td className={cn('px-4 py-2.5 font-medium', TOKEN_TEXT_PRIMARY)}>
          <span className="inline-flex items-center gap-1.5">
            {hasSubs ? (
              <span className={cn('text-[10px]', TOKEN_TEXT_MUTED)}>{expanded ? '\u25BC' : '\u25B6'}</span>
            ) : null}
            {provider.providerName}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <StateBadge state={provider.state} />
        </td>
        <td className={cn('px-4 py-2.5 font-mono', TOKEN_TEXT_SECONDARY)}>
          {provider.consecutiveFailures}
        </td>
        <td className={cn('px-4 py-2.5', TOKEN_TEXT_MUTED)}>
          <LastCheckedCell
            lastCheckedText={provider.lastCheckedAt ? relativeTimeShort(timestampToIso(provider.lastCheckedAt)) : '—'}
            state={provider.state}
            reason={provider.reason || ''}
            errorKey={provider.providerName}
            expanded={errorExpanded}
            onToggle={onToggleError}
            showFullErrorLabel={showFullErrorLabel}
          />
        </td>
      </tr>
      {errorExpanded && provider.reason ? (
        <ErrorDetailRow errorKey={provider.providerName} reason={provider.reason} />
      ) : null}
      {expanded && hasSubs
        ? provider.subHealth.map((sub: AIProviderSubHealth) => {
            const subErrorKey = `${provider.providerName}::${sub.providerName}`;
            const subExpanded = isErrorExpanded(subErrorKey);
            return (
              <SubHealthRow
                key={subErrorKey}
                sub={sub}
                errorKey={subErrorKey}
                expanded={subExpanded}
                onToggle={() => onToggleErrorKey(subErrorKey)}
                showFullErrorLabel={showFullErrorLabel}
              />
            );
          })
        : null}
    </>
  );
}

function SubHealthRow({
  sub,
  errorKey,
  expanded,
  onToggle,
  showFullErrorLabel,
}: {
  sub: AIProviderSubHealth;
  errorKey: string;
  expanded: boolean;
  onToggle: () => void;
  showFullErrorLabel: string;
}) {
  return (
    <>
      <tr className="border-t border-[var(--nimi-border-subtle)]/40 bg-[var(--nimi-surface-panel)]/30">
        <td className={cn('px-4 py-2 pl-9', TOKEN_TEXT_SECONDARY)}>{sub.providerName}</td>
        <td className="px-4 py-2">
          <StateBadge state={sub.state} />
        </td>
        <td className={cn('px-4 py-2 font-mono', TOKEN_TEXT_SECONDARY)}>{sub.consecutiveFailures}</td>
        <td className={cn('px-4 py-2', TOKEN_TEXT_MUTED)}>
          <LastCheckedCell
            lastCheckedText={sub.lastCheckedAt ? relativeTimeShort(timestampToIso(sub.lastCheckedAt)) : '—'}
            state={sub.state}
            reason={sub.reason || ''}
            errorKey={errorKey}
            expanded={expanded}
            onToggle={onToggle}
            showFullErrorLabel={showFullErrorLabel}
          />
        </td>
      </tr>
      {expanded && sub.reason ? (
        <ErrorDetailRow errorKey={errorKey} reason={sub.reason} indent />
      ) : null}
    </>
  );
}
