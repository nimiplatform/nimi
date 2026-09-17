// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { Button, OverlayShell, StatusBadge } from '@nimiplatform/kit/ui';
import { formatBytes } from '../../components/download-format.js';
import {
  groupLoadoutModelPresentations,
  loadoutAssetLabel,
  loadoutCandidatePresentation,
  loadoutModelPresentation,
  loadoutSlotLabelKey,
  loadoutSlotOfferForAsset,
  partitionLoadoutSlotOffers,
  runtimeConfigLoadoutCandidateAssets,
  type LoadoutModelPresentation,
  type NimiLoadoutRecipeSlot,
  type NimiLoadoutRecipeSlotOffer,
} from './runtime-config-loadout-model-display.js';

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
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly onOpenPicker: () => void;
}) {
  const { t } = useTranslation();
  const { slot, asset } = props;
  if (!asset) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-4 py-3"
        data-testid={`loadout-model-card:${slot.slotId}`}
        data-state="empty"
      >
        <span className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.unresolved')}</span>
        <Button size="sm" tone="secondary" onClick={props.onOpenPicker}>
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
      <Button size="sm" tone="secondary" className="shrink-0" onClick={props.onOpenPicker}>
        {t('runtimeConfig.loadouts.picker.change')}
      </Button>
    </div>
  );
}

export function LoadoutSlotModelPicker(props: {
  readonly slot: NimiLoadoutRecipeSlot | null;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly selectedAssetId: string;
  readonly onSelect: (modelAssetId: string) => void;
  readonly onOpenOffer: (offer: NimiLoadoutRecipeSlotOffer) => void;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const [showIncompatible, setShowIncompatible] = useState(false);
  const slot = props.slot;
  const slotLabel = useSlotDisplayLabel(slot ?? { slotId: '', displayLabel: '' });
  if (!slot) return null;

  const installedAssets = runtimeConfigLoadoutCandidateAssets(slot, props.assets);
  const { installable, incompatible } = partitionLoadoutSlotOffers(slot.offers);
  const installableGroups = groupLoadoutModelPresentations(installable, (offer) => loadoutCandidatePresentation(offer.candidate));
  const unknownSize = t('runtimeConfig.loadouts.downloadSizeUnknown');
  const select = (modelAssetId: string) => {
    props.onSelect(modelAssetId);
    props.onClose();
  };

  return (
    <OverlayShell
      open
      kind="dialog"
      size="md"
      title={t('runtimeConfig.loadouts.picker.title', { slot: slotLabel })}
      onClose={props.onClose}
      data-testid={`loadout-model-picker:${slot.slotId}`}
    >
      <div className="grid gap-5 py-2">
        <section className="grid gap-2" data-testid="loadout-model-picker:installed-section">
          <h4 className="text-xs font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.picker.installedSection')}</h4>
          <div className="grid gap-2">
            <button
              type="button"
              data-testid="loadout-model-picker:clear"
              data-selected={props.selectedAssetId === ''}
              onClick={() => select('')}
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition hover:bg-[var(--nimi-action-ghost-hover)] ${props.selectedAssetId === '' ? 'border-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)]'}`}
            >
              <span className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.unresolved')}</span>
              {props.selectedAssetId === '' ? <StatusBadge tone="info" shape="soft">{t('runtimeConfig.loadouts.picker.current')}</StatusBadge> : null}
            </button>
            {installedAssets.map((asset) => {
              const { presentation, totalSizeBytes } = assetPresentation(slot, asset, props.verifiedAssets);
              const selected = props.selectedAssetId === asset.modelAssetId;
              const detail = presentationDetail(presentation, totalSizeBytes, unknownSize);
              return (
                <button
                  key={asset.modelAssetId}
                  type="button"
                  data-testid={`loadout-model-picker:installed:${asset.modelAssetId}`}
                  data-selected={selected}
                  onClick={() => select(asset.modelAssetId)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition hover:bg-[var(--nimi-action-ghost-hover)] ${selected ? 'border-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)]'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--nimi-text-primary)]" title={presentation.headline}>{presentation.headline}</span>
                    <span className="mt-1 block break-all text-xs text-[var(--nimi-text-muted)]" title={detail}>{detail}</span>
                  </span>
                  {selected ? <StatusBadge tone="info" shape="soft" className="shrink-0">{t('runtimeConfig.loadouts.picker.current')}</StatusBadge> : null}
                </button>
              );
            })}
          </div>
        </section>

        {installableGroups.length > 0 ? (
          <section className="grid gap-2" data-testid="loadout-model-picker:installable-section">
            <h4 className="text-xs font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.picker.installableSection')}</h4>
            {installableGroups.map((group) => (
              <div key={group.key} className="grid gap-2" data-testid={`loadout-model-picker:size-group:${group.title}`}>
                <h5 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{group.title}</h5>
                <div className="grid gap-2">
                  {group.items.map((offer) => {
                    const presentation = loadoutCandidatePresentation(offer.candidate);
                    const detail = presentationDetail(presentation, offer.candidate.totalSizeBytes ?? 0, unknownSize);
                    return (
                      <div
                        key={offer.candidate.offerRef}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3"
                        data-testid={`loadout-model-picker:install:${offer.candidate.offerRef}`}
                      >
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{presentation.quant.short || presentation.rawLabel}</span>
                            {presentation.quant.semantic ? (
                              <StatusBadge tone="info" shape="soft">{t(`runtimeConfig.loadouts.quantSemantic.${presentation.quant.semantic}`)}</StatusBadge>
                            ) : null}
                          </span>
                          <span className="mt-1 block break-all text-xs text-[var(--nimi-text-muted)]" title={detail}>{detail}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            tone="ghost"
                            data-testid={`loadout-model-picker:inspect:${offer.candidate.offerRef}`}
                            onClick={() => props.onOpenOffer(offer)}
                          >
                            {t('runtimeConfig.loadouts.picker.inspect')}
                          </Button>
                          <Button size="sm" tone="secondary" onClick={() => props.onOpenOffer(offer)}>
                            {t('runtimeConfig.loadouts.picker.installAndUse')}
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

        {installedAssets.length === 0 && installable.length === 0 && incompatible.length === 0 ? (
          <p className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.noAdmittedOffer')}</p>
        ) : null}
      </div>
    </OverlayShell>
  );
}
