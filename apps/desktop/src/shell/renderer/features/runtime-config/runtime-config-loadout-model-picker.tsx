// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { Button, OverlayShell, ScrollArea, SearchField, StatusBadge } from '@nimiplatform/kit/ui';
import { formatBytes } from '../../components/download-format.js';
import {
  groupLoadoutModelPresentations,
  loadoutAssetLabel,
  loadoutCandidatePresentation,
  loadoutModelPresentation,
  loadoutSlotLabelKey,
  loadoutSlotOfferForAsset,
  partitionLoadoutSlotOffers,
  partitionSlotCandidateAssets,
  type LoadoutModelPresentation,
  type NimiLoadoutRecipeSlot,
  type NimiLoadoutRecipeSlotOffer,
} from './runtime-config-loadout-model-display.js';

export type LoadoutSlotOfferActionMode = 'install-or-inspect' | 'queue-offer' | 'select-verified-hash';

function useSlotDisplayLabel(slot: Pick<NimiLoadoutRecipeSlot, 'slotId' | 'displayLabel'>): string {
  const { t } = useTranslation();
  const key = loadoutSlotLabelKey(slot.slotId);
  return key ? t(key, { defaultValue: slot.displayLabel }) : slot.displayLabel;
}

function assetPresentation(
  slot: NimiLoadoutRecipeSlot,
  asset: NimiRuntimeModelAssetRecord,
  verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): { readonly presentation: LoadoutModelPresentation; readonly totalSizeBytes: number } {
  const offer = loadoutSlotOfferForAsset(slot, asset.modelAssetId);
  if (offer) {
    return {
      presentation: loadoutCandidatePresentation(offer.candidate),
      totalSizeBytes: asset.totalSizeBytes || offer.candidate.totalSizeBytes || 0,
    };
  }
  return {
    presentation: loadoutModelPresentation({
      title: loadoutAssetLabel(asset, verifiedAssets),
      variantLabel: asset.entry,
    }),
    totalSizeBytes: asset.totalSizeBytes,
  };
}

function presentationDetail(presentation: LoadoutModelPresentation, totalSizeBytes: number, unknownSize: string): string {
  return [
    presentation.quant.technical,
    presentation.rawBase && presentation.rawBase !== presentation.headline ? presentation.rawBase : '',
    totalSizeBytes > 0 ? formatBytes(totalSizeBytes) : unknownSize,
  ].filter(Boolean).join(' · ');
}

