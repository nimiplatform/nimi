import type { JsonValue as ProtoJsonValue } from '@protobuf-ts/runtime';
import { Struct as RuntimeStruct } from '../../core-generated/runtime-protobuf/google/protobuf/struct.js';
import type {
  AIConfig,
  AIConfigCapabilityIntent,
  AIConfigCloudIntent,
  AIConfigOwner,
  CapabilityImplementationIdentity,
} from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration.js';
import type { NimiJsonObject, NimiJsonValue } from '../contracts/index.js';
import { createNimiError } from '../../types/index.js';
import { sha256Hex } from '../../types/sha256.js';
import type { NimiLoadoutRecipe } from '../../runtime/machine-loadouts.js';
import {
  parseNimiPortableAIProfile,
  runtimeAIConfigStructToJson,
  serializeNimiPortableAIProfile,
  type NimiPortableAIProfile,
  type NimiPortableAIProfileCapability,
  type NimiPortableAIProfileImplementation,
  type NimiPortableAIProfileInput,
  type NimiPortableAIProfileLoadoutIntent,
  type NimiPortableAIProfileResourceOccurrence,
} from './config-profile.js';

/** Cloud recommendation content is intentionally grantless and connectorless. */
const CLOUD_RECOMMENDATION_FIELDS = Object.freeze([
  'implementation',
  'supportedFeatures',
  'providerModelTarget',
] as const);

export interface NimiAIProfileLocalImplementationAuthoringInput {
  /** Runtime is the only owner of implementation identity, defaults, features, and slots. */
  readonly recipe: NimiLoadoutRecipe;
  /** Omit to use the Runtime-owned Recipe defaults. */
  readonly portableConfig?: NimiJsonObject;
}

export interface NimiAIProfileCloudRecommendationAuthoringInput {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures?: readonly string[];
  readonly providerModelTarget: NimiJsonObject;
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r013
export interface NimiAIProfileLocalCapabilityAuthoringInput {
  readonly capabilityContract: string;
  readonly requiredFeatures?: readonly string[];
  readonly defaults?: NimiJsonObject;
  readonly localConfiguration?: NimiAIProfileLocalImplementationAuthoringInput;
  /** Independent portable occurrences are authored intent, never machine bindings. */
  readonly resourceOccurrences?: readonly NimiPortableAIProfileResourceOccurrence[];
  /** Optional portable Loadout intent is preserved without ModelAsset or selection identity. */
  readonly loadout?: NimiPortableAIProfileLoadoutIntent;
}

export interface NimiAIProfileCloudCapabilityAuthoringInput {
  readonly capabilityContract: string;
  readonly requiredFeatures?: readonly string[];
  readonly defaults?: NimiJsonObject;
  readonly recommendation: NimiAIProfileCloudRecommendationAuthoringInput;
}

export interface NimiAIProfileAuthoringBuilderInput {
  readonly profileId: string;
  readonly title: string;
  readonly description?: string;
  readonly provenance?: NimiJsonObject;
  readonly license?: NimiJsonValue;
  readonly displayMetadata?: NimiJsonObject;
}

export interface NimiAIProfileAuthoringValidationOptions {
  /** Defaults to true for publication/export validation. */
  readonly requireProvenance?: boolean;
  /** Defaults to true for publication/export validation. */
  readonly requireLicense?: boolean;
  /** Defaults to true; this checks only top-level structural emptiness. */
  readonly requireNonEmptyProvenance?: boolean;
  /** Defaults to true; this checks only top-level structural emptiness. */
  readonly requireNonEmptyLicense?: boolean;
}

export type NimiAIProfileEquivalenceDigest = `sha256:${string}`;

export interface NimiAIProfileAuthoringValidationResult {
  readonly profile: NimiPortableAIProfile;
  readonly portableContentDigest: NimiAIProfileEquivalenceDigest;
  readonly localConfigurationDigests: Readonly<Record<string, NimiAIProfileEquivalenceDigest>>;
}

export type NimiAIProfileAuthoringProjectedRequirement = NimiLoadoutRecipe['slots'][number];

export interface NimiAIProfileAuthoringRequirementProjection {
  readonly source: 'runtime-recipe';
  readonly recipeId: string;
  readonly recipeRevision: string;
  readonly requirements: readonly NimiAIProfileAuthoringProjectedRequirement[];
}

export interface NimiAIProfileImportPreview {
  readonly action: 'import-profile';
  readonly source: NimiPortableAIProfile;
  readonly artifactJson: string;
  readonly previewOnly: true;
  readonly declaredWrites: {
    readonly profileArtifact: true;
    readonly aiConfig: false;
    readonly localCapabilityConfigurations: false;
    readonly machineSelection: false;
  };
}

export type NimiAIProfileApplyTarget =
  | { readonly kind: 'app'; readonly appId: string }
  | { readonly kind: 'shared-local-agent' };

export interface NimiAIProfileAIConfigIntentDiff {
  readonly addedCapabilityContracts: readonly string[];
  readonly removedCapabilityContracts: readonly string[];
  readonly changedCapabilityContracts: readonly string[];
  readonly unchangedCapabilityContracts: readonly string[];
}

export type NimiAIProfileCapabilityPrefill = Omit<AIConfigCapabilityIntent, 'route'> & {
  readonly route:
    | { readonly oneofKind: 'local'; readonly local: Readonly<Record<string, never>> }
    | { readonly oneofKind: 'cloud'; readonly cloud: Omit<AIConfigCloudIntent, 'connectorRef'> };
};

export interface NimiAIProfileAIConfigPrefill {
  readonly owner: AIConfigOwner;
  readonly capabilities: readonly NimiAIProfileCapabilityPrefill[];
}

export interface NimiAIProfileApplyPreview {
  readonly action: 'apply-to-ai-config';
  readonly target: NimiAIProfileApplyTarget;
  readonly source: NimiPortableAIProfile;
  readonly before: AIConfig | null;
  readonly after: NimiAIProfileAIConfigPrefill;
  readonly intentDiff: NimiAIProfileAIConfigIntentDiff;
  readonly cloudConfigurations: readonly {
    readonly capabilityContract: string;
    readonly state: 'configured';
  }[];
  readonly previewOnly: true;
  readonly writesOnly: 'none';
  readonly requiresResourceSelection: true;
}

export interface NimiAIProfileAuthoringMachineLoadoutProjection {
  readonly loadoutId: string;
  readonly capabilityContract: string;
  readonly implementation: CapabilityImplementationIdentity;
  readonly portableConfig?: NimiJsonObject;
  readonly supportedFeatures: readonly string[];
  readonly requirementResolution: 'unresolved' | 'configured';
  readonly provenance?: NimiJsonObject;
  /** Optional source identity projected by the caller; Runtime does not infer it. */
  readonly sourceProfileId?: string;
  readonly loadout?: {
    readonly recipeId: string;
    readonly axes: readonly { readonly slotId: string; readonly contentId: string }[];
    readonly options: NimiJsonObject;
  };
}

export interface NimiAIProfileAuthoringMachineSelectionProjection {
  readonly capabilityContract: string;
  readonly loadoutId: string;
}

export interface NimiAIProfileAuthoringMachineProjection {
  readonly loadouts: readonly NimiAIProfileAuthoringMachineLoadoutProjection[];
  readonly selections: readonly NimiAIProfileAuthoringMachineSelectionProjection[];
}

export interface NimiAIProfileLocalConfigurationProposal {
  readonly capabilityContract: string;
  readonly implementation: CapabilityImplementationIdentity;
  readonly portableConfig: NimiJsonObject;
  readonly supportedFeatures: readonly string[];
  readonly displayName: string;
  readonly provenance?: NimiJsonObject;
}

export type NimiAIProfileLocalConfigurationDecision =
  | {
    readonly kind: 'add-new';
    readonly expectedRequirementResolution: 'unresolved';
  }
  | {
    readonly kind: 'reuse-equivalent';
    readonly matches: readonly {
      readonly loadoutId: string;
      readonly requirementResolution: 'unresolved' | 'configured';
    }[];
    readonly expectedRequirementResolution: 'unresolved' | 'configured';
    readonly requiresExistingRecordSelection: boolean;
  }
  | {
    readonly kind: 'choose-update-or-add';
    readonly updateCandidateLoadoutIds: readonly string[];
    readonly updateExpectedRequirementResolution: 'unresolved';
    readonly addExpectedRequirementResolution: 'unresolved';
  };

export interface NimiAIProfileLocalConfigurationPreview {
  readonly action: 'add-or-update-loadout';
  readonly source: NimiPortableAIProfile;
  readonly proposal: NimiAIProfileLocalConfigurationProposal;
  readonly equivalenceDigest: NimiAIProfileEquivalenceDigest;
  readonly requirementProjection: NimiAIProfileAuthoringRequirementProjection;
  readonly decision: NimiAIProfileLocalConfigurationDecision;
  readonly runtimeMayConfigureExactPreferredContentAtCommit: boolean;
  readonly previewOnly: true;
  readonly writesOnly: 'machine-loadout';
  readonly doesNotSelect: true;
}

export interface NimiAIProfileFeatureSubsetResult {
  readonly status: 'compatible' | 'feature-mismatch' | 'unavailable';
  readonly compatible: boolean;
  readonly requiredFeatures: readonly string[];
  readonly supportedFeatures: readonly string[];
  readonly missingFeatures: readonly string[];
}

export interface NimiAIProfileSelectionCloudAlternative {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures: readonly string[];
  readonly providerModelTarget: NimiJsonObject;
}

export interface NimiAIProfileSelectionMismatchPreview {
  readonly action: 'selection-mismatch';
  readonly capabilityContract: string;
  readonly requiredFeatures: readonly string[];
  readonly branches: readonly [
    {
      readonly kind: 'continue-current-selection';
      readonly loadoutId: string | null;
      readonly featureSubset: NimiAIProfileFeatureSubsetResult;
      readonly changesSelection: false;
    },
    {
      readonly kind: 'select-recommended-local-configuration';
      readonly loadoutIds: readonly string[];
      readonly prerequisite: 'none' | 'add-or-update-local-configuration' | 'local-recommendation-unavailable';
      readonly featureSubset: NimiAIProfileFeatureSubsetResult;
      readonly changesSelection: boolean;
    },
    {
      readonly kind: 'use-cloud';
      readonly implementation: CapabilityImplementationIdentity | null;
      readonly providerModelTarget: NimiJsonObject | null;
      readonly featureSubset: NimiAIProfileFeatureSubsetResult;
      readonly prerequisite: 'apply-cloud-intent' | 'cloud-recommendation-unavailable';
    },
  ];
  readonly mismatchFailsClosed: true;
  readonly previewOnly: true;
  readonly commits: false;
}

/** Build one portable Local implementation from Runtime-owned Recipe truth. */
export function createNimiAIProfileLocalImplementation(
  input: NimiAIProfileLocalImplementationAuthoringInput,
): NimiAIProfileLocalImplementationAuthoringInput {
  const normalized = normalizeLocalImplementationInput(input, input.recipe.capabilityContract);
  return Object.freeze({
    recipe: input.recipe,
    portableConfig: normalized.portableConfig,
  });
}
export class NimiAIProfileAuthoringBuilder {
  #profileId: string;
  #title: string;
  #description: string | undefined;
  #capabilities: Record<string, NimiPortableAIProfileCapability> = {};
  #provenance: NimiJsonObject | undefined;
  #license: NimiJsonValue | undefined;
  #displayMetadata: NimiJsonObject | undefined;

