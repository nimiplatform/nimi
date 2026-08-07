import type {
  NimiMachineLocalAIConfiguration,
  NimiMachineLocalAIConfigurationImpact,
  NimiMachineLocalAIConfigurationImpactOperation,
  NimiMachineLocalCapabilityConfiguration,
  NimiMachineLocalCapabilityRequirement,
  NimiMachineLocalCapabilityRequirementPolicy,
  NimiMachineLocalCapabilitySelection,
  NimiMachineLocalStableDiffusionModelFamily,
  NimiMachineLocalStableDiffusionSlotId,
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
  | 'image.generate'
  | 'video.generate';

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

export type RuntimeConfigMachineLocalAILoRADraft = {
  readonly draftId: string;
  readonly displayLabel: string;
  readonly requirementPolicy: NimiMachineLocalCapabilityRequirementPolicy;
  readonly localAssetId: string;
  readonly weight: string;
};

export type RuntimeConfigMachineLocalAIAddDraft = {
  readonly capabilityContract: RuntimeConfigMachineLocalAICapabilityContract;
  readonly displayName: string;
  readonly acceptsImageInput: boolean;
  readonly modelFamily: NimiMachineLocalStableDiffusionModelFamily;
  readonly enableInputImage: boolean;
  readonly slots: Readonly<Record<
    NimiMachineLocalStableDiffusionSlotId,
    RuntimeConfigMachineLocalAIImageSlotDraft
  >>;
  readonly videoSlots: Readonly<Record<
    RuntimeConfigMachineLocalAIVideoSlotId,
    RuntimeConfigMachineLocalAIImageSlotDraft
  >>;
  readonly loras: readonly RuntimeConfigMachineLocalAILoRADraft[];
  readonly executionOptions: {
    readonly steps: string;
    readonly cfgScale: string;
    readonly width: string;
    readonly height: string;
    readonly seed: string;
  };
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
    acceptsImageInput: false,
    modelFamily: 'z-image',
    enableInputImage: false,
    slots: {
      main: slot(),
      textEncoder: slot(),
      vae: slot(),
      uncondDiffusion: slot(),
    },
    videoSlots: {
      fl2va: slot(),
      ref2va: slot(),
      encoder: slot(),
      videoVAE: slot(),
      audioVAE: slot(),
    },
    loras: [],
    executionOptions: {
      steps: '20',
      cfgScale: '7',
      width: '1024',
      height: '1024',
      seed: '42',
    },
  };
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

export function moveRuntimeConfigMachineLocalAILoRA(
  loras: readonly RuntimeConfigMachineLocalAILoRADraft[],
  index: number,
  direction: -1 | 1,
): readonly RuntimeConfigMachineLocalAILoRADraft[] {
  const target = index + direction;
  if (!Number.isInteger(index) || index < 0 || index >= loras.length || target < 0 || target >= loras.length) {
    return loras;
  }
  const next = [...loras];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
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
  const requiredEngine = textValue(constraints.engine).toLowerCase();
  const requiredArtifactRole = textValue(constraints.artifact_role).toLowerCase();
  const requiredAssetKind = textValue(constraints.asset_kind).toLowerCase();
  const requiredModelFamily = normalizeModelFamily(constraints.model_family);
  const compatibleFamilies = textList(constraints.compatible_families).map(normalizeModelFamily);
  return assets.filter((asset) => {
    if (!asset.expectedVerifiedContentId || asset.status === 'removed') return false;
    if (requiredEngine && asset.engine.toLowerCase() !== requiredEngine) return false;
    if (requiredAssetKind && asset.kind.toLowerCase() !== requiredAssetKind) return false;
    if (requiredModelFamily && normalizeModelFamily(asset.modelFamily ?? asset.family) !== requiredModelFamily) {
      return false;
    }
    if (
      compatibleFamilies.length > 0
      && !compatibleFamilies.includes(normalizeModelFamily(asset.modelFamily ?? asset.family))
    ) {
      return false;
    }
    if (requiredArtifactRole && !(asset.artifactRoles ?? [])
      .some((role) => role.toLowerCase() === requiredArtifactRole)) {
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

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(textValue).filter(Boolean)
    : [];
}

function normalizeModelFamily(value: unknown): string {
  const normalized = textValue(value).toLowerCase().replaceAll('_', '-');
  switch (normalized) {
    case 'z-image-base':
    case 'z-image-turbo':
      return 'z-image';
    case 'flux':
    case 'flux2':
    case 'flux-2':
    case 'flux-2-vae':
    case 'ideogram4-vae':
    case 'ideogram-4-vae':
      return 'flux2-vae';
    default:
      return normalized;
  }
}
