import type {
  NimiCapabilityAIConfigIntent,
  NimiCloudAIConfigCapabilityInput,
  NimiJsonObject,
} from '@nimiplatform/kit/core/sdk-contract';

export type ModelConfigOwnerContext =
  | {
      readonly owner: 'app-ai-config';
      readonly consumer: 'nimi-first-party';
      readonly appId: string;
    }
  | {
      readonly owner: 'app-ai-config';
      readonly consumer: 'third-party-app';
      readonly appId: string;
    }
  | {
      readonly owner: 'shared-local-agent-ai-config';
      readonly consumer: 'nimi-first-party';
    }
  | {
      readonly owner: 'machine-loadouts';
      readonly consumer: 'nimi-first-party';
    };

export type ModelConfigAIConfigOwnerContext = Exclude<
  ModelConfigOwnerContext,
  { readonly owner: 'machine-loadouts' }
>;

export interface ModelConfigCloudImplementationOption {
  readonly optionId: string;
  readonly label: string;
  readonly provider: string;
  readonly implementation: NimiCloudAIConfigCapabilityInput['implementation'];
}

export interface ModelConfigCloudTargetOption {
  readonly targetId: string;
  readonly label: string;
  readonly provider: string;
  readonly providerModelTarget: NimiJsonObject;
}

export interface ModelConfigCloudConnectorOption {
  /** A host-confirmed Connector with usable credential custody. */
  readonly connectorId: string;
  readonly label: string;
  readonly provider: string;
}

export interface ModelConfigCloudAuthorizationOptions {
  readonly connectors: readonly ModelConfigCloudConnectorOption[];
}

/** Host-supplied Nimi-owned catalog/Connector seam. It owns no AIConfig state. */
export interface ModelConfigCloudAIConfigModule {
  listImplementations(capabilityContract: string): Promise<readonly ModelConfigCloudImplementationOption[]>;
  listTargets(input: {
    readonly capabilityContract: string;
    readonly provider: string;
    readonly connectorId: string;
  }): Promise<readonly ModelConfigCloudTargetOption[]>;
  listAuthorizationOptions(): Promise<ModelConfigCloudAuthorizationOptions>;
}

export type ModelConfigLocalSelectionProjection = {
  readonly capabilityContract: string;
  readonly state: 'missing' | 'selected' | 'broken' | 'unavailable';
  readonly loadoutId: string | null;
  readonly displayName: string | null;
  readonly supportedFeatures: readonly string[];
  readonly reasons: readonly string[];
  readonly effectiveDefaults?: Readonly<Record<string, string>> | null;
};

export type ModelConfigCapabilityPosture =
  | 'not-configured'
  | 'local-selection-missing'
  | 'local-configuration-blocked'
  | 'local-feature-mismatch'
  | 'local-configured'
  | 'cloud-configured';

export type ModelConfigFormattedError = {
  readonly message: string;
  readonly technicalDetail?: string;
};

export type ModelConfigCopy = Partial<{
  readonly title: string;
  readonly description: string;
  readonly backLabel: string;
  readonly detailTitle: (capabilityLabel: string) => string;
  readonly activeModelLabel: string;
  readonly activeModelHint: string;
  readonly activeModelConfiguredLabel: string;
  readonly activeModelSetupPendingLabel: string;
  readonly modelPickerTitle: string;
  readonly modelPickerSearchPlaceholder: string;
  readonly modelPickerLoadingLabel: string;
  readonly modelPickerEmptyLabel: string;
  readonly configuredSummary: string;
  readonly emptySummary: string;
  readonly routeLabel: string;
  readonly localLabel: string;
  readonly cloudLabel: string;
  readonly saveLocalLabel: string;
  readonly saveCloudLabel: string;
  readonly savingLabel: string;
  readonly advancedLabel: string;
  readonly advancedHint: string;
  readonly requiredFeaturesLabel: string;
  readonly requiredFeaturesPlaceholder: string;
  readonly defaultsLabel: string;
  readonly defaultsPlaceholder: string;
  readonly defaultsUnsetLabel: string;
  readonly defaultsTrueLabel: string;
  readonly defaultsFalseLabel: string;
  readonly defaultsListPlaceholder: string;
  readonly defaultsLocalEffectivePlaceholder: (value: string) => string;
  readonly defaultsCloudEffectivePlaceholder: string;
  readonly defaultsRandomValue: string;
  readonly localChoiceDescription: string;
  readonly localSelectedLabel: string;
  readonly localMissingLabel: string;
  readonly localBrokenLabel: string;
  readonly localUnavailableLabel: string;
  readonly localMismatchLabel: (features: string) => string;
  readonly openMachineLabel: string;
  readonly cloudConnectorPickerLabel: string;
  readonly cloudConnectorPickerPlaceholder: string;
  readonly cloudConnectorSelectionRequired: string;
  readonly cloudNoConnectorsLabel: string;
  readonly openCloudConnectorsLabel: string;
  readonly cloudImplementationLabel: string;
  readonly cloudImplementationPlaceholder: string;
  readonly cloudTargetLabel: string;
  readonly cloudTargetPlaceholder: string;
  readonly cloudTargetDialogTitle: string;
  readonly cloudTargetDialogDescription: string;
  readonly cloudTargetConfirmation: string;
  readonly cloudAuthorizationLabel: string;
  readonly cloudAuthorizationNone: string;
  readonly cloudConnectorLabel: string;
  readonly cloudConnectorPlaceholder: string;
  readonly cloudAuthorizationSeparation: string;
  readonly cloudAccountLabel: (account: string) => string;
  readonly cloudImpactAppLabel: (account: string) => string;
  readonly cloudImpactSharedLabel: (account: string) => string;
  readonly cloudLoadFailed: string;
  readonly retryLabel: string;
  readonly loadFailed: string;
  readonly saveFailed: string;
  readonly technicalDetailsLabel: string;
  readonly unsupportedCapabilityLabel: string;
  readonly notConfiguredLabel: string;
  readonly configuredLabel: string;
  readonly selectionRequiredLabel: string;
  readonly blockedLabel: string;
  readonly mismatchLabel: string;
  readonly cancelLabel: string;
  readonly confirmSelectionLabel: string;
  readonly capabilityLabel: (capabilityContract: string, fallback: string) => string;
  readonly capabilityDescription: (capabilityContract: string, fallback: string) => string;
}>;

export type ModelConfigOverwrite = (
  capabilities: readonly NimiCapabilityAIConfigIntent[],
) => Promise<void>;
