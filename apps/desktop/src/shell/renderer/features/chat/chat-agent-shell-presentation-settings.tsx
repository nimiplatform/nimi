import {
  useMemo,
  useState,
} from 'react';
import {
  AgentCenter,
  type AgentCenterAppearanceAdapter,
  type AgentCenterAppearanceConfigPatch,
  type AgentCenterAppearanceProjection,
  type AgentCenterSectionId,
  type AgentCenterStateInput,
} from '@nimiplatform/kit/features/agent-center';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from './capability-settings-shared';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type {
  AgentCenterAvatarAssetKind,
  AgentCenterAvatarAssetModule,
  AgentCenterAvatarConfigPatch,
} from './chat-agent-center-avatar-config-types';
import type {
  AgentCenterVoiceModule,
} from './chat-agent-center-local-config';
import type {
  AvatarAssetValidationPresentation,
  DecommissionedAvatarAssetLibraryResult,
} from './chat-agent-shell-avatar-asset-diagnostics';

type MutationLike<TArg = void> = {
  error: unknown;
  isPending: boolean;
  mutate: [TArg] extends [void] ? () => void : (arg: TArg) => void;
  mutateAsync?: [TArg] extends [void] ? () => Promise<unknown> : (arg: TArg) => Promise<unknown>;
};

type BackgroundQueryLike = {
  data?: {
    validation?: {
      status?: string;
      errors?: Array<{ message?: string }>;
    } | null;
  } | null;
  isFetching: boolean;
};

type AvatarAssetLibraryQueryLike = {
  data?: DecommissionedAvatarAssetLibraryResult | null;
  error?: unknown;
  isFetching: boolean;
};

type BackgroundValidation = {
  status?: string;
  errors?: Array<{ message?: string }>;
} | null | undefined;

type AgentConversationSettingsContentProps = {
  input: UseAgentConversationPresentationInput;
  avatarAssetValid: boolean;
  backgroundValid: boolean;
  avatarAssetChecking: boolean;
  avatarAssetConfig: AgentCenterAvatarAssetModule | null;
  avatarVoicePolicy: AgentCenterVoiceModule | null;
  avatarAssetValidationPresentation: AvatarAssetValidationPresentation;
  avatarConfigMutation: MutationLike<AgentCenterAvatarConfigPatch>;
  voicePolicyMutation: MutationLike<{ avatar_autoplay: boolean }>;
  voiceArtifactCleanupMutation: MutationLike;
  avatarAssetImportMutation: MutationLike<AgentCenterAvatarAssetKind>;
  avatarAssetLibraryQuery: AvatarAssetLibraryQueryLike;
  avatarAssetSelectMutation: MutationLike<string>;
  avatarImportDisabled: boolean;
  avatarImportError: string | null;
  clearAvatarAssetMutation: MutationLike;
  live2dAdapterManifestImportMutation: MutationLike;
  selectedBackgroundAssetId: string | null | undefined;
  backgroundAssetQuery: BackgroundQueryLike;
  backgroundValidation: BackgroundValidation;
  backgroundImportError: string | null;
  clearBackgroundMutation: MutationLike;
  backgroundImportDisabled: boolean;
  backgroundImportMutation: MutationLike;
};

