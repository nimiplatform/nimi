// @nimi-authority: rule.nimi.desktop.ai-consumption.r023
// @nimi-authority: rule.nimi.desktop.ai-consumption.r004
// @nimi-authority: rule.nimi.desktop.ai-consumption.r021

import {
  createNimiAIProfileAuthoringBuilder,
  createNimiAIProfileLocalImplementation,
  deriveNimiAIProfileApplyPreview,
  deriveNimiAIProfileImportPreview,
  deriveNimiAIProfileLocalConfigurationPreview,
  deriveNimiAIProfileRequirementProjection,
  deriveNimiAIProfileSelectionMismatchPreview,
  importNimiAIProfileAuthoring,
  type NimiAIProfileApplyPreview,
  type NimiAIProfileAuthoringMachineProjection,
  type NimiAIProfileAuthoringRequirementProjection,
  type NimiAIProfileImportPreview,
  type NimiAIProfileLocalConfigurationPreview,
  type NimiAIProfileSelectionMismatchPreview,
  type NimiCapabilityAIConfig,
  type NimiPortableAIProfile,
  type NimiPortableAIProfileImplementation,
  type NimiPortableAIProfileLoadoutIntent,
  type NimiPortableAIProfileResourceOccurrence,
} from '@nimiplatform/sdk/ai';
import type { NimiJsonObject, NimiJsonValue } from '@nimiplatform/sdk/contracts';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadouts,
} from '@nimiplatform/sdk/runtime';

export type RuntimeConfigAIProfileCapabilityContract = string;

export type RuntimeConfigAIProfileLocalDraft = {
  readonly includeImplementation: boolean;
  readonly recipeId: string;
  readonly portableConfigJson: string;
  readonly resourceOccurrences?: readonly NimiPortableAIProfileResourceOccurrence[];
  readonly loadout?: NimiPortableAIProfileLoadoutIntent;
  readonly importedIntent?: {
    readonly recipeId: string;
    readonly implementation: NimiPortableAIProfileImplementation;
  };
  readonly recipeRefreshBlocked?: boolean;
};

export type RuntimeConfigAIProfileCloudDraft = {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
  readonly supportedFeaturesText: string;
  readonly providerModelTargetJson: string;
};

export type RuntimeConfigAIProfileCapabilityDraft = {
  readonly draftId: string;
  readonly capabilityContract: RuntimeConfigAIProfileCapabilityContract;
  readonly route: 'local' | 'cloud';
  readonly requiredFeaturesText: string;
  readonly defaultsJson: string;
  readonly local: RuntimeConfigAIProfileLocalDraft;
  readonly cloud: RuntimeConfigAIProfileCloudDraft;
};

export type RuntimeConfigAIProfileAuthoringDraft = {
  readonly profileId: string;
  readonly title: string;
  readonly descriptionIncluded: boolean;
  readonly description: string;
  readonly provenanceJson: string;
  readonly licenseJson: string;
  readonly displayMetadataJson: string;
  readonly capabilities: readonly RuntimeConfigAIProfileCapabilityDraft[];
  readonly nextDraftOrdinal: number;
};

export type RuntimeConfigAIProfileAuthoringOperation =
  | 'editing'
  | 'imported'
  | 'exported'
  | 'operation-failed';

export type RuntimeConfigAIProfileAuthoringState = {
  readonly draft: RuntimeConfigAIProfileAuthoringDraft;
  readonly operation: RuntimeConfigAIProfileAuthoringOperation;
  readonly operationSource: 'none' | 'import' | 'export';
  readonly technicalError: string;
  readonly revision: number;
};

export type RuntimeConfigAIProfileAuthoringAction =
  | { readonly type: 'draft-changed'; readonly draft: RuntimeConfigAIProfileAuthoringDraft }
  | { readonly type: 'recipes-loaded'; readonly recipes: readonly NimiLoadoutRecipe[] }
  | { readonly type: 'import-succeeded'; readonly draft: RuntimeConfigAIProfileAuthoringDraft }
  | { readonly type: 'export-succeeded' }
  | {
    readonly type: 'operation-failed';
    readonly source: 'import' | 'export';
    readonly technicalError: string;
  };

export type RuntimeConfigAIProfileAuthoringCurrentProjection = {
  readonly appId: string;
  readonly appAIConfig: NimiCapabilityAIConfig | null;
  readonly sharedAIConfig: NimiCapabilityAIConfig | null;
  readonly machine: NimiAIProfileAuthoringMachineProjection;
  readonly recipes: readonly NimiLoadoutRecipe[];
};

