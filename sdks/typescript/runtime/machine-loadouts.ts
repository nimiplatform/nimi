import {
  LoadoutValidationState,
  LocalCapabilityRequirementPresence,
  LocalCapabilityRequirementResolution,
  LocalRecommendationApplicability,
  ReasonCode as RuntimeGeneratedReasonCode,
  type Loadout,
  type LoadoutModelAxis,
  type LoadoutRecipeDescriptor,
  type LoadoutSelection,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
} from '../core-generated/runtime-typed-client.js';
import { createNimiClientId, createNimiError, ReasonCode as NimiReasonCode, type JsonObject } from '../types/index.js';
import { fromNimiRuntimeProtoStruct, toNimiRuntimeProtoStruct } from './runtime-agent-values.js';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs.js';
import {
  projectNimiTextBehaviorCapabilities,
  type NimiTextBehaviorCapabilityProjection,
} from './text-behavior-projections.js';
import {
  projectNimiRuntimeModelAssetMarketCandidate,
  type NimiRuntimeModelAssetMarketCandidate,
} from './runtime-local-recommendation.js';

export type NimiLoadoutValidationState = 'configured' | 'unresolved' | 'blocked';
export type NimiLoadoutRequirementPresence = 'required' | 'optional-conditional';
export type NimiLoadoutRequirementResolution = 'unresolved' | 'configured' | 'not-configured';
export type NimiLoadoutRecommendationApplicability = 'supported' | 'unknown' | 'unsupported';

export interface NimiLoadoutRecipeOffer {
  readonly candidate: NimiRuntimeModelAssetMarketCandidate;
  readonly applicability: NimiLoadoutRecommendationApplicability;
  readonly reasons: readonly string[];
  readonly installedModelAssetId?: string;
}

export interface NimiLoadoutModelAxis {
  readonly slotId: string;
  readonly displayLabel: string;
  readonly modelAssetId: string;
  readonly expectedContentId: string;
  readonly recipeCompatible: boolean;
  readonly reasons: readonly string[];
  readonly presence: NimiLoadoutRequirementPresence;
  readonly conditionalFeatures: readonly string[];
  readonly resolution: NimiLoadoutRequirementResolution;
}

export interface NimiMachineLoadout {
  readonly loadoutId: string;
  readonly capabilityContract: string;
  readonly implementation: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  };
  readonly recipeId: string;
  readonly recipeRevision: string;
  readonly options: Readonly<JsonObject>;
  readonly modelAxes: readonly NimiLoadoutModelAxis[];
  readonly recipeCustody: readonly { readonly custodyId: string; readonly expectedContentId: string }[];
  readonly implementationSupportedFeatures: readonly string[];
  readonly configuredFeatures: readonly string[];
  readonly textBehaviors: readonly NimiTextBehaviorCapabilityProjection[];
  readonly validationState: NimiLoadoutValidationState;
  readonly reasons: readonly string[];
  readonly displayName: string;
  readonly provenance: Readonly<JsonObject>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NimiLoadoutSelection {
  readonly capabilityContract: string;
  readonly loadoutId: string;
  readonly effectiveDefaults: Readonly<JsonObject>;
}

export interface NimiMachineLoadouts {
  readonly loadouts: readonly NimiMachineLoadout[];
  readonly selections: readonly NimiLoadoutSelection[];
}

export interface NimiLoadoutRecipe {
  readonly recipeId: string;
  readonly revision: string;
  readonly title: string;
  readonly capabilityContract: string;
  readonly implementation: NimiMachineLoadout['implementation'];
  readonly defaultOptions: Readonly<JsonObject>;
  readonly implementationSupportedFeatures: readonly string[];
  readonly applicability: NimiLoadoutRecommendationApplicability;
  readonly reasons: readonly string[];
  readonly slots: readonly {
    readonly slotId: string;
    readonly displayLabel: string;
    readonly recommendedContentIds: readonly string[];
    readonly recommendedVariantIds: readonly string[];
    readonly offers: readonly NimiLoadoutRecipeOffer[];
    readonly applicability: NimiLoadoutRecommendationApplicability;
    readonly reasons: readonly string[];
    readonly modelContract: Readonly<JsonObject>;
    readonly presence: NimiLoadoutRequirementPresence;
    readonly conditionalFeatures: readonly string[];
  }[];
}

