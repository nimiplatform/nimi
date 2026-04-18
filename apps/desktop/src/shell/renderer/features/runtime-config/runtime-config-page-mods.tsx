import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { LocalRuntimeProfileResolutionPlan } from '@runtime/local-runtime';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel, RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import { ModelCenterProfileSection } from './runtime-config-model-center-profile-section';
import { Button } from './runtime-config-primitives';
import { RuntimePageShell } from './runtime-config-page-shell';
import {
  normalizeSelectedProfileCapability,
  resolveDependencyStatus,
  resolveProfileCapabilityOptions,
  resolveSelectedRuntimeProfileTarget,
} from './runtime-config-model-center-utils';

type ModsPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function ModsPage({ model, state }: ModsPageProps) {
  const { t } = useTranslation();
  const { runtimeProfileTargets } = model;
  const [selectedModId, setSelectedModId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedProfileCapability, setSelectedProfileCapability] = useState('');
  const [executionPlanPreview, setExecutionPlanPreview] = useState<LocalRuntimeProfileResolutionPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [applyingProfile, setApplyingProfile] = useState(false);
  const [applySummary, setApplySummary] = useState('');

  // Auto-select first mod
  useEffect(() => {
    if (runtimeProfileTargets.length === 0) {
      setSelectedModId('');
      setExecutionPlanPreview(null);
      return;
    }
    if (!runtimeProfileTargets.some((t) => t.modId === selectedModId)) {
      setSelectedModId(runtimeProfileTargets[0]?.modId || '');
      setSelectedProfileId(runtimeProfileTargets[0]?.profiles[0]?.id || '');
      setSelectedProfileCapability('');
    }
  }, [runtimeProfileTargets, selectedModId]);

  const selectedTarget = useMemo(
    () => resolveSelectedRuntimeProfileTarget(runtimeProfileTargets, selectedModId),
    [runtimeProfileTargets, selectedModId],
  );

  useEffect(() => {
    if (!selectedTarget) {
      setSelectedProfileId('');
      setSelectedProfileCapability('');
      return;
    }
    if (!selectedTarget.profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(selectedTarget.profiles[0]?.id || '');
    }
  }, [selectedProfileId, selectedTarget]);
  const selectedProfile = useMemo(() => {
    if (!selectedTarget) {
      return null;
    }
    return selectedTarget.profiles.find((profile) => profile.id === selectedProfileId)
      || selectedTarget.profiles[0]
      || null;
  }, [selectedProfileId, selectedTarget]);

  useEffect(() => {
    const nextCapability = normalizeSelectedProfileCapability(selectedProfile, selectedProfileCapability);
    if (nextCapability !== selectedProfileCapability) {
      setSelectedProfileCapability(nextCapability);
    }
  }, [selectedProfile, selectedProfileCapability]);

  const resolvePlanPreview = useCallback(async (input?: { modId?: string; profileId?: string }) => {
    const modId = String(input?.modId ?? selectedModId).trim();
    const profileId = String(input?.profileId ?? selectedProfileId).trim();
    const capabilityOptions = resolveProfileCapabilityOptions(selectedProfile);
    const capability = normalizeSelectedProfileCapability(selectedProfile, selectedProfileCapability);
    if (!modId || !profileId) {
      setExecutionPlanPreview(null);
      return;
    }
    if (capabilityOptions.length > 1 && !capability) {
      setExecutionPlanPreview(null);
      return;
    }
    setLoadingPlan(true);
    try {
      const plan = await model.resolveRuntimeProfile(modId, profileId, capability || undefined);
      setExecutionPlanPreview(plan);
    } catch {
      setExecutionPlanPreview(null);
    } finally {
      setLoadingPlan(false);
    }
  }, [model, selectedModId, selectedProfileCapability, selectedProfileId, selectedProfile]);

  useEffect(() => {
    if (!selectedModId) {
      setExecutionPlanPreview(null);
      return;
    }
    const timer = setTimeout(() => { void resolvePlanPreview(); }, 140);
    return () => { clearTimeout(timer); };
  }, [resolvePlanPreview, selectedModId, selectedProfileCapability, selectedProfileId]);

  // Derive dependency status for sticky footer
  const capabilityOptions = useMemo(
    () => resolveProfileCapabilityOptions(selectedProfile),
    [selectedProfile],
  );
  const effectiveCapability = useMemo(
    () => normalizeSelectedProfileCapability(selectedProfile, selectedProfileCapability),
    [selectedProfile, selectedProfileCapability],
  );
  const capabilitySelectionMissing = capabilityOptions.length > 1 && !effectiveCapability;

  const { allRequiredMet, missingCount } = useMemo(() => {
    if (!selectedProfile) {
      return { allRequiredMet: false, missingCount: 0 };
    }
    const requiredEntries = (selectedProfile.entries || []).filter((e) => e.required !== false);
    const missing = requiredEntries.filter((e) => !resolveDependencyStatus(e, state).met);
    return {
      allRequiredMet: missing.length === 0,
      missingCount: missing.length,
    };
  }, [selectedProfile, state]);

  const handleApplyProfile = useCallback(() => {
    if (!selectedProfile) {
      return;
    }
    void (async () => {
      setApplyingProfile(true);
      setApplySummary('');
      try {
        const result = await model.applyRuntimeProfile(
          selectedModId,
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
  }, [model, selectedModId, selectedProfile, effectiveCapability, t]);

  if (runtimeProfileTargets.length === 0) {
    return (
      <RuntimePageShell maxWidth="full">
        <div className="p-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-[#F9FAFB] flex items-center justify-center mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--nimi-text-muted)]">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.mods.noAiMods')}</p>
          <p className="text-xs text-[var(--nimi-text-muted)] mt-1">
            {t('runtimeConfig.mods.noAiModsDesc')}
          </p>
        </div>
      </RuntimePageShell>
    );
  }

  return (
    <RuntimePageShell maxWidth="full" className="space-y-4">
      {/* Header summary */}
      <p className="text-xs text-[var(--nimi-text-muted)]">
        {t('runtimeConfig.mods.registeredModsSummary', {
          defaultValue: '{{registered}} registered mods · {{configured}} with AI profiles',
          registered: model.registeredRuntimeModIds.length,
          configured: runtimeProfileTargets.length,
        })}
      </p>

      {/* Left-right split: mod list | mod detail */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* Left panel — mod list */}
        <Surface tone="card" className="h-[600px] overflow-y-auto space-y-1.5 rounded-2xl p-4">
          {runtimeProfileTargets.map((target) => {
            const active = target.modId === selectedModId;
            return (
              <ModTargetRow
                key={target.modId}
                target={target}
                state={state}
                active={active}
                onSelect={() => {
                  setSelectedModId(target.modId);
                  setSelectedProfileCapability('');
                  setApplySummary('');
                }}
              />
            );
          })}
        </Surface>

        {/* Right panel — mod detail & profile config */}
        <Surface tone="card" className="h-[600px] overflow-y-auto rounded-2xl p-4">
          {selectedTarget ? (
            <div className="space-y-5">
              {/* Mod header */}
              <div>
                <h3 className="text-base font-semibold text-[var(--nimi-text-primary)]">{selectedTarget.modName}</h3>
                <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{selectedTarget.modId}</p>
              </div>

              {/* Capability status badges */}
              {selectedTarget.consumeCapabilities.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.mods.aiCapabilityStatus', { defaultValue: 'AI Capability Status' })}</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedTarget.consumeCapabilities.map((cap) => {
                      const localNode = state.local.nodeMatrix.find(
                        (node) => node.capability === cap && node.available,
                      );
                      const hasLocalModel = state.local.models.some(
                        (m) => m.status === 'active' && m.capabilities.includes(cap),
                      );
                      const localAvailable = Boolean(localNode) || hasLocalModel;
                      return (
                        <span
                          key={`mod-cap-${cap}`}
                          className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                            localAvailable
                              ? 'border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]'
                              : 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]'
                          }`}
                        >
                          {cap}: {localAvailable
                            ? t('runtimeConfig.mods.local', { defaultValue: 'local' })
                            : t('runtimeConfig.mods.needsSetup', { defaultValue: 'needs setup' })}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Profile configuration — flat variant */}
              <ModelCenterProfileSection
                isModMode
                variant="flat"
                state={state}
                onNavigateToSetup={model.onChangePage}
                hideInstallButton
                loadingProfilePlan={loadingPlan}
                selectedProfileModId={selectedModId}
                profileSelectionLocked
                selectedProfileId={selectedProfileId}
                selectedProfileCapability={selectedProfileCapability}
                selectedProfileTarget={selectedTarget}
                executionPlanPreview={executionPlanPreview}
                runtimeProfileTargets={runtimeProfileTargets}
                onSetSelectedProfileModId={setSelectedModId}
                onSetSelectedProfileId={(profileId) => {
                  setSelectedProfileId(profileId);
                  setSelectedProfileCapability('');
                  setApplySummary('');
                }}
                onSetSelectedProfileCapability={setSelectedProfileCapability}
                onResolveProfilePlanPreview={() => void resolvePlanPreview()}
                onApplyProfile={model.applyRuntimeProfile}
              />

              {/* Apply summary feedback */}
              {applySummary ? (
                <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-4 py-3 text-xs text-[var(--nimi-action-primary-bg)]">
                  {applySummary}
                </div>
              ) : null}

              {/* Install footer inside detail panel */}
              {selectedProfile ? (
                <div className="sticky bottom-0 -mx-4 nimi-material-glass-thin border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]/95 backdrop-blur-[var(--nimi-backdrop-blur-thin)] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--nimi-text-muted)]">
                      {capabilitySelectionMissing
                        ? t('runtimeConfig.mods.selectCapabilityFirst', { defaultValue: 'Select a capability to continue.' })
                        : allRequiredMet
                          ? t('runtimeConfig.mods.readyToInstall', {
                              defaultValue: 'Ready to install {{title}}',
                              title: selectedProfile.title,
                            })
                          : t('runtimeConfig.mods.missingDeps', {
                              defaultValue: '{{count}} required {{label}} not yet set up',
                              count: missingCount,
                              label: missingCount === 1 ? 'dependency' : 'dependencies',
                            })}
                    </p>
                    <Button
                      variant="primary"
                      disabled={applyingProfile || !allRequiredMet || capabilitySelectionMissing}
                      onClick={handleApplyProfile}
                    >
                      {applyingProfile
                        ? t('runtimeConfig.local.applying', { defaultValue: 'Installing...' })
                        : t('runtimeConfig.local.installProfile', { defaultValue: 'Install Profile' })}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.mods.selectModPrompt', { defaultValue: 'Select a mod to configure its AI profiles.' })}
            </p>
          )}
        </Surface>
      </div>
    </RuntimePageShell>
  );
}

function ModTargetRow({
  target,
  state,
  active,
  onSelect,
}: {
  target: RuntimeProfileTargetDescriptor;
  state: RuntimeConfigStateV11;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-2 rounded-xl border px-3 py-2.5 text-left transition-all ${
        active
          ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)]'
          : 'border-[var(--nimi-border-subtle)] hover:bg-[#F9FAFB]'
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-medium ${active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>
          {target.modName}
        </p>
        <p className="text-[11px] text-[var(--nimi-text-muted)] truncate">
          {target.modId}
        </p>
      </div>
      {target.consumeCapabilities.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {target.consumeCapabilities.map((cap) => {
            const localNode = state.local.nodeMatrix.find(
              (node) => node.capability === cap && node.available,
            );
            const hasLocalModel = state.local.models.some(
              (m) => m.status === 'active' && m.capabilities.includes(cap),
            );
            const available = Boolean(localNode) || hasLocalModel;
            return (
              <span
                key={`${target.modId}-cap-${cap}`}
                className={`rounded-lg px-2 py-0.5 text-[10px] font-medium ${
                  available
                    ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'
                    : 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]'
                }`}
              >
                {cap}
              </span>
            );
          })}
        </div>
      ) : null}
    </button>
  );
}