export type RuntimeConfigAIProfileAuthoringRequirementView = {
  readonly capabilityContract: string;
  readonly supportedFeatures: readonly string[];
  readonly projection: NimiAIProfileAuthoringRequirementProjection;
};

export type RuntimeConfigAIProfileAuthoringJourneyPreview = {
  readonly importPreview: NimiAIProfileImportPreview;
  readonly appApplyPreview: NimiAIProfileApplyPreview;
  readonly sharedApplyPreview: NimiAIProfileApplyPreview;
  readonly localConfigurationPreviews: readonly NimiAIProfileLocalConfigurationPreview[];
  readonly selectionPreviews: readonly NimiAIProfileSelectionMismatchPreview[];
};

export type RuntimeConfigAIProfileAuthoringPreviewModel = {
  readonly profile: NimiPortableAIProfile;
  readonly requirements: readonly RuntimeConfigAIProfileAuthoringRequirementView[];
  readonly exportArtifact: RuntimeConfigAIProfileAuthoringExport | null;
  readonly exportTechnicalError: string;
  readonly journey: RuntimeConfigAIProfileAuthoringJourneyPreview | null;
};

export type RuntimeConfigAIProfileAuthoringInspection =
  | { readonly status: 'valid'; readonly model: RuntimeConfigAIProfileAuthoringPreviewModel }
  | { readonly status: 'invalid'; readonly technicalError: string };

export type RuntimeConfigAIProfileAuthoringExport = {
  readonly profile: NimiPortableAIProfile;
  readonly artifactJson: string;
  readonly fileName: string;
};

const PREVIEW_VALIDATION = Object.freeze({
  requireProvenance: false,
  requireLicense: false,
  requireNonEmptyProvenance: false,
  requireNonEmptyLicense: false,
});

export function createRuntimeConfigAIProfileAuthoringDraft(): RuntimeConfigAIProfileAuthoringDraft {
  return {
    profileId: 'profile.authoring.draft',
    title: 'Untitled AIProfile',
    descriptionIncluded: false,
    description: '',
    provenanceJson: '',
    licenseJson: '',
    displayMetadataJson: '',
    capabilities: [],
    nextDraftOrdinal: 1,
  };
}

export function createRuntimeConfigAIProfileAuthoringState(): RuntimeConfigAIProfileAuthoringState {
  return {
    draft: createRuntimeConfigAIProfileAuthoringDraft(),
    operation: 'editing',
    operationSource: 'none',
    technicalError: '',
    revision: 0,
  };
}

export function reduceRuntimeConfigAIProfileAuthoringState(
  state: RuntimeConfigAIProfileAuthoringState,
  action: RuntimeConfigAIProfileAuthoringAction,
): RuntimeConfigAIProfileAuthoringState {
  switch (action.type) {
    case 'draft-changed':
      return {
        draft: action.draft,
        operation: 'editing',
        operationSource: 'none',
        technicalError: '',
        revision: state.revision + 1,
      };
    case 'recipes-loaded':
      return {
        ...state,
        draft: reconcileRuntimeConfigAIProfileRecipes(state.draft, action.recipes),
        revision: state.revision + 1,
      };
    case 'import-succeeded':
      return {
        draft: action.draft,
        operation: 'imported',
        operationSource: 'import',
        technicalError: '',
        revision: state.revision + 1,
      };
    case 'export-succeeded':
      return {
        ...state,
        operation: 'exported',
        operationSource: 'export',
        technicalError: '',
      };
    case 'operation-failed':
      return {
        ...state,
        operation: 'operation-failed',
        operationSource: action.source,
        technicalError: action.technicalError,
      };
  }
}

export function runtimeConfigAIProfileCapabilityContracts(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  recipes: readonly NimiLoadoutRecipe[],
): readonly string[] {
  return Object.freeze(Array.from(new Set([
    ...recipes.map((recipe) => recipe.capabilityContract),
    ...draft.capabilities.map((capability) => capability.capabilityContract),
  ].filter(Boolean))));
}