export interface NimiPrepareLoadoutInput {
  readonly loadoutId?: string;
  readonly capabilityContract: string;
  readonly recipeId: string;
  readonly options?: Readonly<JsonObject>;
  readonly modelAxes?: readonly { readonly slotId: string; readonly modelAssetId?: string; readonly expectedContentId?: string }[];
  readonly displayName: string;
  readonly provenance?: Readonly<JsonObject>;
}

export interface NimiPreparedLoadout {
  readonly prepareId: string;
  readonly proposedLoadout: NimiMachineLoadout;
  readonly expiresAt: string;
  readonly impact: {
    readonly capabilityContract: string;
    readonly loadoutId: string;
    readonly changesFutureLocalExecution: boolean;
    readonly confirmationRequired: boolean;
  };
}

export type NimiMachineLoadoutRpcClient = Pick<RuntimeTypedClient,
  | 'listLoadoutRecipes'
  | 'getMachineLoadouts'
  | 'getLoadout'
  | 'prepareLoadout'
  | 'commitLoadout'
  | 'updateLoadout'
  | 'selectLoadout'
  | 'deleteLoadout'
>;

export interface NimiMachineLoadoutClient {
  listRecipes(capabilityContract?: string, options?: RuntimeTypedCallOptions): Promise<readonly NimiLoadoutRecipe[]>;
  get(options?: RuntimeTypedCallOptions): Promise<NimiMachineLoadouts>;
  getLoadout(loadoutId: string, options?: RuntimeTypedCallOptions): Promise<NimiMachineLoadout>;
  prepare(input: NimiPrepareLoadoutInput, options?: RuntimeTypedCallOptions): Promise<NimiPreparedLoadout>;
  commit(prepareId: string, confirmedMachineImpact?: boolean, options?: RuntimeTypedCallOptions): Promise<NimiMachineLoadout>;
  update(input: NimiPrepareLoadoutInput, confirmedMachineImpact?: boolean, options?: RuntimeTypedCallOptions): Promise<NimiMachineLoadout>;
  select(capabilityContract: string, loadoutId: string | null, confirmedMachineImpact: boolean, options?: RuntimeTypedCallOptions): Promise<NimiLoadoutSelection | null>;
  delete(loadoutId: string, confirmedMachineImpact: boolean, options?: RuntimeTypedCallOptions): Promise<void>;
}

