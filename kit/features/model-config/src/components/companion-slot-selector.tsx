import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchField, cn } from '@nimiplatform/kit/ui';
import { ModelSelectorTrigger } from '@nimiplatform/kit/features/model-picker/ui';
import type {
  ModelConfigLocalAssetDescriptor,
  ModelConfigTargetRef,
} from '@nimiplatform/kit/core/model-config';
import type { NimiAIConfigComponentSelection } from '@nimiplatform/kit/core/sdk-contract';
import { FieldRow } from './field-primitives.js';
import { filterAssetsForCompanionSlot } from '../constants.js';

export type CompanionSlotPublicStructure = Pick<
  NimiAIConfigComponentSelection,
  'occurrenceId' | 'order' | 'role' | 'componentKind' | 'required' | 'weight' | 'options'
>;

export type CompanionSlotSelectorCopy = Partial<{
  dialogTitle: string;
  searchPlaceholder: string;
  loadingLabel: string;
  emptyLabel: string;
  selectedLabel: string;
  currentUnavailableLabel: string;
  requiredLabel: string;
}>;

export type CompanionSlotSelectorProps = {
  slot: CompanionSlotPublicStructure;
  value: NimiAIConfigComponentSelection;
  candidates: readonly ModelConfigLocalAssetDescriptor[];
  onChange: (selection: NimiAIConfigComponentSelection) => void;
  loading?: boolean;
  copy?: CompanionSlotSelectorCopy;
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function publicAssetLabel(asset: ModelConfigLocalAssetDescriptor): string {
  return asset.displayName?.trim() || asset.logicalModelId?.trim() || '';
}

function isConfigAdmissible(asset: ModelConfigLocalAssetDescriptor): boolean {
  const status = normalize(asset.durableTargetStatus || asset.status);
  return status === 'active' || status === 'installed';
}

function supportsSlot(
  asset: ModelConfigLocalAssetDescriptor,
  slot: CompanionSlotPublicStructure,
): boolean {
  const componentKind = normalize(slot.componentKind);
  const role = normalize(slot.role);
  if (!componentKind) return false;
  return filterAssetsForCompanionSlot([asset], { kind: componentKind, role }).length > 0;
}

function targetRefsEqual(
  left: ModelConfigTargetRef | undefined,
  right: ModelConfigTargetRef | undefined,
): boolean {
  if (!left || !right || left.kind !== right.kind) return !left && !right;
  if (left.kind === 'local-runtime' && right.kind === 'local-runtime') {
    return left.version === right.version
      && left.profileBindingId === right.profileBindingId
      && left.readinessRef === right.readinessRef;
  }
  if (left.kind === 'cloud-connector' && right.kind === 'cloud-connector') {
    return left.connectorId === right.connectorId
      && left.remoteModelCatalogId === right.remoteModelCatalogId
      && left.providerModelId === right.providerModelId
      && left.provider === right.provider;
  }
  if (left.kind === 'profile-slice' && right.kind === 'profile-slice') {
    return left.sourceProfileId === right.sourceProfileId && left.sliceId === right.sliceId;
  }
  return false;
}

function assetMatchesSelection(
  asset: ModelConfigLocalAssetDescriptor,
  selection: NimiAIConfigComponentSelection,
): boolean {
  const logicalModelMatches = normalize(asset.logicalModelId) === normalize(selection.logicalModelId);
  if (!logicalModelMatches) return false;
  if (selection.targetRef) {
    return targetRefsEqual(asset.durableTargetRef, selection.targetRef);
  }
  return true;
}

export function CompanionSlotSelector(props: CompanionSlotSelectorProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const copy = props.copy || {};
  const candidates = useMemo(
    () => props.candidates.filter((asset) => supportsSlot(asset, props.slot) && publicAssetLabel(asset)),
    [props.candidates, props.slot],
  );
  const selectedAsset = useMemo(
    () => candidates.find((asset) => assetMatchesSelection(asset, props.value)) ?? null,
    [candidates, props.value],
  );
  const currentUnavailable = !props.loading && (!selectedAsset || !isConfigAdmissible(selectedAsset));
  const currentLabel = selectedAsset
    ? publicAssetLabel(selectedAsset)
    : props.value.logicalModelId;
  const filteredCandidates = useMemo(() => {
    const query = normalize(search);
    if (!query) return candidates;
    return candidates.filter((asset) => normalize(publicAssetLabel(asset)).includes(query));
  }, [candidates, search]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    setSearch('');
    const timer = setTimeout(() => searchRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen]);

  const selectCandidate = (asset: ModelConfigLocalAssetDescriptor) => {
    if (!isConfigAdmissible(asset) || !asset.durableTargetRef || !asset.logicalModelId?.trim()) return;
    props.onChange({
      ...props.value,
      logicalModelId: asset.logicalModelId.trim(),
      targetRef: asset.durableTargetRef,
    });
    setModalOpen(false);
  };

  const slotLabel = [props.slot.role, props.slot.componentKind].filter(Boolean).join(' · ');
  const dialogId = `companion-slot-picker-${props.slot.occurrenceId}`;
  const modal = modalOpen ? (
    <div
      className="fixed inset-0 z-[var(--nimi-z-dialog)] grid place-items-center bg-[var(--nimi-overlay-backdrop)] px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setModalOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogId}
        className="nimi-overlay-panel nimi-overlay-panel--dialog flex max-h-[520px] w-full max-w-[480px] flex-col overflow-hidden rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-modal)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[var(--nimi-border-subtle)] px-5 pb-4 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id={dialogId} className="text-base font-semibold text-[var(--nimi-text-primary)]">
              {copy.dialogTitle || 'Select component model'}
            </h2>
            <span className="rounded-[var(--nimi-radius-full)] bg-[var(--nimi-surface-muted)] px-2.5 py-0.5 text-xs font-medium text-[var(--nimi-text-muted)]">
              {slotLabel}
            </span>
          </div>
        </div>

        <div className="shrink-0 border-b border-[var(--nimi-border-subtle)] px-5 py-3">
          <SearchField
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.searchPlaceholder || 'Search component models'}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {!selectedAsset ? (
            <button
              type="button"
              disabled
              className="flex w-full cursor-not-allowed items-center gap-3 px-5 py-2.5 text-left opacity-60"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                {props.value.logicalModelId}
              </span>
              <span className="shrink-0 text-xs text-[var(--nimi-status-warning)]">
                {copy.currentUnavailableLabel || 'Currently unavailable'}
              </span>
            </button>
          ) : null}
          {props.loading ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--nimi-text-muted)]">
              {copy.loadingLabel || 'Loading component models...'}
            </p>
          ) : filteredCandidates.length > 0 ? filteredCandidates.map((asset) => {
            const selected = assetMatchesSelection(asset, props.value);
            const selectable = isConfigAdmissible(asset) && Boolean(asset.durableTargetRef) && Boolean(asset.logicalModelId?.trim());
            return (
              <button
                key={`${asset.logicalModelId || ''}:${publicAssetLabel(asset)}`}
                type="button"
                disabled={!selectable}
                onClick={() => selectCandidate(asset)}
                className={cn(
                  'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors',
                  !selectable && 'cursor-not-allowed opacity-60',
                  selected ? 'bg-[var(--nimi-status-success-soft)] text-[var(--nimi-status-success)]' : 'text-[var(--nimi-text-primary)]',
                  selectable && !selected && 'hover:bg-[var(--nimi-action-ghost-hover)]',
                )}
              >
                <span className={cn('min-w-0 flex-1 truncate text-sm', selected ? 'font-semibold' : 'font-medium')}>
                  {publicAssetLabel(asset)}
                </span>
                {selected && !selectable ? (
                  <span className="shrink-0 text-xs text-[var(--nimi-status-warning)]">
                    {copy.currentUnavailableLabel || 'Currently unavailable'}
                  </span>
                ) : selected ? (
                  <span className="shrink-0 text-xs text-[var(--nimi-status-success)]">
                    {copy.selectedLabel || 'Selected'}
                  </span>
                ) : !selectable ? (
                  <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">
                    {copy.currentUnavailableLabel || 'Currently unavailable'}
                  </span>
                ) : null}
              </button>
            );
          }) : (
            <p className="px-5 py-8 text-center text-sm text-[var(--nimi-text-muted)]">
              {copy.emptyLabel || 'No compatible component models available.'}
            </p>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      data-nimi-model-config-component-slot={props.slot.occurrenceId}
      data-nimi-model-config-component-kind={props.slot.componentKind}
    >
      <FieldRow label={slotLabel} requirementLabel={props.slot.required ? (copy.requiredLabel || 'Required') : undefined}>
        <ModelSelectorTrigger
          source={selectedAsset ? 'local' : null}
          modelLabel={currentLabel}
          detail={currentUnavailable ? (copy.currentUnavailableLabel || 'Currently unavailable') : null}
          detailStatus={currentUnavailable ? (copy.currentUnavailableLabel || 'Currently unavailable') : null}
          detailTone={currentUnavailable ? 'warning' : 'neutral'}
          placeholder={props.value.logicalModelId}
          onClick={() => setModalOpen(true)}
        />
        {modal ? (typeof document === 'undefined' ? modal : createPortal(modal, document.body)) : null}
      </FieldRow>
    </div>
  );
}