export function LoadoutSelectedModelCard(props: {
  readonly slot: NimiLoadoutRecipeSlot;
  readonly asset: NimiRuntimeModelAssetRecord | null;
  readonly queuedOffer?: NimiLoadoutRecipeSlotOffer | null;
  readonly notUsed?: boolean;
  readonly disabled?: boolean;
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly onOpenPicker: () => void;
}) {
  const { t } = useTranslation();
  const { slot, asset, queuedOffer, notUsed } = props;
  if (notUsed) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-4 py-3"
        data-testid={`loadout-model-card:${slot.slotId}`}
        data-state="not-used"
      >
        <span className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.customization.notUsed')}</span>
        <Button size="sm" tone="secondary" disabled={props.disabled} onClick={props.onOpenPicker}>
          {t('runtimeConfig.loadouts.picker.choose')}
        </Button>
      </div>
    );
  }
  if (queuedOffer) {
    const installed = Boolean(queuedOffer.installedModelAssetId);
    const presentation = loadoutCandidatePresentation(queuedOffer.candidate);
    const downloadSize = queuedOffer.candidate.downloadSizeBytes;
    const transferSize = typeof downloadSize === 'number' && downloadSize > 0
      ? t('runtimeConfig.product.downloadSize', { size: formatBytes(downloadSize) })
      : t('runtimeConfig.loadouts.downloadSizeUnknown');
    const detail = [
      presentation.quant.technical,
      presentation.rawBase && presentation.rawBase !== presentation.headline ? presentation.rawBase : '',
      installed ? '' : transferSize,
    ].filter(Boolean).join(' · ');
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3"
        data-testid={`loadout-model-card:${slot.slotId}`}
        data-state={installed ? 'selected' : 'queued-offer'}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--nimi-text-primary)]" title={presentation.headline}>{presentation.headline}</span>
            <StatusBadge tone={installed ? 'success' : 'info'} shape="soft">
              {t(installed ? 'runtimeConfig.loadouts.installed' : 'runtimeConfig.loadouts.picker.queuedForDownload')}
            </StatusBadge>
          </div>
          <p className="mt-1 break-all text-xs text-[var(--nimi-text-muted)]" title={detail}>{detail}</p>
        </div>
        <Button size="sm" tone="secondary" className="shrink-0" disabled={props.disabled} onClick={props.onOpenPicker}>
          {t('runtimeConfig.loadouts.picker.change')}
        </Button>
      </div>
    );
  }
  if (!asset) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-4 py-3"
        data-testid={`loadout-model-card:${slot.slotId}`}
        data-state="empty"
      >
        <span className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.unresolved')}</span>
        <Button size="sm" tone="secondary" disabled={props.disabled} onClick={props.onOpenPicker}>
          {t('runtimeConfig.loadouts.picker.choose')}
        </Button>
      </div>
    );
  }
  const { presentation, totalSizeBytes } = assetPresentation(slot, asset, props.verifiedAssets);
  const detail = presentationDetail(presentation, totalSizeBytes, t('runtimeConfig.loadouts.downloadSizeUnknown'));
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3"
      data-testid={`loadout-model-card:${slot.slotId}`}
      data-state="selected"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--nimi-text-primary)]" title={presentation.headline}>{presentation.headline}</span>
          <StatusBadge tone="success" shape="soft">{t('runtimeConfig.loadouts.installed')}</StatusBadge>
        </div>
        <p className="mt-1 break-all text-xs text-[var(--nimi-text-muted)]" title={detail}>{detail}</p>
      </div>
      <Button size="sm" tone="secondary" className="shrink-0" disabled={props.disabled} onClick={props.onOpenPicker}>
        {t('runtimeConfig.loadouts.picker.change')}
      </Button>
    </div>
  );
}

