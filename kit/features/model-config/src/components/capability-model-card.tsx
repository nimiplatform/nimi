import { useEffect, useState } from 'react';
import type { RouteModelPickerSelection } from '@nimiplatform/kit/features/model-picker';
import { ModelPickerModal, ModelSelectorTrigger } from '@nimiplatform/kit/features/model-picker/ui';
import { summarizeTargetRef } from '@nimiplatform/kit/core/model-config';
import type { ModelConfigTargetRef } from '@nimiplatform/kit/core/model-config';
import { pickerSelectionToTargetRef, targetRefToPickerSelection } from '../model-picker-selection-adapter.js';
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

function containsOpaqueRuntimeId(value: string | null | undefined): boolean {
  return normalizeText(value).split(/[:/\s]+/u).some((part) => isOpaqueRuntimeId(part));
}

function splitModelPath(value: string | null | undefined): string[] {
  return normalizeText(value).split('/').map((part) => part.trim()).filter(Boolean);
}

function compactLocalModelLabel(value: string | null | undefined): string | null {
  const parts = splitModelPath(value);
  if (parts.length === 0) return null;
  if (parts[0] === 'local' && parts[1] === 'local-import') {
    return parts.slice(2).join('/') || null;
  }
  if (parts[0] === 'local-import' || parts[0] === 'local' || parts[0] === 'cloud') {
    return parts.slice(1).join('/') || null;
  }
  return normalizeText(value) || null;
}

function localSourceLabel(value: string | null | undefined): string | null {
  const parts = splitModelPath(value);
  if (parts[0] === 'local' && parts[1] === 'local-import') return 'local-import';
  if (parts[0] === 'local-import') return 'local-import';
  if (parts[0] === 'local') return 'local';
  return null;
}

function localTargetSourceLabel(targetRef: ModelConfigTargetRef | null | undefined): string | null {
  if (!targetRef || targetRef.kind !== 'local-runtime') return null;
  return localSourceLabel(targetRef.profileBindingId)
    ?? localSourceLabel(targetRef.readinessRef);
}

function localRuntimeRefCandidates(value: unknown): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  const candidates = [
    normalized,
    ...normalized.split(':').map((part) => part.trim()).filter(Boolean),
  ];
  const prefix = 'local-runtime:';
  if (normalized.toLowerCase().startsWith(prefix)) {
    const localAssetId = normalized.slice(prefix.length).trim();
    if (localAssetId) {
      candidates.push(localAssetId);
    }
  }
  return candidates;
}

