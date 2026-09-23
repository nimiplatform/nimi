import {
  RuntimeProfileQuickStart,
  type RuntimeProfileQuickStartConversation,
} from './runtime-profile-quick-start.js';
// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { Button, IconButton, InlineAlert, LoadingSkeleton, SelectField } from '@nimiplatform/kit/ui';
import type {
  NimiDesktopPortableAIProfileCatalogRecord,
} from '@nimiplatform/sdk/runtime';
import { Download, FileUp, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { capabilityIcon } from './runtime-capability-presentation.js';
import { prepareRuntimeConfigAIProfilePreview } from './runtime-config-ai-profile-preview.js';
import type { RuntimeConfigAIProfileTransferPlan } from './runtime-config-ai-profile-transfer.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { AIProfileAuthoringPage } from './runtime-config-page-profile-authoring.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigProfileUseOwner,
} from './runtime-config-panel-types.js';
import { ProfileExportPanel } from './runtime-config-profile-export-panel.js';
import { ProfileImportWizard } from './runtime-config-profile-import-wizard.js';
import { downloadRuntimeConfigProfileArtifact } from './runtime-config-profile-presentation.js';
import { ProfileRecommendationsPage } from './runtime-config-profile-recommendations.js';
import {
  planRuntimeSetupProfileUse,
} from './runtime-config-profile-use.js';
import {
  currentDesktopAccountIdForSetup,
} from './runtime-setup-task-ports.js';
import {
  createRuntimeSetupCandidate,
  type RuntimeSetupRunnerPorts,
} from './runtime-setup-task-runner.js';
import type {
  RuntimeSetupTaskSource,
  RuntimeSetupTaskStore,
} from './runtime-setup-task-store.js';