function buildAppearanceProjection(input: AgentConversationSettingsContentProps): AgentCenterAppearanceProjection {
  const avatarAssetRef = input.avatarAssetConfig?.local_avatar_asset_ref || null;
  const backgroundRef = input.selectedBackgroundAssetId || null;
  const avatarStatus = input.avatarAssetChecking
    ? 'loading'
    : input.avatarAssetValid
      ? 'ready'
      : avatarAssetRef
        ? 'invalid'
        : 'not_configured';
  const backgroundStatus = input.backgroundValid
    ? 'ready'
    : backgroundRef && input.backgroundValidation?.status
      ? 'invalid'
      : 'not_configured';
  const status: AgentCenterAppearanceProjection['status'] = avatarStatus === 'ready' && backgroundStatus !== 'invalid'
    ? 'ready'
    : avatarStatus;
  return {
    status,
    backendKind: input.avatarAssetConfig?.backend_kind || null,
    avatarAssetRef,
    avatarAssetValid: input.avatarAssetValid,
    avatarAssetChecking: input.avatarAssetChecking,
    validationStatus: input.avatarAssetValidationPresentation.validationStatus,
    validationMessage: input.avatarAssetValidationPresentation.message,
    validationIssueRows: input.avatarAssetValidationPresentation.issueRows,
    backendCapabilityProfileRef: input.avatarAssetConfig?.backend_capability_profile_ref || null,
    live2dAdapterManifestSource: input.avatarAssetConfig?.live2d_adapter_manifest_source || 'none',
    live2dAdapterManifestRef: input.avatarAssetConfig?.live2d_adapter_manifest_ref || null,
    live2dCalibrationRef: input.avatarAssetConfig?.live2d_calibration_ref || null,
    backgroundRef,
    backgroundValid: input.backgroundValid,
    backgroundChecking: input.backgroundAssetQuery.isFetching,
    backgroundValidationStatus: input.backgroundValidation?.status || null,
    backgroundValidationMessage: input.backgroundValidation?.errors?.[0]?.message || null,
    backgroundImportError: input.backgroundImportError,
    defaultVoiceReference: null,
    avatarAutoplay: input.avatarVoicePolicy?.avatar_autoplay === true,
    avatarImportDisabled: input.avatarImportDisabled,
    backgroundImportDisabled: input.backgroundImportDisabled,
    voiceCleanupPending: input.voiceArtifactCleanupMutation.isPending,
    voiceCleanupError: input.voiceArtifactCleanupMutation.error instanceof Error ? input.voiceArtifactCleanupMutation.error.message : null,
    avatarConfigPending: input.avatarConfigMutation.isPending,
    avatarImportPending: input.avatarAssetImportMutation.isPending,
    live2dAdapterImportPending: input.live2dAdapterManifestImportMutation.isPending,
    clearAvatarPending: input.clearAvatarAssetMutation.isPending,
    backgroundImportPending: input.backgroundImportMutation.isPending,
    clearBackgroundPending: input.clearBackgroundMutation.isPending,
    avatarImportError: input.avatarImportError,
    avatarInstancePolicy: input.avatarAssetConfig?.avatar_instance_policy || 'reuse_active_instance',
    generatedMotionProviderPolicy: input.avatarAssetConfig?.generated_motion_provider_policy || 'require_profile_support',
    launchMode: input.avatarAssetConfig?.launch_mode || 'manual',
    debugProfile: input.avatarAssetConfig?.debug_profile || 'standard',
    developerModeEnabled: input.input.developerModeEnabled,
    disabledReason: status === 'ready'
      ? null
      : avatarStatus === 'invalid'
        ? 'Avatar asset is not admitted for launch.'
        : 'Avatar asset is not configured.',
  };
}

async function runMutation<TArg>(
  mutation: MutationLike<TArg>,
  arg: TArg,
): Promise<void> {
  if (mutation.mutateAsync) {
    await mutation.mutateAsync(arg);
    return;
  }
  (mutation.mutate as (arg: TArg) => void)(arg);
}

async function runVoidMutation(mutation: MutationLike): Promise<void> {
  if (mutation.mutateAsync) {
    await mutation.mutateAsync();
    return;
  }
  mutation.mutate();
}