export function LoadoutSlotModelPickerBody(props: {
  readonly slot: NimiLoadoutRecipeSlot;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly selectedAssetId: string;
  readonly selectedOfferRef?: string;
  readonly allowClear?: boolean;
  readonly clearLabel?: string;
  readonly offerActionMode?: LoadoutSlotOfferActionMode;
  readonly offerDisabledReason?: (offer: NimiLoadoutRecipeSlotOffer) => string | null;
  readonly onSelectAsset: (modelAssetId: string) => void;
  readonly onSelectOffer?: (offer: NimiLoadoutRecipeSlotOffer) => void;
  readonly onInspectOffer?: (offer: NimiLoadoutRecipeSlotOffer) => void;
  readonly maxHeightClassName?: string;
}) {
  const { t } = useTranslation();
  const [showIncompatible, setShowIncompatible] = useState(false);
  const [showOtherFiles, setShowOtherFiles] = useState(false);
  const [query, setQuery] = useState('');
  const { slot } = props;
  const offerMode: LoadoutSlotOfferActionMode = props.offerActionMode ?? 'install-or-inspect';
  const allowClear = props.allowClear ?? true;
  const search = query.trim().toLocaleLowerCase();

  const matchesSearch = (asset: NimiRuntimeModelAssetRecord) => !search
    || `${loadoutAssetLabel(asset, props.verifiedAssets)} ${asset.entry}`.toLocaleLowerCase().includes(search);

  const partition = partitionSlotCandidateAssets(slot, props.assets, props.selectedAssetId);
  const recommendedAssets = partition.recommended.filter(matchesSearch);
  const formatMatchedAssets = partition.formatMatched.filter(matchesSearch);
  const otherAssets = partition.other.filter(matchesSearch);
  const otherCount = partition.other.length;

  const { installable, incompatible } = partitionLoadoutSlotOffers(slot.offers);
  const installableGroups = groupLoadoutModelPresentations(
    installable.filter((offer) => !search || `${offer.candidate.title} ${offer.candidate.variantLabel}`.toLocaleLowerCase().includes(search)),
    (offer) => loadoutCandidatePresentation(offer.candidate),
  );
  const unknownSize = t('runtimeConfig.loadouts.downloadSizeUnknown');

  const renderAssetButton = (asset: NimiRuntimeModelAssetRecord) => {
    const { presentation, totalSizeBytes } = assetPresentation(slot, asset, props.verifiedAssets);
    const selected = !props.selectedOfferRef && props.selectedAssetId === asset.modelAssetId;
    const detail = presentationDetail(presentation, totalSizeBytes, unknownSize);
    return (
      <button
        key={asset.modelAssetId}
        type="button"
        data-testid={`loadout-model-picker:installed:${asset.modelAssetId}`}
        data-selected={selected}
        onClick={() => props.onSelectAsset(asset.modelAssetId)}
        className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition hover:bg-[var(--nimi-action-ghost-hover)] ${selected ? 'border-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)]'}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-[var(--nimi-text-primary)]" title={presentation.headline}>{presentation.headline}</span>
          <span className="mt-1 block break-all text-xs text-[var(--nimi-text-muted)]" title={detail}>{detail}</span>
        </span>
        {selected ? <StatusBadge tone="info" shape="soft" className="shrink-0">{t('runtimeConfig.loadouts.picker.current')}</StatusBadge> : null}
      </button>
    );
  };

  const hasVisibleAssets = recommendedAssets.length > 0
    || formatMatchedAssets.length > 0
    || ((showOtherFiles || Boolean(search)) && otherAssets.length > 0);

  return (
    <div data-testid={`loadout-model-picker-body:${slot.slotId}`}>
      <SearchField
        aria-label={t('runtimeConfig.product.searchModels')}
        placeholder={t('runtimeConfig.product.searchModels')}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onClear={() => setQuery('')}
        clearLabel={t('Common.clear')}
      />
      <ScrollArea className={`mt-3 ${props.maxHeightClassName ?? 'h-[min(55vh,480px)]'}`}>
        <div className="grid gap-5 py-2 pr-3">
          <section className="grid gap-2" data-testid="loadout-model-picker:installed-section">
            <h4 className="text-xs font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.picker.installedSection')}</h4>
            <div className="grid gap-2">
              {allowClear ? (
                <button
                  type="button"
                  data-testid="loadout-model-picker:clear"
                  data-selected={!props.selectedOfferRef && props.selectedAssetId === ''}
                  onClick={() => props.onSelectAsset('')}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition hover:bg-[var(--nimi-action-ghost-hover)] ${!props.selectedOfferRef && props.selectedAssetId === '' ? 'border-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)]'}`}
                >
                  <span className="text-sm text-[var(--nimi-text-muted)]">{props.clearLabel ?? t('runtimeConfig.loadouts.unresolved')}</span>
                  {!props.selectedOfferRef && props.selectedAssetId === '' ? <StatusBadge tone="info" shape="soft">{t('runtimeConfig.loadouts.picker.current')}</StatusBadge> : null}
                </button>
              ) : null}
              {recommendedAssets.map(renderAssetButton)}
              {formatMatchedAssets.length > 0 ? (
                <div className="grid gap-2 pt-1" data-testid="loadout-model-picker:format-matched-group">
                  <p className="text-xs font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.picker.matchingFormatSection')}</p>
                  {formatMatchedAssets.map(renderAssetButton)}
                </div>
              ) : null}
              {(showOtherFiles || Boolean(search)) && otherAssets.length > 0 ? (
                <div className="grid gap-2 pt-1" data-testid="loadout-model-picker:other-files-group">
                  {partition.hasFormatFilter ? (
                    <p className="text-xs font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.picker.otherFilesSection')}</p>
                  ) : null}
                  {otherAssets.map(renderAssetButton)}
                </div>
              ) : null}
            </div>
          </section>

          {otherCount > 0 && !search ? (
            <Button tone="ghost" size="sm" onClick={() => setShowOtherFiles((value) => !value)}>
              {t(showOtherFiles ? 'runtimeConfig.product.hideOtherModelFiles' : 'runtimeConfig.product.showOtherModelFiles', { count: otherCount })}
            </Button>
          ) : null}
          {search && !hasVisibleAssets && !installableGroups.length ? (
            <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.noModelsMatch')}</p>
          ) : null}

          {installableGroups.length > 0 && props.onSelectOffer ? (
            <section className="grid gap-2" data-testid="loadout-model-picker:installable-section">
              <h4 className="text-xs font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.picker.installableSection')}</h4>
              {installableGroups.map((group) => (
                <div key={group.key} className="grid gap-2" data-testid={`loadout-model-picker:size-group:${group.title}`}>
                  <h5 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{group.title}</h5>
                  <div className="grid gap-2">
                    {group.items.map((offer) => {
                      const presentation = loadoutCandidatePresentation(offer.candidate);
                      const transferSize = offerMode === 'queue-offer'
                        ? (typeof offer.candidate.downloadSizeBytes === 'number' && offer.candidate.downloadSizeBytes > 0
                          ? t('runtimeConfig.product.downloadSize', { size: formatBytes(offer.candidate.downloadSizeBytes) })
                          : unknownSize)
                        : (offer.candidate.totalSizeBytes && offer.candidate.totalSizeBytes > 0
                          ? formatBytes(offer.candidate.totalSizeBytes)
                          : unknownSize);
                      const detail = [
                        presentation.quant.technical,
                        presentation.rawBase && presentation.rawBase !== presentation.headline ? presentation.rawBase : '',
                        transferSize,
                      ].filter(Boolean).join(' · ');
                      const isCurrentOffer = props.selectedOfferRef === offer.candidate.offerRef;
                      const disabledReason = props.offerDisabledReason?.(offer) ?? null;
                      return (
                        <div
                          key={offer.candidate.offerRef}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${isCurrentOffer ? 'border-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)]'}`}
                          data-testid={`loadout-model-picker:install:${offer.candidate.offerRef}`}
                        >
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{presentation.quant.short || presentation.rawLabel}</span>
                              {presentation.quant.semantic ? (
                                <StatusBadge tone="info" shape="soft">{t(`runtimeConfig.loadouts.quantSemantic.${presentation.quant.semantic}`)}</StatusBadge>
                              ) : null}
                              {isCurrentOffer ? (
                                <StatusBadge tone="info" shape="soft">{t('runtimeConfig.loadouts.picker.current')}</StatusBadge>
                              ) : null}
                            </span>
                            <span className="mt-1 block break-all text-xs text-[var(--nimi-text-muted)]" title={detail}>{detail}</span>
                            {disabledReason ? (
                              <span className="mt-1 block text-xs text-[var(--nimi-status-warning)]">{disabledReason}</span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {offerMode === 'install-or-inspect' && props.onInspectOffer ? (
                              <Button
                                size="sm"
                                tone="ghost"
                                data-testid={`loadout-model-picker:inspect:${offer.candidate.offerRef}`}
                                onClick={() => props.onInspectOffer?.(offer)}
                              >
                                {t('runtimeConfig.loadouts.picker.inspect')}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              tone="secondary"
                              disabled={Boolean(disabledReason)}
                              onClick={() => props.onSelectOffer?.(offer)}
                            >
                              {offerMode === 'queue-offer'
                                ? t('runtimeConfig.loadouts.picker.queueForDownload')
                                : offerMode === 'select-verified-hash'
                                  ? t('runtimeConfig.loadouts.picker.selectVerified')
                                  : t('runtimeConfig.loadouts.picker.installAndUse')}
                            </Button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {incompatible.length > 0 ? (
            <section className="grid gap-2" data-testid="loadout-model-picker:incompatible-section">
              <button
                type="button"
                aria-expanded={showIncompatible}
                onClick={() => setShowIncompatible((current) => !current)}
                className="flex w-fit items-center gap-1.5 text-left text-xs font-medium text-[var(--nimi-text-muted)] transition hover:text-[var(--nimi-text-primary)]"
                data-testid="loadout-model-picker:incompatible-toggle"
              >
                <span aria-hidden="true" className={`inline-block transition-transform ${showIncompatible ? 'rotate-90' : ''}`}>▸</span>
                {t('runtimeConfig.loadouts.picker.unsupportedToggle', { count: incompatible.length })}
              </button>
              {showIncompatible ? (
                <div className="grid gap-2">
                  {incompatible.map((offer) => {
                    const presentation = loadoutCandidatePresentation(offer.candidate);
                    const detail = presentationDetail(presentation, offer.candidate.totalSizeBytes ?? 0, unknownSize);
                    return (
                      <div
                        key={offer.candidate.offerRef}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3 opacity-75"
                        data-testid={`loadout-model-picker:incompatible:${offer.candidate.offerRef}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-[var(--nimi-text-secondary)]" title={presentation.headline}>{presentation.headline}</span>
                          <span className="mt-1 block break-all text-xs text-[var(--nimi-text-muted)]" title={detail}>{detail}</span>
                        </span>
                        <StatusBadge tone="warning" shape="soft" className="shrink-0">
                          {t(`runtimeConfig.loadouts.applicability.${offer.applicability}`, { defaultValue: offer.applicability })}
                        </StatusBadge>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}

          {!hasVisibleAssets && installable.length === 0 && incompatible.length === 0 ? (
            <p className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.noAdmittedOffer')}</p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

export function LoadoutSlotModelPicker(props: {
  readonly slot: NimiLoadoutRecipeSlot | null;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly selectedAssetId: string;
  readonly selectedOfferRef?: string;
  readonly allowClear?: boolean;
  readonly clearLabel?: string;
  readonly offerActionMode?: LoadoutSlotOfferActionMode;
  readonly onSelect: (modelAssetId: string) => void;
  readonly onOpenOffer?: (offer: NimiLoadoutRecipeSlotOffer) => void;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const slot = props.slot;
  const slotLabel = useSlotDisplayLabel(slot ?? { slotId: '', displayLabel: '' });
  if (!slot) return null;

  return (
    <OverlayShell
      open
      kind="dialog"
      size="md"
      title={t('runtimeConfig.loadouts.picker.title', { slot: slotLabel })}
      onClose={props.onClose}
      footer={<Button tone="secondary" onClick={props.onClose}>{t('Common.close')}</Button>}
      data-testid={`loadout-model-picker:${slot.slotId}`}
    >
      <LoadoutSlotModelPickerBody
        slot={slot}
        assets={props.assets}
        verifiedAssets={props.verifiedAssets}
        selectedAssetId={props.selectedAssetId}
        selectedOfferRef={props.selectedOfferRef}
        allowClear={props.allowClear}
        clearLabel={props.clearLabel}
        offerActionMode={props.offerActionMode}
        onSelectAsset={(modelAssetId) => {
          props.onSelect(modelAssetId);
          props.onClose();
        }}
        onSelectOffer={props.onOpenOffer ? (offer) => {
          props.onOpenOffer?.(offer);
          if (props.offerActionMode === 'queue-offer') props.onClose();
        } : undefined}
        onInspectOffer={props.onOpenOffer}
      />
    </OverlayShell>
  );
}
