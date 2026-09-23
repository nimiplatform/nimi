// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { RuntimeLoadoutOptionsEditor } from './runtime-config-setup-task-advanced.js';
import type { RuntimeSetupTaskDraft } from './runtime-setup-task-store.js';

/** Opening or editing this form creates no task and never changes the selected Loadout. */
export function RuntimeCapabilityCustomize(props: {
  readonly selected: NimiMachineLoadout;
  readonly recipe: NimiLoadoutRecipe;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly disabled: boolean;
  readonly onApply: (draft: RuntimeSetupTaskDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const initial = useMemo<RuntimeSetupTaskDraft>(() => ({
    recipeId: props.recipe.recipeId,
    options: (props.selected.options ?? props.recipe.defaultOptions ?? {}) as RuntimeSetupTaskDraft['options'],
    axes: props.selected.modelAxes.filter((axis) => axis.modelAssetId && axis.expectedContentId)
      .map(({ slotId, modelAssetId, expectedContentId }) => ({ slotId, modelAssetId, expectedContentId })),
    disabledOptionalSlots: props.recipe.slots.filter((slot) => slot.presence === 'optional-conditional'
      && !props.selected.modelAxes.some((axis) => axis.slotId === slot.slotId && axis.modelAssetId))
      .map((slot) => slot.slotId),
    preferredOffers: {},
    pendingAxes: [],
  }), [props.selected, props.recipe]);
  const [draft, setDraft] = useState(initial);
  const [revision, setRevision] = useState(0);
  return (
    <section className="space-y-4" data-testid="capability-customize-editor">
      <div>
        <h2 className="text-base font-semibold">{t('runtimeConfig.product.customize')}</h2>
        <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.customization.help')}</p>
      </div>
      <div className="rounded-xl bg-[var(--nimi-surface-card)] p-4 sm:p-5">
        <RuntimeLoadoutOptionsEditor
          key={revision}
          recipe={props.recipe}
          candidate={props.selected}
          draft={draft}
          assets={props.assets}
          verifiedAssets={props.catalog}
          disabled={props.disabled}
          changed={JSON.stringify(draft) !== JSON.stringify(initial)}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onApply={props.onApply}
          applyLabel={t('runtimeConfig.product.customization.apply')}
          onDiscard={() => { setDraft(initial); setRevision((value) => value + 1); }}
        />
      </div>
    </section>
  );
}