  constructor(input: NimiAIProfileAuthoringBuilderInput) {
    assertExactRecord(input, new Set([
      'profileId',
      'title',
      'description',
      'provenance',
      'license',
      'displayMetadata',
    ]), 'AIProfile builder input');
    this.#profileId = requireExactNonEmptyText(input.profileId, 'AIProfile profileId');
    this.#title = requireExactNonEmptyText(input.title, 'AIProfile title');
    this.#description = input.description === undefined
      ? undefined
      : requireExactText(input.description, 'AIProfile description');
    this.#provenance = input.provenance === undefined
      ? undefined
      : normalizeAuthoringJsonObject(input.provenance, 'AIProfile provenance');
    this.#license = input.license === undefined
      ? undefined
      : normalizeAuthoringJsonValue(input.license, 'AIProfile license');
    this.#displayMetadata = input.displayMetadata === undefined
      ? undefined
      : normalizeAuthoringJsonObject(input.displayMetadata, 'AIProfile displayMetadata');
  }

  static import(input: NimiPortableAIProfileInput): NimiAIProfileAuthoringBuilder {
    const profile = parseNimiPortableAIProfile(input);
    const builder = new NimiAIProfileAuthoringBuilder({
      profileId: profile.profileId,
      title: profile.title,
      ...(profile.description !== undefined ? { description: profile.description } : {}),
      ...(profile.provenance !== undefined ? { provenance: profile.provenance } : {}),
      ...(profile.license !== undefined ? { license: profile.license } : {}),
      ...(profile.displayMetadata !== undefined ? { displayMetadata: profile.displayMetadata } : {}),
    });
    builder.#capabilities = Object.fromEntries(
      Object.entries(profile.capabilities).map(([capabilityContract, capability]) => [
        capabilityContract,
        capability,
      ]),
    );
    return builder;
  }

  setProfileId(profileId: string): this {
    this.#profileId = requireExactNonEmptyText(profileId, 'AIProfile profileId');
    return this;
  }

  setTitle(title: string): this {
    this.#title = requireExactNonEmptyText(title, 'AIProfile title');
    return this;
  }

  setDescription(description: string | undefined): this {
    this.#description = description === undefined
      ? undefined
      : requireExactText(description, 'AIProfile description');
    return this;
  }

  setProvenance(provenance: NimiJsonObject | undefined): this {
    this.#provenance = provenance === undefined
      ? undefined
      : normalizeAuthoringJsonObject(provenance, 'AIProfile provenance');
    return this;
  }

  setLicense(license: NimiJsonValue | undefined): this {
    this.#license = license === undefined
      ? undefined
      : normalizeAuthoringJsonValue(license, 'AIProfile license');
    return this;
  }

  setDisplayMetadata(displayMetadata: NimiJsonObject | undefined): this {
    this.#displayMetadata = displayMetadata === undefined
      ? undefined
      : normalizeAuthoringJsonObject(displayMetadata, 'AIProfile displayMetadata');
    return this;
  }

  setLocalCapability(input: NimiAIProfileLocalCapabilityAuthoringInput): this {
    assertExactRecord(
      input,
      new Set([
        'capabilityContract',
        'requiredFeatures',
        'defaults',
        'localConfiguration',
        'resourceOccurrences',
        'loadout',
      ]),
      'Local capability input',
    );
    const capabilityContract = requireExactNonEmptyText(
      input.capabilityContract,
      'Local CapabilityContract',
    );
    const requiredFeatures = normalizeFeatureSet(
      input.requiredFeatures ?? [],
      `${capabilityContract} requiredFeatures`,
    );
    const defaults = input.defaults === undefined
      ? undefined
      : normalizeAuthoringJsonObject(input.defaults, `${capabilityContract} defaults`);
    let implementation: NimiPortableAIProfileImplementation | undefined;
    let driverPortableConfig: NimiJsonObject | undefined;
    if (input.localConfiguration !== undefined) {
      const local = normalizeLocalImplementationInput(
        input.localConfiguration,
        capabilityContract,
      );
      assertFeatureSubset(requiredFeatures, local.supportedFeatures, capabilityContract);
      implementation = Object.freeze({
        ...local.implementation,
        supportedFeatures: local.supportedFeatures,
      });
      driverPortableConfig = local.portableConfig;
    }
    const candidate = {
      route: 'local' as const,
      requiredFeatures,
      ...(defaults !== undefined ? { defaults } : {}),
      ...(implementation !== undefined ? { implementation } : {}),
      ...(driverPortableConfig !== undefined ? { driverPortableConfig } : {}),
      ...(input.resourceOccurrences !== undefined
        ? { resourceOccurrences: input.resourceOccurrences }
        : {}),
      ...(input.loadout !== undefined ? { loadout: input.loadout } : {}),
    };
    const normalized = parseNimiPortableAIProfile({
      profileId: 'profile.authoring.local-capability',
      title: 'Local capability authoring validation',
      capabilities: { [capabilityContract]: candidate },
    }).capabilities[capabilityContract];
    if (!normalized || normalized.route !== 'local') {
      return authoringError(`${capabilityContract} Local capability is invalid`);
    }
    assertAuthoringPortableValue(normalized, `${capabilityContract} Local capability`);
    this.#capabilities[capabilityContract] = normalized;
    return this;
  }