export function reconcileRuntimeConfigAIProfileRecipes(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  recipes: readonly NimiLoadoutRecipe[],
): RuntimeConfigAIProfileAuthoringDraft {
  const first = recipes[0];
  if (draft.capabilities.length === 0) {
    if (!first) return draft;
    return {
      ...draft,
      capabilities: [createCapabilityDraft(`capability-${draft.nextDraftOrdinal}`, first)],
      nextDraftOrdinal: draft.nextDraftOrdinal + 1,
    };
  }
  return {
    ...draft,
    capabilities: draft.capabilities.map((capability) => {
      if (capability.route !== 'local') return capability;
      const reconciledCapability = hasExplicitRecipeSelection(capability.local)
        ? { ...capability, local: clearImportedRecipeIntent(capability.local) }
        : capability;
      const current = recipes.find((recipe) => (
        recipe.recipeId === reconciledCapability.local.recipeId
        && recipe.capabilityContract === reconciledCapability.capabilityContract
      ));
      if (current) {
        if (reconciledCapability.local.recipeRefreshBlocked) {
          return blockImportedRecipeRefresh(reconciledCapability);
        }
        if (
          reconciledCapability.local.importedIntent
          && !sameRecipeImplementation(
            current,
            reconciledCapability.local.importedIntent.implementation,
          )
        ) {
          return blockImportedRecipeRefresh(reconciledCapability);
        }
        if (reconciledCapability.local.portableConfigJson.trim()) return reconciledCapability;
        return {
          ...reconciledCapability,
          local: {
            ...reconciledCapability.local,
            portableConfigJson: prettyJson(current.defaultOptions),
          },
        };
      }
      if (reconciledCapability.local.importedIntent) {
        return blockImportedRecipeRefresh(reconciledCapability);
      }
      if (
        reconciledCapability.local.resourceOccurrences !== undefined
        || reconciledCapability.local.loadout !== undefined
      ) {
        // A Runtime Recipe refresh must not reinterpret or erase imported
        // portable occurrence/Loadout intent. Keep the stale exact identity so
        // preview/export fails closed until the user explicitly chooses a new
        // Recipe (which clears that intent in the editor).
        return reconciledCapability;
      }
      const replacement = recipes.find(
        (recipe) => recipe.capabilityContract === reconciledCapability.capabilityContract,
      );
      if (!replacement) {
        return {
          ...reconciledCapability,
          local: {
            ...reconciledCapability.local,
            includeImplementation: false,
            recipeId: '',
            portableConfigJson: '',
          },
        };
      }
      return {
        ...reconciledCapability,
        local: {
          includeImplementation: reconciledCapability.local.includeImplementation,
          recipeId: replacement.recipeId,
          portableConfigJson: prettyJson(replacement.defaultOptions),
        },
      };
    }),
  };
}

export function addRuntimeConfigAIProfileCapability(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  recipes: readonly NimiLoadoutRecipe[],
): RuntimeConfigAIProfileAuthoringDraft {
  const used = new Set(draft.capabilities.map((capability) => capability.capabilityContract));
  const recipe = recipes.find((candidate) => !used.has(candidate.capabilityContract));
  if (!recipe) return draft;
  return {
    ...draft,
    capabilities: [
      ...draft.capabilities,
      createCapabilityDraft(`capability-${draft.nextDraftOrdinal}`, recipe),
    ],
    nextDraftOrdinal: draft.nextDraftOrdinal + 1,
  };
}

export function changeRuntimeConfigAIProfileCapabilityContract(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  draftId: string,
  capabilityContract: RuntimeConfigAIProfileCapabilityContract,
  recipes: readonly NimiLoadoutRecipe[],
): RuntimeConfigAIProfileAuthoringDraft {
  if (draft.capabilities.some((capability) => (
    capability.draftId !== draftId && capability.capabilityContract === capabilityContract
  ))) return draft;
  const recipe = recipes.find((candidate) => candidate.capabilityContract === capabilityContract);
  return {
    ...draft,
    capabilities: draft.capabilities.map((capability) => (
      capability.draftId === draftId
        ? {
          ...capability,
          capabilityContract,
          local: {
            includeImplementation: recipe !== undefined,
            recipeId: recipe?.recipeId ?? '',
            portableConfigJson: recipe ? prettyJson(recipe.defaultOptions) : '',
          },
        }
        : capability
    )),
  };
}

export function buildRuntimeConfigAIProfileAuthoringDraft(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  recipes: readonly NimiLoadoutRecipe[],
): NimiPortableAIProfile {
  return authoringBuilderFromDraft(draft, recipes).build(PREVIEW_VALIDATION);
}

