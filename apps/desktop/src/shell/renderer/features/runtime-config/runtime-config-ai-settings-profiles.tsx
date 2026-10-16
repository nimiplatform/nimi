import {
  RuntimeProfileQuickStart,
  type RuntimeProfileQuickStartConversation,
  type RuntimeOverviewCapability,
} from './runtime-profile-quick-start.js';
// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { ActionMenu, Button, ConfirmDialog, IconButton, InlineAlert, LoadingSkeleton, Popover, PopoverContent, PopoverTrigger, SelectField, type NimiMenuItem } from '@nimiplatform/kit/ui';
import type {
  NimiDesktopPortableAIProfileCatalogRecord,
} from '@nimiplatform/sdk/runtime';
import { ArrowLeft, ArrowRight, ChevronDown, CircleAlert, CircleCheck, CircleHelp, FileSliders, FileUp, MoreHorizontal, Share2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { homeRuntimeDestination } from '../../app-shell/providers/home-navigation.js';
import { getProfileViewState, trackProfileViewRequest, type RuntimeProfileViewDraft, type RuntimeProfileViewMode } from './runtime-profile-view-state.js';
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
import { runtimeSetupFailureText } from './runtime-setup-failure-message.js';
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

function profileUseOwnerLabel(
  owner: RuntimeConfigProfileUseOwner,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (owner.kind === 'app') return owner.ownerAppId;
  return t('runtimeConfig.setupTask.sourceLocalAgent', { defaultValue: 'the shared LocalAgent' });
}

/**
 * The AI settings 配置库 (profile library) section: recommendations, use,
 * create, and export share one in-page home, and import opens as a dialog
 * over the list it adds to. Using a profile never
 * stores it again, and storing/importing never applies it — the two are
 * separate journeys. With an owner context (entered from an app), the use
 * journey retains that owner when entering the shared preparation tasks.
 */
export function RuntimeConfigAiSettingsProfilesSection(props: {
  /** Home heading; hidden while an export, create or use journey owns the page. */
  readonly title: string;
  /** Preparation summary shown under the heading where the rail is hidden. */
  readonly lead: string;
  /** Current on-device conversation preparation and the actions the quick start can take. */
  readonly conversation: RuntimeProfileQuickStartConversation;
  readonly capabilities: readonly RuntimeOverviewCapability[];
  readonly onOpenCapability: (capability: string) => void;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly runtimeWritesDisabled: boolean;
  readonly owner: RuntimeConfigProfileUseOwner | null;
  readonly onCloseOwner: () => void;
  readonly onOpenSetupTask: (taskId: string) => void;
  readonly onOpenSavedConfigs: (context?: RuntimeConfigLoadoutNavigationContext) => void;
  readonly onOpenCloudServices: () => void;
  /** Model resources rendered below the saved profile library while the list is shown. */
  readonly belowEntryPoints?: ReactNode;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const profileCatalog = useMemo(() => sdk.accountProduct().profiles, [sdk]);
  const navigation = useHomeNavigation();
  const position = useHomeDestination().runtime;
  const views = getProfileViewState(navigation);
  const viewId = position?.profileViewId;
  const view = useSyncExternalStore(views.subscribe, () => views.get(viewId), () => views.get(viewId));
  const mode = view?.mode ?? { kind: 'list' as const };
  const setMode = (next: RuntimeProfileViewMode | { kind: 'list' }) => {
    void navigation.push(homeRuntimeDestination('aiSettings', {
      ...(position?.profileOwner ? { profileOwner: position.profileOwner } : {}),
      ...(next.kind !== 'list' ? { profileViewId: views.create(next) } : {}),
    }));
  };
  const [importing, setImporting] = useState(false);
  const [records, setRecords] = useState<readonly NimiDesktopPortableAIProfileCatalogRecord[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  const handleDeleteProfile = useCallback(async (record: NimiDesktopPortableAIProfileCatalogRecord) => {
    try {
      await profileCatalog.delete(record.source.profileId);
      setDeleteError('');
      setRefreshNonce((value) => value + 1);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error || ''));
    }
  }, [profileCatalog]);

  useEffect(() => {
    if (!props.owner) return;
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

  useEffect(() => {
    if (mode.kind !== 'use') return;
    sectionRef.current?.scrollIntoView({ block: 'start' });
    sectionRef.current?.focus({ preventScroll: true });
  }, [mode.kind]);

  if (viewId && !view) return (
    <InlineAlert tone="warning">
      <p>{t('runtimeConfig.positionUnavailable')}</p>
      <Button onClick={() => setMode({ kind: 'list' })}>{t('runtimeConfig.aiSettings.profileBack')}</Button>
    </InlineAlert>
  );
  return (
    <div ref={sectionRef} tabIndex={-1} className="min-w-0" data-testid="runtime-ai-settings-profiles">
      <div className="space-y-5">
        {mode.kind === 'list' || mode.kind === 'recommended' ? (
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{props.owner ? t('runtimeConfig.aiSettings.profileSelectionTitle') : props.title}</h1>
              {!props.owner && props.lead ? (
                <p className="mt-1.5 text-sm text-[var(--nimi-text-secondary)] md:hidden">{props.lead}</p>
              ) : null}
            </div>
          </header>
        ) : null}

        {props.owner ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] px-3 py-2" data-testid="runtime-ai-settings-profile-owner-banner">
            <p className="text-xs text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.aiSettings.profileOwnerContext', {
                owner: profileUseOwnerLabel(props.owner, t),
                defaultValue: 'Choose a model setup for {{owner}}, then review the capabilities before applying it.',
              })}
            </p>
            <Button tone="ghost" size="sm" onClick={props.onCloseOwner} data-testid="runtime-ai-settings-profile-owner-close">
              {t('runtimeConfig.aiSettings.profileOwnerClose', { defaultValue: 'Exit app context' })}
            </Button>
          </div>
        ) : null}

        {!props.owner && (mode.kind === 'list' || mode.kind === 'recommended') ? (
          <div className="mt-2">
            <RuntimeProfileQuickStart
              disabled={props.runtimeWritesDisabled}
              conversation={props.conversation}
              capabilities={props.capabilities}
              onOpenCapability={props.onOpenCapability}
              readyAction={
                <Button
                  tone="ghost"
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() => setMode({ kind: 'export' })}
                  data-testid="runtime-ai-settings-profile-export"
                >
                  <Share2 size={14} strokeWidth={1.8} aria-hidden="true" />
                  {t('runtimeConfig.quickStart.shareSetup')}
                </Button>
              }
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
        {mode.kind !== 'list' && mode.kind !== 'use' ? (
          <Button tone="ghost" size="sm" className="-ml-3" onClick={() => setMode({ kind: 'list' })}>
            <ArrowLeft size={15} />
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
        {importing ? (
          <ProfileImportWizard
            initialSourceText={null}
            onClose={() => setImporting(false)}
            onCatalogChanged={() => setRefreshNonce((value) => value + 1)}
            onUseImported={(profile) => {
              setImporting(false);
              setMode({ kind: 'use', profile, saved: true });
            }}
          />
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
              key={viewId}
              viewId={viewId!}
              draft={view!}
              profile={mode.profile}
              store={props.store}
              ports={props.ports}
              runtimeWritesDisabled={props.runtimeWritesDisabled}
              owner={mode.owner ?? props.owner}
              autoReview={mode.autoReview}
              saved={mode.saved}
              onBack={() => setMode({ kind: 'list' })}
              onOpenSetupTask={props.onOpenSetupTask}
            />
          </div>
        ) : null}

        {mode.kind === 'list' ? (
          <header className="sticky top-0 z-20 -mx-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--nimi-surface-panel)] px-2 py-2">
            <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.aiSettings.profileLibraryTitle')}</h2>
            <div className="flex shrink-0 flex-wrap items-center gap-1" data-testid="runtime-ai-settings-profile-transfer">
              <Button tone="ghost" size="sm" onClick={() => setImporting(true)} data-testid="runtime-ai-settings-profile-import">
                <FileUp size={14} strokeWidth={1.8} aria-hidden="true" />
                {t('runtimeConfig.aiSettings.profileLibraryImport')}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button tone="ghost" size="sm" data-testid="runtime-ai-settings-profile-tools">
                    {t('runtimeConfig.quickStart.shareTools')}
                    <ChevronDown size={14} aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-1">
                  <div className="flex flex-col gap-1">
                    <Button
                      tone="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() => setMode({ kind: 'create' })}
                      data-testid="runtime-ai-settings-profile-create"
                    >
                      {t('runtimeConfig.aiSettings.profileCreate')}
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() => setMode({ kind: 'recommended' })}
                      data-testid="runtime-ai-settings-profile-recommended"
                    >
                      {t('runtimeConfig.quickStart.compatibility')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </header>
        ) : null}

        {mode.kind === 'list' ? (
          <section className="space-y-2" aria-label={t('runtimeConfig.aiSettings.profileLibraryTitle')} data-testid={props.owner ? 'runtime-ai-settings-profile-selection' : 'runtime-ai-settings-profile-library'}>
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
            {deleteError ? (
              <InlineAlert tone="danger">
                <div>{t('runtimeConfig.aiSettings.profileDeleteFailed')}</div>
              </InlineAlert>
            ) : null}
            {records === null && !loadError ? <LoadingSkeleton className="h-16 w-full" /> : null}
            {records !== null && !loadError && sortedRecords.length === 0 ? (
              <p className="py-6 text-sm text-[var(--nimi-text-secondary)]" data-testid="runtime-ai-settings-profile-selection-empty">
                {t('runtimeConfig.aiSettings.profileSelectionEmpty')}
              </p>
            ) : null}
            {(showAll || props.owner ? sortedRecords : sortedRecords.slice(0, 3)).map((record) => (
              <ProfileLibraryCard
                key={record.source.profileId}
                record={record}
                runtimeWritesDisabled={props.runtimeWritesDisabled}
                onUse={() => setMode({ kind: 'use', profile: record, saved: true })}
                onDelete={() => handleDeleteProfile(record)}
              />
            ))}
            {sortedRecords.length > 3 && !props.owner ? <Button tone="ghost" size="sm" onClick={() => setShowAll(value => !value)}>{t(showAll ? 'runtimeConfig.product.showLess' : 'runtimeConfig.product.allSaved', { count: sortedRecords.length })}</Button> : null}
          </section>
        ) : null}
        {!props.owner && mode.kind === 'list' && props.belowEntryPoints ? (
          <div className="border-t border-[var(--nimi-border-subtle)] pt-6">{props.belowEntryPoints}</div>
        ) : null}
      </div>
    </div>
  );
}

function ProfileLibraryCard(props: {
  readonly record: NimiDesktopPortableAIProfileCatalogRecord;
  readonly runtimeWritesDisabled: boolean;
  readonly onUse: () => void;
  readonly onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { record } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuItems: NimiMenuItem[] = [
    {
      id: 'export',
      label: t('runtimeConfig.aiSettings.profileExportFile'),
      icon: <Share2 className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => {
        setMenuOpen(false);
        downloadRuntimeConfigProfileArtifact(
          record.artifactJson,
          `${record.source.profileId}.ai-profile.json`,
        );
      },
    },
    {
      id: 'delete',
      label: t('runtimeConfig.aiSettings.profileDelete'),
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      tone: 'danger',
      disabled: props.runtimeWritesDisabled || deleting,
      onSelect: () => {
        setMenuOpen(false);
        setConfirmingDelete(true);
      },
    },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-2xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_4%,var(--nimi-surface-card))] px-5 py-3"
      data-testid={`runtime-ai-settings-profile:${record.source.profileId}`}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--nimi-border-subtle)] text-[var(--nimi-action-primary-bg)]">
        <FileSliders size={25} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <h3 className="break-words text-sm font-semibold text-[var(--nimi-text-primary)]">{record.source.title}</h3>
        <div className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
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
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          tone="primary"
          className="min-w-28 border-transparent bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)]"
          disabled={props.runtimeWritesDisabled}
          onClick={props.onUse}
          data-testid={`runtime-ai-settings-profile-use:${record.source.profileId}`}
        >
          {t('runtimeConfig.aiSettings.profileView')}
        </Button>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <IconButton
              icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
              tone="ghost"
              size="sm"
              aria-label={t('runtimeConfig.aiSettings.profileMenu')}
              title={t('runtimeConfig.aiSettings.profileMenu')}
              data-testid={`runtime-ai-settings-profile-menu:${record.source.profileId}`}
            />
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-44 p-1">
            <ActionMenu items={menuItems} ariaLabel={t('runtimeConfig.aiSettings.profileMenu')} />
          </PopoverContent>
        </Popover>
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        title={t('runtimeConfig.aiSettings.profileDeleteConfirmTitle')}
        message={t('runtimeConfig.aiSettings.profileDeleteConfirmMessage', { name: record.source.title })}
        confirmLabel={t('runtimeConfig.aiSettings.profileDelete')}
        cancelLabel={t('Common.cancel')}
        confirmTone="danger"
        pending={deleting}
        onConfirm={() => {
          setDeleting(true);
          void props.onDelete().finally(() => {
            setDeleting(false);
            setConfirmingDelete(false);
          });
        }}
        onClose={() => setConfirmingDelete(false)}
      />
    </div>
  );
}