// @nimi-authority: rule.nimi.runtime.local-compute.r107
export function createNimiMachineLoadoutClient(input: {
  readonly runtime: NimiMachineLoadoutRpcClient;
  readonly callOptions?: RuntimeTypedCallOptions;
}): NimiMachineLoadoutClient {
  const runtime = input?.runtime;
  if (!runtime) throw inputError('Runtime Loadout client is required');
  const read = (options?: RuntimeTypedCallOptions) => options ?? input.callOptions;
  const write = (operation: string, options?: RuntimeTypedCallOptions) => withNimiRuntimeIdempotencyMetadata(
    read(options),
    createNimiClientId(`machine-loadout-${operation}`),
  );
  const client: NimiMachineLoadoutClient = {
    async listRecipes(capabilityContract = '', options) {
      const response = await runtime.listLoadoutRecipes({ capabilityContract: text(capabilityContract) }, read(options));
      return Object.freeze(response.recipes.map(projectRecipe));
    },
    async get(options) {
      const response = await runtime.getMachineLoadouts({}, read(options));
      if (!response.aggregate) throw responseError('GetMachineLoadouts returned no aggregate');
      return Object.freeze({
        loadouts: Object.freeze(response.aggregate.loadouts.map(projectLoadout)),
        selections: Object.freeze(response.aggregate.selections.map(projectSelection)),
      });
    },
    async getLoadout(loadoutId, options) {
      const response = await runtime.getLoadout({ loadoutId: required(loadoutId, 'loadoutId') }, read(options));
      if (!response.loadout) throw responseError('GetLoadout returned no Loadout');
      return projectLoadout(response.loadout);
    },
    async prepare(value, options) {
      const request = prepareRequest(value);
      const response = await runtime.prepareLoadout(request, write('prepare', options));
      if (!response.proposedLoadout || !response.impact) throw responseError('PrepareLoadout returned an incomplete proposal');
      return Object.freeze({
        prepareId: requiredResponse(response.prepareId, 'prepare_id'),
        proposedLoadout: projectLoadout(response.proposedLoadout),
        expiresAt: requiredResponse(response.expiresAt, 'expires_at'),
        impact: Object.freeze({
          capabilityContract: response.impact.capabilityContract,
          loadoutId: response.impact.loadoutId,
          changesFutureLocalExecution: response.impact.changesFutureLocalExecution,
          confirmationRequired: response.impact.confirmationRequired,
        }),
      });
    },
    async commit(prepareId, confirmedMachineImpact = false, options) {
      const response = await runtime.commitLoadout({ prepareId: required(prepareId, 'prepareId'), confirmedMachineImpact }, write('commit', options));
      if (!response.loadout) throw responseError('CommitLoadout returned no Loadout');
      return projectLoadout(response.loadout);
    },
    async update(value, confirmedMachineImpact = false, options) {
      const request = prepareRequest(value);
      const response = await runtime.updateLoadout({ ...request, confirmedMachineImpact }, write('update', options));
      if (!response.loadout) throw responseError('UpdateLoadout returned no Loadout');
      return projectLoadout(response.loadout);
    },
    async select(capabilityContract, loadoutId, confirmedMachineImpact, options) {
      const response = await runtime.selectLoadout({
        capabilityContract: required(capabilityContract, 'capabilityContract'),
        loadoutId: loadoutId === null ? '' : required(loadoutId, 'loadoutId'),
        confirmedMachineImpact,
      }, write('select', options));
      return response.selection ? projectSelection(response.selection) : null;
    },
    async delete(loadoutId, confirmedMachineImpact, options) {
      await runtime.deleteLoadout({ loadoutId: required(loadoutId, 'loadoutId'), confirmedMachineImpact }, write('delete', options));
    },
  };
  return Object.freeze(client);
}

function prepareRequest(value: NimiPrepareLoadoutInput) {
  if (!value || typeof value !== 'object') throw inputError('Prepare Loadout input is required');
  return {
    loadoutId: text(value.loadoutId),
    capabilityContract: required(value.capabilityContract, 'capabilityContract'),
    recipeId: required(value.recipeId, 'recipeId'),
    options: toNimiRuntimeProtoStruct(value.options ?? {}),
    modelAxes: (value.modelAxes ?? []).map((axis) => ({
      slotId: required(axis.slotId, 'slotId'),
      modelAssetId: text(axis.modelAssetId),
      expectedContentId: text(axis.expectedContentId),
    })),
    displayName: required(value.displayName, 'displayName'),
    provenance: value.provenance ? toNimiRuntimeProtoStruct(value.provenance) : undefined,
  };
}

