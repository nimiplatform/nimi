import React from 'react';
import { useTranslation } from 'react-i18next';
import { CAP_META, TONE_PALETTE } from './tester-cap-meta.js';
import { CapTile } from './tester-visuals.js';
import type { TesterHistoryEntry } from './tester-history.js';
import { CAPABILITY_LABELS } from './tester-types.js';

const COPY_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h10" />
  </svg>
);

const TRASH_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelativeDay(timestamp: number, labels: { today: string; yesterday: string }): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return labels.today;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (date.toDateString() === yesterday.toDateString()) return labels.yesterday;
  return date.toLocaleDateString();
}

function formatLatency(ms?: number): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function IconButton({ onClick, title, children }: { onClick?: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        border: 0,
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        background: 'transparent',
        color: 'var(--nimi-fg-3)',
        transition: 'all 160ms',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = 'rgba(148,163,184,0.12)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

function TimelineCard({ entry, onRemove }: { entry: TesterHistoryEntry; onRemove: () => void }) {
  const { t } = useTranslation();
  const meta = CAP_META[entry.capabilityId];
  const labels = CAPABILITY_LABELS[entry.capabilityId];
  const tone = TONE_PALETTE[meta?.tone ?? 'mint'];
  const failed = entry.status === 'failed';
  const latency = formatLatency(entry.elapsedMs);
  const sourceLabel = entry.source === 'local'
    ? t('Tester.route.local', { defaultValue: 'Local' })
    : entry.source === 'cloud'
      ? t('Tester.route.cloud', { defaultValue: 'Cloud' })
      : null;
  const tokenSummary = entry.totalTokens
    ? `${entry.totalTokens} tok`
    : entry.outputTokens
    ? `${entry.outputTokens} tok`
    : null;

  const handleCopy = () => {
    try {
      const payload = failed
        ? entry.error || ''
        : entry.outputSummary || '';
      if (payload && typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(payload);
      }
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <article
      style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.78)',
        border: '1px solid rgba(226,232,240,0.9)',
        borderRadius: 18,
        padding: 20,
        boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 18,
          bottom: 18,
          width: 3,
          borderRadius: 999,
          background: failed ? '#ef4444' : tone.hex,
          opacity: failed ? 0.7 : 0.55,
        }}
      />

      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {meta ? <CapTile kind={meta.icon} tone={meta.tone} size={32} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--nimi-fg-1)' }}>{labels.label}</span>
            {entry.modelResolved ? (
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--nimi-fg-3)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.modelResolved}>
                {entry.modelResolved}
              </span>
            ) : null}
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 999,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                background: failed ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.14)',
                color: failed ? '#b91c1c' : '#047857',
              }}
            >
              {failed
                ? t('Tester.history.failed', { defaultValue: 'Failed' })
                : t('Tester.history.passed', { defaultValue: 'Passed' })}
            </span>
          </div>
          <div className="font-mono" style={{ fontSize: 11, color: 'var(--nimi-fg-3)', marginTop: 2 }}>
            {formatTime(entry.at)}
            {sourceLabel ? ` · ${sourceLabel}` : ''}
            {tokenSummary ? ` · ${tokenSummary}` : ''}
            {latency ? ` · ${latency}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconButton title={t('Tester.history.copyOutput', { defaultValue: 'Copy output' })} onClick={handleCopy}>{COPY_ICON}</IconButton>
          <IconButton title={t('Tester.history.removeFromHistory', { defaultValue: 'Remove from history' })} onClick={onRemove}>{TRASH_ICON}</IconButton>
        </div>
      </header>

      {entry.prompt ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--nimi-fg-3)',
            marginBottom: 10,
            paddingLeft: 10,
            borderLeft: '2px solid rgba(148,163,184,0.25)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <span style={{ fontWeight: 500, color: 'var(--nimi-fg-2)' }}>
            {t('Tester.history.youPrefix', { defaultValue: 'You' })} ·{' '}
          </span>
          {entry.prompt}
        </div>
      ) : null}

      <div
        style={{
          fontSize: 13,
          color: failed ? '#b91c1c' : 'var(--nimi-fg-1)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {failed ? entry.error || 'Run failed' : entry.outputSummary || '—'}
      </div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '44px 28px',
        textAlign: 'center',
      }}
    >
      <svg width="120" height="76" viewBox="0 0 140 90" style={{ marginBottom: 14 }}>
        <defs>
          <radialGradient id="tester-empty-grad" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#a7f3d0" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="70" cy="55" rx="60" ry="28" fill="url(#tester-empty-grad)" />
        <g transform="translate(36, 22)" fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth="1.2" strokeLinecap="round">
          <rect x="0" y="10" width="30" height="40" rx="6" fill="rgba(255,255,255,0.85)" />
          <rect x="34" y="2" width="34" height="48" rx="6" fill="rgba(255,255,255,0.92)" />
          <path d="M6  22 h18 M6  28 h14 M6  34 h18 M6  40 h10" />
          <path d="M40 14 h22 M40 20 h16 M40 26 h22 M40 32 h14 M40 38 h22 M40 44 h12" />
          <circle cx={68} cy={10} r={8} fill="rgba(255,255,255,0.95)" stroke="rgba(148,163,184,0.6)" />
          <path d="M64 10 l2.8 2.8 L72 7.5" stroke="#4ECCA3" strokeWidth="1.8" />
        </g>
      </svg>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--nimi-fg-1)', marginBottom: 6 }}>
        No {label.toLowerCase()} runs yet
      </div>
      <div style={{ fontSize: 13, color: 'var(--nimi-fg-3)', maxWidth: 340, margin: '0 auto', lineHeight: 1.55 }}>
        Run the capability above. Each run is recorded here — prompt, latency, model, and tokens on every card.
      </div>
    </div>
  );
}

export function TesterHistoryPanel(props: {
  capabilityLabel: string;
  entries: TesterHistoryEntry[];
  onClear: () => void;
  onRemoveEntry: (entryId: string) => void;
}) {
  const { capabilityLabel, entries, onClear, onRemoveEntry } = props;
  const { t } = useTranslation();
  const todayCount = entries.filter((entry) => {
    const date = new Date(entry.at);
    const now = new Date();
    return date.toDateString() === now.toDateString();
  }).length;
  const summary = entries.length === 0
    ? t('Tester.history.nothing', { defaultValue: 'Nothing' })
    : t('Tester.history.summary', {
      defaultValue: '{{count}} run · {{todayCount}} today',
      count: entries.length,
      todayCount,
    });

  return (
    <section style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontFamily: 'var(--nimi-font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: 'var(--nimi-fg-3)',
            }}
          >
            {t('Tester.history.title', { defaultValue: 'History' })}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--nimi-fg-1)' }}>{summary}</span>
        </div>
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            style={{
              background: 'transparent',
              border: 0,
              color: 'var(--nimi-fg-2)',
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = 'rgba(148,163,184,0.14)';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent';
            }}
          >
            {t('Tester.history.clear', { defaultValue: 'Clear' })}
          </button>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <EmptyState label={capabilityLabel} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupByDay(entries, {
            today: t('Tester.history.today', { defaultValue: 'Today' }),
            yesterday: t('Tester.history.yesterday', { defaultValue: 'Yesterday' }),
          }).map((group) => (
            <React.Fragment key={group.key}>
              <div
                style={{
                  fontFamily: 'var(--nimi-font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  color: 'var(--nimi-fg-4)',
                  padding: '8px 4px 0',
                }}
              >
                {group.label}
              </div>
              {group.entries.map((entry) => (
                <TimelineCard key={entry.id} entry={entry} onRemove={() => onRemoveEntry(entry.id)} />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

function groupByDay(
  entries: TesterHistoryEntry[],
  labels: { today: string; yesterday: string },
): Array<{ key: string; label: string; entries: TesterHistoryEntry[] }> {
  const groups = new Map<string, { label: string; entries: TesterHistoryEntry[] }>();
  for (const entry of entries) {
    const date = new Date(entry.at);
    const key = date.toDateString();
    const label = formatRelativeDay(entry.at, labels);
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, { label, entries: [entry] });
    }
  }
  return Array.from(groups.entries()).map(([key, group]) => ({ key, ...group }));
}
