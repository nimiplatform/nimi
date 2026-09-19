// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiDesktopPortableAIProfileCatalogRecord,
} from '@nimiplatform/sdk/runtime';
import { Button, InlineAlert, LoadingSkeleton, Surface } from '@nimiplatform/kit/ui';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { downloadRuntimeConfigProfileArtifact } from './runtime-config-profile-presentation.js';
import { ProfileImportWizard } from './runtime-config-profile-import-wizard.js';
import { ProfileExportPanel } from './runtime-config-profile-export-panel.js';
import { AIProfileAuthoringPage } from './runtime-config-page-profile-authoring.js';
import { ProfileRecommendationsPage } from './runtime-config-profile-recommendations.js';
import { prepareRuntimeConfigAIProfilePreview } from './runtime-config-ai-profile-preview.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import {
  planRuntimeSetupProfileUse,
} from './runtime-config-profile-use.js';
import {
  createRuntimeSetupCandidate,
  type RuntimeSetupRunnerPorts,
} from './runtime-setup-task-runner.js';
import {
  currentDesktopAccountIdForSetup,
} from './runtime-setup-task-ports.js';
import type {
  RuntimeSetupTaskSource,
  RuntimeSetupTaskStore,
} from './runtime-setup-task-store.js';
import type { RuntimeConfigAIProfileTransferPlan } from './runtime-config-ai-profile-transfer.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigProfileUseOwner,
} from './runtime-config-panel-types.js';

type ProfilesSectionMode =
  | { readonly kind: 'list' }
  | { readonly kind: 'recommended' }
  | { readonly kind: 'import' }
  | { readonly kind: 'create' }
  | { readonly kind: 'export' }
  | { readonly kind: 'use'; readonly profile: NimiDesktopPortableAIProfileCatalogRecord };

function profileUseOwnerLabel(
  owner: RuntimeConfigProfileUseOwner,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (owner.kind === 'app') return owner.ownerAppId;
  return t('runtimeConfig.setupTask.sourceLocalAgent', { defaultValue: 'the shared LocalAgent' });
}

/**
 * The AI settings 配置库 (profile library) section: recommendations, use,
 * import, create, and export share one in-page home. Using a profile never
 * stores it again, and storing/importing never applies it — the two are
 * separate journeys. With an owner context (entered from an app), the use
 * journey retains that owner when entering the shared preparation tasks.
 */
