import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalRuntimeProfileApplyResult, LocalRuntimeProfileResolutionPlan } from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigStateV11, RuntimePageIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import {
  normalizeSelectedProfileCapability,
  resolveProfileCapabilityOptions,
} from './runtime-config-model-center-utils';
import { RuntimeSelect } from './runtime-config-primitives';
import { Button, CheckIcon, PackageIcon, RefreshIcon } from './runtime-config-model-center-profile-controls';
import { summaryLine } from './runtime-config-model-center-profile-summary';
import { ProfileSectionFlat as ModelCenterProfileSectionFlat } from './runtime-config-model-center-profile-section-flat';

export type ModelCenterProfileSectionProps = {
  isProfileTargetMode: boolean;
  loadingProfilePlan: boolean;
  selectedProfileTargetId: string;
  profileSelectionLocked: boolean;
  selectedProfileId: string;
  selectedProfileCapability: string;
  selectedProfileTarget: RuntimeProfileTargetDescriptor | null;
  executionPlanPreview: LocalRuntimeProfileResolutionPlan | null;
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[];
  onSetSelectedProfileTargetId: (targetId: string) => void;
  onSetSelectedProfileId: (profileId: string) => void;
  onSetSelectedProfileCapability: (capability: string) => void;
  onResolveProfilePlanPreview: () => void;
  onApplyProfile: (targetId: string, profileId: string, capability?: string) => Promise<LocalRuntimeProfileApplyResult>;
  variant?: 'card' | 'flat';
  state?: RuntimeConfigStateV11;
  onNavigateToSetup?: (pageId: RuntimePageIdV11) => void;
  hideInstallButton?: boolean;
};

export type ModelCenterResolvedProfile = RuntimeProfileTargetDescriptor['profiles'][number] | null;

export type ModelCenterProfileResolvedSectionProps = ModelCenterProfileSectionProps & {
  selectedProfile: ModelCenterResolvedProfile;
  capabilityOptions: string[];
  effectiveCapability: string;
  capabilitySelectionMissing: boolean;
};

