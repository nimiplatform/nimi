import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { AgentCenterAvatarDebugWorkbench } from './chat-agent-center-avatar-debug-workbench';
import { AgentCenterLive2dCalibrationWorkbench } from './chat-agent-center-live2d-calibration-workbench';
import type {
  AgentCenterAvatarAssetModule,
  AgentCenterAvatarAssetKind,
  AgentCenterAvatarConfigPatch,
  AgentCenterAvatarDebugProfile,
  AgentCenterAvatarInstancePolicy,
  AgentCenterAvatarLaunchMode,
  AgentCenterGeneratedMotionProviderPolicy,
} from './chat-agent-center-avatar-config-types';
import type {
  AvatarAssetValidationPresentation,
  DecommissionedAvatarAssetLibraryResult,
} from './chat-agent-shell-avatar-asset-diagnostics';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

type MutationLike<TArg = void> = {
  error: unknown;
  isPending: boolean;
  mutate: [TArg] extends [void] ? () => void : (arg: TArg) => void;
};

type AvatarAssetLibraryQueryLike = {
  data?: DecommissionedAvatarAssetLibraryResult | null;
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

type EvidenceState = 'ready' | 'pending' | 'missing' | 'blocked';

function UploadGlyph(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function stateTone(state: EvidenceState) {
  if (state === 'ready') {
    return 'border-emerald-100 bg-emerald-50/70 text-emerald-700';
  }
  if (state === 'pending') {
    return 'border-amber-100 bg-amber-50/80 text-amber-700';
  }
  if (state === 'blocked') {
    return 'border-rose-100 bg-rose-50/80 text-rose-700';
  }
  return 'border-slate-100 bg-slate-50 text-slate-500';
}

function EvidenceRow(props: {
  label: string;
  value: string;
  state: EvidenceState;
}) {
  return (
    <div className="flex min-h-[44px] items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${stateTone(props.state)}`}>
        {props.state === 'ready' ? 'OK' : props.state === 'pending' ? '...' : props.state === 'blocked' ? '!' : '-'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-slate-800">{props.label}</div>
        <div className="truncate text-[10px] leading-4 text-slate-500">{props.value}</div>
      </div>
    </div>
  );
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
  const live2dAdapterImportDisabled = avatarImportDisabled
    || live2dAdapterManifestImportMutation.isPending
    || avatarBackendKind !== 'live2d'
    || !selectedAvatarAssetId;
  const clearAvatarAssetDisabled = !selectedAvatarAssetId || clearAvatarAssetMutation.isPending;
  const assetConfigured = Boolean(selectedAvatarAssetId);
  const capabilityLinked = Boolean(avatarAssetConfig?.backend_capability_profile_ref);
  const assetDisplayRef = selectedAvatarAssetId
    || input.t('Chat.agentCenterMissing', { defaultValue: 'Missing' });
  const adapterDisplay = live2dAdapterManifestSource === 'external_sidecar_manifest'
    ? input.t('Chat.agentCenterLive2dAdapterSidecarLinked', { defaultValue: 'External sidecar linked' })
    : live2dAdapterManifestSource === 'embedded_creator_manifest'
      ? input.t('Chat.agentCenterLive2dAdapterEmbedded', { defaultValue: 'Embedded' })
      : input.t('Chat.agentCenterLive2dAdapterNone', { defaultValue: 'Not selected' });
  const validationDisplay = avatarAssetValidationPresentation.validationStatus.replaceAll('_', ' ');
  const launchReadinessTone = avatarAssetValid
    ? 'border-emerald-100 bg-emerald-50/80 text-emerald-800'
    : avatarAssetChecking
      ? 'border-slate-200 bg-slate-50 text-slate-600'
      : 'border-amber-200 bg-amber-50 text-amber-800';
  const launchReadinessTitle = avatarAssetValid
    ? input.t('Chat.agentCenterAvatarLaunchReady', { defaultValue: 'Ready to launch' })
    : avatarAssetChecking
      ? input.t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
      : input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' });
  const launchReadinessMessage = avatarAssetValid
    ? input.t('Chat.agentCenterAvatarAssetReady', {
      defaultValue: 'Local asset and backend evidence are ready for launch from the composer.',
    })
    : avatarAssetValidationPresentation.message
      || input.t('Chat.agentCenterAvatarAssetMissing', {
        defaultValue: 'Avatar launch requires Avatar-owned package evidence before opening.',
      });
  const capabilityValue = capabilityLinked
    ? input.t('Chat.agentCenterAvatarProfileLinked', { defaultValue: 'Linked' })
    : input.t('Chat.agentCenterAvatarProfilePending', { defaultValue: 'Pending evidence' });
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
      <div className={`rounded-xl border px-3 py-3 ${avatarAssetValid ? 'border-emerald-100 bg-emerald-50/60' : 'border-slate-100 bg-white/85'}`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${avatarAssetValid ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
            {avatarAssetValid ? 'OK' : avatarBackendKind === 'vrm' ? '3D' : '2D'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-xs font-semibold text-slate-950">
                {assetConfigured
                  ? input.t('Chat.agentCenterAvatarAssetSelected', { defaultValue: 'Selected' })
                  : input.t('Chat.agentCenterAvatarAsset', { defaultValue: 'Avatar asset' })}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${avatarAssetValid ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {avatarBackendKind.toUpperCase()}
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] leading-4 text-slate-500">
              {assetDisplayRef}
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            avatarAssetValid
              ? 'bg-emerald-100 text-emerald-700'
              : avatarAssetChecking
                ? 'bg-slate-100 text-slate-600'
                : 'bg-amber-100 text-amber-700'
          }`}
          >
            {avatarAssetValid
              ? input.t('Chat.agentCenterReady', { defaultValue: 'Ready' })
              : avatarAssetChecking
                ? input.t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
                : input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' })}
          </span>
        </div>
      </div>

      <section className="rounded-xl border border-slate-100 bg-white/85 px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-slate-950">
            {input.t('Chat.agentCenterAvatarImportSource', { defaultValue: 'Import source' })}
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            {input.t('Chat.agentCenterAvatarOwnedEvidence', { defaultValue: 'Avatar-owned evidence' })}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={avatarImportDisabled}
          onClick={() => avatarAssetImportMutation.mutate('live2d')}
          className="group flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-4 text-center text-xs font-semibold text-emerald-800 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-emerald-200 disabled:hover:bg-emerald-50/40 disabled:hover:shadow-none"
        >
          <UploadGlyph className="h-4 w-4 text-emerald-500" />
          <span>
            {avatarAssetImportMutation.isPending
              ? input.t('Chat.agentCenterAvatarImporting', { defaultValue: 'Importing...' })
              : input.t('Chat.agentCenterImportLive2d', { defaultValue: 'Import Live2D folder' })}
          </span>
          <span className="text-[10px] font-medium leading-3 text-emerald-700/70">
            {input.t('Chat.agentCenterImportLive2dHint', { defaultValue: 'model3.json + textures' })}
          </span>
        </button>
        <button
          type="button"
          disabled={avatarImportDisabled}
          onClick={() => avatarAssetImportMutation.mutate('vrm')}
          className="group flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-violet-200 bg-violet-50/30 px-3 py-4 text-center text-xs font-semibold text-violet-800 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-violet-400 hover:bg-violet-50 hover:shadow-[0_8px_20px_rgba(139,92,246,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-violet-200 disabled:hover:bg-violet-50/30 disabled:hover:shadow-none"
        >
          <UploadGlyph className="h-4 w-4 text-violet-500" />
          <span>
            {avatarAssetImportMutation.isPending
              ? input.t('Chat.agentCenterAvatarImporting', { defaultValue: 'Importing...' })
              : input.t('Chat.agentCenterImportVrm', { defaultValue: 'Import VRM file' })}
          </span>
          <span className="text-[10px] font-medium leading-3 text-violet-700/70">
            {input.t('Chat.agentCenterImportVrmHint', { defaultValue: '.vrm - single file' })}
          </span>
        </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
      </section>

      <section className="space-y-2 rounded-xl border border-slate-100 bg-white/85 px-3 py-3">
        <div className="text-xs font-semibold text-slate-950">
          {input.t('Chat.agentCenterAvatarEvidence', { defaultValue: 'Evidence' })}
        </div>
        <EvidenceRow
          label={input.t('Chat.agentCenterAvatarSelectedAsset', { defaultValue: 'Selected asset' })}
          value={assetDisplayRef}
          state={assetConfigured ? 'ready' : 'missing'}
        />
        <EvidenceRow
          label={input.t('Chat.agentCenterAvatarValidationStatus', { defaultValue: 'Validation' })}
          value={validationDisplay}
          state={avatarAssetValid ? 'ready' : assetConfigured ? 'blocked' : 'missing'}
        />
        <EvidenceRow
          label={input.t('Chat.agentCenterAvatarCapabilityProfile', { defaultValue: 'Capability profile' })}
          value={capabilityValue}
          state={capabilityLinked ? 'ready' : assetConfigured ? 'pending' : 'missing'}
        />
        {avatarBackendKind === 'live2d' ? (
          <EvidenceRow
            label={input.t('Chat.agentCenterLive2dAdapterManifest', { defaultValue: 'Live2D adapter manifest' })}
            value={adapterDisplay}
            state={live2dAdapterManifestSource === 'none' ? 'missing' : 'ready'}
          />
        ) : null}
        {avatarAssetValidationPresentation.issueRows.length > 1 ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">
            {avatarAssetValidationPresentation.issueRows.map((issue) => (
              <div key={issue} className="break-words">{issue}</div>
            ))}
          </div>
        ) : null}
      </section>

      <AgentCenterLive2dCalibrationWorkbench
        input={input}
        avatarAssetConfig={avatarAssetConfig}
        avatarAssetValid={avatarAssetValid}
        avatarAssetChecking={avatarAssetChecking}
      />

      <section className={`rounded-xl border px-3 py-3 ${launchReadinessTone}`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 text-[11px] font-bold">
            {avatarAssetValid ? 'OK' : avatarAssetChecking ? '...' : '!'}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold">{launchReadinessTitle}</div>
            <div className="mt-1 text-[11px] leading-4">{launchReadinessMessage}</div>
          </div>
        </div>
      </section>

      <details className="group rounded-xl border border-slate-100 bg-white/85 px-3 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-slate-900">
          <span>{input.t('Chat.agentCenterAdvancedDiagnostics', { defaultValue: 'Diagnostics' })}</span>
          <span className="text-[10px] font-semibold text-slate-400 group-open:hidden">
            {input.t('Chat.agentCenterAdvancedCollapsed', { defaultValue: 'Advanced collapsed' })}
          </span>
          <span className="hidden text-[10px] font-semibold text-slate-400 group-open:inline">
            {input.t('Chat.agentCenterAdvancedExpanded', { defaultValue: 'Advanced open' })}
          </span>
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
          {input.developerModeEnabled ? renderOptionSelect<AgentCenterAvatarDebugProfile>({
              label: input.t('Chat.agentCenterAvatarDebugProfile', { defaultValue: 'Debug profile' }),
              value: avatarDebugProfile,
              options: [
                { value: 'standard', label: input.t('Chat.agentCenterAvatarDebugStandard', { defaultValue: 'Standard' }) },
                { value: 'strict_backend_evidence', label: input.t('Chat.agentCenterAvatarDebugStrict', { defaultValue: 'Strict evidence' }) },
                { value: 'route_matrix', label: input.t('Chat.agentCenterAvatarDebugRoutes', { defaultValue: 'Route matrix' }) },
              ],
              onChange: (debug_profile) => avatarConfigMutation.mutate({ debug_profile }),
            }) : null}
        </div>
        {input.developerModeEnabled ? (
          <div className="mt-3">
            <AgentCenterAvatarDebugWorkbench
              input={input}
              avatarAssetConfig={avatarAssetConfig}
              avatarAssetValid={avatarAssetValid}
              avatarAssetChecking={avatarAssetChecking}
              validationMessage={avatarAssetValidationPresentation.message}
            />
          </div>
        ) : null}
      </details>
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
    </div>
  );
}
