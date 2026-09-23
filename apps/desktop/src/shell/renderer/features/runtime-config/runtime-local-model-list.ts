import type {
  NimiLoadoutRecipe,
  NimiLoadoutRecommendationApplicability,
  NimiLoadoutSelection,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { describeModelAssetPresentation } from './runtime-config-local-model-center-asset-presentation.js';
import { loadoutModelPresentation } from './runtime-config-loadout-model-display.js';
import { modelDisplayTitle } from './runtime-capability-presentation.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.local-model-overview
//
// Projection of the on-device model inventory for the AI Capabilities home.
// It only reads: assets and the verified catalog classify content, recipes say
// what each asset can be configured for, Loadouts and selections say which
// configurations reference it and which one is a capability's default.
// Preparation status is not computed here; see runtime-local-model-status.ts.

/** A slot whose id starts with "main." carries the model itself; every other slot is a companion resource. */
export type LocalModelSlotRole = 'model' | 'companion';

export type LocalModelConfigurable = {
  readonly capability: string;
  readonly recipeId: string;
  readonly role: LocalModelSlotRole;
  readonly applicability: NimiLoadoutRecommendationApplicability;
};

export type LocalModelConfiguration = {
  readonly loadoutId: string;
  readonly capability: string;
  readonly displayName: string;
  readonly validationState: NimiMachineLoadout['validationState'];
  /** True when the capability's current selection is this Loadout. */
  readonly isDefault: boolean;
  /** How this variant participates in the configuration. */
  readonly role: LocalModelSlotRole;
};

export type LocalModelVariant = {
  /** Content identity; classifies the content shared by every asset id below. */
  readonly contentId: string;
  /** Every asset record holding this content; each keeps its own id for references. */
  readonly assetIds: readonly string[];
  readonly title: string;
  /** Headline quantization such as "Q4"; empty when not derivable. */
  readonly quantLabel: string;
  readonly format: string | null;
  readonly sizeBytes: number;
  readonly fileCount: number;
  /** True when neither the catalog, a recipe slot nor a saved configuration identifies a use. */
  readonly useNotIdentified: boolean;
  readonly configurableFor: readonly LocalModelConfigurable[];
  readonly configurations: readonly LocalModelConfiguration[];
};

export type LocalModelEntry = {
  /** Catalog logical model id when the catalog supplies it, otherwise the single content id. */
  readonly modelKey: string;
  readonly title: string;
  readonly variants: readonly LocalModelVariant[];
};

export type LocalModelListInput = {
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly loadouts: readonly NimiMachineLoadout[];
  readonly selections: readonly NimiLoadoutSelection[];
};

export function localModelSlotRole(slotId: string): LocalModelSlotRole {
  return slotId.startsWith('main.') ? 'model' : 'companion';
}

const APPLICABILITY_RANK: Readonly<Record<NimiLoadoutRecommendationApplicability, number>> = {
  supported: 0,
  unknown: 1,
  unsupported: 2,
};

function variantTitle(
  asset: NimiRuntimeModelAssetRecord,
  descriptor: NimiRuntimeLocalVerifiedAssetDescriptor | undefined,
): { title: string; quantLabel: string; family: string } {
  if (descriptor) {
    const presentation = loadoutModelPresentation({ title: descriptor.title, variantLabel: descriptor.entry });
    const family = presentation.family || modelDisplayTitle(descriptor.title);
    return {
      title: presentation.sizeLabel ? `${family} ${presentation.sizeLabel}` : family,
      quantLabel: presentation.quant.short,
      family,
    };
  }
  const presentation = describeModelAssetPresentation(asset);
  return { title: presentation.title, quantLabel: '', family: presentation.title };
}

/**
 * Builds the on-device model list. Assets sharing one content id are shown as
 * one variant that keeps every asset id; variants are grouped into one model
 * only when the catalog supplies a logical model id for them. Nothing is ever
 * merged by display name or file name.
 */
export function buildLocalModelList(input: LocalModelListInput): readonly LocalModelEntry[] {
  const descriptorByContent = new Map<string, NimiRuntimeLocalVerifiedAssetDescriptor>();
  for (const descriptor of input.catalog) {
    if (descriptor.contentId && !descriptorByContent.has(descriptor.contentId)) {
      descriptorByContent.set(descriptor.contentId, descriptor);
    }
  }
  const selectedByCapability = new Map(input.selections.map((item) => [item.capabilityContract, item.loadoutId]));

  // asset id -> configurable uses, from recipe slot offers that resolve to an installed asset
  const configurableByAsset = new Map<string, LocalModelConfigurable[]>();
  for (const recipe of input.recipes) {
    for (const slot of recipe.slots) {
      const role = localModelSlotRole(slot.slotId);
      for (const offer of slot.offers) {
        const assetId = offer.installedModelAssetId;
        if (!assetId) continue;
        const list = configurableByAsset.get(assetId) ?? [];
        if (list.some((item) => item.recipeId === recipe.recipeId && item.capability === recipe.capabilityContract && item.role === role)) continue;
        // The recipe's own applicability bounds the slot's: an unsupported recipe cannot be configured
        // even when the slot offer alone looks supported.
        const applicability = APPLICABILITY_RANK[recipe.applicability] >= APPLICABILITY_RANK[offer.applicability]
          ? recipe.applicability
          : offer.applicability;
        list.push({ capability: recipe.capabilityContract, recipeId: recipe.recipeId, role, applicability });
        configurableByAsset.set(assetId, list);
      }
    }
  }

  // asset id -> configurations (Loadouts) referencing it
  const configurationsByAsset = new Map<string, LocalModelConfiguration[]>();
  for (const loadout of input.loadouts) {
    for (const axis of loadout.modelAxes) {
      if (!axis.modelAssetId) continue;
      const list = configurationsByAsset.get(axis.modelAssetId) ?? [];
      if (list.some((item) => item.loadoutId === loadout.loadoutId)) continue;
      list.push({
        loadoutId: loadout.loadoutId,
        capability: loadout.capabilityContract,
        displayName: loadout.displayName,
        validationState: loadout.validationState,
        isDefault: selectedByCapability.get(loadout.capabilityContract) === loadout.loadoutId,
        role: localModelSlotRole(axis.slotId),
      });
      configurationsByAsset.set(axis.modelAssetId, list);
    }
  }

  // content id -> variant
  const variantsByContent = new Map<string, { variant: LocalModelVariant; family: string; modelKey: string }>();
  const orderedContent: string[] = [];
  for (const asset of input.assets) {
    const descriptor = descriptorByContent.get(asset.contentId);
    const existing = variantsByContent.get(asset.contentId);
    const configurableFor = configurableByAsset.get(asset.modelAssetId) ?? [];
    const configurations = configurationsByAsset.get(asset.modelAssetId) ?? [];
    if (existing) {
      variantsByContent.set(asset.contentId, {
        ...existing,
        variant: {
          ...existing.variant,
          assetIds: [...existing.variant.assetIds, asset.modelAssetId],
          useNotIdentified: existing.variant.useNotIdentified && configurableFor.length === 0 && configurations.length === 0,
          configurableFor: mergeConfigurable(existing.variant.configurableFor, configurableFor),
          configurations: [...existing.variant.configurations, ...configurations],
        },
      });
      continue;
    }
    const naming = variantTitle(asset, descriptor);
    const presentation = describeModelAssetPresentation(asset);
    orderedContent.push(asset.contentId);
    variantsByContent.set(asset.contentId, {
      family: naming.family,
      modelKey: descriptor?.logicalModelId ? `model:${descriptor.logicalModelId}` : `content:${asset.contentId}`,
      variant: {
        contentId: asset.contentId,
        assetIds: [asset.modelAssetId],
        title: naming.title,
        quantLabel: naming.quantLabel,
        format: presentation.format,
        sizeBytes: asset.totalSizeBytes,
        fileCount: asset.files.length,
        useNotIdentified: !descriptor && configurableFor.length === 0 && configurations.length === 0,
        configurableFor: sortConfigurable(configurableFor),
        configurations,
      },
    });
  }

  const entries = new Map<string, { title: string; variants: LocalModelVariant[] }>();
  for (const contentId of orderedContent) {
    const item = variantsByContent.get(contentId)!;
    const entry = entries.get(item.modelKey) ?? { title: item.family, variants: [] };
    entry.variants.push({
      ...item.variant,
      configurableFor: sortConfigurable(item.variant.configurableFor),
      configurations: sortConfigurations(item.variant.configurations),
    });
    entries.set(item.modelKey, entry);
  }
  return [...entries.entries()]
    .map(([modelKey, entry]) => ({ modelKey, title: entry.title, variants: entry.variants }))
    .sort((left, right) => {
      const rank = (entry: LocalModelEntry) => {
        if (entry.variants.some((variant) => variant.configurations.some((item) => item.isDefault))) return 0;
        if (entry.variants.some((variant) => variant.configurations.length > 0)) return 1;
        if (entry.variants.every((variant) => variant.useNotIdentified)) return 3;
        return 2;
      };
      return rank(left) - rank(right) || left.title.localeCompare(right.title);
    });
}

function mergeConfigurable(
  left: readonly LocalModelConfigurable[],
  right: readonly LocalModelConfigurable[],
): LocalModelConfigurable[] {
  const merged = [...left];
  for (const item of right) {
    if (!merged.some((known) => known.recipeId === item.recipeId && known.capability === item.capability && known.role === item.role)) {
      merged.push(item);
    }
  }
  return merged;
}

function sortConfigurable(items: readonly LocalModelConfigurable[]): LocalModelConfigurable[] {
  return [...items].sort(
    (left, right) =>
      (left.role === 'model' ? 0 : 1) - (right.role === 'model' ? 0 : 1) ||
      APPLICABILITY_RANK[left.applicability] - APPLICABILITY_RANK[right.applicability] ||
      left.capability.localeCompare(right.capability),
  );
}

/** Default configurations first, then by capability, then by name; each keeps its own row. */
function sortConfigurations(items: readonly LocalModelConfiguration[]): LocalModelConfiguration[] {
  return [...items].sort(
    (left, right) =>
      Number(right.isDefault) - Number(left.isDefault) ||
      left.capability.localeCompare(right.capability) ||
      left.displayName.localeCompare(right.displayName),
  );
}

/**
 * The capabilities a variant can be configured for as a model (not merely as
 * a companion resource), deduplicated and excluding unsupported recipes. This
 * is what the row's "configure" action can offer.
 */
export function configurableCapabilities(variant: LocalModelVariant): readonly string[] {
  return [
    ...new Set(
      variant.configurableFor
        .filter((item) => item.role === 'model' && item.applicability !== 'unsupported')
        .map((item) => item.capability),
    ),
  ];
}
