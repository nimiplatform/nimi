import {
  AgentCenter,
  type AgentCenterAppearanceProjection,
  type AgentCenterStateInput,
} from '@nimiplatform/kit/features/agent-center';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type {
  AgentCenterAvatarAssetModule,
} from './chat-agent-center-avatar-config-types';
import type {
  AgentCenterVoiceModule,
} from './chat-agent-center-local-config';

export { AgentConversationDiagnosticsContent } from './chat-agent-shell-diagnostics-content';

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
  selectedBackgroundAssetId: string | null | undefined;
  backgroundValidation: BackgroundValidation;
};

function buildAppearanceProjection(input: {
  avatarAssetValid: boolean;
  backgroundValid: boolean;
  avatarAssetChecking: boolean;
  avatarAssetConfig: AgentCenterAvatarAssetModule | null;
  avatarVoicePolicy: AgentCenterVoiceModule | null;
  selectedBackgroundAssetId: string | null | undefined;
  backgroundValidation: BackgroundValidation;
}): AgentCenterAppearanceProjection {
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
    backgroundRef,
    defaultVoiceReference: null,
    avatarAutoplay: input.avatarVoicePolicy?.avatar_autoplay === true,
    disabledReason: status === 'ready'
      ? null
      : avatarStatus === 'invalid'
        ? 'Avatar asset is not admitted for launch.'
        : 'Avatar asset is not configured.',
  };
}

export function AgentConversationSettingsContent(props: AgentConversationSettingsContentProps) {
  const { input } = props;
  const state = {
    executionConfig: input.runtimeAgentExecutionConfig,
    readiness: input.runtimeAgentExecutionReadiness,
    inspect: input.runtimeInspect,
    runtimeError: input.runtimeAgentExecutionError,
    autonomyMutationAvailable: Boolean(input.onUpdateAutonomyConfig),
    appearance: buildAppearanceProjection(props),
  } satisfies AgentCenterStateInput;
  return (
    <AgentCenter
      ariaLabel={input.t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' })}
      state={state}
    />
  );
}
