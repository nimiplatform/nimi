import type { ReactNode } from 'react';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import { AgentCenterPanel } from './chat-agent-center-panel';
import { ChatSettingsPanel } from './chat-shared-settings-panel';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { AgentDiagnosticsPanel } from './chat-agent-diagnostics';

type SelectedAvatarPackage = {
  kind: 'live2d' | 'vrm';
  package_id: string;
} | null;

type MutationLike<TArg = void> = {
  error: unknown;
  isPending: boolean;
  mutate: [TArg] extends [void] ? () => void : (arg: TArg) => void;
};

type ValidationQueryLike = {
  data?: {
    errors?: Array<{ message?: string }>;
  } | null;
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
  selectedAvatarPackage: SelectedAvatarPackage;
  avatarPackageValidationQuery: ValidationQueryLike;
  avatarImportError: string | null;
  clearAvatarPackageMutation: MutationLike;
  avatarImportDisabled: boolean;
  avatarPackageImportMutation: MutationLike<'live2d' | 'vrm'>;
  avatarActionPending: boolean;
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
    selectedAvatarPackage,
    avatarPackageValidationQuery,
    avatarImportError,
    clearAvatarPackageMutation,
    avatarImportDisabled,
    avatarPackageImportMutation,
    avatarActionPending,
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
                  <div className="mt-1 text-[11px] leading-4 text-slate-500">
                    {avatarPackageValid
                      ? input.t('Chat.agentCenterAvatarPackageReady', { defaultValue: 'A local package is selected and ready to launch from the composer.' })
                      : avatarPackageChecking
                        ? input.t('Chat.agentCenterAvatarPackageChecking', { defaultValue: 'Checking the selected local package.' })
                        : selectedAvatarPackage
                          ? input.t('Chat.agentCenterAvatarPackageNeedsFix', { defaultValue: 'The selected local package needs attention before launch.' })
                          : input.t('Chat.agentCenterAvatarPackageMissing', { defaultValue: 'Import a local Live2D folder or VRM file to enable avatar launch.' })}
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
              {avatarPackageValidationQuery.data?.errors?.[0]?.message ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
                  {avatarPackageValidationQuery.data.errors[0].message}
                </div>
              ) : null}
              {(avatarImportError || (clearAvatarPackageMutation.error instanceof Error ? clearAvatarPackageMutation.error.message : null)) ? (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
                  {avatarImportError || (clearAvatarPackageMutation.error instanceof Error ? clearAvatarPackageMutation.error.message : null)}
                </div>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={avatarImportDisabled}
                onClick={() => avatarPackageImportMutation.mutate('live2d')}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {avatarPackageImportMutation.isPending
                  ? input.t('Chat.agentCenterAvatarImporting', { defaultValue: 'Importing…' })
                  : input.t('Chat.agentCenterImportLive2d', { defaultValue: 'Import Live2D folder' })}
              </button>
              <button
                type="button"
                disabled={avatarImportDisabled}
                onClick={() => avatarPackageImportMutation.mutate('vrm')}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {avatarPackageImportMutation.isPending
                  ? input.t('Chat.agentCenterAvatarImporting', { defaultValue: 'Importing…' })
                  : input.t('Chat.agentCenterImportVrm', { defaultValue: 'Import VRM file' })}
              </button>
            </div>
            {selectedAvatarPackage ? (
              <button
                type="button"
                disabled={clearAvatarPackageMutation.isPending || avatarActionPending}
                onClick={() => clearAvatarPackageMutation.mutate()}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {clearAvatarPackageMutation.isPending
                  ? input.t('Chat.agentCenterAvatarClearing', { defaultValue: 'Clearing…' })
                  : input.t('Chat.agentCenterClearAvatarSelection', { defaultValue: 'Remove avatar package' })}
              </button>
            ) : null}
            {!hasTauriInvoke() ? (
              <div className="text-[11px] leading-4 text-slate-500">
                {input.t('Chat.agentCenterAvatarImportDesktopOnly', { defaultValue: 'Avatar package import is available in the desktop app.' })}
              </div>
            ) : null}
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
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {backgroundImportMutation.isPending
                  ? input.t('Chat.agentCenterBackgroundImporting', { defaultValue: 'Importing…' })
                  : input.t('Chat.agentCenterImportBackground', { defaultValue: 'Import background image' })}
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
          />
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