export function exportRuntimeConfigAIProfileAuthoring(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  recipes: readonly NimiLoadoutRecipe[],
): RuntimeConfigAIProfileAuthoringExport {
  const builder = authoringBuilderFromDraft(draft, recipes);
  const artifactJson = builder.export();
  const profile = importNimiAIProfileAuthoring(artifactJson).build();
  const safeId = profile.profileId.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return Object.freeze({
    profile,
    artifactJson,
    fileName: `${safeId || 'ai-profile'}.ai-profile.json`,
  });
}

export function importRuntimeConfigAIProfileAuthoring(
  input: string | Uint8Array | NimiJsonObject,
  recipes: readonly NimiLoadoutRecipe[],
): RuntimeConfigAIProfileAuthoringDraft {
  const profile = importNimiAIProfileAuthoring(input).build();
  return draftFromProfile(profile, recipes);
}

export function inspectRuntimeConfigAIProfileAuthoring(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  current: RuntimeConfigAIProfileAuthoringCurrentProjection | null,
): RuntimeConfigAIProfileAuthoringInspection {
  try {
    return {
      status: 'valid',
      model: deriveRuntimeConfigAIProfileAuthoringPreview(draft, current),
    };
  } catch (error) {
    return { status: 'invalid', technicalError: technicalErrorDetail(error) };
  }
}

export function deriveRuntimeConfigAIProfileAuthoringPreview(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  current: RuntimeConfigAIProfileAuthoringCurrentProjection | null,
): RuntimeConfigAIProfileAuthoringPreviewModel {
  const recipes = current?.recipes ?? [];
  const profile = buildRuntimeConfigAIProfileAuthoringDraft(draft, recipes);
  const requirements = Object.entries(profile.capabilities).flatMap(([
    capabilityContract,
    capability,
  ]) => {
    if (capability.route !== 'local' || !capability.implementation) return [];
    const recipe = recipeForCapabilityDraft(draft, capabilityContract, recipes);
    return [Object.freeze({
      capabilityContract,
      supportedFeatures: recipe.implementationSupportedFeatures,
      projection: deriveNimiAIProfileRequirementProjection(
        profile,
        capabilityContract,
        recipe,
      ),
    })];
  });
  let exportArtifact: RuntimeConfigAIProfileAuthoringExport | null = null;
  let exportTechnicalError = '';
  try {
    exportArtifact = exportRuntimeConfigAIProfileAuthoring(draft, recipes);
  } catch (error) {
    exportTechnicalError = technicalErrorDetail(error);
  }

  const journey = current === null
    ? null
    : Object.freeze({
      importPreview: deriveNimiAIProfileImportPreview({
        profile,
        validation: PREVIEW_VALIDATION,
      }),
      appApplyPreview: deriveNimiAIProfileApplyPreview({
        profile,
        target: { kind: 'app', appId: current.appId },
        before: current.appAIConfig,
        validation: PREVIEW_VALIDATION,
      }),
      sharedApplyPreview: deriveNimiAIProfileApplyPreview({
        profile,
        target: { kind: 'shared-local-agent' },
        before: current.sharedAIConfig,
        validation: PREVIEW_VALIDATION,
      }),
      localConfigurationPreviews: Object.entries(profile.capabilities).flatMap(([
        capabilityContract,
        capability,
      ]) => (
        capability.route === 'local' && capability.implementation
          ? [deriveNimiAIProfileLocalConfigurationPreview({
            profile,
            capabilityContract,
            recipe: recipeForCapabilityDraft(draft, capabilityContract, recipes),
            machine: current.machine,
            validation: PREVIEW_VALIDATION,
          })]
          : []
      )),
      selectionPreviews: Object.keys(profile.capabilities).map((capabilityContract) => (
        deriveNimiAIProfileSelectionMismatchPreview({
          profile,
          capabilityContract,
          machine: current.machine,
          validation: PREVIEW_VALIDATION,
        })
      )),
    });

  return Object.freeze({
    profile,
    requirements: Object.freeze(requirements),
    exportArtifact,
    exportTechnicalError,
    journey,
  });
}

