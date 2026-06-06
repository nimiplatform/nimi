import { summarizeTargetRef } from '@nimiplatform/kit/core/model-config';
import type { CapabilityModelCardProps, ModelConfigCapabilityStatus } from '../types.js';

function statusToneClasses(status: ModelConfigCapabilityStatus | null | undefined): {
  dot: string;
  badge: string;
  title: string;
} {
  if (status?.supported) {
    return {
      dot: 'bg-emerald-400',
      badge: 'bg-emerald-50 text-emerald-700',
      title: 'text-emerald-700',
    };
  }
  if (status?.tone === 'attention') {
    return {
      dot: 'bg-amber-400',
      badge: 'bg-amber-50 text-amber-700',
      title: 'text-amber-700',
    };
  }
  return {
    dot: 'bg-slate-300',
    badge: 'bg-slate-100 text-slate-600',
    title: 'text-slate-600',
  };
}

export function CapabilityModelCard({ item }: CapabilityModelCardProps) {
  const shouldShowEditor = item.editor && (
    item.showEditorWhen !== 'local'
    || item.targetRef?.kind === 'local-runtime'
  );
  const targetSummary = summarizeTargetRef(item.targetRef);
  const statusClasses = statusToneClasses(item.status);

  const headerLabel = item.activeModelLabel;
  const labelNode = headerLabel ? (
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted,#94a3b8)]">
      {headerLabel}
    </span>
  ) : item.detail ? (
    <span
      className="text-xs font-semibold text-[var(--nimi-text-secondary,#475569)]"
      title={item.detail}
      aria-label={`${item.label}: ${item.detail}`}
    >
      {item.label}
    </span>
  ) : (
    <span className="text-xs font-semibold text-[var(--nimi-text-secondary,#475569)]">{item.label}</span>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {labelNode}
        {!headerLabel && item.status ? (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClasses.dot}`} />
        ) : null}
        {!headerLabel && item.status?.badgeLabel ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasses.badge}`}>
            {item.status.badgeLabel}
          </span>
        ) : null}
      </div>

      <div className="rounded-[8px] border border-[var(--nimi-border,#e2e8f0)] bg-[var(--nimi-surface-muted,#f8fafc)] px-3 py-2">
        <div className="truncate text-[12px] font-medium text-[var(--nimi-text-primary,#0f172a)]">
          {targetSummary.label || item.placeholder || 'Setup required'}
        </div>
        {targetSummary.detail ? (
          <div className="mt-0.5 truncate text-[11px] text-[var(--nimi-text-muted,#94a3b8)]">
            {targetSummary.detail}
          </div>
        ) : null}
      </div>

      {item.status?.title || item.status?.detail ? (
        <div className="space-y-0.5">
          {item.status?.title ? (
            <div className={`text-[11px] font-medium ${statusClasses.title}`}>
              {item.status.title}
            </div>
          ) : null}
          {item.status?.detail ? (
            <div className="text-[11px] text-[var(--nimi-text-muted,#94a3b8)]">
              {item.status.detail}
            </div>
          ) : null}
        </div>
      ) : null}

      {item.showClearButton && item.targetRef ? (
        <button
          type="button"
          onClick={() => item.onTargetRefChange(null)}
          className="text-xs text-[var(--nimi-text-muted,#94a3b8)] transition-colors hover:text-[var(--nimi-action-primary-bg,#10b981)]"
        >
          {item.clearSelectionLabel || 'Clear selection'}
        </button>
      ) : null}

      {shouldShowEditor ? item.editor : null}
    </div>
  );
}
