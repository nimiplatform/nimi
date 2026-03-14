import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalAiProfileApplyResult, LocalAiProfileResolutionPlan } from '@runtime/local-ai-runtime';
import type { RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import {
  normalizeSelectedProfileCapability,
  resolveProfileCapabilityOptions,
} from './runtime-config-model-center-utils';
import { RuntimeSelect } from './runtime-config-primitives';

function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PackageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  icon,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const variantClass = variant === 'primary'
    ? 'bg-mint-500 text-white hover:bg-mint-600 disabled:bg-gray-300'
    : variant === 'secondary'
      ? 'border border-mint-200 bg-white text-mint-700 hover:bg-mint-50 disabled:bg-gray-100 disabled:text-gray-400'
      : 'text-mint-700 hover:bg-mint-50 disabled:text-gray-300';

  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:cursor-not-allowed hover:shadow-sm ${variantClass} ${sizeClass}`}
    >
      {icon}
      {children}
    </button>
  );
}

export type ModelCenterProfileSectionProps = {
  isModMode: boolean;
  loadingProfilePlan: boolean;
  selectedProfileModId: string;
  profileSelectionLocked: boolean;
  selectedProfileId: string;
  selectedProfileCapability: string;
  selectedProfileTarget: RuntimeProfileTargetDescriptor | null;
  executionPlanPreview: LocalAiProfileResolutionPlan | null;
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[];
  onSetSelectedProfileModId: (modId: string) => void;
  onSetSelectedProfileId: (profileId: string) => void;
  onSetSelectedProfileCapability: (capability: string) => void;
  onResolveProfilePlanPreview: () => void;
  onApplyProfile: (modId: string, profileId: string, capability?: string) => Promise<LocalAiProfileApplyResult>;
};

function summaryLine(plan: LocalAiProfileResolutionPlan): string {
  const selectedDependencies = plan.executionPlan.entries.filter((entry) => entry.selected).length;
  const artifactCount = plan.artifactEntries.length;
  return `${selectedDependencies} runtime entries · ${artifactCount} companion artifacts`;
}

export function ModelCenterProfileSection(props: ModelCenterProfileSectionProps) {
  const { t } = useTranslation();
  const [applyingProfile, setApplyingProfile] = useState(false);
  const [applySummary, setApplySummary] = useState('');

  const selectedProfile = useMemo(() => {
    if (!props.selectedProfileTarget) {
      return null;
    }
    return props.selectedProfileTarget.profiles.find((profile) => profile.id === props.selectedProfileId)
      || props.selectedProfileTarget.profiles[0]
      || null;
  }, [props.selectedProfileTarget, props.selectedProfileId]);
  const capabilityOptions = useMemo(
    () => resolveProfileCapabilityOptions(selectedProfile),
    [selectedProfile],
  );
  const effectiveCapability = useMemo(
    () => normalizeSelectedProfileCapability(selectedProfile, props.selectedProfileCapability),
    [props.selectedProfileCapability, selectedProfile],
  );
  const capabilitySelectionMissing = capabilityOptions.length > 1 && !effectiveCapability;

  return (
    <div className="rounded-xl border border-mint-100 bg-mint-50/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageIcon className="h-4 w-4 text-mint-600" />
          <p className="text-sm font-semibold text-gray-900">
            {props.isModMode
              ? t('runtimeConfig.local.modelProfiles', { defaultValue: 'Recommended Profiles' })
              : t('runtimeConfig.mods.modProfiles', { defaultValue: 'Mod Profiles' })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.loadingProfilePlan || !props.selectedProfileModId || !selectedProfile || capabilitySelectionMissing}
          onClick={() => void props.onResolveProfilePlanPreview()}
          icon={<RefreshIcon />}
        >
          {props.loadingProfilePlan
            ? t('runtimeConfig.local.resolving', { defaultValue: 'Resolving...' })
            : t('runtimeConfig.local.resolvePlan', { defaultValue: 'Preview Install' })}
        </Button>
      </div>

      {props.runtimeProfileTargets.length <= 0 ? (
        <p className="text-xs text-gray-500">
          {t('runtimeConfig.local.noProfileEnabledMod', { defaultValue: 'No profile-enabled runtime mod found.' })}
        </p>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 ${props.profileSelectionLocked ? '' : 'md:grid-cols-2'}`}>
            {props.profileSelectionLocked ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {t('runtimeConfig.local.runtimeMod', { defaultValue: 'Runtime Mod' })}
                </label>
                <div className="flex h-11 w-full items-center rounded-xl border border-mint-100 bg-[#F4FBF8] px-3 text-sm text-gray-900">
                  {props.selectedProfileTarget?.modName
                    || props.selectedProfileModId
                    || t('runtimeConfig.local.unknownRuntimeMod', { defaultValue: 'Unknown runtime mod' })}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {t('runtimeConfig.local.runtimeMod', { defaultValue: 'Runtime Mod' })}
                </label>
                <RuntimeSelect
                  value={props.selectedProfileModId}
                  onChange={props.onSetSelectedProfileModId}
                  className="w-full"
                  options={props.runtimeProfileTargets.map((target) => ({
                    value: target.modId,
                    label: target.modName,
                  }))}
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('runtimeConfig.local.profile', { defaultValue: 'Profile' })}
              </label>
              <RuntimeSelect
                value={selectedProfile?.id || ''}
                onChange={props.onSetSelectedProfileId}
                className="w-full"
                options={(props.selectedProfileTarget?.profiles || []).map((profile) => ({
                  value: profile.id,
                  label: profile.recommended
                    ? `${profile.title} (${t('runtimeConfig.local.recommended', { defaultValue: 'Recommended' })})`
                    : profile.title,
                }))}
              />
            </div>
          </div>

          {selectedProfile ? (
            <div className="space-y-3 rounded-xl border border-mint-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selectedProfile.title}</p>
                  {selectedProfile.description ? (
                    <p className="mt-1 text-xs text-gray-500">{selectedProfile.description}</p>
                  ) : null}
                </div>
                {selectedProfile.recommended ? (
                  <span className="rounded-full bg-mint-100 px-2 py-0.5 text-[10px] font-medium text-mint-700">
                    {t('runtimeConfig.local.recommended', { defaultValue: 'Recommended' })}
                  </span>
                ) : null}
              </div>

              {selectedProfile.consumeCapabilities.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.consumeCapabilities.map((capability) => (
                    <span key={capability} className="rounded-full bg-mint-100 px-2 py-0.5 text-[10px] font-medium text-mint-700">
                      {capability}
                    </span>
                  ))}
                </div>
              ) : null}

              {capabilityOptions.length > 1 ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {t('runtimeConfig.local.profileCapability', { defaultValue: 'Capability' })}
                  </label>
                  <RuntimeSelect
                    value={effectiveCapability}
                    onChange={props.onSetSelectedProfileCapability}
                    className="w-full md:max-w-xs"
                    options={[
                      {
                        value: '',
                        label: t('runtimeConfig.local.selectCapability', { defaultValue: 'Select capability' }),
                      },
                      ...capabilityOptions.map((capability) => ({
                        value: capability,
                        label: capability,
                      })),
                    ]}
                  />
                  {!effectiveCapability ? (
                    <p className="mt-1 text-xs text-amber-700">
                      {t('runtimeConfig.local.selectProfileCapability', {
                        defaultValue: 'Select which capability to resolve and install for this profile.',
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {selectedProfile.requirements ? (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  {selectedProfile.requirements.minGpuMemoryGb
                    ? `${selectedProfile.requirements.minGpuMemoryGb} GB VRAM · `
                    : ''}
                  {selectedProfile.requirements.minDiskBytes
                    ? `${Math.ceil(selectedProfile.requirements.minDiskBytes / (1024 * 1024 * 1024))} GB disk · `
                    : ''}
                  {(selectedProfile.requirements.platforms || []).join(', ')}
                </div>
              ) : null}

              <div className="space-y-2">
                {(selectedProfile.entries || []).map((entry) => (
                  <div key={entry.entryId} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs">
                    <div>
                      <p className="font-medium text-gray-900">{entry.title || entry.entryId}</p>
                      <p className="text-gray-500">
                        {entry.kind}
                        {entry.capability ? ` · ${entry.capability}` : ''}
                        {entry.artifactKind ? ` · ${entry.artifactKind}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {entry.required !== false ? (
                        <span className="rounded-full bg-mint-100 px-2 py-0.5 text-[10px] font-medium text-mint-700">
                          {t('runtimeConfig.local.required', { defaultValue: 'Required' })}
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                          {t('runtimeConfig.local.optional', { defaultValue: 'Optional' })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {props.loadingProfilePlan ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <RefreshIcon className="h-4 w-4 animate-spin" />
                  {t('runtimeConfig.local.resolvingProfilePlan', { defaultValue: 'Resolving profile install plan...' })}
                </div>
              ) : props.executionPlanPreview ? (
                <div className="rounded-lg bg-mint-50/60 px-3 py-2 text-xs text-mint-900">
                  <p className="font-medium">{summaryLine(props.executionPlanPreview)}</p>
                  {props.executionPlanPreview.warnings.length > 0 ? (
                    <p className="mt-1 text-mint-800">
                      {props.executionPlanPreview.warnings.join(' · ')}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <Button
                variant="primary"
                size="sm"
                disabled={applyingProfile || !selectedProfile || capabilitySelectionMissing}
                onClick={() => {
                  if (!selectedProfile) {
                    return;
                  }
                  void (async () => {
                    setApplyingProfile(true);
                    try {
                      const result = await props.onApplyProfile(
                        props.selectedProfileModId,
                        selectedProfile.id,
                        effectiveCapability || undefined,
                      );
                      setApplySummary(t('runtimeConfig.local.profileInstalled', {
                        defaultValue: 'Installed {{profileId}}: {{artifactCount}} artifact(s)',
                        profileId: selectedProfile.id,
                        artifactCount: result.installedArtifacts.length,
                      }));
                    } catch (e) {
                      setApplySummary(
                        e instanceof Error
                          ? e.message
                          : t('runtimeConfig.local.profileInstallFailed', { defaultValue: 'Failed to install profile.' }),
                      );
                    } finally {
                      setApplyingProfile(false);
                    }
                  })();
                }}
                icon={<CheckIcon />}
              >
                {applyingProfile
                  ? t('runtimeConfig.local.applying', { defaultValue: 'Installing...' })
                  : t('runtimeConfig.local.installProfile', { defaultValue: 'Install Profile' })}
              </Button>

              {applySummary ? (
                <p className="rounded-lg bg-mint-50/60 px-3 py-2 text-xs text-mint-800">{applySummary}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
