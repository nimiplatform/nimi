import { Suspense, lazy, type ReactNode } from 'react';
import { AgentCenterPanel } from './chat-agent-center-panel';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type {
  AgentCenterAvatarConfigPatch,
  AgentCenterAvatarAssetKind,
  AgentCenterAvatarAssetModule,
} from './chat-agent-center-avatar-config-types';
import type {
  AvatarAssetValidationPresentation,
  DecommissionedAvatarAssetLibraryResult,
} from './chat-agent-shell-avatar-asset-diagnostics';
import { AgentConversationBackgroundSettingsContent } from './chat-agent-shell-background-settings-content';
import { AgentConversationAvatarSettingsContent } from './chat-agent-shell-avatar-settings-content';

const ChatSettingsPanel = lazy(async () => {
  const mod = await import('./chat-shared-settings-panel');
  return { default: mod.ChatSettingsPanel };
});

export { AgentConversationDiagnosticsContent } from './chat-agent-shell-diagnostics-content';

type MutationLike<TArg = void> = {
  error: unknown;
  isPending: boolean;
  mutate: [TArg] extends [void] ? () => void : (arg: TArg) => void;
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
  diagnosticsContent: ReactNode;
  avatarAssetValid: boolean;
  backgroundValid: boolean;
  avatarAssetChecking: boolean;
  avatarAssetConfig: AgentCenterAvatarAssetModule | null;
  avatarAssetValidationPresentation: AvatarAssetValidationPresentation;
  avatarConfigMutation: MutationLike<AgentCenterAvatarConfigPatch>;
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

export function AgentConversationSettingsContent(props: AgentConversationSettingsContentProps) {
  const {
    input,
    diagnosticsContent,
    avatarAssetValid,
    backgroundValid,
    avatarAssetChecking,
    avatarAssetConfig,
    avatarAssetValidationPresentation,
    avatarConfigMutation,
    avatarAssetImportMutation,
    avatarAssetLibraryQuery,
    avatarAssetSelectMutation,
    avatarImportDisabled,
    avatarImportError,
    clearAvatarAssetMutation,
    live2dAdapterManifestImportMutation,
    selectedBackgroundAssetId,
    backgroundAssetQuery,
    backgroundValidation,
    backgroundImportError,
    clearBackgroundMutation,
    backgroundImportDisabled,
    backgroundImportMutation,
  } = props;
  return (
    <AgentCenterPanel
        activeTarget={input.activeTarget}
        runtimeInspect={input.runtimeInspect}
        runtimeInspectLoading={input.runtimeInspectLoading}
        routeReady={input.agentRouteReady}
        mutationPendingAction={input.mutationPendingAction}
        avatarConfigured={avatarAssetValid}
        backgroundConfigured={Boolean(backgroundValid)}
        avatarContent={(
          <AgentConversationAvatarSettingsContent
            input={input}
            avatarAssetValid={avatarAssetValid}
            avatarAssetChecking={avatarAssetChecking}
            avatarAssetConfig={avatarAssetConfig}
            avatarAssetValidationPresentation={avatarAssetValidationPresentation}
            avatarConfigMutation={avatarConfigMutation}
            avatarAssetImportMutation={avatarAssetImportMutation}
            avatarAssetLibraryQuery={avatarAssetLibraryQuery}
            avatarAssetSelectMutation={avatarAssetSelectMutation}
            avatarImportDisabled={avatarImportDisabled}
            avatarImportError={avatarImportError}
            clearAvatarAssetMutation={clearAvatarAssetMutation}
            live2dAdapterManifestImportMutation={live2dAdapterManifestImportMutation}
          />
        )}
        localAppearanceContent={(
          <AgentConversationBackgroundSettingsContent
            input={input}
            backgroundValid={backgroundValid}
            selectedBackgroundAssetId={selectedBackgroundAssetId}
            backgroundAssetQuery={backgroundAssetQuery}
            backgroundValidation={backgroundValidation}
            backgroundImportError={backgroundImportError}
            clearBackgroundMutation={clearBackgroundMutation}
            backgroundImportDisabled={backgroundImportDisabled}
            backgroundImportMutation={backgroundImportMutation}
          />
        )}
        modelContent={(
          <Suspense fallback={null}>
            <ChatSettingsPanel
              onDiagnosticsVisibilityChange={input.onDiagnosticsVisibilityChange}
              onModelSelectionChange={input.onModelSelectionChange}
              initialModelSelection={input.initialModelSelection}
              diagnosticsContent={diagnosticsContent}
              showPresenceContent={false}
              showDiagnosticsFooter={false}
              superSections={[
                { id: 'conversation', label: input.t('Chat.agentCenterSuperSectionConversation', { defaultValue: 'Conversation' }), sections: ['chat', 'embed'] },
                { id: 'voice', label: input.t('Chat.agentCenterSuperSectionVoice', { defaultValue: 'Voice' }), sections: ['tts', 'stt', 'voice'] },
                { id: 'media', label: input.t('Chat.agentCenterSuperSectionMedia', { defaultValue: 'Media' }), sections: ['image', 'video'] },
                { id: 'world', label: input.t('Chat.agentCenterSuperSectionWorld', { defaultValue: 'World' }), sections: ['world'] },
              ]}
            />
          </Suspense>
        )}
        cognitionContent={input.cognitionContent}
        diagnosticsContent={diagnosticsContent}
        onEnableAutonomy={input.onEnableAutonomy}
        onDisableAutonomy={input.onDisableAutonomy}
        onUpdateAutonomyConfig={input.onUpdateAutonomyConfig}
      />
  );
}
