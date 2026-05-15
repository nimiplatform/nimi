import { Suspense, lazy, type ReactNode } from 'react';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import { AdvBlock, AgentCenterPanel } from './chat-agent-center-panel';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { AgentDiagnosticsPanel } from './chat-agent-diagnostics';
import { AgentCenterAvatarDebugWorkbench } from './chat-agent-center-avatar-debug-workbench';
import type {
  AgentCenterAvatarDebugProfile,
  AgentCenterAvatarConfigPatch,
  AgentCenterAvatarInstancePolicy,
  AgentCenterAvatarLaunchMode,
  AgentCenterAvatarPackageModule,
  AgentCenterGeneratedMotionProviderPolicy,
} from './chat-agent-center-avatar-config-types';
import type { AgentCenterAvatarPackageKind } from './chat-agent-center-local-config';

const ChatSettingsPanel = lazy(async () => {
  const mod = await import('./chat-shared-settings-panel');
  return { default: mod.ChatSettingsPanel };
});

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

type BackgroundValidation = {
  status?: string;
  errors?: Array<{ message?: string }>;
} | null | undefined;

type AgentConversationSettingsContentProps = {
  input: UseAgentConversationPresentationInput;
  diagnosticsContent: ReactNode;
  avatarPackageValid: boolean;
  backgroundValid: boolean;
  avatarPackageChecking: boolean;
  avatarPackageConfig: AgentCenterAvatarPackageModule | null;
  avatarConfigMutation: MutationLike<AgentCenterAvatarConfigPatch>;
  avatarPackageImportMutation: MutationLike<AgentCenterAvatarPackageKind>;
  avatarImportDisabled: boolean;
  avatarImportError: string | null;
  clearAvatarPackageMutation: MutationLike;
  live2dAdapterManifestImportMutation: MutationLike;
  selectedBackgroundAssetId: string | null | undefined;
  backgroundAssetQuery: BackgroundQueryLike;
  backgroundValidation: BackgroundValidation;
  backgroundImportError: string | null;
  clearBackgroundMutation: MutationLike;
  backgroundImportDisabled: boolean;
  backgroundImportMutation: MutationLike;
};

export function AgentConversationDiagnosticsContent({
  input,
}: {
  input: UseAgentConversationPresentationInput;
}) {
  return (
    <AgentDiagnosticsPanel
      activeTarget={input.activeTarget}
      lifecycle={input.currentFooterHostState?.lifecycle || null}
      mutationPendingAction={input.mutationPendingAction}
      onCancelHook={input.onCancelPendingHook}
      onClearDyadicContext={input.onClearDyadicContext}
      onClearWorldContext={input.onClearWorldContext}
      onDisableAutonomy={input.onDisableAutonomy}
      onEnableAutonomy={input.onEnableAutonomy}
      onRefreshInspect={input.onRefreshInspect}
      onUpdateRuntimeState={input.onUpdateRuntimeState}
      onUpdateAutonomyConfig={input.onUpdateAutonomyConfig}
      recentRuntimeEvents={input.recentRuntimeEvents}
      routeReady={input.routeReady}
      runtimeInspect={input.runtimeInspect}
      runtimeInspectLoading={input.runtimeInspectLoading}
      t={input.t}
      targetsPending={input.targetsPending}
      renderShell={(sections) => (
        <div>
          {sections.map((section, index) => (
            <AdvBlock
              key={section.id}
              title={section.title}
              defaultOpen={index === 0}
              dirty={section.dirty}
              headerAction={section.headerAction}
            >
              {section.body}
            </AdvBlock>
          ))}
        </div>
      )}
    />
  );
}