export function AgentConversationSettingsContent(props: AgentConversationSettingsContentProps) {
  const { input } = props;
  const [activeSection, setActiveSection] = useState<AgentCenterSectionId>('overview');
  const localAssetsQuery = useLocalAssets({ enabled: activeSection === 'model' });
  const localAssetSource = useMemo(() => ({
    loading: localAssetsQuery.isFetching,
    list: () => localAssetsQuery.data || [],
  }), [localAssetsQuery.data, localAssetsQuery.isFetching]);
  const runtimeAdapter = useMemo(() => {
    if (!input.runtimeAgentCenterAdapter) {
      return null;
    }
    return {
      ...input.runtimeAgentCenterAdapter,
      modelConfig: {
        ...input.runtimeAgentCenterAdapter.modelConfig,
        localAssetSource,
        providerResolver: getDesktopRouteModelPickerProvider,
      },
    };
  }, [input.runtimeAgentCenterAdapter, localAssetSource]);
  const appearanceProjection = useMemo(() => buildAppearanceProjection(props), [
    input.developerModeEnabled,
    props.avatarAssetChecking,
    props.avatarAssetConfig,
    props.avatarAssetImportMutation.isPending,
    props.avatarAssetValid,
    props.avatarAssetValidationPresentation.issueRows,
    props.avatarAssetValidationPresentation.message,
    props.avatarAssetValidationPresentation.validationStatus,
    props.avatarConfigMutation.isPending,
    props.avatarImportDisabled,
    props.avatarImportError,
    props.avatarVoicePolicy?.avatar_autoplay,
    props.backgroundAssetQuery.isFetching,
    props.backgroundImportDisabled,
    props.backgroundImportError,
    props.backgroundImportMutation.isPending,
    props.backgroundValid,
    props.backgroundValidation,
    props.clearAvatarAssetMutation.isPending,
    props.clearBackgroundMutation.isPending,
    props.live2dAdapterManifestImportMutation.isPending,
    props.selectedBackgroundAssetId,
    props.voiceArtifactCleanupMutation.error,
    props.voiceArtifactCleanupMutation.isPending,
  ]);
  const appearanceAdapter = useMemo<AgentCenterAppearanceAdapter>(() => ({
    load: async () => appearanceProjection,
    importAvatarAsset: async (kind) => {
      await runMutation(props.avatarAssetImportMutation, kind);
      return appearanceProjection;
    },
    linkLive2dAdapterManifest: async () => {
      await runVoidMutation(props.live2dAdapterManifestImportMutation);
      return appearanceProjection;
    },
    clearAvatarAsset: async () => {
      await runVoidMutation(props.clearAvatarAssetMutation);
      return appearanceProjection;
    },
    importBackground: async () => {
      await runVoidMutation(props.backgroundImportMutation);
      return appearanceProjection;
    },
    clearBackground: async () => {
      await runVoidMutation(props.clearBackgroundMutation);
      return appearanceProjection;
    },
    updateAvatarConfig: async (patch: AgentCenterAppearanceConfigPatch) => {
      const avatarPatch: AgentCenterAvatarConfigPatch = {
        ...(patch.avatar_instance_policy ? { avatar_instance_policy: patch.avatar_instance_policy as AgentCenterAvatarConfigPatch['avatar_instance_policy'] } : {}),
        ...(patch.generated_motion_provider_policy ? { generated_motion_provider_policy: patch.generated_motion_provider_policy as AgentCenterAvatarConfigPatch['generated_motion_provider_policy'] } : {}),
        ...(patch.launch_mode ? { launch_mode: patch.launch_mode as AgentCenterAvatarConfigPatch['launch_mode'] } : {}),
        ...(patch.debug_profile ? { debug_profile: patch.debug_profile as AgentCenterAvatarConfigPatch['debug_profile'] } : {}),
      };
      await runMutation(props.avatarConfigMutation, avatarPatch);
      return appearanceProjection;
    },
    cleanupGeneratedVoiceArtifacts: async () => {
      await runVoidMutation(props.voiceArtifactCleanupMutation);
      return appearanceProjection;
    },
    setAvatarAutoplay: async (enabled) => {
      await runMutation(props.voicePolicyMutation, { avatar_autoplay: enabled });
      return appearanceProjection;
    },
  }), [
    appearanceProjection,
    props.avatarAssetImportMutation,
    props.avatarConfigMutation,
    props.backgroundImportMutation,
    props.clearAvatarAssetMutation,
    props.clearBackgroundMutation,
    props.live2dAdapterManifestImportMutation,
    props.voiceArtifactCleanupMutation,
    props.voicePolicyMutation,
  ]);
  const state = useMemo<AgentCenterStateInput>(() => ({
    agentAIConfig: input.runtimeAgentAIConfig,
    readiness: input.runtimeAgentAIConfigReadiness,
    inspect: input.runtimeInspect,
    runtimeError: input.runtimeAgentAIConfigError,
    autonomyMutationAvailable: Boolean(runtimeAdapter?.setAutonomyConfig),
    appearance: appearanceProjection,
  }), [
    appearanceProjection,
    input.runtimeAgentAIConfig,
    input.runtimeAgentAIConfigError,
    input.runtimeAgentAIConfigReadiness,
    input.runtimeInspect,
    runtimeAdapter?.setAutonomyConfig,
  ]);
  return (
    <AgentCenter
      activeSection={activeSection}
      ariaLabel={input.t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' })}
      appearanceAdapter={appearanceAdapter}
      chrome="embedded"
      onSectionChange={setActiveSection}
      runtimeAdapter={runtimeAdapter}
      state={state}
    />
  );
}