  setCloudCapability(input: NimiAIProfileCloudCapabilityAuthoringInput): this {
    assertExactRecord(
      input,
      new Set(['capabilityContract', 'requiredFeatures', 'defaults', 'recommendation']),
      'Cloud capability input',
    );
    const capabilityContract = requireExactNonEmptyText(
      input.capabilityContract,
      'Cloud CapabilityContract',
    );
    const requiredFeatures = normalizeFeatureSet(
      input.requiredFeatures ?? [],
      `${capabilityContract} requiredFeatures`,
    );
    const defaults = input.defaults === undefined
      ? undefined
      : normalizeAuthoringJsonObject(input.defaults, `${capabilityContract} defaults`);
    const recommendation = normalizeCloudRecommendation(input.recommendation);
    assertFeatureSubset(requiredFeatures, recommendation.supportedFeatures, capabilityContract);
    this.#capabilities[capabilityContract] = Object.freeze({
      route: 'cloud' as const,
      requiredFeatures,
      ...(defaults !== undefined ? { defaults } : {}),
      implementation: Object.freeze({
        ...recommendation.implementation,
        supportedFeatures: recommendation.supportedFeatures,
      }),
      providerModelTarget: recommendation.providerModelTarget,
    });
    return this;
  }

  removeCapability(capabilityContract: string): this {
    delete this.#capabilities[requireExactNonEmptyText(capabilityContract, 'CapabilityContract')];
    return this;
  }

  build(
    options: NimiAIProfileAuthoringValidationOptions = {},
  ): NimiPortableAIProfile {
    return validateNimiAIProfileAuthoring(this.#draft(), options).profile;
  }

  export(
    options: NimiAIProfileAuthoringValidationOptions = {},
  ): string {
    return exportNimiAIProfileAuthoring(this.#draft(), options);
  }

  #draft(): NimiPortableAIProfile {
    const capabilities = Object.fromEntries(
      Object.entries(this.#capabilities).sort(([left], [right]) => compareCanonicalText(left, right)),
    );
    return {
      profileId: this.#profileId,
      title: this.#title,
      ...(this.#description !== undefined ? { description: this.#description } : {}),
      capabilities,
      ...(this.#provenance !== undefined ? { provenance: this.#provenance } : {}),
      ...(this.#license !== undefined ? { license: this.#license } : {}),
      ...(this.#displayMetadata !== undefined ? { displayMetadata: this.#displayMetadata } : {}),
    };
  }
}

export function createNimiAIProfileAuthoringBuilder(
  input: NimiAIProfileAuthoringBuilderInput,
): NimiAIProfileAuthoringBuilder {
  return new NimiAIProfileAuthoringBuilder(input);
}

export function importNimiAIProfileAuthoring(
  input: NimiPortableAIProfileInput,
): NimiAIProfileAuthoringBuilder {
  return NimiAIProfileAuthoringBuilder.import(input);
}

export function validateNimiAIProfileAuthoring(
  input: NimiPortableAIProfileInput,
  options: NimiAIProfileAuthoringValidationOptions = {},
): NimiAIProfileAuthoringValidationResult {
  const profile = parseNimiPortableAIProfile(input);
  assertAuthoringPortableValue(profile, 'AIProfile');
  validateAuthoringMetadata(profile, options);
  const localConfigurationDigests: Record<string, NimiAIProfileEquivalenceDigest> = {};
  for (const [capabilityContract, capability] of Object.entries(profile.capabilities)) {
    if (capability.route === 'local' && capability.implementation) {
      localConfigurationDigests[capabilityContract] = localConfigurationDigestFromProfile(
        capabilityContract,
        capability,
      );
    }
  }
  return Object.freeze({
    profile,
    portableContentDigest: digestCanonical(
      'nimi.ai-profile.portable-content/v1',
      portableProfileContent(profile),
    ),
    localConfigurationDigests: Object.freeze(localConfigurationDigests),
  });
}

export function exportNimiAIProfileAuthoring(
  input: NimiPortableAIProfileInput,
  options: NimiAIProfileAuthoringValidationOptions = {},
): string {
  const validated = validateNimiAIProfileAuthoring(input, options);
  return serializeNimiPortableAIProfile(validated.profile);
}

export function deriveNimiAIProfilePortableContentDigest(
  input: NimiPortableAIProfileInput,
): NimiAIProfileEquivalenceDigest {
  const profile = validateNimiAIProfileAuthoring(input, OPTIONAL_METADATA_VALIDATION).profile;
  return digestCanonical('nimi.ai-profile.portable-content/v1', portableProfileContent(profile));
}

export function deriveNimiAIProfileLocalConfigurationEquivalenceDigest(
  input: NimiPortableAIProfileInput,
  capabilityContract: string,
): NimiAIProfileEquivalenceDigest {
  const profile = validateNimiAIProfileAuthoring(input, OPTIONAL_METADATA_VALIDATION).profile;
  const contract = requireExactNonEmptyText(capabilityContract, 'CapabilityContract');
  const capability = profile.capabilities[contract];
  if (!capability || capability.route !== 'local' || !capability.implementation) {
    return authoringError(`AIProfile ${contract} has no Local implementation configuration intent`);
  }
  return localConfigurationDigestFromProfile(contract, capability);
}

export function deriveNimiAIProfileRequirementProjection(
  input: NimiPortableAIProfileInput,
  capabilityContract: string,
  recipe: NimiLoadoutRecipe,
): NimiAIProfileAuthoringRequirementProjection {
  const profile = validateNimiAIProfileAuthoring(input, OPTIONAL_METADATA_VALIDATION).profile;
  const contract = requireExactNonEmptyText(capabilityContract, 'CapabilityContract');
  const capability = profile.capabilities[contract];
  if (!capability || capability.route !== 'local' || !capability.implementation) {
    return authoringError(`AIProfile ${contract} has no Local implementation configuration intent`);
  }
  return projectRuntimeRecipeRequirements(contract, capability.implementation, recipe);
}

export function deriveNimiAIProfileImportPreview(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly validation?: NimiAIProfileAuthoringValidationOptions;
}): NimiAIProfileImportPreview {
  assertExactRecord(input, new Set(['profile', 'validation']), 'AIProfile Import preview input');
  const source = validateNimiAIProfileAuthoring(input.profile, input.validation ?? {}).profile;
  return Object.freeze({
    action: 'import-profile' as const,
    source,
    artifactJson: serializeNimiPortableAIProfile(source),
    previewOnly: true as const,
    declaredWrites: Object.freeze({
      profileArtifact: true as const,
      aiConfig: false as const,
      localCapabilityConfigurations: false as const,
      machineSelection: false as const,
    }),
  });
}

export function deriveNimiAIProfileApplyPreview(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly target: NimiAIProfileApplyTarget;
  readonly before?: AIConfig | null;
  readonly validation?: NimiAIProfileAuthoringValidationOptions;
}): NimiAIProfileApplyPreview {
  assertExactRecord(
    input,
    new Set(['profile', 'target', 'before', 'validation']),
    'AIProfile Apply preview input',
  );
  const source = validateNimiAIProfileAuthoring(input.profile, input.validation ?? {}).profile;
  const target = normalizeApplyTarget(input.target);
  const owner = applyTargetOwner(target);
  const before = input.before ?? null;
  if (before !== null) assertAIConfigOwner(before, target);
  const capabilities: NimiAIProfileCapabilityPrefill[] = Object.entries(source.capabilities).map(([capabilityContract, capability]) => {
    if (capability.route === 'local') {
      return {
        capabilityContract,
        requiredFeatures: [...capability.requiredFeatures],
        ...(capability.defaults ? { defaults: RuntimeStruct.fromJson(capability.defaults as ProtoJsonValue) } : {}),
        route: { oneofKind: 'local' as const, local: {} },
      };
    }
    return {
      capabilityContract,
      requiredFeatures: [...capability.requiredFeatures],
      ...(capability.defaults ? { defaults: RuntimeStruct.fromJson(capability.defaults as ProtoJsonValue) } : {}),
      route: {
        oneofKind: 'cloud' as const,
        cloud: {
          implementation: implementationContent(capability.implementation),
          providerModelTarget: RuntimeStruct.fromJson(capability.providerModelTarget as ProtoJsonValue),
        },
      },
    };
  });
  const after: NimiAIProfileAIConfigPrefill = { owner, capabilities };
  const intentDiff = deriveAIConfigIntentDiff(before, after);
  const cloudConfigurations = Object.freeze(after.capabilities
    .filter((intent) => intent.route.oneofKind === 'cloud')
    .map((intent) => Object.freeze({
      capabilityContract: intent.capabilityContract,
      state: 'configured' as const,
    })));
  return Object.freeze({
    action: 'apply-to-ai-config' as const,
    target,
    source,
    before,
    after,
    intentDiff,
    cloudConfigurations,
    previewOnly: true as const,
    writesOnly: 'none' as const,
    requiresResourceSelection: true as const,
  });
}

export function deriveNimiAIProfileLocalConfigurationPreview(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly capabilityContract: string;
  readonly recipe: NimiLoadoutRecipe;
  readonly machine: NimiAIProfileAuthoringMachineProjection;
  readonly validation?: NimiAIProfileAuthoringValidationOptions;
}): NimiAIProfileLocalConfigurationPreview {
  assertExactRecord(
    input,
    new Set(['profile', 'capabilityContract', 'recipe', 'machine', 'validation']),
    'AIProfile Local configuration preview input',
  );
  const source = validateNimiAIProfileAuthoring(input.profile, input.validation ?? {}).profile;
  const capabilityContract = requireExactNonEmptyText(
    input.capabilityContract,
    'CapabilityContract',
  );
  const capability = source.capabilities[capabilityContract];
  if (!capability || capability.route !== 'local' || !capability.implementation) {
    return authoringError(`AIProfile ${capabilityContract} has no Local implementation configuration intent`);
  }
  const machine = normalizeMachineProjection(input.machine);
  const equivalenceDigest = localConfigurationDigestFromProfile(
    capabilityContract,
    capability,
  );
  const equivalent = machine.loadouts
    .filter((loadout) => loadout.capabilityContract === capabilityContract)
    .filter((loadout) => sameImplementation(
      loadout.implementation,
      capability.implementation!,
    ))
    .filter((loadout) => localConfigurationDigestFromMachineLoadout(loadout) === equivalenceDigest)
    .sort((left, right) => compareCanonicalText(left.loadoutId, right.loadoutId));
  const sameSource = equivalent.length > 0
    ? []
    : machine.loadouts
      .filter((loadout) => loadout.capabilityContract === capabilityContract)
      .filter((loadout) => sameProfileSource(source, loadout))
      .sort((left, right) => compareCanonicalText(left.loadoutId, right.loadoutId));
  const requirementProjection = projectRuntimeRecipeRequirements(
    capabilityContract,
    capability.implementation,
    input.recipe,
  );
  const decision: NimiAIProfileLocalConfigurationDecision = equivalent.length > 0
    ? Object.freeze({
      kind: 'reuse-equivalent' as const,
      matches: Object.freeze(equivalent.map((loadout) => Object.freeze({
        loadoutId: loadout.loadoutId,
        requirementResolution: loadout.requirementResolution,
      }))),
      expectedRequirementResolution: equivalent.every(
        (loadout) => loadout.requirementResolution === 'configured',
      ) ? 'configured' as const : 'unresolved' as const,
      requiresExistingRecordSelection: equivalent.length > 1,
    })
    : sameSource.length > 0
      ? Object.freeze({
        kind: 'choose-update-or-add' as const,
        updateCandidateLoadoutIds: Object.freeze(
          sameSource.map((loadout) => loadout.loadoutId),
        ),
        updateExpectedRequirementResolution: 'unresolved' as const,
        addExpectedRequirementResolution: 'unresolved' as const,
      })
      : Object.freeze({
        kind: 'add-new' as const,
        expectedRequirementResolution: 'unresolved' as const,
      });
  return Object.freeze({
    action: 'add-or-update-loadout' as const,
    source,
    proposal: Object.freeze({
      capabilityContract,
      implementation: Object.freeze({
        implementationId: capability.implementation.implementationId,
        driverId: capability.implementation.driverId,
        driverDialect: capability.implementation.driverDialect,
      }),
      portableConfig: capability.driverPortableConfig ?? Object.freeze({}),
      supportedFeatures: capability.implementation.supportedFeatures,
      displayName: source.title,
      ...(source.provenance !== undefined ? { provenance: source.provenance } : {}),
    }),
    equivalenceDigest,
    requirementProjection,
    decision,
    runtimeMayConfigureExactPreferredContentAtCommit: requirementProjection.requirements.some(
      (requirement) => requirement.recommendedContentIds.length > 0,
    ),
    previewOnly: true as const,
    writesOnly: 'machine-loadout' as const,
    doesNotSelect: true as const,
  });
}

export function deriveNimiAIProfileSelectionMismatchPreview(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly capabilityContract: string;
  readonly machine: NimiAIProfileAuthoringMachineProjection;
  readonly cloudAlternative?: NimiAIProfileSelectionCloudAlternative;
  readonly validation?: NimiAIProfileAuthoringValidationOptions;
}): NimiAIProfileSelectionMismatchPreview {
  assertExactRecord(
    input,
    new Set(['profile', 'capabilityContract', 'machine', 'cloudAlternative', 'validation']),
    'AIProfile selection preview input',
  );
  const source = validateNimiAIProfileAuthoring(input.profile, input.validation ?? {}).profile;
  const capabilityContract = requireExactNonEmptyText(
    input.capabilityContract,
    'CapabilityContract',
  );
  const capability = source.capabilities[capabilityContract];
  if (!capability) return authoringError(`AIProfile does not declare ${capabilityContract}`);
  const requiredFeatures = capability.requiredFeatures;
  const machine = normalizeMachineProjection(input.machine);
  const currentSelection = machine.selections.find(
    (selection) => selection.capabilityContract === capabilityContract,
  );
  const currentLoadout = currentSelection
    ? machine.loadouts.find(
      (loadout) => loadout.loadoutId === currentSelection.loadoutId,
    )
    : undefined;
  if (currentSelection && !currentLoadout) {
    return authoringError(`Machine selection for ${capabilityContract} is dangling`);
  }

  const localCapability = capability.route === 'local' && capability.implementation
    ? capability
    : null;
  const equivalentLoadoutIds = localCapability?.implementation
    ? machine.loadouts
      .filter((loadout) => loadout.capabilityContract === capabilityContract)
      .filter((loadout) => sameImplementation(
        loadout.implementation,
        localCapability.implementation!,
      ))
      .filter((loadout) => (
        localConfigurationDigestFromMachineLoadout(loadout)
          === localConfigurationDigestFromProfile(capabilityContract, localCapability)
      ))
      .map((loadout) => loadout.loadoutId)
      .sort()
    : [];

  const cloud = capability.route === 'cloud'
    ? {
      implementation: capability.implementation,
      supportedFeatures: capability.implementation.supportedFeatures,
      providerModelTarget: capability.providerModelTarget,
    }
    : input.cloudAlternative === undefined
      ? null
      : normalizeSelectionCloudAlternative(input.cloudAlternative);

  const currentFeatureSubset = currentLoadout
    ? deriveFeatureSubset(requiredFeatures, currentLoadout.supportedFeatures)
    : unavailableFeatureSubset(requiredFeatures);
  const recommendedFeatureSubset = localCapability?.implementation
    ? deriveFeatureSubset(requiredFeatures, localCapability.implementation.supportedFeatures)
    : unavailableFeatureSubset(requiredFeatures);
  const cloudFeatureSubset = cloud
    ? deriveFeatureSubset(requiredFeatures, cloud.supportedFeatures)
    : unavailableFeatureSubset(requiredFeatures);

  return Object.freeze({
    action: 'selection-mismatch' as const,
    capabilityContract,
    requiredFeatures,
    branches: Object.freeze([
      Object.freeze({
        kind: 'continue-current-selection' as const,
        loadoutId: currentLoadout?.loadoutId ?? null,
        featureSubset: currentFeatureSubset,
        changesSelection: false as const,
      }),
      Object.freeze({
        kind: 'select-recommended-local-configuration' as const,
        loadoutIds: Object.freeze(equivalentLoadoutIds),
        prerequisite: !localCapability
          ? 'local-recommendation-unavailable' as const
          : equivalentLoadoutIds.length > 0
            ? 'none' as const
            : 'add-or-update-local-configuration' as const,
        featureSubset: recommendedFeatureSubset,
        changesSelection: localCapability !== null && (
          equivalentLoadoutIds.length === 0
          || !equivalentLoadoutIds.includes(currentLoadout?.loadoutId ?? '')
        ),
      }),
      Object.freeze({
        kind: 'use-cloud' as const,
        implementation: cloud
          ? Object.freeze({
            implementationId: cloud.implementation.implementationId,
            driverId: cloud.implementation.driverId,
            driverDialect: cloud.implementation.driverDialect,
          })
          : null,
        providerModelTarget: cloud?.providerModelTarget ?? null,
        featureSubset: cloudFeatureSubset,
        prerequisite: cloud
          ? 'apply-cloud-intent' as const
          : 'cloud-recommendation-unavailable' as const,
      }),
    ] as const),
    mismatchFailsClosed: true as const,
    previewOnly: true as const,
    commits: false as const,
  });
}

const OPTIONAL_METADATA_VALIDATION: NimiAIProfileAuthoringValidationOptions = Object.freeze({
  requireProvenance: false,
  requireLicense: false,
  requireNonEmptyProvenance: false,
  requireNonEmptyLicense: false,
});

function normalizeLocalImplementationInput(
  input: NimiAIProfileLocalImplementationAuthoringInput,
  capabilityContract: string,
): {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures: readonly string[];
  readonly portableConfig: NimiJsonObject;
} {
  assertExactRecord(
    input,
    new Set(['recipe', 'portableConfig']),
    `${capabilityContract} Local implementation`,
  );
  const recipe = requireRecord(
    input.recipe,
    `${capabilityContract} Runtime Recipe is required`,
  );
  const recipeContract = requireExactNonEmptyText(
    recipe.capabilityContract,
    `${capabilityContract} Runtime Recipe CapabilityContract`,
  );
  if (recipeContract !== capabilityContract) {
    return authoringError(
      `Runtime Recipe ${String(recipe.recipeId || '')} belongs to ${recipeContract}, not ${capabilityContract}`,
    );
  }
  return Object.freeze({
    implementation: normalizeImplementation(
      recipe.implementation,
      `${capabilityContract} Runtime Recipe implementation`,
    ),
    supportedFeatures: normalizeFeatureSet(
      recipe.supportedFeatures,
      `${capabilityContract} Runtime Recipe supportedFeatures`,
    ),
    portableConfig: normalizeAuthoringJsonObject(
      input.portableConfig ?? recipe.defaultOptions,
      `${capabilityContract} portableConfig`,
    ),
  });
}
function normalizeCloudRecommendation(
  input: NimiAIProfileCloudRecommendationAuthoringInput,
): {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures: readonly string[];
  readonly providerModelTarget: NimiJsonObject;
} {
  assertExactRecord(
    input,
    new Set(CLOUD_RECOMMENDATION_FIELDS),
    'Cloud recommendation',
  );
  const providerModelTarget = normalizeAuthoringJsonObject(
    input.providerModelTarget,
    'Cloud providerModelTarget',
  );
  assertExactCloudRecommendationTarget(providerModelTarget, 'Cloud providerModelTarget');
  return Object.freeze({
    implementation: normalizeImplementation(input.implementation, 'Cloud implementation'),
    supportedFeatures: normalizeFeatureSet(
      input.supportedFeatures ?? [],
      'Cloud supportedFeatures',
    ),
    providerModelTarget,
  });
}

function normalizeSelectionCloudAlternative(
  input: NimiAIProfileSelectionCloudAlternative,
): NimiAIProfileSelectionCloudAlternative {
  assertExactRecord(
    input,
    new Set(['implementation', 'supportedFeatures', 'providerModelTarget']),
    'Cloud selection alternative',
  );
  const providerModelTarget = normalizeAuthoringJsonObject(
    input.providerModelTarget,
    'Cloud selection providerModelTarget',
  );
  assertExactCloudRecommendationTarget(
    providerModelTarget,
    'Cloud selection providerModelTarget',
  );
  return Object.freeze({
    implementation: normalizeImplementation(input.implementation, 'Cloud selection implementation'),
    supportedFeatures: normalizeFeatureSet(
      input.supportedFeatures,
      'Cloud selection supportedFeatures',
    ),
    providerModelTarget,
  });
}

function assertExactCloudRecommendationTarget(
  target: NimiJsonObject,
  label: string,
): void {
  if (Object.hasOwn(target, 'model')) {
    return authoringError(`${label}.model is not supported`);
  }
  for (const key of ['provider', 'providerModelId', 'remoteModelCatalogId'] as const) {
    const value = target[key];
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
      return authoringError(`${label}.${key} is required`);
    }
  }
}