export function AgentConversationSettingsContent(props: AgentConversationSettingsContentProps) {
  const {
    input,
    diagnosticsContent,
    avatarPackageValid,
    backgroundValid,
    avatarPackageChecking,
    avatarPackageConfig,
    avatarConfigMutation,
    avatarPackageImportMutation,
    avatarImportDisabled,
    avatarImportError,
    clearAvatarPackageMutation,
    live2dAdapterManifestImportMutation,
    selectedBackgroundAssetId,
    backgroundAssetQuery,
    backgroundValidation,
    backgroundImportError,
    clearBackgroundMutation,
    backgroundImportDisabled,
    backgroundImportMutation,
  } = props;
  const avatarBackendKind = avatarPackageConfig?.backend_kind || 'live2d';
  const avatarInstancePolicy = avatarPackageConfig?.avatar_instance_policy || 'reuse_active_instance';
  const generatedMotionProviderPolicy = avatarPackageConfig?.generated_motion_provider_policy || 'require_profile_support';
  const avatarLaunchMode = avatarPackageConfig?.launch_mode || 'manual';
  const avatarDebugProfile = avatarPackageConfig?.debug_profile || 'standard';
  const live2dAdapterManifestSource = avatarPackageConfig?.live2d_adapter_manifest_source || 'none';
  const avatarConfigDisabled = avatarConfigMutation.isPending || !hasTauriInvoke();
  const selectedAvatarPackageId = avatarPackageConfig?.avatar_package_ref || null;
  const live2dAdapterImportDisabled = avatarImportDisabled
    || live2dAdapterManifestImportMutation.isPending
    || avatarBackendKind !== 'live2d'
    || !selectedAvatarPackageId;
  const clearAvatarPackageDisabled = !selectedAvatarPackageId || clearAvatarPackageMutation.isPending;
  const renderOptionSelect = <TValue extends string>(inputProps: {
    label: string;
    value: TValue;
    disabled?: boolean;
    options: Array<{ value: TValue; label: string }>;
    onChange: (value: TValue) => void;
  }) => (
    <label className="block rounded-lg border border-slate-100 bg-white px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase text-slate-500">
        {inputProps.label}
      </span>
      <select
        value={inputProps.value}
        disabled={avatarConfigDisabled || inputProps.disabled}
        onChange={(event) => inputProps.onChange(event.target.value as TValue)}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none transition-colors focus:border-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        {inputProps.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <AgentCenterPanel
        activeTarget={input.activeTarget}
        runtimeInspect={input.runtimeInspect}
        runtimeInspectLoading={input.runtimeInspectLoading}
        routeReady={input.agentRouteReady}
        mutationPendingAction={input.mutationPendingAction}
        avatarConfigured={avatarPackageValid}
        backgroundConfigured={Boolean(backgroundValid)}
        avatarContent={(
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-950">
                    {input.t('Chat.agentCenterAvatarPackage', { defaultValue: 'Avatar package' })}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                  {avatarPackageValid
                    ? input.t('Chat.agentCenterReady', { defaultValue: 'Ready' })
                    : avatarPackageChecking
                      ? input.t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
                      : input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' })}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-[11px] leading-4 text-slate-500 sm:grid-cols-2">
                <div className="rounded-md bg-white px-2.5 py-2">
                  <span className="font-semibold text-slate-700">
                    {input.t('Chat.agentCenterAvatarBackend', { defaultValue: 'Backend' })}
                  </span>
                  <span className="ml-1 uppercase">{avatarBackendKind}</span>
                </div>
                <div className="rounded-md bg-white px-2.5 py-2">
                  <span className="font-semibold text-slate-700">
                    {input.t('Chat.agentCenterAvatarCapabilityProfile', { defaultValue: 'Capability profile' })}
                  </span>
                  <span className="ml-1">
                    {avatarPackageConfig?.backend_capability_profile_ref
                      ? input.t('Chat.agentCenterAvatarProfileLinked', { defaultValue: 'Linked' })
                      : input.t('Chat.agentCenterAvatarProfilePending', { defaultValue: 'Pending evidence' })}
                  </span>
                </div>
                <div className="rounded-md bg-white px-2.5 py-2">
                  <span className="font-semibold text-slate-700">
                    {input.t('Chat.agentCenterLive2dAdapterManifest', { defaultValue: 'Live2D adapter manifest' })}
                  </span>
                  <span className="ml-1">
                    {live2dAdapterManifestSource === 'external_sidecar_manifest'
                      ? input.t('Chat.agentCenterLive2dAdapterSidecarLinked', { defaultValue: 'External sidecar linked' })
                      : live2dAdapterManifestSource === 'embedded_creator_manifest'
                        ? input.t('Chat.agentCenterLive2dAdapterEmbedded', { defaultValue: 'Embedded' })
                        : input.t('Chat.agentCenterLive2dAdapterNone', { defaultValue: 'Not selected' })}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={avatarImportDisabled}
                onClick={() => avatarPackageImportMutation.mutate('live2d')}
                className="group flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-center text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-slate-300 disabled:hover:bg-white/70 disabled:hover:text-slate-700 disabled:hover:shadow-none"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-400 transition-colors group-hover:text-emerald-500">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>
                  {avatarPackageImportMutation.isPending
                    ? input.t('Chat.agentCenterAvatarImporting', { defaultValue: 'Importing...' })
                    : input.t('Chat.agentCenterImportLive2d', { defaultValue: 'Import Live2D folder' })}
                </span>
              </button>
              <button
                type="button"
                disabled={avatarImportDisabled}
                onClick={() => avatarPackageImportMutation.mutate('vrm')}
                className="group flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-center text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-slate-300 disabled:hover:bg-white/70 disabled:hover:text-slate-700 disabled:hover:shadow-none"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-400 transition-colors group-hover:text-emerald-500">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>
                  {avatarPackageImportMutation.isPending
                    ? input.t('Chat.agentCenterAvatarImporting', { defaultValue: 'Importing...' })
                    : input.t('Chat.agentCenterImportVrm', { defaultValue: 'Import VRM file' })}
                </span>
              </button>
              <button
                type="button"
                disabled={live2dAdapterImportDisabled}
                onClick={() => live2dAdapterManifestImportMutation.mutate()}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {live2dAdapterManifestImportMutation.isPending
                  ? input.t('Chat.agentCenterLive2dAdapterImporting', { defaultValue: 'Linking...' })
                  : input.t('Chat.agentCenterImportLive2dAdapterManifest', { defaultValue: 'Link Live2D adapter manifest' })}
              </button>
              <button
                type="button"
                disabled={clearAvatarPackageDisabled}
                onClick={() => clearAvatarPackageMutation.mutate()}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {clearAvatarPackageMutation.isPending
                  ? input.t('Chat.agentCenterAvatarClearing', { defaultValue: 'Removing...' })
                  : input.t('Chat.agentCenterClearAvatarSelection', { defaultValue: 'Remove avatar package' })}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {renderOptionSelect<'live2d' | 'vrm' | 'future'>({
                label: input.t('Chat.agentCenterAvatarBackendKind', { defaultValue: 'Backend kind' }),
                value: avatarBackendKind,
                options: [
                  { value: 'live2d', label: 'Live2D' },
                  { value: 'vrm', label: 'VRM' },
                  { value: 'future', label: input.t('Chat.agentCenterAvatarBackendFuture', { defaultValue: 'Future' }) },
                ],
                onChange: (backend_kind) => avatarConfigMutation.mutate({ backend_kind }),
              })}
              {renderOptionSelect<AgentCenterAvatarInstancePolicy>({
                label: input.t('Chat.agentCenterAvatarInstancePolicy', { defaultValue: 'Instance policy' }),
                value: avatarInstancePolicy,
                options: [
                  { value: 'reuse_active_instance', label: input.t('Chat.agentCenterAvatarReuseActive', { defaultValue: 'Reuse active' }) },
                  { value: 'launch_new_instance', label: input.t('Chat.agentCenterAvatarLaunchNew', { defaultValue: 'Launch new' }) },
                  { value: 'require_user_selection', label: input.t('Chat.agentCenterAvatarRequireSelection', { defaultValue: 'Ask every time' }) },
                ],
                onChange: (avatar_instance_policy) => avatarConfigMutation.mutate({ avatar_instance_policy }),
              })}
              {renderOptionSelect<AgentCenterGeneratedMotionProviderPolicy>({
                label: input.t('Chat.agentCenterAvatarMotionPolicy', { defaultValue: 'Generated motion' }),
                value: generatedMotionProviderPolicy,
                options: [
                  { value: 'require_profile_support', label: input.t('Chat.agentCenterAvatarMotionRequireProfile', { defaultValue: 'Require profile' }) },
                  { value: 'disable_generated_motion', label: input.t('Chat.agentCenterAvatarMotionDisabled', { defaultValue: 'Disabled' }) },
                  { value: 'debug_only', label: input.t('Chat.agentCenterAvatarMotionDebugOnly', { defaultValue: 'Debug only' }) },
                ],
                onChange: (generated_motion_provider_policy) => avatarConfigMutation.mutate({ generated_motion_provider_policy }),
              })}
              {renderOptionSelect<AgentCenterAvatarLaunchMode>({
                label: input.t('Chat.agentCenterAvatarLaunchMode', { defaultValue: 'Launch mode' }),
                value: avatarLaunchMode,
                options: [
                  { value: 'manual', label: input.t('Chat.agentCenterAvatarLaunchManual', { defaultValue: 'Manual' }) },
                  { value: 'debug_session', label: input.t('Chat.agentCenterAvatarLaunchDebug', { defaultValue: 'Debug session' }) },
                  { value: 'start_with_chat', label: input.t('Chat.agentCenterAvatarLaunchWithChat', { defaultValue: 'Start with chat' }) },
                ],
                onChange: (launch_mode) => avatarConfigMutation.mutate({ launch_mode }),
              })}
              {renderOptionSelect<AgentCenterAvatarDebugProfile>({
                label: input.t('Chat.agentCenterAvatarDebugProfile', { defaultValue: 'Debug profile' }),
                value: avatarDebugProfile,
                options: [
                  { value: 'standard', label: input.t('Chat.agentCenterAvatarDebugStandard', { defaultValue: 'Standard' }) },
                  { value: 'strict_backend_evidence', label: input.t('Chat.agentCenterAvatarDebugStrict', { defaultValue: 'Strict evidence' }) },
                  { value: 'route_matrix', label: input.t('Chat.agentCenterAvatarDebugRoutes', { defaultValue: 'Route matrix' }) },
                ],
                onChange: (debug_profile) => avatarConfigMutation.mutate({ debug_profile }),
              })}
            </div>
            {avatarConfigMutation.error instanceof Error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
                {avatarConfigMutation.error.message}
              </div>
            ) : null}
            {avatarImportError ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
                {avatarImportError}
              </div>
            ) : null}
            <AgentCenterAvatarDebugWorkbench
              input={input}
              avatarPackageConfig={avatarPackageConfig}
              avatarPackageValid={avatarPackageValid}
              avatarPackageChecking={avatarPackageChecking}
              validationMessage={null}
            />
          </div>
        )}
        localAppearanceContent={(
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-950">
                    {input.t('Chat.agentCenterBackground', { defaultValue: 'Background' })}
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-slate-500">
                    {backgroundValid
                      ? input.t('Chat.agentCenterBackgroundReadyHint', { defaultValue: 'A local background is selected for this agent.' })
                      : selectedBackgroundAssetId
                        ? input.t('Chat.agentCenterBackgroundNeedsFix', { defaultValue: 'The selected local background needs attention.' })
                        : input.t('Chat.agentCenterBackgroundMissingHint', { defaultValue: 'Import a png, jpeg, or webp image for this agent.' })}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                  {backgroundValid
                    ? input.t('Chat.agentCenterReady', { defaultValue: 'Ready' })
                    : backgroundAssetQuery.isFetching
                      ? input.t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
                      : input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' })}
                </span>
              </div>
              {backgroundValidation?.errors?.[0]?.message ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
                  {backgroundValidation.errors[0].message}
                </div>
              ) : null}
              {(backgroundImportError || (clearBackgroundMutation.error instanceof Error ? clearBackgroundMutation.error.message : null)) ? (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
                  {backgroundImportError || (clearBackgroundMutation.error instanceof Error ? clearBackgroundMutation.error.message : null)}
                </div>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={backgroundImportDisabled}
                onClick={() => backgroundImportMutation.mutate()}
                className="group flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-center text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-slate-300 disabled:hover:bg-white/70 disabled:hover:text-slate-700 disabled:hover:shadow-none"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-400 transition-colors group-hover:text-emerald-500">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>
                  {backgroundImportMutation.isPending
                    ? input.t('Chat.agentCenterBackgroundImporting', { defaultValue: 'Importing…' })
                    : input.t('Chat.agentCenterImportBackground', { defaultValue: 'Import background image' })}
                </span>
              </button>
              <button
                type="button"
                disabled={!selectedBackgroundAssetId || clearBackgroundMutation.isPending}
                onClick={() => clearBackgroundMutation.mutate()}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {clearBackgroundMutation.isPending
                  ? input.t('Chat.agentCenterBackgroundClearing', { defaultValue: 'Clearing…' })
                  : input.t('Chat.agentCenterClearBackgroundSelection', { defaultValue: 'Remove background' })}
              </button>
            </div>
          </div>
        )}
        modelContent={(
          <Suspense fallback={null}>
            <ChatSettingsPanel
              onDiagnosticsVisibilityChange={input.onDiagnosticsVisibilityChange}
              onModelSelectionChange={input.onModelSelectionChange}
              initialModelSelection={input.initialModelSelection}
              diagnosticsContent={diagnosticsContent}
              clearChatsTargetName={input.clearChatsTargetName}
              clearChatsDisabled={input.clearChatsDisabled}
              onClearAgentHistory={input.onClearAgentHistory}
              showPresenceContent={false}
              showDiagnosticsFooter={false}
              showClearHistoryAction={false}
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
        clearChatsTargetName={input.clearChatsTargetName}
        clearChatsDisabled={input.clearChatsDisabled}
        onClearAgentHistory={input.onClearAgentHistory}
      />
  );
}