export function projectRuntimeConfigAIProfileAuthoringMachine(
  machine: NimiMachineLoadouts,
): NimiAIProfileAuthoringMachineProjection {
  return Object.freeze({
    loadouts: Object.freeze(machine.loadouts.map((loadout) => Object.freeze({
      loadoutId: loadout.loadoutId,
      capabilityContract: loadout.capabilityContract,
      implementation: Object.freeze({ ...loadout.implementation }),
      portableConfig: loadout.options as unknown as NimiJsonObject,
      supportedFeatures: Object.freeze([...loadout.implementationSupportedFeatures]),
      requirementResolution: loadout.validationState === 'configured'
        ? 'configured' as const
        : 'unresolved' as const,
      provenance: loadout.provenance as unknown as NimiJsonObject,
      ...(loadout.validationState === 'configured' ? {
        loadout: Object.freeze({
          recipeId: loadout.recipeId,
          axes: Object.freeze(loadout.modelAxes.map((axis) => Object.freeze({
            slotId: axis.slotId,
            contentId: axis.expectedContentId,
          }))),
          options: loadout.options as unknown as NimiJsonObject,
        }),
      } : {}),
    }))),
    selections: Object.freeze(machine.selections.map((selection) => Object.freeze({
      capabilityContract: selection.capabilityContract,
      loadoutId: selection.loadoutId,
    }))),
  });
}

export async function loadRuntimeConfigAIProfileAuthoringCurrentProjection(input: {
  readonly appId: string;
  readonly getAppAIConfig: () => Promise<NimiCapabilityAIConfig | null>;
  readonly getSharedAIConfig: () => Promise<NimiCapabilityAIConfig | null>;
  readonly getLoadouts: () => Promise<NimiMachineLoadouts>;
  readonly getRecipes: () => Promise<readonly NimiLoadoutRecipe[]>;
}): Promise<RuntimeConfigAIProfileAuthoringCurrentProjection> {
  const [appAIConfig, sharedAIConfig, machine, recipes] = await Promise.all([
    input.getAppAIConfig(),
    input.getSharedAIConfig(),
    input.getLoadouts(),
    input.getRecipes(),
  ]);
  return Object.freeze({
    appId: input.appId,
    appAIConfig,
    sharedAIConfig,
    machine: projectRuntimeConfigAIProfileAuthoringMachine(machine),
    recipes: Object.freeze([...recipes]),
  });
}

export function technicalErrorDetail(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || 'Unknown AIProfile authoring error');
}

function createCapabilityDraft(
  draftId: string,
  recipe: NimiLoadoutRecipe,
): RuntimeConfigAIProfileCapabilityDraft {
  return {
    draftId,
    capabilityContract: recipe.capabilityContract,
    route: 'local',
    requiredFeaturesText: '',
    defaultsJson: '',
    local: {
      includeImplementation: true,
      recipeId: recipe.recipeId,
      portableConfigJson: prettyJson(recipe.defaultOptions),
    },
    cloud: {
      implementationId: '',
      driverId: '',
      driverDialect: '',
      supportedFeaturesText: '',
      providerModelTargetJson: '',
    },
  };
}

function authoringBuilderFromDraft(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  recipes: readonly NimiLoadoutRecipe[],
) {
  const builder = createNimiAIProfileAuthoringBuilder({
    profileId: draft.profileId,
    title: draft.title,
    ...(draft.descriptionIncluded ? { description: draft.description } : {}),
    ...(draft.provenanceJson.trim()
      ? { provenance: parseJsonObject(draft.provenanceJson, 'provenance') }
      : {}),
    ...(draft.licenseJson.trim()
      ? { license: parseJsonValue(draft.licenseJson, 'license') }
      : {}),
    ...(draft.displayMetadataJson.trim()
      ? { displayMetadata: parseJsonObject(draft.displayMetadataJson, 'display metadata') }
      : {}),
  });

  for (const capability of draft.capabilities) {
    const requiredFeatures = parseFeatureText(capability.requiredFeaturesText);
    const defaults = capability.defaultsJson.trim()
      ? parseJsonObject(capability.defaultsJson, `${capability.capabilityContract} defaults`)
      : undefined;
    if (capability.route === 'local') {
      builder.setLocalCapability({
        capabilityContract: capability.capabilityContract,
        requiredFeatures,
        ...(defaults !== undefined ? { defaults } : {}),
        ...(capability.local.includeImplementation
          ? {
            localConfiguration: createNimiAIProfileLocalImplementation({
              recipe: recipeForCapabilityDraft(
                draft,
                capability.capabilityContract,
                recipes,
              ),
              portableConfig: parseJsonObject(
                capability.local.portableConfigJson,
                `${capability.capabilityContract} portable config`,
              ),
            }),
            ...(capability.local.resourceOccurrences !== undefined
              ? { resourceOccurrences: capability.local.resourceOccurrences }
              : {}),
            ...(capability.local.loadout !== undefined
              ? { loadout: capability.local.loadout }
              : {}),
          }
          : {}),
      });
      continue;
    }
    builder.setCloudCapability({
      capabilityContract: capability.capabilityContract,
      requiredFeatures,
      ...(defaults !== undefined ? { defaults } : {}),
      recommendation: {
        implementation: {
          implementationId: capability.cloud.implementationId,
          driverId: capability.cloud.driverId,
          driverDialect: capability.cloud.driverDialect,
        },
        supportedFeatures: parseFeatureText(capability.cloud.supportedFeaturesText),
        providerModelTarget: parseJsonObject(
          capability.cloud.providerModelTargetJson,
          `${capability.capabilityContract} provider-model target`,
        ),
      },
    });
  }
  return builder;
}