function ProfileUsePanel(props: {
  readonly viewId: string;
  readonly draft: RuntimeProfileViewDraft;
  readonly autoReview?: boolean;
  readonly saved?: boolean;
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
  const navigation = useHomeNavigation();
  const views = getProfileViewState(navigation);
  const { destination, busy, outcomes } = props.draft;
  const subset = props.draft.subset ?? [];
  const setDestination = (value: string) => views.update(props.viewId, () => ({ destination: value }));
  const { profile } = props;
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const [transferPlan, setTransferPlan] = useState<RuntimeConfigAIProfileTransferPlan | null>(null);
  const [previewError, setPreviewError] = useState('');

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
        views.update(props.viewId, (current) => ({ subset: current.subset ?? Object.keys(plan.profile.capabilities) }));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPreviewError(error instanceof Error ? error.message : String(error || ''));
      });
    return () => {
      active = false;
    };
  }, [localEnvironment, profile.artifactJson, props.ports.loadouts, props.viewId, views]);

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
    views.update(props.viewId, (current) => ({ subset: checked
      ? [...new Set([...(current.subset ?? []), capabilityContract])]
      : (current.subset ?? []).filter((entry) => entry !== capabilityContract) }));
  }, [props.viewId, views]);

  const onStart = useCallback(() => {
    if (startablePlans.length === 0 || views.get(props.viewId)?.busy) return;
    views.update(props.viewId, () => ({ busy: true, error: '' }));
    const request = trackProfileViewRequest(navigation);
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
          nextOutcomes.push({ capabilityContract: plan.capabilityContract, error: runtimeSetupFailureText(created.failure, t) });
        }
      }
      // Owner routes are deliberately NOT saved here: each task saves its
      // owner's route when its own preparation is confirmed and used, chained
      // through the session save lane. Starting a preparation never rewrites
      // the owner's current routes.
      views.update(props.viewId, () => ({ outcomes: nextOutcomes }));
      const firstTaskId = nextOutcomes.find((outcome) => outcome.taskId)?.taskId;
      if (firstTaskId && request.canNavigate()) {
        props.onOpenSetupTask(firstTaskId);
      }
    })().catch((error: unknown) => views.update(props.viewId, () => ({ error: error instanceof Error ? error.message : String(error) }))).finally(() => {
      request.dispose();
      views.update(props.viewId, () => ({ busy: false }));
    });
  }, [navigation, views, owner, profile.source.profileId, props, startablePlans, t]);

  useEffect(() => {
    if (!props.autoReview || props.draft.autoReviewStarted || !transferPlan || busy || previewError || startablePlans.length !== selectedPlans.length || !startablePlans.length) return;
    views.update(props.viewId, () => ({ autoReviewStarted: true }));
    onStart();
  }, [props.autoReview, props.draft.autoReviewStarted, props.viewId, views, transferPlan, busy, previewError, startablePlans.length, selectedPlans.length, onStart]);

  return (
    <div
      className="space-y-6"
      data-testid="runtime-ai-settings-profile-use-panel"
    >
      <Button tone="ghost" size="sm" className="-ml-3" onClick={props.onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t('runtimeConfig.aiSettings.profileBack')}
      </Button>
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--nimi-border-subtle)] pb-6">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]">
          <FileSliders size={28} strokeWidth={1.6} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-semibold tracking-tight">{profile.source.title}</h1>
            <span className="rounded bg-[var(--nimi-surface-subtle)] px-2 py-0.5 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.aiSettings.profileKind')}</span>
          </div>
          {props.saved ? <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.aiSettings.profileSaved')}</p> : null}
          {profile.source.description ? <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{profile.source.description}</p> : null}
        </div>
        <Button tone="secondary" size="sm" onClick={() => downloadRuntimeConfigProfileArtifact(profile.artifactJson, `${profile.source.profileId}.ai-profile.json`)}>
          <Share2 size={15} aria-hidden="true" />
          {t('runtimeConfig.aiSettings.profileExportFile')}
        </Button>
      </header>
      {previewError || props.draft.error ? (
        <InlineAlert tone="danger">
          <div>
            {t('runtimeConfig.profiles.feedbackPreviewFailed', {
              defaultValue: 'This portable AIProfile could not be previewed.',
            })}
          </div>
          <div className="mt-1 text-xs">{previewError || props.draft.error}</div>
        </InlineAlert>
      ) : null}
      <section className="space-y-4" aria-label={t('runtimeConfig.aiSettings.profileContents')}>
        <h2 className="text-lg font-semibold">{t('runtimeConfig.aiSettings.profileContents')}</h2>
        {!transferPlan && !previewError ? <LoadingSkeleton className="h-28 w-full" /> : null}
        {capabilityPlans.length > 0 ? <div className="divide-y divide-[var(--nimi-border-subtle)] overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
          {capabilityPlans.map((plan) => {
            const selectable = isStartable(plan);
            const Icon = capabilityIcon(plan.capabilityContract);
            const capability = profile.source.capabilities[plan.capabilityContract];
            const transfer = transferPlan?.capabilities.find((entry) => entry.capabilityContract === plan.capabilityContract);
            const description = capability?.route === 'local'
              ? transfer?.recipe?.title || capability.loadout?.recipeId
              : capability?.implementation?.implementationId;
            const needsAttention = plan.state !== 'ready' && !(owner && plan.state === 'cloud-requires-owner');
            const StatusIcon = plan.state === 'ready' ? CircleCheck : needsAttention ? CircleAlert : CircleHelp;
            return (
              <div
                key={plan.capabilityContract}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-5"
                data-testid={`runtime-ai-settings-profile-capability:${plan.capabilityContract}`}
              >
                <label className="flex min-w-0 flex-1 basis-56 items-center gap-4 text-sm text-[var(--nimi-text-primary)]">
                  <input
                    type="checkbox"
                    checked={subset.includes(plan.capabilityContract)}
                    disabled={!selectable}
                    className="size-4 shrink-0 accent-[var(--nimi-action-primary-bg)]"
                    onChange={(event) => onToggle(plan.capabilityContract, event.currentTarget.checked)}
                  />
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--nimi-border-subtle)] text-[var(--nimi-action-primary-bg)]">
                    <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{displayRuntimeConfigCapabilityLabel(plan.capabilityContract, t)}</span>
                    {description ? <span className="mt-1 block break-words text-sm text-[var(--nimi-text-secondary)]">{description}</span> : null}
                  </span>
                </label>
                <span className={`flex max-w-full items-center gap-2 text-sm ${needsAttention ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-secondary)]'}`}>
                  <StatusIcon size={16} className="shrink-0" aria-hidden="true" />
                  {owner && plan.state === 'cloud-requires-owner'
                    ? t('runtimeConfig.aiSettings.profileUseState.cloud-owner-choice', { defaultValue: 'Cloud · choose the connection in the task' })
                    : plan.state === 'ready' ? t('runtimeConfig.aiSettings.profileModelsPresent')
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
        </div> : null}
        <details className="rounded-lg border border-[var(--nimi-border-subtle)] px-4 py-3 text-sm">
          <summary className="cursor-pointer text-[var(--nimi-text-secondary)]">{t('runtimeConfig.aiSettings.profileFileDetails')}</summary>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--nimi-surface-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">{JSON.stringify(profile.source, null, 2)}</pre>
        </details>
      </section>
      <section className="border-t border-[var(--nimi-border-subtle)] pt-6" aria-label={t('runtimeConfig.aiSettings.profileScope')}>
        {!props.owner ? (
          <label className="block max-w-md space-y-3 text-sm">
            <span className="block text-lg font-semibold">{t('runtimeConfig.aiSettings.profileScope')}</span>
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
        ) : (
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">{t('runtimeConfig.aiSettings.profileScope')}</h2>
            <p className="text-sm text-[var(--nimi-text-secondary)]">{profileUseOwnerLabel(props.owner, t)}</p>
          </div>
        )}
        {!owner && selectedPlans.some((plan) => plan.state === 'cloud-requires-owner') ? (
          <p className="mt-3 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.aiSettings.profileUseCloudNote', {
              defaultValue:
                'Cloud routes are saved from the app that uses them; a machine-wide task never sets a global cloud default.',
            })}
          </p>
        ) : null}
      </section>
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
      <div className="flex justify-end">
        <Button
          tone="primary"
          disabled={busy || props.runtimeWritesDisabled || startablePlans.length === 0}
          onClick={onStart}
          data-testid="runtime-ai-settings-profile-start"
        >
          {busy
            ? t('runtimeConfig.aiSettings.profileUseStarting', { defaultValue: 'Starting…' })
            : t('runtimeConfig.product.reviewPreparation')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
