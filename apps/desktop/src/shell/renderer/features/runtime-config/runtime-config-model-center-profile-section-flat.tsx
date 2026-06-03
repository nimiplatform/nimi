import { useTranslation } from 'react-i18next';
import { resolveDependencyStatus } from './runtime-config-model-center-utils';
import { RuntimeSelect } from './runtime-config-primitives';
import { CheckIcon, DownloadIcon, RefreshIcon } from './runtime-config-model-center-profile-controls';
import { summaryLine } from './runtime-config-model-center-profile-summary';
import type { ModelCenterProfileResolvedSectionProps } from './runtime-config-model-center-profile-section';

export function ProfileSectionFlat(props: ModelCenterProfileResolvedSectionProps) {
  const { t } = useTranslation();
  const { selectedProfile, capabilityOptions, effectiveCapability } = props;

  return (
    <div className="space-y-5">
      <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {props.isProfileTargetMode
          ? t('runtimeConfig.local.modelProfiles', { defaultValue: 'Recommended Profiles' })
          : t('runtimeConfig.profileTargets.profileSetup', { defaultValue: 'Profile Setup' })}
      </h4>

      {props.runtimeProfileTargets.length <= 0 ? (
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.local.noProfileEnabledTarget', { defaultValue: 'No profile-enabled target found.' })}
        </p>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 ${props.profileSelectionLocked ? '' : 'md:grid-cols-2'}`}>
            {props.profileSelectionLocked ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.local.runtimeProfileTarget', { defaultValue: 'Profile Target' })}
                </label>
                <div className="flex h-10 w-full items-center rounded-lg bg-[#F9FAFB] px-3 text-sm text-[var(--nimi-text-primary)]">
                  {props.selectedProfileTarget?.targetName
                    || props.selectedProfileTargetId
                    || t('runtimeConfig.local.unknownRuntimeProfileTarget', { defaultValue: 'Unknown profile target' })}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--nimi-text-secondary)]">
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

          {selectedProfile ? (
            <div className="space-y-4 pt-1">
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

              {selectedProfile.consumeCapabilities.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.consumeCapabilities.map((capability) => (
                    <span key={capability} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
                      {capability}
                    </span>
                  ))}
                </div>
              ) : null}

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
                            {t('runtimeConfig.profileTargets.ready', { defaultValue: 'Ready' })}
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
                                onClick={() => props.onNavigateToSetup!(entry.kind === 'service' ? 'cloud' as const : 'models' as const)}
                              >
                                <DownloadIcon />
                                {t('runtimeConfig.profileTargets.setup', { defaultValue: 'Setup' })}
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

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