function ProfileSectionCard(props: ModelCenterProfileResolvedSectionProps) {
  const { t } = useTranslation();
  const [applyingProfile, setApplyingProfile] = useState(false);
  const [applySummary, setApplySummary] = useState('');
  const { selectedProfile, capabilityOptions, effectiveCapability, capabilitySelectionMissing } = props;

  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageIcon className="h-4 w-4 text-[var(--nimi-action-primary-bg)]" />
          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {props.isProfileTargetMode
              ? t('runtimeConfig.local.modelProfiles', { defaultValue: 'Recommended Profiles' })
              : t('runtimeConfig.profileTargets.profileSetup', { defaultValue: 'Profile Setup' })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.loadingProfilePlan || !props.selectedProfileTargetId || !selectedProfile || capabilitySelectionMissing}
          onClick={() => void props.onResolveProfilePlanPreview()}
          icon={<RefreshIcon />}
        >
          {props.loadingProfilePlan
            ? t('runtimeConfig.local.resolving', { defaultValue: 'Resolving...' })
            : t('runtimeConfig.local.resolvePlan', { defaultValue: 'Preview Install' })}
        </Button>
      </div>

      {props.runtimeProfileTargets.length <= 0 ? (
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.local.noProfileEnabledTarget', { defaultValue: 'No profile-enabled target found.' })}
        </p>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 ${props.profileSelectionLocked ? '' : 'md:grid-cols-2'}`}>
            {props.profileSelectionLocked ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.local.runtimeProfileTarget', { defaultValue: 'Profile Target' })}
                </label>
                <div className="flex h-11 w-full items-center rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-3 text-sm text-[var(--nimi-text-primary)]">
                  {props.selectedProfileTarget?.targetName
                    || props.selectedProfileTargetId
                    || t('runtimeConfig.local.unknownRuntimeProfileTarget', { defaultValue: 'Unknown profile target' })}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.local.runtimeProfileTarget', { defaultValue: 'Profile Target' })}
                </label>
                <RuntimeSelect
                  value={props.selectedProfileTargetId}
                  onChange={props.onSetSelectedProfileTargetId}
                  className="w-full"
                  options={props.runtimeProfileTargets.map((target) => ({
                    value: target.targetId,
                    label: target.targetName,
                  }))}
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
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
            <div className="space-y-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{selectedProfile.title}</p>
                  {selectedProfile.description ? (
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{selectedProfile.description}</p>
                  ) : null}
                </div>
                {selectedProfile.recommended ? (
                  <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
                    {t('runtimeConfig.local.recommended', { defaultValue: 'Recommended' })}
                  </span>
                ) : null}
              </div>

              {selectedProfile.consumeCapabilities.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.consumeCapabilities.map((capability) => (
                    <span key={capability} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
                      {capability}
                    </span>
                  ))}
                </div>
              ) : null}

              {capabilityOptions.length > 1 ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                    {t('runtimeConfig.local.profileCapability', { defaultValue: 'Capability' })}
                  </label>
                  <RuntimeSelect
                    value={effectiveCapability}
                    onChange={props.onSetSelectedProfileCapability}
                    className="w-full md:max-w-xs"
                    placeholder={t('runtimeConfig.local.selectCapability', { defaultValue: 'Select capability' })}
                    options={capabilityOptions.map((capability) => ({
                      value: capability,
                      label: capability,
                    }))}
                  />
                  {!effectiveCapability ? (
                    <p className="mt-1 text-xs text-[var(--nimi-status-warning)]">
                      {t('runtimeConfig.local.selectProfileCapability', {
                        defaultValue: 'Select which capability to resolve and install for this profile.',
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {selectedProfile.requirements ? (
                <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-3 py-2 text-xs text-[var(--nimi-text-secondary)]">
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
                  <div key={entry.entryId} className="flex items-center justify-between rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-3 py-2 text-xs">
                    <div>
                      <p className="font-medium text-[var(--nimi-text-primary)]">{entry.title || entry.entryId}</p>
                      <p className="text-[var(--nimi-text-muted)]">
                        {entry.kind}
                        {entry.capability ? ` · ${entry.capability}` : ''}
                        {entry.assetKind ? ` · ${entry.assetKind}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {entry.required !== false ? (
                        <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
                          {t('runtimeConfig.local.required', { defaultValue: 'Required' })}
                        </span>
                      ) : (
                        <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-text-secondary)]">
                          {t('runtimeConfig.local.optional', { defaultValue: 'Optional' })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {props.loadingProfilePlan ? (
                <div className="flex items-center gap-2 text-sm text-[var(--nimi-text-muted)]">
                  <RefreshIcon className="h-4 w-4 animate-spin" />
                  {t('runtimeConfig.local.resolvingProfilePlan', { defaultValue: 'Resolving profile install plan...' })}
                </div>
              ) : props.executionPlanPreview ? (
                <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/60 px-3 py-2 text-xs text-[var(--nimi-action-primary-bg)]">
                  <p className="font-medium">{summaryLine(props.executionPlanPreview)}</p>
                  {props.executionPlanPreview.warnings.length > 0 ? (
                    <p className="mt-1 text-[var(--nimi-action-primary-bg)]">
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
                        props.selectedProfileTargetId,
                        selectedProfile.id,
                        effectiveCapability || undefined,
                      );
                      setApplySummary(t('runtimeConfig.local.profileApplied', {
                        defaultValue: 'Profile {{profileId}} installed.',
                        profileId: result.profileId || selectedProfile.id,
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
                <p className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/60 px-3 py-2 text-xs text-[var(--nimi-action-primary-bg)]">{applySummary}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hook to resolve selected profile                                  */
/* ------------------------------------------------------------------ */

function useResolvedProfile(props: ModelCenterProfileSectionProps) {
  return useMemo(() => {
    if (!props.selectedProfileTarget) {
      return null;
    }
    return props.selectedProfileTarget.profiles.find((profile) => profile.id === props.selectedProfileId)
      || props.selectedProfileTarget.profiles[0]
      || null;
  }, [props.selectedProfileTarget, props.selectedProfileId]);
}

/* ------------------------------------------------------------------ */
/*  Public export                                                     */
/* ------------------------------------------------------------------ */

export function ModelCenterProfileSection(props: ModelCenterProfileSectionProps) {
  const selectedProfile = useResolvedProfile(props);
  const capabilityOptions = useMemo(
    () => resolveProfileCapabilityOptions(selectedProfile),
    [selectedProfile],
  );
  const effectiveCapability = useMemo(
    () => normalizeSelectedProfileCapability(selectedProfile, props.selectedProfileCapability),
    [props.selectedProfileCapability, selectedProfile],
  );
  const capabilitySelectionMissing = capabilityOptions.length > 1 && !effectiveCapability;

  const shared = {
    ...props,
    selectedProfile,
    capabilityOptions,
    effectiveCapability,
    capabilitySelectionMissing,
  };

  if (props.variant === 'flat') {
    return <ModelCenterProfileSectionFlat {...shared} />;
  }
  return <ProfileSectionCard {...shared} />;
}
