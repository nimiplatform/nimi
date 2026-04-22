import React from 'react';
import { useTranslation } from 'react-i18next';
import { TONE_PALETTE, type CapIconKind, type CapTone } from './tester-cap-meta.js';

export function CapIcon({ kind, size = 18 }: { kind: CapIconKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'chat':
      return <svg {...common}><path d="M4 5h16v10H9l-5 4V5z" /></svg>;
    case 'stream':
      return <svg {...common}><path d="M3 12h3M9 12h3M15 12h3M21 12h-.5M4 6h6M4 18h10" /></svg>;
    case 'vector':
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="2" />
          <circle cx="19" cy="6" r="2" />
          <circle cx="19" cy="18" r="2" />
          <path d="M7 11l10-4M7 13l10 4" />
        </svg>
      );
    case 'image':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="M3 17l6-5 5 4 3-2 4 3" />
        </svg>
      );
    case 'imageJob':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <rect x="7" y="7" width="14" height="14" rx="2" />
        </svg>
      );
    case 'video':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="13" height="14" rx="2" />
          <path d="M16 9l5-3v12l-5-3z" />
        </svg>
      );
    case 'world':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
        </svg>
      );
    case 'tts':
      return (
        <svg {...common}>
          <path d="M4 9v6h3l5 4V5L7 9H4z" />
          <path d="M16 8a5 5 0 010 8M19 5a9 9 0 010 14" />
        </svg>
      );
    case 'stt':
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6" />
        </svg>
      );
    case 'clone':
      return (
        <svg {...common}>
          <path d="M4 18V9l8-5 8 5v9" />
          <path d="M9 21V12h6v9" />
          <circle cx="12" cy="8" r="1" />
        </svg>
      );
    case 'design':
      return (
        <svg {...common}>
          <path d="M4 20V4M4 12h8a4 4 0 000-8H4M14 20c3 0 6-2 6-5s-3-5-6-5" />
        </svg>
      );
    default:
      return null;
  }
}

export function CapTile({ kind, tone, size = 40 }: { kind: CapIconKind; tone: CapTone; size?: number }) {
  const t = TONE_PALETTE[tone];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        background: `radial-gradient(circle at 30% 30%, ${t.glow}, ${t.soft})`,
        color: t.ink,
        border: `1px solid ${t.soft}`,
      }}
    >
      <CapIcon kind={kind} size={Math.round(size * 0.5)} />
    </div>
  );
}

export type SourceChipProps = {
  source: 'local' | 'cloud' | null;
  id?: string;
  latencyMs?: number | null;
  cost?: number | null;
};

export function SourceChip({ source, id, latencyMs, cost }: SourceChipProps) {
  const { t } = useTranslation();
  if (!source && !id) return null;
  const isLocal = source === 'local';
  const dot = isLocal ? '#10b981' : '#60A5FA';
  const label = source
    ? (isLocal
      ? t('Tester.route.local', { defaultValue: 'Local' })
      : t('Tester.route.cloud', { defaultValue: 'Cloud' }))
    : t('Tester.history.unrouted', { defaultValue: 'Unrouted' });
  const fmtLatency =
    typeof latencyMs === 'number' && latencyMs > 0
      ? latencyMs >= 1000
        ? `${(latencyMs / 1000).toFixed(1)}s`
        : `${latencyMs}ms`
      : null;
  const fmtCost =
    typeof cost === 'number'
      ? cost === 0
        ? 'Free'
        : `$${cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2)}`
      : null;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px 6px 10px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.72)',
        border: '1px solid var(--nimi-border-subtle)',
        fontSize: 12,
        color: 'var(--nimi-fg-2)',
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ position: 'relative', width: 8, height: 8 }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: dot }} />
          {source ? (
            <span
              style={{
                position: 'absolute',
                inset: -3,
                borderRadius: 999,
                background: dot,
                opacity: 0.25,
                animation: 'tester-pulse-ring 2.4s ease-out infinite',
              }}
            />
          ) : null}
        </span>
        <span
          style={{
            fontWeight: 600,
            color: 'var(--nimi-fg-1)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: 10,
          }}
        >
          {label}
        </span>
      </span>
      {id ? (
        <>
          <span style={{ width: 1, height: 12, background: 'var(--nimi-border-subtle)' }} />
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              color: 'var(--nimi-fg-1)',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={id}
          >
            {id}
          </span>
        </>
      ) : null}
      {fmtLatency ? (
        <>
          <span style={{ width: 1, height: 12, background: 'var(--nimi-border-subtle)' }} />
          <span
            className="font-mono"
            style={{ fontSize: 11, color: 'var(--nimi-fg-2)' }}
            title={t('Tester.history.lastLatency', { defaultValue: 'Last latency' })}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ verticalAlign: -1, marginRight: 3 }}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {fmtLatency}
          </span>
        </>
      ) : null}
      {fmtCost ? (
        <>
          <span style={{ width: 1, height: 12, background: 'var(--nimi-border-subtle)' }} />
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              color: cost === 0 ? '#10b981' : 'var(--nimi-fg-2)',
              fontWeight: cost === 0 ? 600 : 500,
            }}
          >
            {fmtCost === 'Free'
              ? t('Tester.history.free', { defaultValue: 'Free' })
              : fmtCost}
          </span>
        </>
      ) : null}
    </div>
  );
}