function projectLoadout(value: Loadout): NimiMachineLoadout {
  if (!value.implementation) throw responseError('Loadout implementation identity is missing');
  return Object.freeze({
    loadoutId: requiredResponse(value.loadoutId, 'loadout_id'),
    capabilityContract: requiredResponse(value.capabilityContract, 'capability_contract'),
    implementation: Object.freeze({
      implementationId: requiredResponse(value.implementation.implementationId, 'implementation_id'),
      driverId: requiredResponse(value.implementation.driverId, 'driver_id'),
      driverDialect: requiredResponse(value.implementation.driverDialect, 'driver_dialect'),
    }),
    recipeId: requiredResponse(value.recipeId, 'recipe_id'),
    recipeRevision: requiredResponse(value.recipeRevision, 'recipe_revision'),
    options: Object.freeze(fromNimiRuntimeProtoStruct(value.options) as JsonObject),
    modelAxes: Object.freeze(value.modelAxes.map(projectAxis)),
    recipeCustody: Object.freeze(value.recipeCustody.map((item) => Object.freeze({ custodyId: item.custodyId, expectedContentId: item.expectedContentId }))),
    implementationSupportedFeatures: Object.freeze([...value.implementationSupportedFeatures]),
    configuredFeatures: Object.freeze([...value.configuredFeatures]),
    textBehaviors: projectNimiTextBehaviorCapabilities(value.textBehaviors),
    validationState: validationState(value.validationState),
    reasons: Object.freeze(value.reasons.map((reason) => RuntimeGeneratedReasonCode[reason] || 'REASON_CODE_UNSPECIFIED')),
    displayName: requiredResponse(value.displayName, 'display_name'),
    provenance: Object.freeze(fromNimiRuntimeProtoStruct(value.provenance) as JsonObject),
    createdAt: requiredResponse(value.createdAt, 'created_at'),
    updatedAt: requiredResponse(value.updatedAt, 'updated_at'),
  });
}

function projectAxis(value: LoadoutModelAxis): NimiLoadoutModelAxis {
  const presence = requirementPresence(value.presence);
  return Object.freeze({
    slotId: requiredResponse(value.slotId, 'slot_id'), displayLabel: requiredResponse(value.displayLabel, 'display_label'),
    modelAssetId: text(value.modelAssetId), expectedContentId: text(value.expectedContentId),
    recipeCompatible: value.recipeCompatible,
    reasons: Object.freeze(value.reasons.map((reason) => RuntimeGeneratedReasonCode[reason] || 'REASON_CODE_UNSPECIFIED')),
    presence,
    conditionalFeatures: projectConditionalFeatures(presence, value.conditionalFeatures),
    resolution: requirementResolution(value.resolution, presence),
  });
}

function projectSelection(value: LoadoutSelection): NimiLoadoutSelection {
  return Object.freeze({
    capabilityContract: requiredResponse(value.capabilityContract, 'capability_contract'),
    loadoutId: requiredResponse(value.loadoutId, 'loadout_id'),
    effectiveDefaults: Object.freeze(fromNimiRuntimeProtoStruct(value.effectiveDefaults) as JsonObject),
  });
}

function projectRecipe(value: LoadoutRecipeDescriptor): NimiLoadoutRecipe {
  if (!value.implementation) throw responseError('Loadout recipe implementation is missing');
  return Object.freeze({
    recipeId: requiredResponse(value.recipeId, 'recipe_id'), revision: requiredResponse(value.revision, 'revision'),
    title: requiredResponse(value.title, 'title'), capabilityContract: requiredResponse(value.capabilityContract, 'capability_contract'),
    implementation: Object.freeze({ implementationId: value.implementation.implementationId, driverId: value.implementation.driverId, driverDialect: value.implementation.driverDialect }),
    defaultOptions: Object.freeze(fromNimiRuntimeProtoStruct(value.defaultOptions) as JsonObject),
    implementationSupportedFeatures: Object.freeze([...value.implementationSupportedFeatures]),
    applicability: recommendationApplicability(value.applicability),
    reasons: Object.freeze(value.reasons.map((reason) => RuntimeGeneratedReasonCode[reason] || 'REASON_CODE_UNSPECIFIED')),
    slots: Object.freeze(value.slots.map((slot) => {
      const presence = requirementPresence(slot.presence);
      return Object.freeze({
        slotId: slot.slotId, displayLabel: slot.displayLabel,
        recommendedContentIds: Object.freeze([...slot.recommendedContentIds]),
        recommendedVariantIds: Object.freeze([...slot.recommendedVariantIds]),
        offers: Object.freeze(slot.offers.map((offer) => Object.freeze({
          candidate: offer.candidate
            ? projectNimiRuntimeModelAssetMarketCandidate(offer.candidate)
            : responseError('Loadout recipe offer is missing candidate'),
          applicability: recommendationApplicability(offer.applicability),
          reasons: Object.freeze(offer.reasons.map((reason) => RuntimeGeneratedReasonCode[reason] || 'REASON_CODE_UNSPECIFIED')),
          ...(text(offer.installedModelAssetId) ? { installedModelAssetId: text(offer.installedModelAssetId) } : {}),
        }))),
        applicability: recommendationApplicability(slot.applicability),
        reasons: Object.freeze(slot.reasons.map((reason) => RuntimeGeneratedReasonCode[reason] || 'REASON_CODE_UNSPECIFIED')),
        modelContract: Object.freeze(fromNimiRuntimeProtoStruct(slot.modelContract) as JsonObject),
        presence,
        conditionalFeatures: projectConditionalFeatures(presence, slot.conditionalFeatures),
      });
    })),
  });
}