function projectRuntimeRecipeRequirements(
  capabilityContract: string,
  implementation: NimiPortableAIProfileImplementation,
  recipe: NimiLoadoutRecipe,
): NimiAIProfileAuthoringRequirementProjection {
  const normalized = normalizeLocalImplementationInput({ recipe }, capabilityContract);
  if (!sameImplementation(implementation, normalized.implementation)) {
    return authoringError(
      `AIProfile ${capabilityContract} implementation does not match Runtime Recipe ${recipe.recipeId}`,
    );
  }
  const profileFeatures = normalizeFeatureSet(
    implementation.supportedFeatures,
    `${capabilityContract} implementation supportedFeatures`,
  );
  if (
    profileFeatures.length !== normalized.supportedFeatures.length
    || profileFeatures.some((feature, index) => feature !== normalized.supportedFeatures[index])
  ) {
    return authoringError(
      `AIProfile ${capabilityContract} supportedFeatures do not match Runtime Recipe ${recipe.recipeId}`,
    );
  }
  const recipeId = requireExactNonEmptyText(recipe.recipeId, 'Runtime Recipe recipeId');
  const recipeRevision = requireExactNonEmptyText(recipe.revision, 'Runtime Recipe revision');
  if (!Array.isArray(recipe.slots)) {
    return authoringError(`Runtime Recipe ${recipeId} slots must be an array`);
  }
  const requirements = recipe.slots.map((slot, index) => {
    const value = requireRecord(slot, `Runtime Recipe ${recipeId} slot ${index}`);
    return Object.freeze({
      slotId: requireExactNonEmptyText(value.slotId, `Runtime Recipe ${recipeId} slotId`),
      displayLabel: requireExactNonEmptyText(
        value.displayLabel,
        `Runtime Recipe ${recipeId} slot displayLabel`,
      ),
      recommendedContentIds: normalizeFeatureSet(
        value.recommendedContentIds,
        `Runtime Recipe ${recipeId} recommendedContentIds`,
      ),
      recommendedVariantIds: normalizeFeatureSet(
        value.recommendedVariantIds,
        `Runtime Recipe ${recipeId} recommendedVariantIds`,
      ),
      modelContract: normalizeAuthoringJsonObject(
        value.modelContract,
        `Runtime Recipe ${recipeId} modelContract`,
      ),
    });
  });
  assertUnique(requirements.map((requirement) => requirement.slotId), `Runtime Recipe ${recipeId} slotId`);
  return Object.freeze({
    source: 'runtime-recipe' as const,
    recipeId,
    recipeRevision,
    requirements: Object.freeze(requirements),
  });
}
function validateAuthoringMetadata(
  profile: NimiPortableAIProfile,
  options: NimiAIProfileAuthoringValidationOptions,
): void {
  assertExactRecord(
    options,
    new Set([
      'requireProvenance',
      'requireLicense',
      'requireNonEmptyProvenance',
      'requireNonEmptyLicense',
    ]),
    'AIProfile validation options',
  );
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined && typeof value !== 'boolean') {
      return authoringError(`AIProfile validation option ${name} must be a boolean`);
    }
  }
  const requireProvenance = options.requireProvenance ?? true;
  const requireLicense = options.requireLicense ?? true;
  const requireNonEmptyProvenance = options.requireNonEmptyProvenance ?? true;
  const requireNonEmptyLicense = options.requireNonEmptyLicense ?? true;
  if (requireProvenance && profile.provenance === undefined) {
    return authoringError('AIProfile provenance is required for authoring export');
  }
  if (
    profile.provenance !== undefined
    && requireNonEmptyProvenance
    && Object.keys(profile.provenance).length === 0
  ) {
    return authoringError('AIProfile provenance cannot be empty');
  }
  if (requireLicense && profile.license === undefined) {
    return authoringError('AIProfile license is required for authoring export');
  }
  if (
    profile.license !== undefined
    && requireNonEmptyLicense
    && !isStructurallyNonEmpty(profile.license)
  ) {
    return authoringError('AIProfile license cannot be empty');
  }
}