function localTargetCandidates(targetRef: ModelConfigTargetRef | null | undefined): string[] {
  if (!targetRef || targetRef.kind !== 'local-runtime') {
    return [];
  }
  const candidates = [
    ...localRuntimeRefCandidates(targetRef.profileBindingId),
    ...localRuntimeRefCandidates(targetRef.readinessRef),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function localTargetMatches(
  model: {
    localModelId?: string;
    goRuntimeLocalModelId?: string;
    profileBindingId?: string;
    readinessRef?: string;
    modelId?: string;
    label?: string;
  },
  candidates: readonly string[],
): boolean {
  const modelValues = [
    normalizeText(model.localModelId),
    normalizeText(model.goRuntimeLocalModelId),
    normalizeText(model.profileBindingId),
    normalizeText(model.readinessRef),
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
    sourceLabel?: string | null;
  } | null>(null);
  const shouldShowEditor = item.editor && (
    item.showEditorWhen !== 'local'
    || item.targetRef?.kind === 'local-runtime'
  );
  const targetSummary = summarizeTargetRef(item.targetRef);
  const selection = targetRefToPickerSelection(item.targetRef);
  const displayLabel = hydratedTargetSummary?.label
    || selection.modelLabel
    || selection.model
    || targetSummary.label
    || null;
  const source = selection.source || null;
  const unresolvedLocalTarget = item.targetRef?.kind === 'local-runtime' && !hydratedTargetSummary;
  const unresolvedOpaqueLocalTarget = unresolvedLocalTarget && containsOpaqueRuntimeId(displayLabel);
  const localDetail = source === 'local'
    ? (hydratedTargetSummary?.sourceLabel
      ?? localSourceLabel(displayLabel)
      ?? localTargetSourceLabel(item.targetRef)
      ?? null)
    : null;
  const activeModelDetail = item.activeModelLabel ? localDetail : null;
  const activeModelSetupPending = Boolean(activeModelDetail && item.status && !item.status.supported);
  const activeModelDetailStatus = activeModelDetail
    ? (item.status?.supported
      ? (item.activeModelConfiguredLabel || 'configured')
      : activeModelSetupPending
        ? (item.activeModelSetupPendingLabel || 'setup pending')
        : null)
    : null;
  const connectorDetail = hydratedTargetSummary?.detail
    ?? (unresolvedLocalTarget
      ? null
      : (source === 'cloud' && selection.connectorId ? selection.connectorId : targetSummary.detail));
  const visibleDetail = item.activeModelLabel ? activeModelDetail : connectorDetail;
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
          const rawLabel = match.label || match.modelId || match.localModelId || '';
          const label = compactLocalModelLabel(rawLabel) || rawLabel;
          const sourceLabel = localSourceLabel(match.modelId)
            ?? localSourceLabel(match.localModelId)
            ?? localSourceLabel(match.label);
          const detail = [
            match.engine,
            match.modelId && match.modelId !== label ? match.modelId : '',
          ].filter(Boolean).join(' · ');
          setHydratedTargetSummary({
            label,
            detail: detail || null,
            sourceLabel,
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

  const triggerLabel = item.targetRef && (unresolvedOpaqueLocalTarget || containsOpaqueRuntimeId(displayLabel))
    ? 'Local runtime model'
    : (source === 'local' ? compactLocalModelLabel(displayLabel) ?? displayLabel : displayLabel);

  const headerLabel = item.activeModelLabel;
  const labelNode = headerLabel ? (
    <span className="min-w-0 truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted,#94a3b8)]">
      {headerLabel}
    </span>
  ) : item.detail ? (
    <span
      className="min-w-0 truncate text-xs font-semibold text-[var(--nimi-text-secondary,#475569)]"
      title={item.detail}
      aria-label={`${item.label}: ${item.detail}`}
    >
      {item.label}
    </span>
  ) : (
    <span className="min-w-0 truncate text-xs font-semibold text-[var(--nimi-text-secondary,#475569)]">{item.label}</span>
  );

  return (
    <div
      className="min-w-0 max-w-full space-y-2 overflow-hidden"
      data-nimi-model-config-capability={item.capabilityId}
      data-nimi-model-config-route-capability={item.routeCapability}
    >
      <div className={headerLabel ? 'grid min-w-0 gap-0.5' : 'flex min-w-0 items-center gap-2'}>
        {labelNode}
        {headerLabel && item.activeModelHint ? (
          <span className="min-w-0 truncate text-[11px] font-medium text-[var(--nimi-text-muted,#94a3b8)]">
            {item.activeModelHint}
          </span>
        ) : null}
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
        detail={visibleDetail}
        detailStatus={item.activeModelLabel ? activeModelDetailStatus : null}
        detailTone={item.activeModelLabel && activeModelDetailStatus
          ? (activeModelSetupPending ? 'warning' : 'success')
          : 'neutral'}
        hoverBorderTone={item.activeModelLabel ? 'success' : 'neutral'}
        placeholder={item.provider
          ? (item.placeholder || 'Setup required')
          : (item.runtimeNotReadyLabel || item.placeholder || 'Setup required')}
        className="min-w-0 max-w-full overflow-hidden"
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
        <div className="min-w-0 space-y-0.5">
          {item.status?.title ? (
            <div className={`min-w-0 break-words text-[11px] font-medium ${statusClasses.title}`}>
              {item.status.title}
            </div>
          ) : null}
          {item.status?.detail ? (
            <div className="min-w-0 break-words text-[11px] text-[var(--nimi-text-muted,#94a3b8)]">
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
