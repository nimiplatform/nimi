import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiMachineLoadout,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import {
  downloadRuntimeConfigProfileArtifact,
  selectRuntimeConfigProfileExportLoadout,
} from './runtime-config-profile-presentation.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import {
  exportRuntimeConfigAIProfileFromLoadouts,
} from './runtime-config-ai-profile-transfer.js';

type ProfileExportFeedback = {
  readonly tone: 'info' | 'success' | 'danger';
  readonly message: string;
  readonly technicalDetail?: string;
};

export function ProfileExportPanel() {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const loadoutsClient = useMemo(() => sdk.machineProduct().local.loadouts, [sdk]);
  const modelAssetsClient = useRuntimeConfigLocalEnvironmentClient();
  const [availableLoadouts, setAvailableLoadouts] = useState<readonly NimiMachineLoadout[]>([]);
  const [availableAssets, setAvailableAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [selectedExportIds, setSelectedExportIds] = useState<readonly string[]>([]);
  const [exportName, setExportName] = useState('');
  const [feedback, setFeedback] = useState<ProfileExportFeedback | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([loadoutsClient.get(), modelAssetsClient.listModelAssets()]).then(([machine, assets]) => {
      if (!active) return;
      setAvailableLoadouts(machine.loadouts);
      setAvailableAssets(assets);
      setSelectedExportIds(machine.selections.map((selection) => selection.loadoutId));
    }).catch(() => {
      // The panel stays empty-but-safe when Runtime inventory is offline.
    });
    return () => { active = false; };
  }, [loadoutsClient, modelAssetsClient]);

  const exportGroups = useMemo(() => {
    const grouped = new Map<string, NimiMachineLoadout[]>();
    for (const loadout of availableLoadouts) {
      const current = grouped.get(loadout.capabilityContract) ?? [];
      grouped.set(loadout.capabilityContract, [...current, loadout]);
    }
    return [...grouped.entries()];
  }, [availableLoadouts]);

  const exportSelectedLoadouts = () => {
    try {
      const selected = availableLoadouts.filter((loadout) => selectedExportIds.includes(loadout.loadoutId));
      const artifact = exportRuntimeConfigAIProfileFromLoadouts({
        profileId: `profile.loadouts.${Date.now()}`,
        title: exportName.trim() || t('runtimeConfig.profiles.exportedTitle', { defaultValue: 'Shared Loadouts' }),
        loadouts: selected,
        assets: availableAssets,
      });
      downloadRuntimeConfigProfileArtifact(artifact.artifactJson, `${artifact.profile.profileId}.ai-profile.json`);
      setFeedback({ tone: 'success', message: t('runtimeConfig.profiles.exportSuccess', { defaultValue: 'Exported {{count}} portable Loadout intent(s).', count: selected.length }) });
    } catch (error) {
      setFeedback({ tone: 'danger', message: t('runtimeConfig.profiles.exportFailed', { defaultValue: 'The selected Loadouts could not be exported.' }), technicalDetail: exportErrorMessage(error) });
    }
  };

  const openLoadoutRepair = () => {
    setActiveTab('runtime');
    runtimeConfigNavigation.focusAction({
      page: 'loadouts',
      action: 'open-loadouts',
      focus: 'runtime-config-action-focus.loadouts',
    });
  };

  return (
    <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-loadout-export">
      <div>
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.profiles.exportLoadoutsTitle', { defaultValue: 'Share your current model setup' })}
        </h3>
        <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.profiles.exportLoadoutsDescription', { defaultValue: 'Choose one model setup for each use. Private machine paths, account details, and secrets are never included.' })}
        </p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-[var(--nimi-text-secondary)]" htmlFor="runtime-profile-export-name">
          {t('runtimeConfig.profiles.profileNameLabel', { defaultValue: 'Profile name' })}
        </label>
        <input
          id="runtime-profile-export-name"
          type="text"
          value={exportName}
          onChange={(event) => setExportName(event.currentTarget.value)}
          placeholder={t('runtimeConfig.profiles.exportNamePlaceholder', { defaultValue: 'e.g. My workstation setup' })}
          className="w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
        />
      </div>
      <div className="grid gap-3">
        {exportGroups.map(([capabilityContract, loadouts]) => {
          const groupIds = new Set(loadouts.map((item) => item.loadoutId));
          const groupHasSelection = selectedExportIds.some((id) => groupIds.has(id));
          return (
            <fieldset key={capabilityContract} className="grid gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3">
              <legend className="px-1 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {displayRuntimeConfigCapabilityLabel(capabilityContract, t)}
              </legend>
              {loadouts.map((loadout) => {
                const configured = loadout.validationState === 'configured';
                return (
                  <div key={loadout.loadoutId} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--nimi-surface-hover)]">
                    <input
                      className="mt-0.5"
                      type="radio"
                      name={`runtime-profile-export-${capabilityContract}`}
                      checked={selectedExportIds.includes(loadout.loadoutId)}
                      disabled={!configured}
                      onChange={() => {
                        setSelectedExportIds((current) => selectRuntimeConfigProfileExportLoadout({
                          currentIds: current,
                          loadoutId: loadout.loadoutId,
                          sameUseIds: groupIds,
                          checked: true,
                        }));
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block font-semibold text-[var(--nimi-text-primary)]">{loadout.displayName}</span>
                      {!configured ? (
                        <span className="mt-0.5 flex flex-wrap items-center gap-2">
                          <span className="text-[var(--nimi-danger-text)]">{t('runtimeConfig.profiles.setupNeedsAttention', { defaultValue: 'Needs attention before it can be shared' })}</span>
                          <Button size="sm" tone="secondary" onClick={openLoadoutRepair}>
                            {t('runtimeConfig.profiles.fixBeforeShare', { defaultValue: 'Fix it' })}
                          </Button>
                        </span>
                      ) : null}
                      <details className="mt-1 text-[var(--nimi-text-muted)]">
                        <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                        <div className="mt-1 font-mono">{loadout.capabilityContract} · {loadout.recipeId}</div>
                      </details>
                    </div>
                  </div>
                );
              })}
              <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-hover)]">
                <input
                  type="radio"
                  name={`runtime-profile-export-${capabilityContract}`}
                  checked={!groupHasSelection}
                  onChange={() => {
                    setSelectedExportIds((current) => current.filter((id) => !groupIds.has(id)));
                  }}
                />
                {t('runtimeConfig.profiles.exportNoneOption', { defaultValue: "Don't include this use" })}
              </label>
            </fieldset>
          );
        })}
      </div>
      <div>
        <Button size="sm" tone="primary" disabled={selectedExportIds.length === 0} onClick={exportSelectedLoadouts}>
          {t('runtimeConfig.profiles.exportSelectedLoadouts', { defaultValue: 'Export setup file' })}
        </Button>
      </div>
      {feedback ? <InlineAlert tone={feedback.tone}>{feedback.message}</InlineAlert> : null}
      {feedback?.technicalDetail ? (
        <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">
          <summary className="cursor-pointer font-semibold">
            {t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-caption-size)]">{feedback.technicalDetail}</pre>
        </details>
      ) : null}
    </Surface>
  );
}

function exportErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || 'Unknown profile error');
}