export function RuntimeConfigAiSettingsProfilesSection(props: {
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly runtimeWritesDisabled: boolean;
  readonly owner: RuntimeConfigProfileUseOwner | null;
  readonly onCloseOwner: () => void;
  readonly onOpenSetupTask: (taskId: string) => void;
  readonly onOpenSavedConfigs: (context?: RuntimeConfigLoadoutNavigationContext) => void;
  readonly onOpenCloudServices: () => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const profileCatalog = useMemo(() => sdk.accountProduct().profiles, [sdk]);
  const [mode, setMode] = useState<ProfilesSectionMode>({ kind: 'list' });
  const [records, setRecords] = useState<readonly NimiDesktopPortableAIProfileCatalogRecord[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.owner) return;
    setMode({ kind: 'list' });
    sectionRef.current?.scrollIntoView({ block: 'start' });
    sectionRef.current?.focus({ preventScroll: true });
  }, [props.owner]);

  useEffect(() => {
    let active = true;
    setLoadError('');
    void profileCatalog.list()
      .then((profiles) => {
        if (active) setRecords(profiles);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error || ''));
      });
    return () => {
      active = false;
    };
  }, [profileCatalog, refreshNonce]);

  const sortedRecords = useMemo(
    () => [...(records ?? [])].sort((left, right) => left.source.title.localeCompare(right.source.title)),
    [records],
  );

  return (
    <div ref={sectionRef} tabIndex={-1} className="min-w-0" data-testid="runtime-ai-settings-profiles">
    <Surface tone="card" material="glass-thin" padding="md" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.aiSettings.profilesTitle', { defaultValue: 'Profile library' })}
          </div>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.aiSettings.profilesDescription', {
              defaultValue: 'Saved, shareable setup descriptions. Using one prepares models on this machine; storing one never applies it.',
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" size="sm" onClick={() => setMode(mode.kind === 'recommended' ? { kind: 'list' } : { kind: 'recommended' })} data-testid="runtime-ai-settings-profile-recommended">
            {t('runtimeConfig.aiSettings.profileRecommended', { defaultValue: 'Recommended' })}
          </Button>
          <Button tone="secondary" size="sm" onClick={() => setMode({ kind: 'import' })} data-testid="runtime-ai-settings-profile-import">
            {t('runtimeConfig.aiSettings.profileImport', { defaultValue: 'Import' })}
          </Button>
          <Button tone="secondary" size="sm" onClick={() => setMode(mode.kind === 'create' ? { kind: 'list' } : { kind: 'create' })} data-testid="runtime-ai-settings-profile-create">
            {t('runtimeConfig.aiSettings.profileCreate', { defaultValue: 'Create' })}
          </Button>
          <Button tone="secondary" size="sm" onClick={() => setMode(mode.kind === 'export' ? { kind: 'list' } : { kind: 'export' })} data-testid="runtime-ai-settings-profile-export">
            {t('runtimeConfig.aiSettings.profileExport', { defaultValue: 'Export' })}
          </Button>
        </div>
      </div>

      {props.owner ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] px-3 py-2" data-testid="runtime-ai-settings-profile-owner-banner">
          <p className="text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.aiSettings.profileOwnerContext', {
              owner: profileUseOwnerLabel(props.owner, t),
              defaultValue: 'Using a profile for {{owner}}: selected capabilities are prepared on this machine; each capability saves the app route when its setup is used.',
            })}
          </p>
          <Button tone="ghost" size="sm" onClick={props.onCloseOwner} data-testid="runtime-ai-settings-profile-owner-close">
            {t('runtimeConfig.aiSettings.profileOwnerClose', { defaultValue: 'Exit app context' })}
          </Button>
        </div>
      ) : null}

      {mode.kind === 'recommended' ? (
        <div className="mt-3" data-testid="runtime-ai-settings-profile-recommendations">
          <ProfileRecommendationsPage
            onOpenLoadouts={(capabilityContract) => props.onOpenSavedConfigs({ capabilityContract })}
            onOpenCloudConnectors={props.onOpenCloudServices}
          />
        </div>
      ) : null}
      {mode.kind === 'import' ? (
        <div className="mt-3">
          <ProfileImportWizard
            initialSourceText={null}
            onClose={() => setMode({ kind: 'list' })}
            onCatalogChanged={() => setRefreshNonce((value) => value + 1)}
            onUseImported={(profile) => setMode({ kind: 'use', profile })}
          />
        </div>
      ) : null}
      {mode.kind === 'create' ? (
        <div className="mt-3" data-testid="runtime-ai-settings-profile-authoring">
          <AIProfileAuthoringPage />
        </div>
      ) : null}
      {mode.kind === 'export' ? (
        <div className="mt-3" data-testid="runtime-ai-settings-profile-export-panel">
          <ProfileExportPanel />
        </div>
      ) : null}
      {mode.kind === 'use' ? (
        <div className="mt-3">
          <ProfileUsePanel
            profile={mode.profile}
            store={props.store}
            ports={props.ports}
            runtimeWritesDisabled={props.runtimeWritesDisabled}
            owner={props.owner}
            onBack={() => setMode({ kind: 'list' })}
            onOpenSetupTask={props.onOpenSetupTask}
          />
        </div>
      ) : null}

      {mode.kind === 'list' ? (
        <div className="mt-3 space-y-2">
          {loadError ? (
            <InlineAlert tone="danger">
              <div>{t('runtimeConfig.profiles.libraryLoadFailed', { defaultValue: 'Saved setup files could not be loaded.' })}</div>
              <Button size="sm" tone="secondary" className="mt-2" onClick={() => setRefreshNonce((value) => value + 1)}>
                {t('Common.retry', { defaultValue: 'Retry' })}
              </Button>
            </InlineAlert>
          ) : null}
          {records === null && !loadError ? <LoadingSkeleton className="h-16 w-full" /> : null}
          {records !== null && sortedRecords.length === 0 ? (
            <p className="text-xs text-[var(--nimi-text-muted)]" data-testid="runtime-ai-settings-profiles-empty">
              {t('runtimeConfig.profiles.libraryEmptyTitle', { defaultValue: 'No profiles yet' })}
            </p>
          ) : null}
          {sortedRecords.map((record) => (
            <div
              key={record.source.profileId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] px-3 py-2"
              data-testid={`runtime-ai-settings-profile:${record.source.profileId}`}
            >
              <div className="min-w-0">
                <div className="truncate text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">
                  {record.source.title}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {Object.keys(record.source.capabilities).sort().map((contract) => (
                    <span key={contract} className="rounded-full border border-[var(--nimi-border-subtle)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                      {displayRuntimeConfigCapabilityLabel(contract, t)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  tone="primary"
                  disabled={props.runtimeWritesDisabled}
                  onClick={() => setMode({ kind: 'use', profile: record })}
                  data-testid={`runtime-ai-settings-profile-use:${record.source.profileId}`}
                >
                  {t('runtimeConfig.aiSettings.profileUse', { defaultValue: 'Use' })}
                </Button>
                <Button
                  size="sm"
                  tone="secondary"
                  onClick={() => downloadRuntimeConfigProfileArtifact(record.artifactJson, `${record.source.profileId}.ai-profile.json`)}
                >
                  {t('runtimeConfig.profiles.savedProfileExport', { defaultValue: 'Export' })}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Surface>
    </div>
  );
}

function ProfileUsePanel(props: {
  readonly profile: NimiDesktopPortableAIProfileCatalogRecord;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly runtimeWritesDisabled: boolean;
  readonly owner: RuntimeConfigProfileUseOwner | null;
  readonly onBack: () => void;
  readonly onOpenSetupTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const { profile } = props;
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const [transferPlan, setTransferPlan] = useState<RuntimeConfigAIProfileTransferPlan | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [subset, setSubset] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<readonly { readonly capabilityContract: string; readonly taskId?: string; readonly error?: string }[]>([]);

  useEffect(() => {
    let active = true;
    void prepareRuntimeConfigAIProfilePreview({
      profile: profile.artifactJson,
      modelAssets: localEnvironment,
      loadouts: props.ports.loadouts,
    })
      .then(({ plan }) => {
        if (!active) return;
        setTransferPlan(plan);
        // Every declared capability is listed, including cloud intents the
        // local transfer plan skips; only locally preparable ones preselect.
        setSubset(Object.keys(plan.profile.capabilities));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPreviewError(error instanceof Error ? error.message : String(error || ''));
      });
    return () => {
      active = false;
    };
  }, [localEnvironment, profile.artifactJson, props.ports.loadouts]);

  const capabilityPlans = useMemo(() => {
    if (!transferPlan) return [];
    return planRuntimeSetupProfileUse({
      profile: transferPlan.profile,
      subset: Object.keys(transferPlan.profile.capabilities),
      transferPlan,
    });
  }, [transferPlan]);

  const owner = props.owner;
  const selectedPlans = useMemo(
    () => capabilityPlans.filter((plan) => subset.includes(plan.capabilityContract)),
    [capabilityPlans, subset],
  );
  const isStartable = useCallback((plan: { readonly state: string }) => (
    plan.state === 'ready'
    || plan.state === 'needs-acquisition'
    // A cloud route is startable when an owner exists: the task view owns the
    // connector and target selection.
    || (owner !== null && plan.state === 'cloud-requires-owner')
  ), [owner]);
  const startablePlans = selectedPlans.filter((plan) => isStartable(plan));

  const onToggle = useCallback((capabilityContract: string, checked: boolean) => {
    setSubset((current) => (
      checked
        ? [...new Set([...current, capabilityContract])]
        : current.filter((entry) => entry !== capabilityContract)
    ));
  }, []);

  const onStart = useCallback(() => {
    if (startablePlans.length === 0 || busy) return;
    setBusy(true);
    void (async () => {
      const accountId = await currentDesktopAccountIdForSetup();
      const source: RuntimeSetupTaskSource = owner
        ? {
            kind: owner.kind,
            ...(owner.kind === 'app' ? { ownerAppId: owner.ownerAppId } : {}),
            accountId,
            ...(owner.returnFocus ? { returnFocus: owner.returnFocus } : {}),
          }
        : { kind: 'runtime', accountId, returnFocus: 'runtime.aiSettings' };
      const nextOutcomes: { capabilityContract: string; taskId?: string; error?: string }[] = [];
      for (const plan of startablePlans) {
        // One task per capability; each keeps the exact owner/account context
        // and walks the shared preparation flow.
        const task = props.store.createTask({
          capabilityContract: plan.capabilityContract,
          source,
        });
        if (plan.state === 'cloud-requires-owner') {
          // Cloud routes finish in the task view (connector + target choice).
          props.store.updateTask(task.taskId, () => ({
            draft: { route: 'cloud', profileId: profile.source.profileId, cloudRecommendation: plan.cloudRecommendation },
          }));
          nextOutcomes.push({ capabilityContract: plan.capabilityContract, taskId: task.taskId });
          continue;
        }
        if (!plan.candidate) continue;
        props.store.updateTask(task.taskId, () => ({
          draft: {
            recipeId: plan.candidate!.recipeId,
            route: 'local',
            options: plan.candidate!.options,
            ...(plan.candidate!.axes.length > 0 ? { axes: plan.candidate!.axes } : {}),
            ...(plan.candidate!.pendingAxes.length > 0 ? { pendingAxes: plan.candidate!.pendingAxes } : {}),
            profileId: profile.source.profileId,
          },
        }));
        const created = await createRuntimeSetupCandidate(props.store, task.taskId, props.ports, {
          recipeId: plan.candidate.recipeId,
          options: plan.candidate.options,
          axes: plan.candidate.axes,
          displayName: plan.candidate.displayName,
          provenance: plan.candidate.provenance,
        });
        if (created.status === 'ok') {
          nextOutcomes.push({ capabilityContract: plan.capabilityContract, taskId: task.taskId });
        } else {
          nextOutcomes.push({ capabilityContract: plan.capabilityContract, error: created.failure.message });
        }
      }
      // Owner routes are deliberately NOT saved here: each task saves its
      // owner's route when its own preparation is confirmed and used, chained
      // through the session save lane. Starting a preparation never rewrites
      // the owner's current routes.
      setOutcomes(nextOutcomes);
      const firstTaskId = nextOutcomes.find((outcome) => outcome.taskId)?.taskId;
      if (firstTaskId) {
        props.onOpenSetupTask(firstTaskId);
      }
    })().finally(() => setBusy(false));
  }, [busy, owner, profile.source.profileId, props, startablePlans]);

  return (
    <div className="space-y-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3" data-testid="runtime-ai-settings-profile-use-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.aiSettings.profileUseTitle', { defaultValue: 'Use {{title}}', title: profile.source.title })}
          </div>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {owner
              ? t('runtimeConfig.aiSettings.profileUseDescriptionOwner', {
                  defaultValue: "Choose the capabilities to set up. App settings are saved when you choose to use each one.",
                })
              : t('runtimeConfig.aiSettings.profileUseDescription', {
                  defaultValue: "Choose the capabilities to prepare on this device. You can review and use each one separately.",
                })}
          </p>
        </div>
        <Button tone="ghost" size="sm" onClick={props.onBack}>
          {t('runtimeConfig.setupTask.back', { defaultValue: 'Back' })}
        </Button>
      </div>
      {previewError ? (
        <InlineAlert tone="danger">
          <div>{t('runtimeConfig.profiles.feedbackPreviewFailed', { defaultValue: 'This portable AIProfile could not be previewed.' })}</div>
          <div className="mt-1 text-xs">{previewError}</div>
        </InlineAlert>
      ) : null}
      {!transferPlan && !previewError ? <LoadingSkeleton className="h-20 w-full" /> : null}
      {capabilityPlans.map((plan) => {
        const selectable = isStartable(plan);
        return (
          <div
            key={plan.capabilityContract}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] px-3 py-2"
            data-testid={`runtime-ai-settings-profile-capability:${plan.capabilityContract}`}
          >
            <label className="flex min-w-0 items-center gap-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-primary)]">
              <input
                type="checkbox"
                checked={subset.includes(plan.capabilityContract)}
                disabled={!selectable}
                onChange={(event) => onToggle(plan.capabilityContract, event.currentTarget.checked)}
              />
              <span className="truncate">{displayRuntimeConfigCapabilityLabel(plan.capabilityContract, t)}</span>
            </label>
            <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">
              {owner && plan.state === 'cloud-requires-owner'
                ? t('runtimeConfig.aiSettings.profileUseState.cloud-owner-choice', { defaultValue: 'Cloud · choose the connection in the task' })
                : t(`runtimeConfig.aiSettings.profileUseState.${plan.state}`, {
                    defaultValue: plan.state,
                  })}
            </span>
            {plan.state === 'missing-source' ? (
              <p className="w-full text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.aiSettings.profileMissingSourceHelp', {
                defaultValue: 'This model is not on your device and the setup has no usable download source. Ask the sender for a complete setup, or return to AI settings to choose another model.',
              })}</p>
            ) : null}
            {plan.reasonCode && !(owner && plan.state === 'cloud-requires-owner') ? (
              <details className="w-full text-xs text-[var(--nimi-text-muted)]"><summary>{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>{plan.reasonCode}</details>
            ) : null}
          </div>
        );
      })}
      {!owner && selectedPlans.some((plan) => plan.state === 'cloud-requires-owner') ? (
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.aiSettings.profileUseCloudNote', {
            defaultValue: 'Cloud routes are saved from the app that uses them; a machine-wide task never sets a global cloud default.',
          })}
        </p>
      ) : null}
      {outcomes.length > 0 ? (
        <div className="space-y-1" data-testid="runtime-ai-settings-profile-outcomes">
          {outcomes.map((outcome) => (
            <div key={outcome.capabilityContract} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[var(--nimi-text-secondary)]">{displayRuntimeConfigCapabilityLabel(outcome.capabilityContract, t)}</span>
              {outcome.taskId ? (
                <Button size="sm" tone="secondary" onClick={() => props.onOpenSetupTask(outcome.taskId!)}>
                  {t('runtimeConfig.aiSettings.continueTask', { defaultValue: 'Continue' })}
                </Button>
              ) : (
                <span className="text-[var(--nimi-status-danger)]">{outcome.error}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          tone="primary"
          size="sm"
          disabled={busy || props.runtimeWritesDisabled || startablePlans.length === 0}
          onClick={onStart}
          data-testid="runtime-ai-settings-profile-start"
        >
          {busy
            ? t('runtimeConfig.aiSettings.profileUseStarting', { defaultValue: 'Starting…' })
            : t('runtimeConfig.aiSettings.profileUseStart', { defaultValue: 'Start preparation' })}
        </Button>
      </div>
    </div>
  );
}