type ProfilesSectionMode =
  | { readonly kind: 'list'; }
  | { readonly kind: 'recommended'; }
  | { readonly kind: 'import'; }
  | { readonly kind: 'create'; }
  | { readonly kind: 'export'; }
  | {
    readonly kind: 'use'; readonly owner?: RuntimeConfigProfileUseOwner;
    readonly autoReview?: boolean;
    readonly profile: Pick<NimiDesktopPortableAIProfileCatalogRecord, 'source' | 'artifactJson'>;
  };

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
  /** Home heading; hidden while an import, export, create or use journey owns the page. */
  readonly title: string;
  /** Preparation summary shown under the heading where the rail is hidden. */
  readonly lead: string;
  /** Current on-device conversation preparation and the actions the quick start can take. */
  readonly conversation: RuntimeProfileQuickStartConversation;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly runtimeWritesDisabled: boolean;
  readonly owner: RuntimeConfigProfileUseOwner | null;
  readonly onCloseOwner: () => void;
  readonly onOpenSetupTask: (taskId: string) => void;
  readonly onOpenSavedConfigs: (context?: RuntimeConfigLoadoutNavigationContext) => void;
  readonly onOpenCloudServices: () => void;
  /** Rendered below the recommendation and sharing entry points while the list is shown. */
  readonly belowEntryPoints?: ReactNode;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const profileCatalog = useMemo(() => sdk.accountProduct().profiles, [sdk]);
  const [mode, setMode] = useState<ProfilesSectionMode>({ kind: 'list' });
  const [records, setRecords] = useState<readonly NimiDesktopPortableAIProfileCatalogRecord[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [showAll, setShowAll] = useState(false);
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
    () => [...(records ?? [])].sort((left, right) => Number(right.record.updatedAt?.seconds ?? 0) - Number(left.record.updatedAt?.seconds ?? 0) || left.source.title.localeCompare(right.source.title)),
    [records],
  );

  return (
    <div ref={sectionRef} tabIndex={-1} className="min-w-0" data-testid="runtime-ai-settings-profiles">
      <div className="space-y-5">
        {mode.kind === 'list' || mode.kind === 'recommended' ? (
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
              {props.lead ? (
                <p className="mt-1.5 text-sm text-[var(--nimi-text-secondary)] md:hidden">{props.lead}</p>
              ) : null}
            </div>
            {mode.kind === 'list' ? (
              // Import and share are low-frequency tools: two compact entries
              // in the heading row, not two explanatory bands. The journeys
              // themselves carry the preview-first and no-secrets promises.
              <div className="flex shrink-0 flex-wrap items-center gap-1" data-testid="runtime-ai-settings-profile-transfer">
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => setMode({ kind: 'import' })}
                  data-testid="runtime-ai-settings-profile-import"
                >
                  <FileUp size={14} strokeWidth={1.8} aria-hidden="true" />
                  {t('runtimeConfig.quickStart.loadShared')}
                </Button>
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => setMode({ kind: 'export' })}
                  data-testid="runtime-ai-settings-profile-export"
                >
                  <Share2 size={14} strokeWidth={1.8} aria-hidden="true" />
                  {t('runtimeConfig.quickStart.shareSetup')}
                </Button>
              </div>
            ) : null}
          </header>
        ) : null}

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

        {mode.kind === 'list' || mode.kind === 'recommended' ? (
          <div className="mt-2">
            <RuntimeProfileQuickStart
              disabled={props.runtimeWritesDisabled}
              conversation={props.conversation}
              onUse={(source) =>
                setMode({
                  kind: 'use',
                  autoReview: true,
                  profile: { source, artifactJson: JSON.stringify(source) },
                  owner: props.owner ?? { kind: 'app', ownerAppId: sdk.appId(), returnFocus: 'chat' },
                })
              }
            />
          </div>
        ) : null}
        {mode.kind === 'list' && props.belowEntryPoints ? <div className="mt-4">{props.belowEntryPoints}</div> : null}
        {mode.kind !== 'list' && mode.kind !== 'use' ? (
          <Button tone="ghost" size="sm" onClick={() => setMode({ kind: 'list' })}>
            {t('runtimeConfig.capabilities.backHome')}
          </Button>
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
            <ProfileExportPanel onOpenSavedConfigs={props.onOpenSavedConfigs} />
          </div>
        ) : null}
        {mode.kind === 'use' ? (
          <div className="mt-3">
            <ProfileUsePanel
              profile={mode.profile}
              store={props.store}
              ports={props.ports}
              runtimeWritesDisabled={props.runtimeWritesDisabled}
              owner={mode.owner ?? props.owner}
              autoReview={mode.autoReview}
              onBack={() => setMode({ kind: 'list' })}
              onOpenSetupTask={props.onOpenSetupTask}
            />
          </div>
        ) : null}

        {mode.kind === 'list' ? (
          <section className="mt-4 space-y-1">
            {loadError ? (
              <InlineAlert tone="danger">
                <div>{t('runtimeConfig.profiles.libraryLoadFailed', {
                  defaultValue: 'Saved setup files could not be loaded.',
                })}</div>
                <Button size="sm" tone="secondary" className="mt-2" onClick={() => setRefreshNonce((value) => value + 1)}>
                  {t('Common.retry', { defaultValue: 'Retry' })}
                </Button>
              </InlineAlert>
            ) : null}
            {records === null && !loadError ? <LoadingSkeleton className="h-16 w-full" /> : null}
            {(showAll || props.owner ? sortedRecords : sortedRecords.slice(0, 3)).map((record) => (
              <div
                key={record.source.profileId}
                className="flex flex-wrap items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-1 py-3"
                data-testid={`runtime-ai-settings-profile:${record.source.profileId}`}
              >
                <div className="flex shrink-0 -space-x-1.5">
                  {Object.keys(record.source.capabilities)
                    .sort()
                    .slice(0, 3)
                    .map((contract) => {
                      const Icon = capabilityIcon(contract);
                      return (
                        <span
                          key={contract}
                          title={displayRuntimeConfigCapabilityLabel(contract, t)}
                          className="flex size-8 items-center justify-center rounded-lg bg-[var(--nimi-surface-active)] text-[var(--nimi-text-secondary)] ring-2 ring-[var(--nimi-surface-panel)]"
                        >
                          <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
                        </span>
                      );
                    })}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {record.source.title}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[var(--nimi-text-secondary)]">
                    {Object.keys(record.source.capabilities)
                      .sort()
                      .slice(0, 3)
                      .map((contract) => displayRuntimeConfigCapabilityLabel(contract, t))
                      .join(' · ')}
                    {Object.keys(record.source.capabilities).length > 3
                      ? ` · ${t('runtimeConfig.product.moreCapabilities', { count: Object.keys(record.source.capabilities).length - 3 })}`
                      : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    tone="secondary"
                    disabled={props.runtimeWritesDisabled}
                    onClick={() => setMode({ kind: 'use', profile: record })}
                    data-testid={`runtime-ai-settings-profile-use:${record.source.profileId}`}
                  >
                    {t('runtimeConfig.aiSettings.profileUse', { defaultValue: 'Use' })}
                  </Button>
                  <IconButton
                    size="sm"
                    tone="ghost"
                    aria-label={t('runtimeConfig.profiles.savedProfileExport', { defaultValue: 'Export' })}
                    title={t('runtimeConfig.profiles.savedProfileExport', { defaultValue: 'Export' })}
                    icon={<Download size={15} />}
                    onClick={() =>
                      downloadRuntimeConfigProfileArtifact(
                        record.artifactJson,
                        `${record.source.profileId}.ai-profile.json`,
                      )
                    }
                  />
                </div>
              </div>
            ))}
            {sortedRecords.length > 3 && !props.owner ? <Button tone="ghost" size="sm" onClick={() => setShowAll(value => !value)}>{t(showAll ? 'runtimeConfig.product.showLess' : 'runtimeConfig.product.allSaved', { count: sortedRecords.length })}</Button> : null}
          </section>
        ) : null}
        {mode.kind === 'list' ? (
          <details className="border-t border-[var(--nimi-border-subtle)] pt-3">
            <summary className="cursor-pointer text-sm text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.quickStart.shareTools')}
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                tone="secondary"
                size="sm"
                onClick={() => setMode({ kind: 'create' })}
                data-testid="runtime-ai-settings-profile-create"
              >
                {t('runtimeConfig.aiSettings.profileCreate')}
              </Button>
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setMode({ kind: 'recommended' })}
                data-testid="runtime-ai-settings-profile-recommended"
              >
                {t('runtimeConfig.quickStart.compatibility')}
              </Button>
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function ProfileUsePanel(props: {
  readonly autoReview?: boolean;
  readonly profile: Pick<NimiDesktopPortableAIProfileCatalogRecord, 'source' | 'artifactJson'>;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly runtimeWritesDisabled: boolean;
  readonly owner: RuntimeConfigProfileUseOwner | null;
  readonly onBack: () => void;
  readonly onOpenSetupTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const apps = useAppsOverview();
  const [destination, setDestination] = useState('machine');
  const { profile } = props;
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const [transferPlan, setTransferPlan] = useState<RuntimeConfigAIProfileTransferPlan | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [subset, setSubset] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const autoReviewStarted = useRef(false);
  const [outcomes, setOutcomes] = useState<readonly { readonly capabilityContract: string; readonly taskId?: string; readonly error?: string; }[]>([]);

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

  const owner: RuntimeConfigProfileUseOwner | null =
    props.owner ??
    (destination === 'local-agent'
      ? { kind: 'local-agent', returnFocus: 'chat' }
      : destination.startsWith('app:')
        ? {
          kind: 'app',
          ownerAppId: destination.slice(4),
          returnFocus: destination.slice(4) === sdk.appId() ? 'chat' : `apps:${destination.slice(4)}`,
        }
        : null);
  const appEntries = apps.data?.status === 'loaded' ? apps.data.entries : [];
  const destinations = [
    ...new Map(appEntries.map((entry) => [entry.identity.appId, entry.identity.displayName])).entries(),
  ].filter(([id]) => id !== sdk.appId());
  const selectedPlans = useMemo(
    () => capabilityPlans.filter((plan) => subset.includes(plan.capabilityContract)),
    [capabilityPlans, subset],
  );
  const isStartable = useCallback((plan: { readonly state: string; }) => (
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
      const profileUseId = `profile-use-${crypto.randomUUID()}`;
      const nextOutcomes: { capabilityContract: string; taskId?: string; error?: string; }[] = [];
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
            draft: {
              route: 'cloud',
              profileId: profile.source.profileId,
              profileUseId,
              profileTitle: profile.source.title,
              cloudRecommendation: plan.cloudRecommendation,
            },
          }));
          nextOutcomes.push({ capabilityContract: plan.capabilityContract, taskId: task.taskId });
          continue;
        }
        if (!plan.candidate) continue;
        props.store.updateTask(task.taskId, () => ({
          draft: {
            profileUseId,
            profileTitle: profile.source.title,
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
    })().catch((error: unknown) => setPreviewError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
  }, [busy, owner, profile.source.profileId, props, startablePlans]);

  useEffect(() => {
    if (!props.autoReview || autoReviewStarted.current || !transferPlan || busy || previewError || startablePlans.length !== selectedPlans.length || !startablePlans.length) return;
    autoReviewStarted.current = true;
    onStart();
  }, [props.autoReview, transferPlan, busy, previewError, startablePlans.length, selectedPlans.length, onStart]);

  return (
    <div
      className="space-y-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3"
      data-testid="runtime-ai-settings-profile-use-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.aiSettings.profileUseTitle', {
              defaultValue: 'Use {{title}}',
              title: profile.source.title,
            })}
          </div>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {owner
              ? t('runtimeConfig.aiSettings.profileUseDescriptionOwner', {
                defaultValue:
                  'Choose the capabilities to set up. App settings are saved when you choose to use each one.',
              })
              : t('runtimeConfig.aiSettings.profileUseDescription', {
                defaultValue:
                  'Choose the capabilities to prepare on this device. You can review and use each one separately.',
              })}
          </p>
        </div>
        <Button tone="ghost" size="sm" onClick={props.onBack}>
          {t('runtimeConfig.setupTask.back', { defaultValue: 'Back' })}
        </Button>
      </div>
      {previewError ? (
        <InlineAlert tone="danger">
          <div>
            {t('runtimeConfig.profiles.feedbackPreviewFailed', {
              defaultValue: 'This portable AIProfile could not be previewed.',
            })}
          </div>
          <div className="mt-1 text-xs">{previewError}</div>
        </InlineAlert>
      ) : null}
      {!transferPlan && !previewError ? <LoadingSkeleton className="h-20 w-full" /> : null}
      {!props.owner ? (
        <label className="block space-y-2 text-sm">
          <span>{t('runtimeConfig.profileRun.destination')}</span>
          <SelectField
            value={destination}
            onValueChange={setDestination}
            options={[
              { value: 'machine', label: t('runtimeConfig.profileRun.machine') },
              { value: `app:${sdk.appId()}`, label: 'Nimi Chat' },
              { value: 'local-agent', label: t('runtimeConfig.setupTask.sourceLocalAgent') },
              ...destinations.map(([id, label]) => ({ value: `app:${id}`, label })),
            ]}
          />
        </label>
      ) : null}
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
            defaultValue:
              'Cloud routes are saved from the app that uses them; a machine-wide task never sets a global cloud default.',
          })}
        </p>
      ) : null}
      {outcomes.length > 0 ? (
        <div className="space-y-1" data-testid="runtime-ai-settings-profile-outcomes">
          {outcomes.map((outcome) => (
            <div key={outcome.capabilityContract} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[var(--nimi-text-secondary)]">
                {displayRuntimeConfigCapabilityLabel(outcome.capabilityContract, t)}
              </span>
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
            : t('runtimeConfig.product.reviewPreparation')}
        </Button>
      </div>
    </div>
  );
}
