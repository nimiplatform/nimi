import { useEffect, useState, type ReactNode } from 'react';
import type { WorldAgent, WorldDetailData } from './world-detail-types.js';

export const statusGlowStyles = `
  @keyframes pulse-glow {
    0%, 100% { opacity: 0.45; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.04); }
  }

  @keyframes float-card {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
  }
`;

export const BENTO_SPAN_CLASS: Record<4 | 6 | 8 | 12, string> = {
  4: 'col-span-12 md:col-span-6 xl:col-span-4',
  6: 'col-span-12 xl:col-span-6',
  8: 'col-span-12 xl:col-span-8',
  12: 'col-span-12',
};

export const MAIN_ROW_SPAN_CLASS: Record<3 | 4 | 6 | 8, string> = {
  3: 'col-span-12 md:col-span-6 xl:col-span-3',
  4: 'col-span-12 md:col-span-6 xl:col-span-4',
  6: 'col-span-12 xl:col-span-6',
  8: 'col-span-12 xl:col-span-8',
};

export type XianxiaWorldData = WorldDetailData;

export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);

  return prefersReducedMotion;
}

export function displayValue(value: unknown, fallback = 'N/A') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isNaN(value)) return fallback;
  return String(value);
}

export function formatSemanticValue(value: string, t: (key: string) => string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes') return t('WorldDetail.xianxia.v2.common.yes');
  if (normalized === 'false' || normalized === 'no') return t('WorldDetail.xianxia.v2.common.no');
  return value;
}

export function joinParts(parts: Array<string | null | undefined>): string | null {
  const values = parts.map((part) => (typeof part === 'string' ? part.trim() : '')).filter(Boolean);
  return values.length ? values.join(' · ') : null;
}

export function resolveChronologyValue(world: Pick<WorldDetailData, 'currentTimeLabel' | 'eraLabel' | 'currentWorldTime'>): string | null {
  return world.currentTimeLabel || joinParts([world.eraLabel, world.currentWorldTime]);
}

export function formatDateTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatEnum(value?: string | null): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function formatFreezeReason(value?: string | null, t?: TranslateFn): string | null {
  switch (value) {
    case 'QUOTA_OVERFLOW':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.freezeReason.quotaOverflow') : 'QUOTA_OVERFLOW';
    case 'WORLD_INACTIVE':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.freezeReason.worldInactive') : 'WORLD_INACTIVE';
    case 'GOVERNANCE_LOCK':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.freezeReason.governanceLock') : 'GOVERNANCE_LOCK';
    default:
      return formatEnum(value);
  }
}

export function formatCreationState(value?: string | null, t?: TranslateFn): string | null {
  switch (value) {
    case 'OPEN':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.creationState.open') : 'OPEN';
    case 'NATIVE_CREATION_FROZEN':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.creationState.nativeCreationFrozen') : 'NATIVE_CREATION_FROZEN';
    default:
      return formatEnum(value);
  }
}

export function formatStatus(value: WorldDetailData['status'], t?: TranslateFn): string {
  switch (value) {
    case 'ACTIVE':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.status.active') : 'ACTIVE';
    case 'DRAFT':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.status.draft') : 'DRAFT';
    case 'PENDING_REVIEW':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.status.pendingReview') : 'PENDING_REVIEW';
    case 'SUSPENDED':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.status.suspended') : 'SUSPENDED';
    case 'ARCHIVED':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.status.archived') : 'ARCHIVED';
    default:
      return value;
  }
}

export function formatAuditEventType(eventType?: string | null, t?: TranslateFn): string | null {
  switch (eventType) {
    case 'LEVEL_UP':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.audit.levelUp') : 'LEVEL_UP';
    case 'LEVEL_DOWN':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.audit.levelDown') : 'LEVEL_DOWN';
    case 'NATIVE_CREATION_FROZEN':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.audit.nativeCreationFrozen') : 'NATIVE_CREATION_FROZEN';
    case 'NATIVE_CREATION_UNFROZEN':
      return t ? t('WorldDetail.xianxia.v2.systemLabels.audit.nativeCreationUnfrozen') : 'NATIVE_CREATION_UNFROZEN';
    default:
      return formatEnum(eventType);
  }
}

export function buildVisibleAgentGroups(agents: WorldAgent[], limit: number, expanded: boolean) {
  const order: Array<WorldAgent['importance']> = ['PRIMARY', 'SECONDARY', 'BACKGROUND'];
  const grouped = order.map((importance) => ({
    importance,
    items: agents
      .filter((agent) => agent.importance === importance)
      .sort((left, right) => {
        const vitalityDelta = (right.stats?.vitalityScore ?? 0) - (left.stats?.vitalityScore ?? 0);
        if (vitalityDelta !== 0) return vitalityDelta;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }),
  })).filter((group) => group.items.length > 0);

  if (expanded) {
    return grouped;
  }

  let remaining = limit;
  return grouped.reduce<typeof grouped>((acc, group) => {
    if (remaining <= 0) return acc;
    const visible = group.items.slice(0, remaining);
    remaining -= visible.length;
    if (visible.length > 0) {
      acc.push({ ...group, items: visible });
    }
    return acc;
  }, []);
}

export function SectionShell({
  title,
  subtitle,
  children,
  className = '',
  dataTestId,
}: {
  title: string;
  subtitle?: string | null;
  children: ReactNode;
  className?: string;
  dataTestId?: string;
}) {
  return (
    <section
      data-testid={dataTestId}
      className={`relative overflow-hidden rounded-[22px] border border-[#4ECCA3]/14 bg-[#0f1612]/86 shadow-[0_0_0_1px_rgba(78,204,163,0.05),0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-sm ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background: 'radial-gradient(circle at top right, rgba(78,204,163,0.08), transparent 38%), linear-gradient(180deg, rgba(255,255,255,0.035) 0%, transparent 26%)',
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/55 to-transparent" />
      <div className="relative px-5 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-[0.08em] text-[#4ECCA3]">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs leading-relaxed text-[#d8efe4]/42">{subtitle}</p> : null}
          </div>
        </div>
      </div>
      <div className="relative px-5 pb-5 pt-4">{children}</div>
    </section>
  );
}

export function HeroTag({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] px-3 py-1 text-xs font-medium text-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm">
      {label}
    </span>
  );
}

export function MetricPill({
  label,
  value,
  className = '',
  valueClassName = '',
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <span className={`inline-flex max-w-full items-center gap-2 rounded-full border border-[#4ECCA3]/16 bg-[linear-gradient(180deg,rgba(78,204,163,0.16),rgba(78,204,163,0.08))] px-3 py-1.5 text-[11px] text-[#86f0ca] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm ${className}`}>
      <span className="text-[10px] uppercase tracking-[0.12em] text-[#c5f7e6]/46">{label}</span>
      <span className={`font-semibold text-[#f4fff9] ${valueClassName}`}>{value}</span>
    </span>
  );
}

export function DataFactCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(10,15,12,0.58))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#86f0ca]/68">{label}</div>
      <div className="mt-2 text-sm leading-relaxed text-[#effff8]/96">{value}</div>
    </div>
  );
}