function recommendationApplicability(
  value: LocalRecommendationApplicability,
): NimiLoadoutRecommendationApplicability {
  switch (value) {
    case LocalRecommendationApplicability.SUPPORTED: return 'supported';
    case LocalRecommendationApplicability.UNKNOWN: return 'unknown';
    case LocalRecommendationApplicability.UNSUPPORTED: return 'unsupported';
    default: throw responseError('Recommendation applicability is unspecified');
  }
}

function requirementPresence(value: LocalCapabilityRequirementPresence): NimiLoadoutRequirementPresence {
  switch (value) {
    case LocalCapabilityRequirementPresence.REQUIRED: return 'required';
    case LocalCapabilityRequirementPresence.OPTIONAL_CONDITIONAL: return 'optional-conditional';
    default: throw responseError('Loadout requirement presence is unspecified');
  }
}

function requirementResolution(
  value: LocalCapabilityRequirementResolution,
  presence: NimiLoadoutRequirementPresence,
): NimiLoadoutRequirementResolution {
  switch (value) {
    case LocalCapabilityRequirementResolution.UNRESOLVED: return 'unresolved';
    case LocalCapabilityRequirementResolution.CONFIGURED: return 'configured';
    case LocalCapabilityRequirementResolution.NOT_CONFIGURED:
      if (presence !== 'optional-conditional') {
        throw responseError('Required Loadout requirement cannot be not-configured');
      }
      return 'not-configured';
    default: throw responseError('Loadout requirement resolution is unspecified');
  }
}

function projectConditionalFeatures(
  presence: NimiLoadoutRequirementPresence,
  values: readonly string[],
): readonly string[] {
  const features = Object.freeze(values.map((value) => requiredResponse(value, 'conditional_feature')));
  if (presence === 'optional-conditional' && features.length === 0) {
    throw responseError('Optional-conditional Loadout requirement is missing conditional features');
  }
  if (presence === 'required' && features.length > 0) {
    throw responseError('Required Loadout requirement cannot declare conditional features');
  }
  return features;
}

function validationState(value: LoadoutValidationState): NimiLoadoutValidationState {
  switch (value) {
    case LoadoutValidationState.CONFIGURED: return 'configured';
    case LoadoutValidationState.UNRESOLVED: return 'unresolved';
    case LoadoutValidationState.BLOCKED: return 'blocked';
    default: throw responseError('Loadout validation state is unspecified');
  }
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function required(value: unknown, field: string): string { const result = text(value); if (!result) throw inputError(`${field} is required`); return result; }
function requiredResponse(value: unknown, field: string): string { const result = text(value); if (!result) throw responseError(`${field} is missing`); return result; }
function inputError(message: string): never { throw createNimiError({ source: 'sdk', reasonCode: NimiReasonCode.SDK_AI_INPUT_INVALID, message, actionHint: 'correct_loadout_input' }); }
function responseError(message: string): never { throw createNimiError({ source: 'runtime', reasonCode: NimiReasonCode.RUNTIME_UNAVAILABLE, message, actionHint: 'inspect_loadout_response' }); }
