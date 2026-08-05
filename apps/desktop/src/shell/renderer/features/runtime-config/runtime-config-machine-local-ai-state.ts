import type {
  NimiMachineLocalAIConfiguration,
  NimiMachineLocalCapabilityConfiguration,
  NimiMachineLocalCapabilityRequirement,
  NimiMachineLocalCapabilitySelection,
  NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';

export type RuntimeConfigMachineLocalAIState = {
  readonly aggregate: NimiMachineLocalAIConfiguration | null;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly loading: boolean;
  readonly technicalError: string;
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
  | { readonly type: 'configuration-deleted'; readonly configurationId: string };

export const INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE: RuntimeConfigMachineLocalAIState = {
  aggregate: null,
  assets: [],
  loading: true,
  technicalError: '',
};

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
  }
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
  return assets.filter((asset) => {
    if (!asset.expectedVerifiedContentId || asset.status === 'removed') return false;
    if (requiredEngine && asset.engine.toLowerCase() !== requiredEngine) return false;
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