function recipeForCapabilityDraft(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  capabilityContract: string,
  recipes: readonly NimiLoadoutRecipe[],
): NimiLoadoutRecipe {
  const capability = draft.capabilities.find(
    (candidate) => candidate.capabilityContract === capabilityContract,
  );
  const recipe = capability
    ? recipes.find((candidate) => (
      candidate.recipeId === capability.local.recipeId
      && candidate.capabilityContract === capabilityContract
    ))
    : undefined;
  const explicitlySelected = capability
    ? hasExplicitRecipeSelection(capability.local)
    : false;
  if (capability?.local.recipeRefreshBlocked && !explicitlySelected) {
    throw new Error(
      `${capabilityContract} requires a current Runtime Recipe selection; `
      + 'an explicit Runtime Recipe selection is required after Recipe drift',
    );
  }
  if (!recipe) {
    throw new Error(`${capabilityContract} requires a current Runtime Recipe selection`);
  }
  if (
    capability?.local.importedIntent
    && !explicitlySelected
    && !sameRecipeImplementation(recipe, capability.local.importedIntent.implementation)
  ) {
    throw new Error(
      `${capabilityContract} requires a current Runtime Recipe selection; `
      + 'an explicit Runtime Recipe selection is required after Recipe drift',
    );
  }
  return recipe;
}

function parseFeatureText(value: string): readonly string[] {
  if (!value.trim()) return [];
  return value.split(/[\n,]/gu).map((feature) => feature.trim()).filter(Boolean);
}

