import { Button, ConfirmDialog, IconButton, InlineAlert, LoadingSkeleton, OverlayShell } from '@nimiplatform/kit/ui';
import type { NimiLoadoutRecipe, NimiMachineLoadout, NimiRuntimeLocalVerifiedAssetDescriptor, NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RuntimeCapabilityCustomize } from './runtime-capability-customize.js';
import { capabilityModelIdentity, modelDisplayTitle } from './runtime-capability-presentation.js';
import type { RuntimeSetupTaskDraft } from './runtime-setup-task-store.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function RuntimeCapabilitySettingsDialog(props: {
  readonly recipe?: NimiLoadoutRecipe;
  readonly selected?: NimiMachineLoadout;
  readonly missingConfiguration: boolean;
  readonly current: boolean;
  readonly configurations?: readonly NimiMachineLoadout[];
  readonly onChooseConfiguration: (configuration?: NimiMachineLoadout) => void;
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly loading: boolean;
  readonly readFailed: boolean;
  readonly disabled: boolean;
  readonly onRetry?: () => void;
  readonly onClose: () => void;
  readonly onApply: (draft: RuntimeSetupTaskDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const onStateChange = useCallback((changed: boolean, pending: boolean) => { setDirty(changed); setApplying(pending); }, []);
  const close = () => { if (!applying) { if (dirty) setConfirmClose(true); else props.onClose(); } };
  const identity = capabilityModelIdentity(props.selected, props.recipe ? [props.recipe] : [], props.catalog);
  const name = identity.shortTitle || (props.recipe ? modelDisplayTitle(props.recipe.title) : props.selected?.displayName) || '';
  const unavailable = props.readFailed || !props.recipe || props.missingConfiguration;
  return (
    <>
      <OverlayShell open kind="dialog" size="lg" onClose={applying ? undefined : close} closeOnBackdrop={!applying}
        panelClassName="flex max-h-[calc(100dvh-4rem)] flex-col overflow-hidden" contentClassName="min-h-0 overflow-y-auto pb-4"
        title={<span className="block pr-8">{t('runtimeConfig.product.settings.title', { model: name })}</span>}
        data-testid="capability-model-settings">
        <div className="space-y-4" data-testid="capability-settings-content" data-loadout-id={props.selected?.loadoutId} data-recipe-id={props.recipe?.recipeId}>
          {props.configurations ? <div className="space-y-3">
            <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.settings.chooseConfiguration')}</p>
            <ul className="divide-y divide-[var(--nimi-border-subtle)]">
              {props.configurations.map(configuration => {
                const model = capabilityModelIdentity(configuration, props.recipe ? [props.recipe] : [], props.catalog);
                return <li key={configuration.loadoutId} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0"><p className="break-words text-sm font-medium">{configuration.displayName}</p>
                    <p className="break-all text-xs text-[var(--nimi-text-secondary)]">{[model.versionShort, configuration.loadoutId].filter(Boolean).join(' · ')}</p></div>
                  <Button tone="secondary" size="sm" onClick={() => props.onChooseConfiguration(configuration)} data-testid={`capability-settings-choose:${configuration.loadoutId}`}>{t('runtimeConfig.product.settings.open')}</Button>
                </li>;
              })}
            </ul>
            <Button tone="ghost" onClick={() => props.onChooseConfiguration()}>{t('runtimeConfig.product.settings.useRecommended')}</Button>
          </div> : <>
          <div className="text-sm text-[var(--nimi-text-secondary)]">
            <p className="font-medium text-[var(--nimi-text-primary)]">{props.selected?.displayName || t('runtimeConfig.product.settings.recommended')}{identity.versionShort ? ` · ${identity.versionShort}` : ''}</p>
            <p className="mt-1">{t(props.current ? 'runtimeConfig.product.settings.currentScope' : 'runtimeConfig.product.settings.otherScope')}</p>
          </div>
          {props.loading ? <LoadingSkeleton lines={4} /> : unavailable ? (
            <InlineAlert tone="warning">{t(props.missingConfiguration ? 'runtimeConfig.localModels.configurationMissing' : 'runtimeConfig.product.customization.unavailable')}
              {props.onRetry ? <Button tone="secondary" size="sm" onClick={props.onRetry}>{t('Common.retry')}</Button> : null}
            </InlineAlert>
          ) : <RuntimeCapabilityCustomize key={props.selected?.loadoutId ?? 'new'} selected={props.selected} recipe={props.recipe!} catalog={props.catalog} assets={props.assets}
            disabled={props.disabled || props.recipe!.applicability === 'unsupported'} onStateChange={onStateChange} onApply={props.onApply}
            onCancel={props.onClose} applyLabel={t(props.current ? 'runtimeConfig.product.customization.apply' : 'runtimeConfig.product.settings.applyAndSelect')} />}
          </>}
        </div>
        <IconButton size="sm" aria-label={t('Common.close')} icon={<X size={16} />} disabled={applying} onClick={close}
          className="absolute right-4 top-4" data-testid="capability-model-settings-close" />
      </OverlayShell>
      <ConfirmDialog open={confirmClose} title={t('runtimeConfig.product.settings.discardTitle')} message={t('runtimeConfig.product.settings.discardMessage')}
        confirmLabel={t('runtimeConfig.product.customization.discard')} cancelLabel={t('runtimeConfig.product.settings.keepEditing')}
        onClose={() => setConfirmClose(false)} onConfirm={props.onClose} />
    </>
  );
}
