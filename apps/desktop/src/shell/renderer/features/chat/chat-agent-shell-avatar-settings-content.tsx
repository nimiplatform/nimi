import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { AgentCenterAvatarDebugWorkbench } from './chat-agent-center-avatar-debug-workbench';
import type {
  AgentCenterAvatarAssetModule,
  AgentCenterAvatarConfigPatch,
  AgentCenterAvatarDebugProfile,
  AgentCenterAvatarInstancePolicy,
  AgentCenterAvatarLaunchMode,
  AgentCenterGeneratedMotionProviderPolicy,
} from './chat-agent-center-avatar-config-types';
import type {
  AgentCenterAvatarAssetKind,
  AgentCenterAvatarAssetListResult,
} from './chat-agent-center-local-config';
import type { AvatarAssetValidationPresentation } from './chat-agent-shell-avatar-asset-diagnostics';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

type MutationLike<TArg = void> = {
  error: unknown;
  isPending: boolean;
  mutate: [TArg] extends [void] ? () => void : (arg: TArg) => void;
};

type AvatarAssetLibraryQueryLike = {
  data?: AgentCenterAvatarAssetListResult | null;
  error?: unknown;
  isFetching: boolean;
};

type AgentConversationAvatarSettingsContentProps = {
  input: UseAgentConversationPresentationInput;
  avatarAssetValid: boolean;
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
};

function formatAssetBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export function AgentConversationAvatarSettingsContent(
  props: AgentConversationAvatarSettingsContentProps,
) {
  const {
    input,
    avatarAssetValid,
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
  } = props;
  const avatarBackendKind = avatarAssetConfig?.backend_kind || 'live2d';
  const avatarInstancePolicy = avatarAssetConfig?.avatar_instance_policy || 'reuse_active_instance';
  const generatedMotionProviderPolicy = avatarAssetConfig?.generated_motion_provider_policy || 'require_profile_support';
  const avatarLaunchMode = avatarAssetConfig?.launch_mode || 'manual';
  const avatarDebugProfile = avatarAssetConfig?.debug_profile || 'standard';
  const live2dAdapterManifestSource = avatarAssetConfig?.live2d_adapter_manifest_source || 'none';
  const avatarConfigDisabled = avatarConfigMutation.isPending || !hasTauriInvoke();
  const selectedAvatarAssetId = avatarAssetConfig?.local_avatar_asset_ref || null;
  const avatarAssetLibrary = avatarAssetLibraryQuery.data?.assets || [];
  const live2dAdapterImportDisabled = avatarImportDisabled
    || live2dAdapterManifestImportMutation.isPending
    || avatarBackendKind !== 'live2d'
    || !selectedAvatarAssetId;
  const clearAvatarAssetDisabled = !selectedAvatarAssetId || clearAvatarAssetMutation.isPending;
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
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-950">
              {input.t('Chat.agentCenterAvatarAsset', { defaultValue: 'Avatar asset' })}
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
            {avatarAssetValid
              ? input.t('Chat.agentCenterReady', { defaultValue: 'Ready' })
              : avatarAssetChecking
                ? input.t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
                : input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' })}
          </span>
        </div>
        <div className="mt-3 grid gap-2 text-[11px] leading-4 text-slate-500 sm:grid-cols-2">
          <div className="rounded-md bg-white px-2.5 py-2">
            <span className="font-semibold text-slate-700">
              {input.t('Chat.agentCenterAvatarSelectedAsset', { defaultValue: 'Selected asset' })}
            </span>
            <span className="ml-1 break-all">
              {avatarAssetValidationPresentation.selectedAssetId
                || input.t('Chat.agentCenterMissing', { defaultValue: 'Missing' })}
            </span>
          </div>
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
              {avatarAssetConfig?.backend_capability_profile_ref
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
          <div className="rounded-md bg-white px-2.5 py-2">
            <span className="font-semibold text-slate-700">
              {input.t('Chat.agentCenterAvatarValidationStatus', { defaultValue: 'Validation' })}
            </span>
            <span className="ml-1">
              {avatarAssetValidationPresentation.validationStatus.replaceAll('_', ' ')}
            </span>
          </div>
        </div>
        {avatarAssetValidationPresentation.message ? (
          <div className={`mt-3 rounded-md border px-3 py-2 text-[11px] leading-4 ${
            avatarAssetValidationPresentation.status === 'invalid'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
          >
            {avatarAssetValidationPresentation.message}
          </div>
        ) : null}
        {avatarAssetValidationPresentation.issueRows.length > 1 ? (
          <div className="mt-2 rounded-md bg-white px-3 py-2 text-[11px] leading-4 text-slate-600">
            {avatarAssetValidationPresentation.issueRows.map((issue) => (
              <div key={issue} className="break-words">{issue}</div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="rounded-lg border border-slate-100 bg-white px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-slate-950">
            {input.t('Chat.agentCenterAvatarAssetLibrary', { defaultValue: 'Local asset library' })}
          </div>
          <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-400">
            {avatarAssetLibraryQuery.isFetching
              ? input.t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
              : `${avatarAssetLibrary.length}`}
          </span>
        </div>
        {avatarAssetLibrary.length ? (
          <div className="mt-2 divide-y divide-slate-100">
            {avatarAssetLibrary.map((asset) => {
              const assetSelected = asset.selected || asset.local_asset_id === selectedAvatarAssetId;
              const assetValid = asset.validation.status === 'valid';
              const selectDisabled = assetSelected
                || !assetValid
                || avatarAssetSelectMutation.isPending
                || !hasTauriInvoke();
              return (
                <div key={asset.local_asset_id} className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs font-semibold text-slate-800">
                        {asset.display_name}
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-slate-500">
                        {asset.backend_kind}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-slate-500">
                      <span className="break-all">{asset.local_asset_id}</span>
                      <span>{formatAssetBytes(asset.asset_bytes)}</span>
                      <span>{asset.file_count} files</span>
                      <span className={assetValid ? 'text-emerald-600' : 'text-rose-600'}>
                        {asset.validation.status.replaceAll('_', ' ')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={selectDisabled}
                    onClick={() => avatarAssetSelectMutation.mutate(asset.local_asset_id)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    {assetSelected
                      ? input.t('Chat.agentCenterAvatarAssetSelected', { defaultValue: 'Selected' })
                      : input.t('Chat.agentCenterAvatarUseAsset', { defaultValue: 'Use' })}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-500">
            {avatarAssetLibraryQuery.isFetching
              ? input.t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
              : input.t('Chat.agentCenterAvatarAssetLibraryEmpty', { defaultValue: 'No imported Avatar assets' })}
          </div>
        )}
        {avatarAssetLibraryQuery.error instanceof Error ? (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
            {avatarAssetLibraryQuery.error.message}
          </div>
        ) : null}
        {avatarAssetSelectMutation.error instanceof Error ? (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
            {avatarAssetSelectMutation.error.message}
          </div>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={avatarImportDisabled}
          onClick={() => avatarAssetImportMutation.mutate('live2d')}
          className="group flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-center text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-slate-300 disabled:hover:bg-white/70 disabled:hover:text-slate-700 disabled:hover:shadow-none"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-400 transition-colors group-hover:text-emerald-500">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>
            {avatarAssetImportMutation.isPending
              ? input.t('Chat.agentCenterAvatarImporting', { defaultValue: 'Importing...' })
              : input.t('Chat.agentCenterImportLive2d', { defaultValue: 'Import Live2D folder' })}
          </span>
        </button>
        <button
          type="button"
          disabled={avatarImportDisabled}
          onClick={() => avatarAssetImportMutation.mutate('vrm')}
          className="group flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-center text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-slate-300 disabled:hover:bg-white/70 disabled:hover:text-slate-700 disabled:hover:shadow-none"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-400 transition-colors group-hover:text-emerald-500">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>
            {avatarAssetImportMutation.isPending
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
          disabled={clearAvatarAssetDisabled}
          onClick={() => clearAvatarAssetMutation.mutate()}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {clearAvatarAssetMutation.isPending
            ? input.t('Chat.agentCenterAvatarClearing', { defaultValue: 'Removing...' })
            : input.t('Chat.agentCenterClearAvatarSelection', { defaultValue: 'Remove Avatar asset' })}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
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
        avatarAssetConfig={avatarAssetConfig}
        avatarAssetValid={avatarAssetValid}
        avatarAssetChecking={avatarAssetChecking}
        validationMessage={avatarAssetValidationPresentation.message}
      />
    </div>
  );
}
