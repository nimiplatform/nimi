import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalRuntimeProfileApplyResult, LocalRuntimeProfileResolutionPlan } from '@runtime/local-runtime';
import type { RuntimeConfigStateV11, RuntimePageIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import {
  normalizeSelectedProfileCapability,
  resolveDependencyStatus,
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

function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
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
    ? 'bg-[var(--nimi-action-primary-bg)] text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:bg-[color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)]'
    : variant === 'secondary'
      ? 'border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] bg-white text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] disabled:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]'
      : 'text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]';

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
  executionPlanPreview: LocalRuntimeProfileResolutionPlan | null;
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[];
  onSetSelectedProfileModId: (modId: string) => void;
  onSetSelectedProfileId: (profileId: string) => void;
  onSetSelectedProfileCapability: (capability: string) => void;
  onResolveProfilePlanPreview: () => void;
  onApplyProfile: (modId: string, profileId: string, capability?: string) => Promise<LocalRuntimeProfileApplyResult>;
  variant?: 'card' | 'flat';
  state?: RuntimeConfigStateV11;
  onNavigateToSetup?: (pageId: RuntimePageIdV11) => void;
  hideInstallButton?: boolean;
};

function summaryLine(plan: LocalRuntimeProfileResolutionPlan): string {
  const selectedDependencies = plan.executionPlan.entries.filter((entry) => entry.selected).length;
  const passiveAssetCount = plan.assetEntries.length;
  return `${selectedDependencies} runtime entries · ${passiveAssetCount} passive assets`;
}

/* ------------------------------------------------------------------ */
/*  Card variant (original layout — backward compat)                  */
/* ------------------------------------------------------------------ */

function ProfileSectionCard(props: ModelCenterProfileSectionProps & {
  selectedProfile: ReturnType<typeof useResolvedProfile>;
  capabilityOptions: string[];
  effectiveCapability: string;
  capabilitySelectionMissing: boolean;
}) {
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
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.local.noProfileEnabledMod', { defaultValue: 'No profile-enabled runtime mod found.' })}
        </p>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 ${props.profileSelectionLocked ? '' : 'md:grid-cols-2'}`}>
            {props.profileSelectionLocked ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.local.runtimeMod', { defaultValue: 'Runtime Mod' })}
                </label>
                <div className="flex h-11 w-full items-center rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-3 text-sm text-[var(--nimi-text-primary)]">
                  {props.selectedProfileTarget?.modName
                    || props.selectedProfileModId
                    || t('runtimeConfig.local.unknownRuntimeMod', { defaultValue: 'Unknown runtime mod' })}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
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
                        props.selectedProfileModId,
                        selectedProfile.id,
                        effectiveCapability || undefined,
                      );
                      setApplySummary(t('runtimeConfig.local.profileInstalled', {
                        defaultValue: 'Installed {{profileId}}: {{assetCount}} asset(s)',
                        profileId: selectedProfile.id,
                        assetCount: result.installedAssets.length,
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
/*  Flat variant (flattened layout for Mods page)                     */
/* ------------------------------------------------------------------ */

function ProfileSectionFlat(props: ModelCenterProfileSectionProps & {
  selectedProfile: ReturnType<typeof useResolvedProfile>;
  capabilityOptions: string[];
  effectiveCapability: string;
  capabilitySelectionMissing: boolean;
}) {
  const { t } = useTranslation();
  const { selectedProfile, capabilityOptions, effectiveCapability } = props;

  return (
    <div className="space-y-5">
      <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {props.isModMode
          ? t('runtimeConfig.local.modelProfiles', { defaultValue: 'Recommended Profiles' })
          : t('runtimeConfig.mods.modProfiles', { defaultValue: 'Mod Profiles' })}
      </h4>

      {props.runtimeProfileTargets.length <= 0 ? (
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.local.noProfileEnabledMod', { defaultValue: 'No profile-enabled runtime mod found.' })}
        </p>
      ) : (
        <>
          {/* Dropdowns */}
          <div className={`grid grid-cols-1 gap-3 ${props.profileSelectionLocked ? '' : 'md:grid-cols-2'}`}>
            {props.profileSelectionLocked ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.local.runtimeMod', { defaultValue: 'Runtime Mod' })}
                </label>
                <div className="flex h-10 w-full items-center rounded-lg bg-[#F9FAFB] px-3 text-sm text-[var(--nimi-text-primary)]">
                  {props.selectedProfileTarget?.modName
                    || props.selectedProfileModId
                    || t('runtimeConfig.local.unknownRuntimeMod', { defaultValue: 'Unknown runtime mod' })}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--nimi-text-secondary)]">
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
              <label className="mb-1.5 block text-xs font-medium text-[var(--nimi-text-secondary)]">
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

          {/* Profile detail — flat, no card */}
          {selectedProfile ? (
            <div className="space-y-4 pt-1">
              {/* Title + badge */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{selectedProfile.title}</p>
                  {selectedProfile.description ? (
                    <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{selectedProfile.description}</p>
                  ) : null}
                </div>
                {selectedProfile.recommended ? (
                  <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
                    {t('runtimeConfig.local.recommended', { defaultValue: 'Recommended' })}
                  </span>
                ) : null}
              </div>

              {/* Capability chips */}
              {selectedProfile.consumeCapabilities.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.consumeCapabilities.map((capability) => (
                    <span key={capability} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
                      {capability}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Capability selector */}
              {capabilityOptions.length > 1 ? (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--nimi-text-secondary)]">
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

              {/* Requirements — plain text */}
              {selectedProfile.requirements ? (
                <p className="text-xs text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.local.requires', { defaultValue: 'Requires' })}:{' '}
                  {selectedProfile.requirements.minGpuMemoryGb
                    ? `${selectedProfile.requirements.minGpuMemoryGb} GB VRAM`
                    : ''}
                  {selectedProfile.requirements.minGpuMemoryGb && selectedProfile.requirements.minDiskBytes ? ' · ' : ''}
                  {selectedProfile.requirements.minDiskBytes
                    ? `${Math.ceil(selectedProfile.requirements.minDiskBytes / (1024 * 1024 * 1024))} GB disk`
                    : ''}
                  {((selectedProfile.requirements.minGpuMemoryGb || selectedProfile.requirements.minDiskBytes)
                    && (selectedProfile.requirements.platforms || []).length > 0)
                    ? ' · '
                    : ''}
                  {(selectedProfile.requirements.platforms || []).join(', ')}
                </p>
              ) : null}

              {/* Entry list with inline status */}
              <div className="divide-y divide-[var(--nimi-border-subtle)]">
                {(selectedProfile.entries || []).map((entry) => {
                  const dep = props.state
                    ? resolveDependencyStatus(entry, props.state)
                    : { met: true, reason: '' };
                  const isRequired = entry.required !== false;
                  const showWarning = !dep.met && isRequired;

                  return (
                    <div
                      key={entry.entryId}
                      className={`flex items-center justify-between py-2.5 text-xs ${
                        showWarning
                          ? 'rounded-lg bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,transparent)] px-3 -mx-3'
                          : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-[var(--nimi-text-primary)]">{entry.title || entry.entryId}</p>
                        <p className="text-[var(--nimi-text-muted)]">
                          {entry.kind}
                          {entry.capability ? ` · ${entry.capability}` : ''}
                          {entry.assetKind ? ` · ${entry.assetKind}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pl-3">
                        {dep.met ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--nimi-status-success)]">
                            <CheckIcon className="h-3 w-3" />
                            {t('runtimeConfig.mods.ready', { defaultValue: 'Ready' })}
                          </span>
                        ) : (
                          <>
                            <span className={`text-[10px] font-medium ${isRequired ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-muted)]'}`}>
                              {isRequired
                                ? t('runtimeConfig.local.required', { defaultValue: 'Required' })
                                : t('runtimeConfig.local.optional', { defaultValue: 'Optional' })}
                            </span>
                            {props.onNavigateToSetup ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md bg-[var(--nimi-action-primary-bg)] px-2 py-1 text-[10px] font-medium text-white hover:opacity-90 transition-opacity"
                                onClick={() => props.onNavigateToSetup!(entry.kind === 'service' ? 'cloud' as const : 'local' as const)}
                              >
                                <DownloadIcon />
                                {t('runtimeConfig.mods.setup', { defaultValue: 'Setup' })}
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Plan summary — inline text */}
              {props.loadingProfilePlan ? (
                <p className="flex items-center gap-2 text-xs text-[var(--nimi-text-muted)]">
                  <RefreshIcon className="h-3.5 w-3.5 animate-spin" />
                  {t('runtimeConfig.local.resolvingProfilePlan', { defaultValue: 'Resolving profile install plan...' })}
                </p>
              ) : props.executionPlanPreview ? (
                <div className="flex items-center justify-between text-xs text-[var(--nimi-text-secondary)]">
                  <div>
                    <p className="font-medium">{summaryLine(props.executionPlanPreview)}</p>
                    {props.executionPlanPreview.warnings.length > 0 ? (
                      <p className="mt-0.5 text-[var(--nimi-status-warning)]">
                        {props.executionPlanPreview.warnings.join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void props.onResolveProfilePlanPreview()}
                    className="rounded p-1 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)] hover:bg-[#F9FAFB] transition-colors"
                    title={t('runtimeConfig.local.resolvePlan', { defaultValue: 'Preview Install' })}
                  >
                    <RefreshIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
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
    return <ProfileSectionFlat {...shared} />;
  }
  return <ProfileSectionCard {...shared} />;
}
