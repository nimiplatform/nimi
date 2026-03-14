import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalAiProfileResolutionPlan } from '@runtime/local-ai-runtime';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigPanelControllerModel, RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import { ModelCenterProfileSection } from './runtime-config-model-center-profile-section';
import { Button } from './runtime-config-primitives';
import { resolveSelectedRuntimeProfileTarget } from './runtime-config-model-center-utils';

type ModsPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

// SurfaceCard component matching Overview page style
function SurfaceCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04] ${className}`}>{children}</div>;
}

export function ModsPage({ model, state }: ModsPageProps) {
  const { t } = useTranslation();
  const { runtimeProfileTargets } = model;
  const [selectedModId, setSelectedModId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [executionPlanPreview, setExecutionPlanPreview] = useState<LocalAiProfileResolutionPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);

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
    }
  }, [runtimeProfileTargets, selectedModId]);

  const selectedTarget = useMemo(
    () => resolveSelectedRuntimeProfileTarget(runtimeProfileTargets, selectedModId),
    [runtimeProfileTargets, selectedModId],
  );

  useEffect(() => {
    if (!selectedTarget) {
      setSelectedProfileId('');
      return;
    }
    if (!selectedTarget.profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(selectedTarget.profiles[0]?.id || '');
    }
  }, [selectedProfileId, selectedTarget]);

  const resolvePlanPreview = useCallback(async (input?: { modId?: string; profileId?: string }) => {
    const modId = String(input?.modId ?? selectedModId).trim();
    const profileId = String(input?.profileId ?? selectedProfileId).trim();
    if (!modId || !profileId) {
      setExecutionPlanPreview(null);
      return;
    }
    setLoadingPlan(true);
    try {
      const plan = await model.resolveRuntimeProfile(modId, profileId);
      setExecutionPlanPreview(plan);
    } catch {
      setExecutionPlanPreview(null);
    } finally {
      setLoadingPlan(false);
    }
  }, [model, selectedModId, selectedProfileId]);

  useEffect(() => {
    if (!selectedModId) {
      setExecutionPlanPreview(null);
      return;
    }
    const timer = setTimeout(() => { void resolvePlanPreview(); }, 140);
    return () => { clearTimeout(timer); };
  }, [resolvePlanPreview, selectedModId, selectedProfileId]);

  if (runtimeProfileTargets.length === 0) {
    return (
      <SurfaceCard className="p-8 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-900">{t('runtimeConfig.mods.noAiMods')}</p>
        <p className="text-xs text-gray-500 mt-1">
          {t('runtimeConfig.mods.noAiModsDesc')}
        </p>
      </SurfaceCard>
    );
  }

  return (
    <div className="space-y-8">
      {/* Mod list */}
      <section>
        <SectionTitle description={t('runtimeConfig.mods.modsWithAiProfilesDesc', { defaultValue: 'Select a mod to configure its AI profiles.' })}>
          {t('runtimeConfig.mods.modsWithAiProfiles')}
        </SectionTitle>
        <SurfaceCard className="mt-3 p-5">
          <div className="mb-4 text-xs text-gray-500">
            {t('runtimeConfig.mods.registeredModsSummary', {
              defaultValue: '{{registered}} registered mods · {{configured}} with AI profiles',
              registered: model.registeredRuntimeModIds.length,
              configured: runtimeProfileTargets.length,
            })}
          </div>
          <div className="space-y-2">
            {runtimeProfileTargets.map((target) => {
              const active = target.modId === selectedModId;
              return (
                <ModTargetRow
                  key={target.modId}
                  target={target}
                  state={state}
                  active={active}
                  onSelect={() => setSelectedModId(target.modId)}
                />
              );
            })}
          </div>
        </SurfaceCard>
      </section>

      {/* Selected mod detail */}
      {selectedTarget ? (
        <section>
          <SectionTitle description={t('runtimeConfig.mods.selectedModDescription', { defaultValue: 'Configure the selected mod\'s recommended local AI profiles.' })}>
            {selectedTarget.modName}
          </SectionTitle>
          <SurfaceCard className="mt-3 p-5 space-y-5">
            {/* Capability status badges */}
            {selectedTarget.consumeCapabilities.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-700">{t('runtimeConfig.mods.aiCapabilityStatus', { defaultValue: 'AI Capability Status' })}</p>
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
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-amber-200 bg-amber-50 text-amber-800'
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

            {/* Profile installation */}
            <ModelCenterProfileSection
              isModMode
              loadingProfilePlan={loadingPlan}
              selectedProfileModId={selectedModId}
              profileSelectionLocked
              selectedProfileId={selectedProfileId}
              selectedProfileTarget={selectedTarget}
              executionPlanPreview={executionPlanPreview}
              runtimeProfileTargets={runtimeProfileTargets}
              onSetSelectedProfileModId={setSelectedModId}
              onSetSelectedProfileId={setSelectedProfileId}
              onResolveProfilePlanPreview={() => void resolvePlanPreview()}
              onApplyProfile={model.applyRuntimeProfile}
            />

            {/* Setup required warning */}
            {selectedTarget.consumeCapabilities.some((cap) => {
              const localNode = state.local.nodeMatrix.find((n) => n.capability === cap && n.available);
              const hasLocalModel = state.local.models.some((m) => m.status === 'active' && m.capabilities.includes(cap));
              return !localNode && !hasLocalModel;
            }) ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-amber-900">{t('runtimeConfig.mods.setupRequired')}</p>
                <p className="text-xs text-amber-800">
                  {t('runtimeConfig.mods.setupRequiredDesc')}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => model.onChangePage('local')}>
                    {t('runtimeConfig.mods.installModels')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => model.onChangePage('cloud')}>
                    {t('runtimeConfig.mods.configureCloudApi')}
                  </Button>
                </div>
              </div>
            ) : null}
          </SurfaceCard>
        </section>
      ) : null}
    </div>
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
      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
        active
          ? 'border-mint-300 bg-mint-50 ring-1 ring-mint-200'
          : 'border-gray-200 bg-white hover:border-mint-200 hover:bg-mint-50/30'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${active ? 'text-gray-900' : 'text-gray-900'}`}>
          {target.modName}
        </p>
        <p className={`text-xs ${active ? 'text-gray-500' : 'text-gray-400'}`}>
          {target.modId}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1 pl-3">
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
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {cap}
            </span>
          );
        })}
      </div>
    </button>
  );
}
