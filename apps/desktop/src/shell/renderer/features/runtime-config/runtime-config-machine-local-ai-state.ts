import type {
  NimiMachineLocalAIConfiguration,
  NimiMachineLocalAIConfigurationImpact,
  NimiMachineLocalAIConfigurationImpactOperation,
  NimiMachineLocalCapabilityConfiguration,
  NimiMachineLocalCapabilityRequirement,
  NimiMachineLocalCapabilityRequirementPolicy,
  NimiMachineLocalCapabilitySelection,
  NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';

export type RuntimeConfigMachineLocalAIImpactRequest = {
  readonly requestId: string;
  readonly operation: NimiMachineLocalAIConfigurationImpactOperation;
  readonly configurationId: string;
  readonly capabilityContract: string;
};

export type RuntimeConfigMachineLocalAIImpactConfirmation = {
  readonly request: RuntimeConfigMachineLocalAIImpactRequest;
  readonly status: 'loading' | 'ready' | 'failed';
  readonly impact: NimiMachineLocalAIConfigurationImpact | null;
  readonly technicalError: string;
  /** Impact display never sets this; only the explicit confirm action does. */
  readonly explicitlyConfirmed: boolean;
};

export type RuntimeConfigMachineLocalAIState = {
  readonly aggregate: NimiMachineLocalAIConfiguration | null;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly loading: boolean;
  readonly technicalError: string;
  readonly impactConfirmation: RuntimeConfigMachineLocalAIImpactConfirmation | null;
};

export type RuntimeConfigMachineLocalAICapabilityContract =
  | 'text.generate'
  | 'text.embed'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'image.generate'
  | 'video.generate'
  | 'voice.create';

export type RuntimeConfigMachineLocalAIASRDriverKind =
  | 'qwen3-asr'
  | 'qwen3-asr-transformers';

/**
 * MiniMax-H3 video.generate Add-form slots. The five ids are the portable-key
 * prefixes admitted by the SDK video configuration constructor; projected
 * requirement id/role/label truth stays Runtime-owned.
 */
export const RUNTIME_CONFIG_MACHINE_LOCAL_VIDEO_SLOT_IDS = Object.freeze([
  'fl2va',
  'ref2va',
  'encoder',
  'videoVAE',
  'audioVAE',
] as const);

export type RuntimeConfigMachineLocalAIVideoSlotId =
  typeof RUNTIME_CONFIG_MACHINE_LOCAL_VIDEO_SLOT_IDS[number];

export type RuntimeConfigMachineLocalAIImageSlotDraft = {
  readonly requirementPolicy: NimiMachineLocalCapabilityRequirementPolicy;
  readonly localAssetId: string;
};

export type RuntimeConfigMachineLocalAIVideoRecipeDraft = {
  readonly cfgScale: string;
  readonly flowShift: string;
  readonly sampleMethod: string;
  readonly scheduler: string;
  readonly diffusionFlashAttention: boolean;
  readonly offloadParamsToCPU: boolean;
  readonly rng: 'std_default' | 'cuda' | 'cpu';
};

export type RuntimeConfigMachineLocalAIVideoExecutionOptions = {
  readonly cfgScale: number;
  readonly flowShift: number;
  readonly sampleMethod: string;
  readonly scheduler: string;
  readonly diffusionFlashAttention: boolean;
  readonly offloadParamsToCPU: boolean;
  readonly rng: RuntimeConfigMachineLocalAIVideoRecipeDraft['rng'];
};

export type RuntimeConfigMachineLocalAIAddDraft = {
  readonly capabilityContract: RuntimeConfigMachineLocalAICapabilityContract;
  readonly displayName: string;
  readonly asrDriverKind: RuntimeConfigMachineLocalAIASRDriverKind;
  readonly voiceCreateSource: 'reference-audio' | 'text-description';
  readonly acceptsImageInput: boolean;
  readonly modelFamily: string;
  readonly mainLocalAssetId: string;
  readonly enableInputImage: boolean;
  readonly videoSlots: Readonly<Record<
    RuntimeConfigMachineLocalAIVideoSlotId,
    RuntimeConfigMachineLocalAIImageSlotDraft
  >>;
  readonly executionOptions: {
    readonly steps: string;
    readonly cfgScale: string;
    readonly width: string;
    readonly height: string;
    readonly seed: string;
  };
  readonly videoExecutionOptions: RuntimeConfigMachineLocalAIVideoRecipeDraft;
};

export type RuntimeConfigMachineLocalAIRequirementGroup = {
  readonly role: NimiMachineLocalCapabilityRequirement['role'];
  readonly occurrenceOrdinal: number;
  readonly requirements: readonly NimiMachineLocalCapabilityRequirement[];
};

export type RuntimeConfigMachineLocalAIAction =
  | { readonly type: 'load-started' }
  | {
    readonly type: 'load-succeeded';
    readonly aggregate: NimiMachineLocalAIConfiguration;
    readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  }
  | { readonly type: 'load-failed'; readonly technicalError: string }
  | {
    readonly type: 'configuration-committed';
    readonly configuration: NimiMachineLocalCapabilityConfiguration;
  }
  | {
    readonly type: 'selection-committed';
    readonly selection: NimiMachineLocalCapabilitySelection;
  }
  | { readonly type: 'selection-cleared'; readonly capabilityContract: string }
  | { readonly type: 'configuration-deleted'; readonly configurationId: string }
  | {
    readonly type: 'impact-confirmation-requested';
    readonly request: RuntimeConfigMachineLocalAIImpactRequest;
  }
  | {
    readonly type: 'impact-load-succeeded';
    readonly requestId: string;
    readonly impact: NimiMachineLocalAIConfigurationImpact;
  }
  | {
    readonly type: 'impact-load-failed';
    readonly requestId: string;
    readonly technicalError: string;
  }
  | { readonly type: 'impact-explicitly-confirmed'; readonly requestId: string }
  | { readonly type: 'impact-confirmation-cleared'; readonly requestId?: string };

export const INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE: RuntimeConfigMachineLocalAIState = {
  aggregate: null,
  assets: [],
  loading: true,
  technicalError: '',
  impactConfirmation: null,
};

export function createRuntimeConfigMachineLocalAIAddDraft(): RuntimeConfigMachineLocalAIAddDraft {
  const slot = (): RuntimeConfigMachineLocalAIImageSlotDraft => ({
    requirementPolicy: 'substitutable',
    localAssetId: '',
  });
  return {
    capabilityContract: 'text.generate',
    displayName: '',
    asrDriverKind: 'qwen3-asr',
    voiceCreateSource: 'reference-audio',
    acceptsImageInput: false,
    modelFamily: '',
    mainLocalAssetId: '',
    enableInputImage: false,
    videoSlots: {
      fl2va: slot(),
      ref2va: slot(),
      encoder: slot(),
      videoVAE: slot(),
      audioVAE: slot(),
    },
    executionOptions: {
      steps: '20',
      cfgScale: '7',
      width: '1024',
      height: '1024',
      seed: '42',
    },
    videoExecutionOptions: createRuntimeConfigMachineLocalAIVideoRecipeDraft(),
  };
}

export function createRuntimeConfigMachineLocalAIVideoRecipeDraft(
  portableConfig?: Readonly<Record<string, unknown>>,
): RuntimeConfigMachineLocalAIVideoRecipeDraft {
  const raw = portableConfig?.executionOptions;
  const options = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Readonly<Record<string, unknown>>
    : {};
  const rng = options.rng === 'std_default' || options.rng === 'cuda' || options.rng === 'cpu'
    ? options.rng
    : 'cpu';
  return {
    cfgScale: finiteNumberText(options.cfgScale, '1'),
    flowShift: finiteNumberText(options.flowShift, '12'),
    sampleMethod: recipeTokenText(options.sampleMethod, 'engine-default'),
    scheduler: recipeTokenText(options.scheduler, 'engine-default'),
    diffusionFlashAttention: typeof options.diffusionFlashAttention === 'boolean'
      ? options.diffusionFlashAttention
      : true,
    offloadParamsToCPU: typeof options.offloadParamsToCPU === 'boolean'
      ? options.offloadParamsToCPU
      : true,
    rng,
  };
}

export function parseRuntimeConfigMachineLocalAIVideoRecipeDraft(
  draft: RuntimeConfigMachineLocalAIVideoRecipeDraft,
): RuntimeConfigMachineLocalAIVideoExecutionOptions {
  const cfgScale = parseVideoRecipeNumber(draft.cfgScale, 'cfgScale');
  const flowShift = parseVideoRecipeNumber(draft.flowShift, 'flowShift');
  if (cfgScale < 0 || cfgScale > 30) throw new Error('cfgScale must be between 0 and 30.');
  if (flowShift < 0) throw new Error('flowShift must be non-negative.');
  const sampleMethod = requireVideoRecipeToken(draft.sampleMethod, 'sampleMethod');
  const scheduler = requireVideoRecipeToken(draft.scheduler, 'scheduler');
  if (draft.rng !== 'std_default' && draft.rng !== 'cuda' && draft.rng !== 'cpu') {
    throw new Error('rng is invalid.');
  }
  return {
    cfgScale,
    flowShift,
    sampleMethod,
    scheduler,
    diffusionFlashAttention: draft.diffusionFlashAttention,
    offloadParamsToCPU: draft.offloadParamsToCPU,
    rng: draft.rng,
  };
}

function finiteNumberText(value: unknown, fallback: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}

function recipeTokenText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function parseVideoRecipeNumber(value: string, field: string): number {
  if (!value || value.trim() !== value) throw new Error(`${field} is required.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be finite.`);
  return number;
}

function requireVideoRecipeToken(value: string, field: string): string {
  if (!value || value.trim() !== value || value.length > 64 || !/^[A-Za-z0-9+_.-]+$/u.test(value)) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

const EMPTY_AGGREGATE: NimiMachineLocalAIConfiguration = {
  configurations: [],
  selections: [],
};

export function reduceRuntimeConfigMachineLocalAIState(
  state: RuntimeConfigMachineLocalAIState,
  action: RuntimeConfigMachineLocalAIAction,
): RuntimeConfigMachineLocalAIState {
  switch (action.type) {
    case 'load-started':
      return { ...state, loading: true, technicalError: '' };
    case 'load-succeeded':
      return {
        aggregate: action.aggregate,
        assets: action.assets,
        loading: false,
        technicalError: '',
        impactConfirmation: null,
      };
    case 'load-failed':
      return {
        ...state,
        loading: false,
        technicalError: action.technicalError,
      };
    case 'configuration-committed':
      return {
        ...state,
        aggregate: upsertMachineLocalConfiguration(
          state.aggregate ?? EMPTY_AGGREGATE,
          action.configuration,
        ),
      };
    case 'selection-committed':
      return {
        ...state,
        aggregate: upsertMachineLocalSelection(
          state.aggregate ?? EMPTY_AGGREGATE,
          action.selection,
        ),
      };
    case 'selection-cleared':
      return {
        ...state,
        aggregate: clearMachineLocalSelection(
          state.aggregate ?? EMPTY_AGGREGATE,
          action.capabilityContract,
        ),
      };
    case 'configuration-deleted':
      return {
        ...state,
        aggregate: deleteMachineLocalConfiguration(
          state.aggregate ?? EMPTY_AGGREGATE,
          action.configurationId,
        ),
      };
    case 'impact-confirmation-requested':
      return {
        ...state,
        impactConfirmation: {
          request: action.request,
          status: 'loading',
          impact: null,
          technicalError: '',
          explicitlyConfirmed: false,
        },
      };
    case 'impact-load-succeeded':
      if (state.impactConfirmation?.request.requestId !== action.requestId) return state;
      return {
        ...state,
        impactConfirmation: {
          ...state.impactConfirmation,
          status: 'ready',
          impact: action.impact,
          technicalError: '',
          explicitlyConfirmed: false,
        },
      };
    case 'impact-load-failed':
      if (state.impactConfirmation?.request.requestId !== action.requestId) return state;
      return {
        ...state,
        impactConfirmation: {
          ...state.impactConfirmation,
          status: 'failed',
          impact: null,
          technicalError: action.technicalError,
          explicitlyConfirmed: false,
        },
      };
    case 'impact-explicitly-confirmed':
      if (
        state.impactConfirmation?.request.requestId !== action.requestId
        || state.impactConfirmation.status !== 'ready'
        || !state.impactConfirmation.impact
      ) return state;
      return {
        ...state,
        impactConfirmation: {
          ...state.impactConfirmation,
          explicitlyConfirmed: true,
        },
      };
    case 'impact-confirmation-cleared':
      if (
        action.requestId !== undefined
        && state.impactConfirmation?.request.requestId !== action.requestId
      ) return state;
      return { ...state, impactConfirmation: null };
  }
}

export function runtimeConfigMachineLocalAIImpactCommitAllowed(
  state: RuntimeConfigMachineLocalAIState,
  requestId: string,
): boolean {
  return state.impactConfirmation?.request.requestId === requestId
    && state.impactConfirmation.status === 'ready'
    && state.impactConfirmation.impact !== null
    && state.impactConfirmation.explicitlyConfirmed;
}

export function groupMachineLocalCapabilityRequirements(
  requirements: readonly NimiMachineLocalCapabilityRequirement[],
): readonly RuntimeConfigMachineLocalAIRequirementGroup[] {
  const groups = new Map<string, RuntimeConfigMachineLocalAIRequirementGroup>();
  for (const requirement of requirements) {
    const key = `${requirement.role}\u0000${requirement.occurrenceOrdinal}`;
    const current = groups.get(key);
    groups.set(key, current
      ? { ...current, requirements: [...current.requirements, requirement] }
      : {
        role: requirement.role,
        occurrenceOrdinal: requirement.occurrenceOrdinal,
        requirements: [requirement],
      });
  }
  return [...groups.values()].sort((left, right) => {
    const roleOrder = (left.role === 'main' ? 0 : 1) - (right.role === 'main' ? 0 : 1);
    return roleOrder || left.occurrenceOrdinal - right.occurrenceOrdinal;
  });
}

export function machineLocalConfigurationFileState(
  configuration: NimiMachineLocalCapabilityConfiguration,
): 'configured' | 'files-needed' {
  return configuration.requirementResolution === 'configured'
    ? 'configured'
    : 'files-needed';
}

export function compatibleMachineLocalAssets(
  requirement: NimiMachineLocalCapabilityRequirement,
  assets: readonly NimiRuntimeLocalAssetEntry[],
): readonly NimiRuntimeLocalAssetEntry[] {
  const constraints = requirement.compatibilityConstraints ?? {};
  const allowedKeys = new Set([
    'engine',
    'artifact_role',
    'asset_kind',
    'model_family',
    'compatible_families',
    'format',
    'source_feature',
  ]);
  if (Object.keys(constraints).some((key) => !allowedKeys.has(key))) return [];
  const requiredEngine = exactConstraintText(constraints, 'engine');
  const requiredArtifactRole = exactConstraintText(constraints, 'artifact_role');
  const requiredAssetKind = exactConstraintText(constraints, 'asset_kind');
  const requiredModelFamily = exactConstraintText(constraints, 'model_family');
  const compatibleFamilies = exactConstraintTextList(constraints, 'compatible_families');
  const projectedOnlyConstraints = [
    exactConstraintText(constraints, 'format'),
    exactConstraintText(constraints, 'source_feature'),
  ];
  if (
    requiredEngine === null
    || requiredArtifactRole === null
    || requiredAssetKind === null
    || requiredModelFamily === null
    || compatibleFamilies === null
    || projectedOnlyConstraints.some((value) => value === null)
  ) return [];
  return assets.filter((asset) => {
    if (!asset.expectedVerifiedContentId || asset.status === 'removed') return false;
    if (requiredEngine && asset.engine !== requiredEngine) return false;
    if (requiredAssetKind && asset.kind !== requiredAssetKind) return false;
    if (requiredModelFamily && asset.family !== requiredModelFamily) {
      return false;
    }
    if (
      compatibleFamilies.length > 0
      && !compatibleFamilies.includes(asset.family ?? '')
    ) {
      return false;
    }
    if (requiredArtifactRole && !(asset.artifactRoles ?? []).includes(requiredArtifactRole)) {
      return false;
    }
    if (
      requirement.policy === 'strict'
      && requirement.preferredVerifiedContentId
      && requirement.preferredVerifiedContentId !== asset.expectedVerifiedContentId
    ) {
      return false;
    }
    return true;
  });
}

function upsertMachineLocalConfiguration(
  aggregate: NimiMachineLocalAIConfiguration,
  configuration: NimiMachineLocalCapabilityConfiguration,
): NimiMachineLocalAIConfiguration {
  const index = aggregate.configurations.findIndex(
    (item) => item.configurationId === configuration.configurationId,
  );
  const configurations = [...aggregate.configurations];
  if (index >= 0) {
    configurations[index] = configuration;
  } else {
    configurations.push(configuration);
  }
  return { ...aggregate, configurations };
}

function upsertMachineLocalSelection(
  aggregate: NimiMachineLocalAIConfiguration,
  selection: NimiMachineLocalCapabilitySelection,
): NimiMachineLocalAIConfiguration {
  return {
    ...aggregate,
    selections: [
      ...aggregate.selections.filter(
        (item) => item.capabilityContract !== selection.capabilityContract,
      ),
      selection,
    ],
  };
}

function clearMachineLocalSelection(
  aggregate: NimiMachineLocalAIConfiguration,
  capabilityContract: string,
): NimiMachineLocalAIConfiguration {
  return {
    ...aggregate,
    selections: aggregate.selections.filter(
      (selection) => selection.capabilityContract !== capabilityContract,
    ),
  };
}

function deleteMachineLocalConfiguration(
  aggregate: NimiMachineLocalAIConfiguration,
  configurationId: string,
): NimiMachineLocalAIConfiguration {
  return {
    configurations: aggregate.configurations.filter(
      (configuration) => configuration.configurationId !== configurationId,
    ),
    selections: aggregate.selections.filter(
      (selection) => selection.configurationId !== configurationId,
    ),
  };
}

function exactConstraintText(
  constraints: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  if (!Object.hasOwn(constraints, key)) return '';
  const value = constraints[key];
  return typeof value === 'string' && value !== '' && value === value.trim()
    ? value
    : null;
}

function exactConstraintTextList(
  constraints: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | null {
  if (!Object.hasOwn(constraints, key)) return [];
  const value = constraints[key];
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value.filter((item): item is string => (
    typeof item === 'string' && item !== '' && item === item.trim()
  ));
  return items.length === value.length && new Set(items).size === items.length
    ? items
    : null;
}