function isStructurallyNonEmpty(value: NimiJsonValue): boolean {
  if (value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function portableProfileContent(profile: NimiPortableAIProfile): unknown {
  return {
    capabilities: Object.entries(profile.capabilities).map(([capabilityContract, capability]) => ({
      capabilityContract,
      route: capability.route,
      requiredFeatures: [...capability.requiredFeatures],
      ...(capability.defaults !== undefined ? { defaults: capability.defaults } : {}),
      ...(capability.implementation !== undefined
        ? { implementation: capability.implementation }
        : {}),
      ...(capability.route === 'local'
        ? {
          ...(capability.driverPortableConfig !== undefined
            ? { driverPortableConfig: capability.driverPortableConfig }
            : {}),
          ...(capability.resourceOccurrences !== undefined
            ? { resourceOccurrences: capability.resourceOccurrences }
            : {}),
          ...(capability.loadout !== undefined ? { loadout: capability.loadout } : {}),
        }
        : { providerModelTarget: capability.providerModelTarget }),
    })),
  };
}

function localConfigurationDigestFromProfile(
  capabilityContract: string,
  capability: Extract<NimiPortableAIProfileCapability, { readonly route: 'local' }>,
): NimiAIProfileEquivalenceDigest {
  if (!capability.implementation) {
    return authoringError(`AIProfile ${capabilityContract} has no Local implementation`);
  }
  return digestCanonical(
    'nimi.loadout.portable-content/v1',
    {
      capabilityContract,
      implementation: implementationContent(capability.implementation),
      driverPortableConfig: capability.driverPortableConfig ?? {},
      loadout: capability.loadout ? portableLoadoutEquivalence(capability.loadout) : null,
      supportedFeatures: [...capability.implementation.supportedFeatures],
    },
  );
}

function localConfigurationDigestFromMachineLoadout(
  loadout: NimiAIProfileAuthoringMachineLoadoutProjection,
): NimiAIProfileEquivalenceDigest {
  const implementation = normalizeImplementation(
    loadout.implementation,
    `${loadout.capabilityContract} machine implementation`,
  );
  const supportedFeatures = normalizeFeatureSet(
    loadout.supportedFeatures,
    `${loadout.capabilityContract} machine supportedFeatures`,
  );
  const portableConfig = loadout.portableConfig === undefined
    ? Object.freeze({})
    : normalizeAuthoringJsonObject(
      loadout.portableConfig,
      `${loadout.capabilityContract} machine portableConfig`,
    );
  return digestCanonical(
    'nimi.loadout.portable-content/v1',
    {
      capabilityContract: loadout.capabilityContract,
      implementation: implementationContent(implementation),
      driverPortableConfig: portableConfig,
      loadout: loadout.loadout ?? null,
      supportedFeatures,
    },
  );
}

function portableLoadoutEquivalence(
  loadout: NonNullable<Extract<NimiPortableAIProfileCapability, { readonly route: 'local' }>['loadout']>,
): unknown {
  return {
    recipeId: loadout.recipeId,
    axes: loadout.axes.map((axis) => ({ slotId: axis.slotId, contentId: axis.contentId })),
    options: loadout.options,
  };
}

function implementationContent(
  implementation: CapabilityImplementationIdentity,
): CapabilityImplementationIdentity {
  return {
    implementationId: implementation.implementationId,
    driverId: implementation.driverId,
    driverDialect: implementation.driverDialect,
  };
}

function digestCanonical(domain: string, value: unknown): NimiAIProfileEquivalenceDigest {
  const encoded = new TextEncoder().encode(`${domain}\n${canonicalJson(value)}`);
  return `sha256:${sha256Hex(encoded)}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return authoringError('canonical digest input contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCanonicalText(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return authoringError('canonical digest input is not portable JSON');
}

function normalizeMachineProjection(
  input: NimiAIProfileAuthoringMachineProjection,
): NimiAIProfileAuthoringMachineProjection {
  if (!input || !Array.isArray(input.loadouts) || !Array.isArray(input.selections)) {
    return authoringError('Machine Loadout projection is invalid');
  }
  const loadouts = input.loadouts.map((loadout, index) => {
    if (!loadout || typeof loadout !== 'object') {
      return authoringError(`Machine Loadout[${index}] is invalid`);
    }
    const normalized = Object.freeze({
      loadoutId: requireExactNonEmptyText(
        loadout.loadoutId,
        `Machine Loadout[${index}].loadoutId`,
      ),
      capabilityContract: requireExactNonEmptyText(
        loadout.capabilityContract,
        `Machine Loadout[${index}].capabilityContract`,
      ),
      implementation: normalizeImplementation(
        loadout.implementation,
        `Machine Loadout[${index}].implementation`,
      ),
      ...(loadout.portableConfig !== undefined
        ? {
          portableConfig: normalizeJsonObject(
            loadout.portableConfig,
            `Machine Loadout[${index}].portableConfig`,
          ),
        }
        : {}),
      supportedFeatures: normalizeFeatureSet(
        loadout.supportedFeatures,
        `Machine Loadout[${index}].supportedFeatures`,
      ),
      requirementResolution: requireRequirementResolution(
        loadout.requirementResolution,
        `Machine Loadout[${index}].requirementResolution`,
      ),
      ...(loadout.provenance !== undefined
        ? {
          provenance: normalizeJsonObject(
            loadout.provenance,
            `Machine Loadout[${index}].provenance`,
          ),
        }
        : {}),
      ...(loadout.sourceProfileId !== undefined
        ? {
          sourceProfileId: requireExactNonEmptyText(
            loadout.sourceProfileId,
            `Machine Loadout[${index}].sourceProfileId`,
          ),
        }
        : {}),
      ...(loadout.loadout !== undefined
        ? { loadout: normalizeMachineLoadoutIntent(loadout.loadout, index) }
        : {}),
    });
    return normalized;
  });
  assertUnique(
    loadouts.map((loadout) => loadout.loadoutId),
    'Machine Loadout ids',
  );
  const byId = new Map(
    loadouts.map((loadout) => [loadout.loadoutId, loadout] as const),
  );
  const selections = input.selections.map((selection, index) => {
    if (!selection || typeof selection !== 'object') {
      return authoringError(`Machine selection[${index}] is invalid`);
    }
    const normalized = Object.freeze({
      capabilityContract: requireExactNonEmptyText(
        selection.capabilityContract,
        `Machine selection[${index}].capabilityContract`,
      ),
      loadoutId: requireExactNonEmptyText(
        selection.loadoutId,
        `Machine selection[${index}].loadoutId`,
      ),
    });
    const loadout = byId.get(normalized.loadoutId);
    if (!loadout || loadout.capabilityContract !== normalized.capabilityContract) {
      return authoringError(`Machine selection[${index}] is dangling or mismatched`);
    }
    return normalized;
  });
  assertUnique(
    selections.map((selection) => selection.capabilityContract),
    'Machine selection capability contracts',
  );
  return Object.freeze({
    loadouts: Object.freeze(loadouts),
    selections: Object.freeze(selections),
  });
}

function normalizeMachineLoadoutIntent(
  input: NonNullable<NimiAIProfileAuthoringMachineLoadoutProjection['loadout']>,
  loadoutIndex: number,
): NonNullable<NimiAIProfileAuthoringMachineLoadoutProjection['loadout']> {
  if (!input || typeof input !== 'object' || !Array.isArray(input.axes)) {
    return authoringError(`Machine Loadout[${loadoutIndex}].loadout is invalid`);
  }
  const axes = input.axes.map((axis, axisIndex) => {
    const slotId = requireExactNonEmptyText(
      axis?.slotId,
      `Machine Loadout[${loadoutIndex}].loadout.axes[${axisIndex}].slotId`,
    );
    const contentId = requireExactNonEmptyText(
      axis?.contentId,
      `Machine Loadout[${loadoutIndex}].loadout.axes[${axisIndex}].contentId`,
    );
    if (!/^sha256:[a-f0-9]{64}$/u.test(contentId)) {
      return authoringError(`Machine Loadout[${loadoutIndex}].loadout.axes[${axisIndex}].contentId is invalid`);
    }
    return Object.freeze({ slotId, contentId });
  });
  assertUnique(axes.map((axis) => axis.slotId), `Machine Loadout[${loadoutIndex}] slots`);
  return Object.freeze({
    recipeId: requireExactNonEmptyText(input.recipeId, `Machine Loadout[${loadoutIndex}].loadout.recipeId`),
    axes: Object.freeze(axes),
    options: normalizeJsonObject(input.options, `Machine Loadout[${loadoutIndex}].loadout.options`),
  });
}

function sameProfileSource(
  profile: NimiPortableAIProfile,
  loadout: NimiAIProfileAuthoringMachineLoadoutProjection,
): boolean {
  if (loadout.sourceProfileId === profile.profileId) return true;
  if (profile.provenance === undefined || loadout.provenance === undefined) return false;
  if (Object.keys(profile.provenance).length === 0) return false;
  return canonicalJson(profile.provenance) === canonicalJson(loadout.provenance);
}

function deriveFeatureSubset(
  requiredFeatures: readonly string[],
  supportedFeatures: readonly string[],
): NimiAIProfileFeatureSubsetResult {
  const required = normalizeFeatureSet(requiredFeatures, 'requiredFeatures');
  const supported = normalizeFeatureSet(supportedFeatures, 'supportedFeatures');
  const supportedSet = new Set(supported);
  const missingFeatures = Object.freeze(required.filter((feature) => !supportedSet.has(feature)));
  return Object.freeze({
    status: missingFeatures.length === 0 ? 'compatible' as const : 'feature-mismatch' as const,
    compatible: missingFeatures.length === 0,
    requiredFeatures: required,
    supportedFeatures: supported,
    missingFeatures,
  });
}

function unavailableFeatureSubset(
  requiredFeatures: readonly string[],
): NimiAIProfileFeatureSubsetResult {
  return Object.freeze({
    status: 'unavailable' as const,
    compatible: false,
    requiredFeatures: normalizeFeatureSet(requiredFeatures, 'requiredFeatures'),
    supportedFeatures: Object.freeze([]),
    missingFeatures: Object.freeze([...requiredFeatures]),
  });
}

function normalizeApplyTarget(target: NimiAIProfileApplyTarget): NimiAIProfileApplyTarget {
  const record = requireRecord(target, 'AIConfig Apply target must be an object');
  if (record.kind === 'app') {
    assertExactRecord(record, new Set(['kind', 'appId']), 'App AIConfig Apply target');
    return Object.freeze({
      kind: 'app' as const,
      appId: requireExactNonEmptyText(record.appId, 'App AIConfig target appId'),
    });
  }
  if (record.kind === 'shared-local-agent') {
    assertExactRecord(record, new Set(['kind']), 'shared LocalAgent AIConfig Apply target');
    return Object.freeze({ kind: 'shared-local-agent' as const });
  }
  return authoringError('AIConfig Apply target kind is unsupported');
}

function applyTargetOwner(target: NimiAIProfileApplyTarget): AIConfigOwner {
  return target.kind === 'app'
    ? { owner: { oneofKind: 'app', app: { appId: target.appId } } }
    : {
      owner: {
        oneofKind: 'runtimeLocalAgentSubsystem',
        runtimeLocalAgentSubsystem: {},
      },
    };
}

function assertAIConfigOwner(config: AIConfig, target: NimiAIProfileApplyTarget): void {
  const owner = config?.owner?.owner;
  if (
    target.kind === 'app'
      ? owner?.oneofKind !== 'app' || owner.app.appId !== target.appId
      : owner?.oneofKind !== 'runtimeLocalAgentSubsystem'
  ) {
    return authoringError('AIConfig Apply preview before projection has a mismatched owner');
  }
}

function deriveAIConfigIntentDiff(
  before: AIConfig | null,
  after: NimiAIProfileAIConfigPrefill,
): NimiAIProfileAIConfigIntentDiff {
  const beforeByContract = indexAIConfigIntents(before?.capabilities ?? [], 'before AIConfig');
  const afterByContract = indexAIConfigIntents(after.capabilities, 'after AIConfig');
  const contracts = [...new Set([...beforeByContract.keys(), ...afterByContract.keys()])].sort();
  const addedCapabilityContracts: string[] = [];
  const removedCapabilityContracts: string[] = [];
  const changedCapabilityContracts: string[] = [];
  const unchangedCapabilityContracts: string[] = [];
  for (const capabilityContract of contracts) {
    const beforeIntent = beforeByContract.get(capabilityContract);
    const afterIntent = afterByContract.get(capabilityContract);
    if (!beforeIntent) addedCapabilityContracts.push(capabilityContract);
    else if (!afterIntent) removedCapabilityContracts.push(capabilityContract);
    else if (canonicalAIConfigIntent(beforeIntent) === canonicalAIConfigIntent(afterIntent)) {
      unchangedCapabilityContracts.push(capabilityContract);
    } else {
      changedCapabilityContracts.push(capabilityContract);
    }
  }
  return Object.freeze({
    addedCapabilityContracts: Object.freeze(addedCapabilityContracts),
    removedCapabilityContracts: Object.freeze(removedCapabilityContracts),
    changedCapabilityContracts: Object.freeze(changedCapabilityContracts),
    unchangedCapabilityContracts: Object.freeze(unchangedCapabilityContracts),
  });
}

function indexAIConfigIntents(
  intents: readonly (AIConfigCapabilityIntent | NimiAIProfileCapabilityPrefill)[],
  label: string,
): Map<string, AIConfigCapabilityIntent | NimiAIProfileCapabilityPrefill> {
  if (!Array.isArray(intents)) return authoringError(`${label} capabilities must be an array`);
  const result = new Map<string, AIConfigCapabilityIntent | NimiAIProfileCapabilityPrefill>();
  for (const intent of intents) {
    const capabilityContract = requireExactNonEmptyText(
      intent?.capabilityContract,
      `${label} CapabilityContract`,
    );
    if (result.has(capabilityContract)) {
      return authoringError(`${label} contains duplicate ${capabilityContract} intent`);
    }
    result.set(capabilityContract, intent);
  }
  return result;
}

function canonicalAIConfigIntent(intent: AIConfigCapabilityIntent | NimiAIProfileCapabilityPrefill): string {
  return canonicalJson(canonicalAIConfigIntentValue(intent));
}

function canonicalAIConfigIntentValue(intent: AIConfigCapabilityIntent | NimiAIProfileCapabilityPrefill): {
  readonly capabilityContract: string;
  readonly requiredFeatures: readonly string[];
  readonly defaults?: NimiJsonObject;
  readonly route: unknown;
} {
  const capabilityContract = requireExactNonEmptyText(
    intent.capabilityContract,
    'AIConfig CapabilityContract',
  );
  const requiredFeatures = normalizeFeatureSet(
    intent.requiredFeatures,
    `${capabilityContract} requiredFeatures`,
  );
  if (intent.route.oneofKind === 'local') {
    return {
      capabilityContract,
      requiredFeatures,
      ...(intent.defaults !== undefined
        ? { defaults: runtimeAIConfigStructToJson(intent.defaults) }
        : {}),
      route: { kind: 'local' },
    };
  }
  if (intent.route.oneofKind === 'cloud') {
    return {
      capabilityContract,
      requiredFeatures,
      ...(intent.defaults !== undefined
        ? { defaults: runtimeAIConfigStructToJson(intent.defaults) }
        : {}),
      route: {
        kind: 'cloud',
        implementation: normalizeImplementation(
          intent.route.cloud.implementation,
          `${capabilityContract} Cloud implementation`,
        ),
        providerModelTarget: runtimeAIConfigStructToJson(
          intent.route.cloud.providerModelTarget,
        ),
      },
    };
  }
  return authoringError(`AIConfig ${capabilityContract} route is missing`);
}

function normalizeImplementation(
  value: unknown,
  label: string,
  allowSupportedFeatures = false,
): CapabilityImplementationIdentity {
  const record = requireRecord(value, `${label} must be an object`);
  assertExactRecord(
    record,
    new Set([
      'implementationId',
      'driverId',
      'driverDialect',
      ...(allowSupportedFeatures ? ['supportedFeatures'] : []),
    ]),
    label,
  );
  return Object.freeze({
    implementationId: requireExactNonEmptyText(record.implementationId, `${label}.implementationId`),
    driverId: requireExactNonEmptyText(record.driverId, `${label}.driverId`),
    driverDialect: requireExactNonEmptyText(record.driverDialect, `${label}.driverDialect`),
  });
}

function sameImplementation(
  left: CapabilityImplementationIdentity,
  right: CapabilityImplementationIdentity,
): boolean {
  return left.implementationId === right.implementationId
    && left.driverId === right.driverId
    && left.driverDialect === right.driverDialect;
}

function assertFeatureSubset(
  requiredFeatures: readonly string[],
  supportedFeatures: readonly string[],
  capabilityContract: string,
): void {
  const supported = new Set(supportedFeatures);
  const missing = requiredFeatures.find((feature) => !supported.has(feature));
  if (missing) {
    return authoringError(`${capabilityContract} implementation does not support required feature ${missing}`);
  }
}

function normalizeFeatureSet(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) return authoringError(`${label} must be an array`);
  const features = value
    .map((feature, index) => requireExactNonEmptyText(feature, `${label}[${index}]`))
    .sort();
  if (new Set(features).size !== features.length) {
    return authoringError(`${label} must not contain duplicates`);
  }
  return Object.freeze(features);
}

function normalizeAuthoringJsonObject(value: unknown, label: string): NimiJsonObject {
  const normalized = normalizeJsonObject(value, label);
  assertAuthoringPortableValue(normalized, label);
  return normalized;
}

function normalizeAuthoringJsonValue(value: unknown, label: string): NimiJsonValue {
  const normalized = normalizeJsonValue(value, label);
  assertAuthoringPortableValue(normalized, label);
  return normalized;
}

function normalizeJsonObject(value: unknown, label: string): NimiJsonObject {
  const record = requireRecord(value, `${label} must be an object`);
  const normalized: Record<string, NimiJsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    if (UNSAFE_KEYS.has(key)) return authoringError(`${label} contains unsafe key ${key}`);
    normalized[key] = normalizeJsonValue(record[key], `${label}.${key}`);
  }
  return Object.freeze(normalized);
}

function normalizeJsonValue(value: unknown, label: string): NimiJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => normalizeJsonValue(entry, `${label}[${index}]`)));
  }
  if (value && typeof value === 'object') return normalizeJsonObject(value, label);
  return authoringError(`${label} is not portable JSON`);
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FORBIDDEN_EXACT_KEYS = new Set([
  'account',
  'accountid',
  'assetid',
  'connector',
  'connectorid',
  'credential',
  'credentials',
  'deviceid',
  'grant',
  'grantid',
  'hostid',
  'localassetid',
  'machine',
  'machineid',
  'ownerid',
  'owneruserid',
  'password',
  'path',
  'privatekey',
  'secret',
  'secrets',
  'subjectid',
  'subjectuserid',
  'token',
  'userid',
]);

function assertAuthoringPortableValue(value: unknown, label: string): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (isAbsoluteOrFilePath(value)) return authoringError(`${label} contains a non-portable path`);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return authoringError(`${label} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAuthoringPortableValue(entry, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(key)) return authoringError(`${label} contains unsafe key ${key}`);
      const normalized = normalizeIdentityKey(key);
      if (isForbiddenIdentityKey(normalized)) {
        return authoringError(`${label}.${key} is forbidden in portable AIProfile authoring`);
      }
      assertAuthoringPortableValue(entry, `${label}.${key}`);
    }
    return;
  }
  return authoringError(`${label} contains unsupported portable JSON`);
}

function normalizeIdentityKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function isForbiddenIdentityKey(key: string): boolean {
  return FORBIDDEN_EXACT_KEYS.has(key)
    || key.startsWith('machine')
    || key.endsWith('machineid')
    || key.endsWith('machineref')
    || key.startsWith('account')
    || key.endsWith('account')
    || key.endsWith('accountid')
    || key.endsWith('accountref')
    || key.endsWith('userid')
    || key.startsWith('connector')
    || key.endsWith('connectorid')
    || key.endsWith('connectorref')
    || key.startsWith('grant')
    || key.endsWith('grantid')
    || key.endsWith('grantref')
    || key.includes('connectorgrant')
    || key.includes('credential')
    || key.includes('secret')
    || key.endsWith('privatekey')
    || key === 'apikey'
    || key.endsWith('accesstoken')
    || key.endsWith('refreshtoken')
    || key.endsWith('oauthtoken')
    || key.endsWith('path')
    || key.endsWith('assetid')
    || key.endsWith('artifactid')
    || key.includes('localasset');
}

function isAbsoluteOrFilePath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('/')
    || trimmed.startsWith('\\\\')
    || trimmed.startsWith('~/')
    || trimmed.toLowerCase().startsWith('file://')
    || /^[A-Za-z]:[\\/]/u.test(trimmed);
}

function requireRequirementResolution(
  value: unknown,
  label: string,
): 'unresolved' | 'configured' {
  if (value !== 'unresolved' && value !== 'configured') {
    return authoringError(`${label} must be unresolved or configured`);
  }
  return value;
}

function assertExactRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const record = requireRecord(value, `${label} must be an object`);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) return authoringError(`${label} contains unsupported field ${unknown[0]}`);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return authoringError(message);
  return value as Record<string, unknown>;
}

function requireExactNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return authoringError(`${label} must be exact non-empty text`);
  }
  return value;
}

function requireExactText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value) {
    return authoringError(`${label} must be exact text`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) return authoringError(`${label} must be unique`);
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function authoringError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'AI_PROFILE_AUTHORING_INVALID',
    actionHint: 'provide_valid_portable_ai_profile_authoring_input',
    source: 'sdk',
  });
}