function parseJsonObject(value: string, label: string): NimiJsonObject {
  const parsed = parseJson(value, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as NimiJsonObject;
}

function parseJsonValue(value: string, label: string): NimiJsonValue {
  return parseJson(value, label) as NimiJsonValue;
}

function parseJson(value: string, label: string): unknown {
  if (!value.trim()) throw new Error(`${label} JSON is required`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function draftFromProfile(
  profile: NimiPortableAIProfile,
  recipes: readonly NimiLoadoutRecipe[],
): RuntimeConfigAIProfileAuthoringDraft {
  let nextDraftOrdinal = 1;
  const capabilities = Object.entries(profile.capabilities).map(([
    capabilityContract,
    capability,
  ]) => {
    const cloud: RuntimeConfigAIProfileCloudDraft = capability.route === 'cloud'
      ? {
        implementationId: capability.implementation.implementationId,
        driverId: capability.implementation.driverId,
        driverDialect: capability.implementation.driverDialect,
        supportedFeaturesText: capability.implementation.supportedFeatures.join(', '),
        providerModelTargetJson: prettyJson(capability.providerModelTarget),
      }
      : {
        implementationId: '',
        driverId: '',
        driverDialect: '',
        supportedFeaturesText: '',
        providerModelTargetJson: '',
      };
    if (capability.route === 'cloud' || !capability.implementation) {
      const localRecipe = capability.route === 'local'
        ? recipes.find((recipe) => recipe.capabilityContract === capabilityContract)
        : undefined;
      const draft: RuntimeConfigAIProfileCapabilityDraft = {
        draftId: `capability-${nextDraftOrdinal}`,
        capabilityContract,
        route: capability.route,
        requiredFeaturesText: capability.requiredFeatures.join(', '),
        defaultsJson: prettyJson(capability.defaults),
        local: {
          includeImplementation: false,
          recipeId: localRecipe?.recipeId ?? '',
          portableConfigJson: localRecipe ? prettyJson(localRecipe.defaultOptions) : '',
        },
        cloud,
      };
      nextDraftOrdinal += 1;
      return draft;
    }
    const implementation = capability.implementation;
    const candidates = recipes.filter((recipe) => (
      recipe.capabilityContract === capabilityContract
      && sameImplementation(recipe.implementation, implementation)
      && sameStrings(recipe.implementationSupportedFeatures, implementation.supportedFeatures)
    ));
    const recipe = capability.loadout?.recipeId
      ? candidates.find((candidate) => candidate.recipeId === capability.loadout?.recipeId)
      : candidates.length === 1 ? candidates[0] : undefined;
    if (!recipe) {
      throw new Error(
        `Imported ${capabilityContract} Local implementation has no unambiguous current Runtime Recipe`,
      );
    }
    const draft: RuntimeConfigAIProfileCapabilityDraft = {
      draftId: `capability-${nextDraftOrdinal}`,
      capabilityContract,
      route: 'local',
      requiredFeaturesText: capability.requiredFeatures.join(', '),
      defaultsJson: prettyJson(capability.defaults),
      local: {
        includeImplementation: true,
        recipeId: recipe.recipeId,
        portableConfigJson: prettyJson(
          capability.driverPortableConfig ?? recipe.defaultOptions,
        ),
        importedIntent: Object.freeze({
          recipeId: capability.loadout?.recipeId ?? recipe.recipeId,
          implementation: Object.freeze({
            implementationId: implementation.implementationId,
            driverId: implementation.driverId,
            driverDialect: implementation.driverDialect,
            supportedFeatures: Object.freeze([...implementation.supportedFeatures]),
          }),
        }),
        ...(capability.resourceOccurrences !== undefined
          ? { resourceOccurrences: capability.resourceOccurrences }
          : {}),
        ...(capability.loadout !== undefined ? { loadout: capability.loadout } : {}),
      },
      cloud,
    };
    nextDraftOrdinal += 1;
    return draft;
  });
  return {
    profileId: profile.profileId,
    title: profile.title,
    descriptionIncluded: profile.description !== undefined,
    description: profile.description ?? '',
    provenanceJson: prettyJson(profile.provenance),
    licenseJson: prettyJson(profile.license),
    displayMetadataJson: prettyJson(profile.displayMetadata),
    capabilities,
    nextDraftOrdinal,
  };
}

function sameImplementation(
  left: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  },
  right: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  },
): boolean {
  return left.implementationId === right.implementationId
    && left.driverId === right.driverId
    && left.driverDialect === right.driverDialect;
}

function sameRecipeImplementation(
  recipe: NimiLoadoutRecipe,
  implementation: NimiPortableAIProfileImplementation,
): boolean {
  return sameImplementation(recipe.implementation, implementation)
    && sameStrings(recipe.implementationSupportedFeatures, implementation.supportedFeatures);
}

function hasExplicitRecipeSelection(local: RuntimeConfigAIProfileLocalDraft): boolean {
  const imported = local.importedIntent;
  if (!imported || !local.recipeId) return false;
  if (local.resourceOccurrences !== undefined || local.loadout !== undefined) return false;
  return local.recipeRefreshBlocked === true || local.recipeId !== imported.recipeId;
}

function clearImportedRecipeIntent(
  local: RuntimeConfigAIProfileLocalDraft,
): RuntimeConfigAIProfileLocalDraft {
  return {
    includeImplementation: local.includeImplementation,
    recipeId: local.recipeId,
    portableConfigJson: local.portableConfigJson,
    ...(local.resourceOccurrences !== undefined
      ? { resourceOccurrences: local.resourceOccurrences }
      : {}),
    ...(local.loadout !== undefined ? { loadout: local.loadout } : {}),
  };
}

function blockImportedRecipeRefresh(
  capability: RuntimeConfigAIProfileCapabilityDraft,
): RuntimeConfigAIProfileCapabilityDraft {
  return {
    ...capability,
    local: {
      ...capability.local,
      recipeId: '',
      recipeRefreshBlocked: true,
    },
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join('\u0000') === [...right].sort().join('\u0000');
}

function prettyJson(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}
