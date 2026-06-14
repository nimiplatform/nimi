import { useEffect, useState } from 'react';
import type { RouteModelPickerSelection } from '@nimiplatform/kit/features/model-picker';
import { ModelPickerModal, ModelSelectorTrigger } from '@nimiplatform/kit/features/model-picker/ui';
import { summarizeTargetRef } from '@nimiplatform/kit/core/model-config';
import type { ModelConfigTargetRef } from '@nimiplatform/kit/core/model-config';
import { pickerSelectionToTargetRef, targetRefToPickerSelection } from '../binding-helpers.js';
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isOpaqueRuntimeId(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);
  return /^[0-9A-HJKMNP-TV-Z]{20,32}$/u.test(normalized);
}

function localTargetCandidates(targetRef: ModelConfigTargetRef | null | undefined): string[] {
  if (!targetRef || targetRef.kind !== 'local-runtime') {
    return [];
  }
  const candidates = [
    normalizeText(targetRef.profileId),
    normalizeText(targetRef.targetId),
    normalizeText(targetRef.readinessRef),
    ...normalizeText(targetRef.readinessRef).split(':'),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function localTargetMatches(
  model: {
    localModelId?: string;
    modelId?: string;
    label?: string;
  },
  candidates: readonly string[],
): boolean {
  const modelValues = [
    normalizeText(model.localModelId),
    normalizeText(model.modelId),
    normalizeText(model.label),
  ].filter(Boolean);
  return candidates.some((candidate) => modelValues.includes(candidate));
}

export function CapabilityModelCard({ item }: CapabilityModelCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [hydratedTargetSummary, setHydratedTargetSummary] = useState<{
    label: string;
    detail: string | null;
  } | null>(null);
  const shouldShowEditor = item.editor && (
    item.showEditorWhen !== 'local'
    || item.targetRef?.kind === 'local-runtime'
  );
  const targetSummary = summarizeTargetRef(item.targetRef);
  const selection = targetRefToPickerSelection(item.targetRef);
  const displayLabel = hydratedTargetSummary?.label
    || selection.modelLabel
    || (selection.source === 'local' ? targetSummary.label : selection.model)
    || targetSummary.label
    || null;
  const source = selection.source || null;
  const unresolvedLocalTarget = item.targetRef?.kind === 'local-runtime' && !hydratedTargetSummary;
  const connectorDetail = hydratedTargetSummary?.detail
    ?? (unresolvedLocalTarget
      ? null
      : (source === 'cloud' && selection.connectorId ? selection.connectorId : targetSummary.detail));
  const statusClasses = statusToneClasses(item.status);

  useEffect(() => {
    let cancelled = false;
    setHydratedTargetSummary(null);
    if (!item.provider || !item.targetRef) {
      return () => {
        cancelled = true;
      };
    }
    if (item.targetRef.kind === 'local-runtime') {
      const candidates = localTargetCandidates(item.targetRef);
      if (candidates.length === 0) {
        return () => {
          cancelled = true;
        };
      }
      void item.provider.listLocalModels()
        .then((models) => {
          if (cancelled) return;
          const match = models.find((model) => localTargetMatches(model, candidates));
          if (!match) return;
          const label = match.label || match.modelId || match.localModelId;
          const detail = [
            match.engine,
            match.modelId && match.modelId !== label ? match.modelId : '',
          ].filter(Boolean).join(' · ');
          setHydratedTargetSummary({
            label,
            detail: detail || null,
          });
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
    return () => {
      cancelled = true;
    };
  }, [item.provider, item.targetRef]);

  const triggerLabel = item.targetRef && (unresolvedLocalTarget || isOpaqueRuntimeId(displayLabel))
    ? 'Local runtime model'
    : displayLabel;

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

      <ModelSelectorTrigger
        source={source}
        modelLabel={item.targetRef ? triggerLabel : null}
        detail={connectorDetail}
        placeholder={item.provider
          ? (item.placeholder || 'Setup required')
          : (item.runtimeNotReadyLabel || item.placeholder || 'Setup required')}
        onClick={() => {
          if (item.provider) {
            setModalOpen(true);
          }
        }}
        disabled={item.disabled || !item.provider}
      />

      {modalOpen && item.provider ? (
        <ModelPickerModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          capability={item.routeCapability}
          capabilityLabel={item.label}
          provider={item.provider}
          initialSelection={selection}
          onSelect={(pickerSelection: RouteModelPickerSelection) => {
            item.onTargetRefChange(pickerSelectionToTargetRef(pickerSelection));
          }}
        />
      ) : null}

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
