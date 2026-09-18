import { AppPackageSourceClass } from '@nimiplatform/sdk/runtime/wire-types';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { NimiDesktopOpenAppsSection } from '@nimiplatform/kit/core/desktop-open';
import type { NimiAIConfigOverwriteResult } from '@nimiplatform/kit/core/sdk-contract';
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Bot,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  FolderOpen,
  Info,
  MoreHorizontal,
  PackageOpen,
  Play,
  Settings,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  IconButton,
  InlineAlert,
  NimiTabs,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import {
  AppsAIConfigSection,
  appsAIConfigCapabilityContracts,
} from './apps-ai-config-section.js';
import { AppsPropertiesDialog, type AppsPropertiesRow, type AppsPropertiesSection } from './apps-properties-dialog.js';
import { AppsUpdateSection } from './apps-update-section.js';
import type { DesktopAppsEntry, DesktopAppsProjectionSource } from './apps-panel-projection.js';
import {
  actionPlanForEntry,
  canRequestCatalogInstall,
  canRequestCatalogUpdate, canRequestLocalPackageUpdate,
  hasAvailableCatalogUpdate,
  canRequestUninstall,
  type AppCardActionId,
} from './apps-card-actions.js';
import { appRunVisualState, appSourceForEntry } from './apps-card-fields.js';
import { AppArtworkIcon, AppPackageStatusLine, AppRunStatusBadge, AppSourceBadge } from './apps-card-visuals.js';
import { AppsReadmeMarkdown, readmeExternalHref } from './apps-readme-markdown.js';
import { AppsDistributionDocuments } from './apps-distribution-info.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';
import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001
// @nimi-authority: rule.nimi.desktop.shell-ui.r061

type AppsDetailTab = 'overview' | 'access' | 'ai-models';

const APP_ACCESS_COPY_KEYS = Object.freeze({
  'realm.data': 'realmData',
  'runtime.consume': 'runtimeConsume',
  'agent.local': 'agentLocal',
  'agent.configure': 'agentConfigure',
} as const);

type ProjectReadmeState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly content: string | null; readonly truncated: boolean }
  | { readonly status: 'error' };

const APP_ACCESS_FEATURE_ICON = Object.freeze({
  'realm.data': Database,
  'runtime.consume': Sparkles,
  'agent.local': Bot,
  'agent.configure': SlidersHorizontal,
} as const);

export interface AppsDetailViewProps {
  readonly entry: DesktopAppsEntry;
  /** Other sources of the same App, for cross-source management. */
  readonly sourceEntries: readonly DesktopAppsEntry[];
  readonly requestedSection: NimiDesktopOpenAppsSection | null;
  readonly requestedNavigationRevision: number;
  readonly onBack: () => void;
  readonly onOpenEntry: (entryKey: string) => void;
  readonly onAction: (action: AppCardActionId) => void;
  readonly activeAction: AppCardActionId | null;
  readonly actionsDisabled: boolean;
  readonly actionError: string | null;
  readonly onAIConfigChanged: (result: NimiAIConfigOverwriteResult) => void;
  readonly readPackageInfo?: DesktopAppsProjectionSource['readPackageInfo'];
}

export function AppsDetailView({
  entry,
  ...props
}: AppsDetailViewProps): ReactElement {
  return entry.localDevelopment
    ? <LocalDevelopmentAppsDetailView entry={entry} {...props} />
    : <InstalledAppsDetailView entry={entry} {...props} />;
}

function LocalDevelopmentAppsDetailView({
  entry,
  sourceEntries,
  requestedSection,
  requestedNavigationRevision,
  onBack,
  onOpenEntry,
  onAction,
  activeAction,
  actionsDisabled,
  actionError,
  onAIConfigChanged,
}: AppsDetailViewProps): ReactElement {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<AppsDetailTab>('overview');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [copiedAppId, setCopiedAppId] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const registration = entry.localDevelopment;
  if (!registration) throw new Error('Local-development App detail requires a registration');
  const { identity } = entry;
  const aiConfigCapabilityContracts = appsAIConfigCapabilityContracts(registration.appAccess);
  const aiModelsAvailable = aiConfigCapabilityContracts.length > 0;
  const actionPlan = actionPlanForEntry(entry);

  const liveBridge = useMemo(() => createDesktopAppsLiveBridge(), []);
  const [readme, setReadme] = useState<ProjectReadmeState>({ status: 'loading' });

  useEffect(() => {
    setActiveTab(requestedSection === 'ai-models' && aiModelsAvailable ? 'ai-models' : 'overview');
  }, [aiModelsAvailable, identity.appId, requestedNavigationRevision, requestedSection]);

  useEffect(() => {
    let alive = true;
    setReadme({ status: 'loading' });
    liveBridge.readProjectReadme(registration.selector)
      .then((result) => {
        if (alive) setReadme({ status: 'loaded', content: result.content, truncated: result.truncated });
      })
      .catch(() => {
        if (alive) setReadme({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [liveBridge, registration.selector, registration.updatedAtUnixMs]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const registeredAt = formatTimestamp(registration.registeredAtUnixMs, i18n.language);
  const updatedAt = formatTimestamp(registration.updatedAtUnixMs, i18n.language);
  const shellLabel = t(`LocalDevelopment.shell.${registration.shell}`, { defaultValue: registration.shell });

  const copyAppId = (): void => {
    void navigator.clipboard?.writeText(identity.appId).then(() => {
      setCopiedAppId(true);
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => setCopiedAppId(false), 1_600);
    }).catch(() => {
      // Clipboard is a convenience; a rejected write needs no surface.
    });
  };

  const menuItems: NimiMenuItem[] = [
    {
      id: 'properties',
      label: t('Apps.detail.propertiesTitle'),
      icon: <Settings className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => setPropertiesOpen(true),
    },
    ...(actionPlan.secondary.some((action) => action.id === 'cancel-job') ? [{
      id: 'cancel-job',
      label: t('Apps.action.cancel'),
      icon: <X className="h-4 w-4" aria-hidden="true" />,
      disabled: actionsDisabled,
      onSelect: () => onAction('cancel-job'),
    }] : []),
    {
      id: 'copy-app-id',
      label: copiedAppId ? t('Apps.detail.appIdCopied') : t('Apps.detail.copyAppId'),
      icon: copiedAppId
        ? <Check className="h-4 w-4" aria-hidden="true" />
        : <Copy className="h-4 w-4" aria-hidden="true" />,
      onSelect: copyAppId,
    },
    {
      id: 'remove',
      label: t('Apps.action.removeDevelopment'),
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      tone: 'danger',
      disabled: actionsDisabled,
      onSelect: () => setConfirmingRemove(true),
    },
  ];

  const tabItems = [
    { value: 'overview', label: t('Apps.detail.overviewTab') },
    { value: 'access', label: t('Apps.detail.accessTab') },
    ...(aiModelsAvailable ? [{ value: 'ai-models', label: t('Apps.detail.aiModelsTab') }] : []),
  ];

  const propertiesSections: AppsPropertiesSection[] = [
    {
      id: 'developer',
      label: t('Apps.detail.developerInfoTitle'),
      description: t('Apps.detail.developerInfoDescription'),
      rows: [
        { label: t('LocalDevelopment.field.app'), value: identity.appId, mono: true },
        { label: t('LocalDevelopment.field.projectRoot'), value: registration.canonicalProjectRoot, icon: <FolderOpen className="h-4 w-4" />, mono: true },
        { label: t('LocalDevelopment.field.shell'), value: shellLabel },
        { label: t('LocalDevelopment.field.sourceGeneration'), value: String(registration.sourceGeneration), mono: true },
        { label: t('LocalDevelopment.field.declarationGeneration'), value: String(registration.declarationGeneration), mono: true },
        { label: t('Apps.detail.registeredAt'), value: registeredAt },
        { label: t('Apps.detail.lastUpdated'), value: updatedAt },
      ],
    },
    {
      id: 'run',
      label: t('Apps.detail.runCardTitle'),
      description: t('Apps.detail.runDiagnosticsDescription'),
      rows: [
        { label: t('Apps.detail.runState'), value: t(`Apps.runState.${appRunVisualState(entry.run?.state ?? null)}`) },
        ...(entry.run?.message ? [{ label: t('Apps.detail.runMessage'), value: entry.run.message }] : []),
        ...(entry.run?.reasonCode ? [{ label: t('Apps.detail.runReasonCode'), value: entry.run.reasonCode, mono: true }] : []),
      ],
    },
  ];

  return (
    <div data-testid="apps-detail-body" className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-5 pt-4 sm:px-7 sm:pt-5">
        <Button
          data-testid="apps-detail-back"
          tone="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 mb-3"
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('Apps.library.backToLibrary')}
        </Button>

        <div className="flex min-w-0 items-center gap-5">
          <AppArtworkIcon
            appId={identity.appId}
            displayName={identity.displayName}
            iconUrl={entry.iconUrl}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 data-testid="apps-detail-title" className="break-words text-2xl font-semibold leading-8 text-[color:var(--nimi-text-primary)]">
                {identity.displayName}
              </h1>
              {appRunVisualState(entry.run?.state ?? null) !== 'stopped' ? <AppRunStatusBadge entry={entry} /> : null}
            </div>
            {entry.summary ? (
              <p data-testid="apps-detail-summary" className="mt-1.5 break-words text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
                {entry.summary}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actionPlan.primary?.id === 'stop' ? (
              <Button
                data-testid="apps-detail-stop"
                tone="secondary"
                loading={activeAction === 'stop'}
                disabled={actionsDisabled}
                onClick={() => onAction('stop')}
              >
                <Square className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                {t('Apps.action.stop')}
              </Button>
            ) : (
              <Button
                data-testid="apps-detail-launch"
                tone="primary"
                loading={activeAction === 'launch'}
                disabled={actionsDisabled}
                onClick={() => onAction('launch')}
              >
                <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('Apps.action.launch')}
              </Button>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <IconButton
                  data-testid="apps-detail-more"
                  icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                  tone="secondary"
                  aria-label={t('Apps.detail.moreActions')}
                  title={t('Apps.detail.moreActions')}
                />
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="p-1">
                <ActionMenu items={menuItems} ariaLabel={t('Apps.detail.moreActions')} />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <NimiTabs
          className="mt-5"
          items={tabItems}
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as AppsDetailTab)}
          ariaLabel={t('Apps.detail.tabsLabel')}
        />
      </header>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-7">
          {actionError ? (
            <InlineAlert tone="danger" data-testid="apps-action-error" className="mb-5">
              {actionError}
            </InlineAlert>
          ) : null}

          {activeTab === 'overview' ? (
            <div role="tabpanel" id="apps-detail-panel-overview" aria-labelledby="apps-detail-tab-overview" tabIndex={0} className="space-y-7 outline-none">
              <AppsOverviewTab
                sourceEntries={sourceEntries}
                onOpenEntry={onOpenEntry}
                readme={readme}
                about={(
                  <AppsAboutSection
                    entry={entry}
                    developer={null}
                    fact={{ label: t('Apps.detail.lastUpdated'), value: formatDate(registration.updatedAtUnixMs, i18n.language) }}
                    fallbackSummary={t('Apps.detail.localSummary')}
                    onOpenProperties={() => setPropertiesOpen(true)}
                  />
                )}
              />
            </div>
          ) : null}

          {activeTab === 'access' ? (
            <div role="tabpanel" id="apps-detail-panel-access" aria-labelledby="apps-detail-tab-access" tabIndex={0} className="space-y-7 outline-none">
              <AppsAccessTabSections
                appAccess={registration.appAccess}
                aiModelsAvailable={aiModelsAvailable}
                runRequirementsDescription={t('Apps.detail.runRequirementsLocalDescription')}
              />
            </div>
          ) : null}

          {activeTab === 'ai-models' && aiModelsAvailable ? (
            <div role="tabpanel" id="apps-detail-panel-ai-models" aria-labelledby="apps-detail-tab-ai-models" tabIndex={0} className="outline-none">
              <AppsAIConfigSection
                appId={identity.appId}
                appDisplayName={identity.displayName}
                allowedRoutes={registration.aiConfigAllowedRoutes}
                declaredCapabilityRefs={registration.capabilityContractRefs}
                onAIConfigChanged={onAIConfigChanged}
              />
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <AppsPropertiesDialog
        open={propertiesOpen}
        appName={identity.displayName}
        onClose={() => setPropertiesOpen(false)}
        sections={propertiesSections}
      />

      <ConfirmDialog
        open={confirmingRemove}
        title={t('Apps.confirm.removeDevelopment.title')}
        message={t('Apps.confirm.removeDevelopment.message', { app: identity.displayName })}
        confirmLabel={t('Apps.confirm.removeDevelopment.confirm')}
        cancelLabel={t('Common.cancel')}
        confirmTone="danger"
        pending={activeAction === 'remove'}
        onConfirm={() => {
          setConfirmingRemove(false);
          onAction('remove');
        }}
        onClose={() => setConfirmingRemove(false)}
      />
    </div>
  );
}

function InstalledAppsDetailView({
  entry,
  sourceEntries,
  requestedSection,
  requestedNavigationRevision,
  onBack,
  onOpenEntry,
  onAction,
  activeAction,
  actionsDisabled,
  actionError,
  onAIConfigChanged,
  readPackageInfo,
}: AppsDetailViewProps): ReactElement {
  const { t } = useTranslation();
  const release = entry.committedRelease;
  const catalog = entry.catalogTarget;
  const installedRun = entry.run && 'accessAvailable' in entry.run ? entry.run : null;
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [copiedAppId, setCopiedAppId] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const aiModelsAvailable = appsAIConfigCapabilityContracts(release?.appAccess ?? []).length > 0;
  const [activeTab, setActiveTab] = useState<AppsDetailTab>(
    requestedSection === 'ai-models' && aiModelsAvailable ? 'ai-models' : 'overview',
  );
  useEffect(() => {
    setActiveTab(requestedSection === 'ai-models' && aiModelsAvailable ? 'ai-models' : 'overview');
  }, [aiModelsAvailable, entry.identity.entryKey, requestedNavigationRevision, requestedSection]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const actionPlan = actionPlanForEntry(entry);

  const declaredAppAccess = release?.appAccess ?? catalog?.appAccess ?? [];
  const readme: ProjectReadmeState = entry.appInfoError
    ? { status: 'error' }
    : entry.appInfo
      ? { status: 'loaded', content: entry.appInfo.readmeMarkdown || null, truncated: false }
      : { status: 'loading' };
  const aboutDeveloper = entry.appInfo?.author?.trim()
    || (catalog?.publisherGithubNamespace?.trim() ? `@${catalog.publisherGithubNamespace.trim()}` : null);
  const aboutLinks = [
    ...(entry.appInfo?.homepageUrl ? [{ label: t('Apps.info.homepage'), url: entry.appInfo.homepageUrl }] : []),
    ...(entry.appInfo?.supportUrl ? [{ label: t('Apps.info.support'), url: entry.appInfo.supportUrl }] : []),
  ];

  const tabItems = [
    { value: 'overview', label: t('Apps.detail.overviewTab') },
    { value: 'access', label: t('Apps.detail.accessTab') },
    ...(aiModelsAvailable ? [{ value: 'ai-models', label: t('Apps.detail.aiModelsTab') }] : []),
  ];

  const copyAppId = (): void => {
    void navigator.clipboard?.writeText(entry.identity.appId).then(() => {
      setCopiedAppId(true);
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => setCopiedAppId(false), 1_600);
    }).catch(() => {
      // Clipboard is a convenience; a rejected write needs no surface.
    });
  };

  const menuItems: NimiMenuItem[] = [
    {
      id: 'properties',
      label: t('Apps.detail.propertiesTitle'),
      icon: <Settings className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => setPropertiesOpen(true),
    },
    ...(actionPlan.secondary.some((action) => action.id === 'stop') ? [{
      id: 'stop',
      label: t('Apps.action.stop'),
      icon: <Square className="h-4 w-4" aria-hidden="true" />,
      disabled: actionsDisabled,
      onSelect: () => onAction('stop'),
    }] : []),
    ...(hasAvailableCatalogUpdate(entry) ? [{
      id: 'update',
      label: t('Apps.update.toVersion', { version: entry.catalogTarget?.version }),
      icon: <Download className="h-4 w-4" aria-hidden="true" />,
      disabled: actionsDisabled || !canRequestCatalogUpdate(entry),
      onSelect: () => onAction('update'),
    }] : []),
    ...(release?.sourceClass === AppPackageSourceClass.USER_IMPORTED ? [{
      id: 'local-update',
      label: t('Apps.localImport.updateAction'),
      icon: <Download className="h-4 w-4" aria-hidden="true" />,
      disabled: actionsDisabled || !canRequestLocalPackageUpdate(entry),
      onSelect: () => onAction('update'),
    }] : []),
    ...(entry.packageJob?.cancelable ? [{
      id: 'cancel-job',
      label: t('Apps.action.cancel'),
      icon: <X className="h-4 w-4" aria-hidden="true" />,
      disabled: actionsDisabled,
      onSelect: () => onAction('cancel-job'),
    }] : []),
    {
      id: 'copy-app-id',
      label: copiedAppId ? t('Apps.detail.appIdCopied') : t('Apps.detail.copyAppId'),
      icon: copiedAppId
        ? <Check className="h-4 w-4" aria-hidden="true" />
        : <Copy className="h-4 w-4" aria-hidden="true" />,
      onSelect: copyAppId,
    },
    ...(canRequestUninstall(entry) ? [{
      id: 'uninstall',
      label: t('Apps.action.uninstall'),
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      tone: 'danger' as const,
      disabled: actionsDisabled,
      onSelect: () => setConfirmingUninstall(true),
    }] : []),
  ];

  const propertiesSections: AppsPropertiesSection[] = [
    {
      id: 'general',
      label: t('Apps.detail.generalSectionTitle'),
      rows: [
        { label: t('LocalDevelopment.field.app'), value: entry.identity.appId, mono: true },
        { label: t('Apps.detail.source'), value: t(appSourceForEntry(entry) === 'user_imported' ? 'Apps.sourceBadge.userImported' : 'Apps.sourceBadge.verified') },
        { label: t('Apps.detail.catalogVersion'), value: release?.version ?? catalog?.version ?? t('Apps.version.notInstalled'), mono: true },
      ],
    },
    ...(release || catalog ? [{
      id: 'technical',
      label: t('Apps.detail.technicalTitle'),
      rows: [
        ...(release ? [{ label: t('Apps.detail.releaseRef'), value: release.releaseRef, mono: true }] : []),
        ...(release
          ? (entry.appInfo ? [
            { label: t('Apps.catalog.capabilities'), value: entry.appInfo.capabilityContractRefs.join(', ') || t('Apps.catalog.none'), mono: true },
            { label: t('Apps.catalog.requiredFeatures'), value: entry.appInfo.requiredStandardizedFeatureRefs.join(', ') || t('Apps.catalog.none'), mono: true },
            { label: t('Apps.catalog.storage'), value: entry.appInfo.storagePolicyKind, mono: true },
            { label: t('Apps.catalog.storageDisclosures'), value: formatStorageDisclosures(entry.appInfo.osStorageDisclosure, t) || t('Apps.catalog.none'), mono: true },
          ] : [])
          : (catalog ? [
            { label: t('Apps.catalog.capabilities'), value: catalog.capabilityContractRefs.join(', ') || t('Apps.catalog.none'), mono: true },
            { label: t('Apps.catalog.requiredFeatures'), value: catalog.requiredStandardizedFeatureRefs.join(', ') || t('Apps.catalog.none'), mono: true },
            { label: t('Apps.catalog.storage'), value: catalog.storagePolicyKind, mono: true },
            { label: t('Apps.catalog.storageDisclosures'), value: formatStorageDisclosures(catalog.osStorageDisclosures, t) || t('Apps.catalog.none'), mono: true },
          ] : [])),
      ],
    }] : []),
    ...(catalog ? [{
      id: 'registry',
      label: t('Apps.detail.catalogTargetTitle'),
      rows: catalogRegistryFactRows(catalog, t),
    }] : []),
    ...(release ? [{
      id: 'update',
      label: t('Apps.detail.updateSectionTitle'),
      content: (
        <AppsUpdateSection
          entry={entry}
          readPackageInfo={readPackageInfo}
          onAction={onAction}
          actionsDisabled={actionsDisabled}
          actionPending={activeAction === 'update'}
        />
      ),
    }] : []),
    // The overview owns the README; installed Apps keep release notes and
    // license with the version facts in the 更新 pane. Without an installed
    // release that pane is absent, so the documents pane covers them here.
    ...(release ? [] : [{
      id: 'documents',
      label: t('Apps.detail.documentsSectionTitle'),
      content: <AppsDistributionDocuments info={entry.appInfo} error={entry.appInfoError} kinds={['releaseNotes', 'license']} />,
    }]),
  ];

  return (
    <div data-testid="apps-detail-body" data-installed-detail className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-5 pt-4 sm:px-7 sm:pt-5">
        <Button
          data-testid="apps-detail-back"
          tone="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 mb-3"
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('Apps.library.backToLibrary')}
        </Button>

        <div className="flex min-w-0 items-center gap-5">
          <AppArtworkIcon
            appId={entry.identity.appId}
            displayName={entry.identity.displayName}
            iconUrl={entry.iconUrl}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 data-testid="apps-detail-title" className="break-words text-2xl font-semibold leading-8 text-[color:var(--nimi-text-primary)]">
                {entry.identity.displayName}{appSourceForEntry(entry) === 'verified' ? (
                  <AppSourceBadge source="verified" description={t('Apps.sourceBadge.verifiedDescription')} className="ml-1.5 mt-1 align-top" />
                ) : null}
              </h1>
              {release && appRunVisualState(entry.run?.state ?? null) !== 'stopped' ? <AppRunStatusBadge entry={entry} /> : null}
              {release ? (
                <span className="text-sm text-[color:var(--nimi-text-secondary)]" data-testid="apps-installed-access">
                  {t(installedRun?.accessAvailable ? 'Apps.installedAccess.ready' : 'Apps.installedAccess.unavailable')}
                </span>
              ) : null}
            </div>
            {entry.summary ? (
              <p data-testid="apps-detail-summary" className="mt-1.5 break-words text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
                {entry.summary}
              </p>
            ) : null}
            {appSourceForEntry(entry) !== 'verified' ? (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <AppSourceBadge source={appSourceForEntry(entry)} variant="quiet" />
              </div>
            ) : null}
            {release || entry.packageJob ? (
              <AppPackageStatusLine entry={entry} showInstalledVersion={false} className="mt-1.5" />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canRequestCatalogInstall(entry) ? (
              <Button
                data-testid="apps-detail-install"
                tone="primary"
                loading={activeAction === 'install'}
                disabled={actionsDisabled}
                onClick={() => onAction('install')}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('Apps.action.install')}
              </Button>
            ) : actionPlan.primary ? (
              <Button
                data-testid="apps-installed-launch"
                tone="primary"
                loading={activeAction === 'launch'}
                disabled={actionsDisabled}
                onClick={() => onAction('launch')}
              >
                <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                {t(installedRun?.state === 'running' ? 'Apps.action.focus' : 'Apps.action.launch')}
              </Button>
            ) : null}
            <Popover>
              <PopoverTrigger asChild>
                <IconButton
                  data-testid="apps-detail-more"
                  icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                  tone="secondary"
                  aria-label={t('Apps.detail.moreActions')}
                  title={t('Apps.detail.moreActions')}
                />
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="p-1">
                <ActionMenu items={menuItems} ariaLabel={t('Apps.detail.moreActions')} />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {catalog?.policyBlocked ? (
          <InlineAlert tone="danger" className="mt-3" data-testid="apps-catalog-policy-blocked">
            {t('Apps.catalog.policyBlocked', {
              reason: catalog.policyReason ?? t('Apps.catalog.policyBlockedFallback'),
              revision: catalog.policyRevision,
            })}
          </InlineAlert>
        ) : null}
        {release && installedRun?.message ? <InlineAlert tone="danger" className="mt-3">{installedRun.message}</InlineAlert> : null}
        <NimiTabs
          className="mt-5"
          items={tabItems}
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as AppsDetailTab)}
          ariaLabel={t('Apps.detail.tabsLabel')}
        />
      </header>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-7">
          {actionError ? (
            <InlineAlert tone="danger" data-testid="apps-action-error" className="mb-5">
              {actionError}
            </InlineAlert>
          ) : null}
          {activeTab === 'overview' ? (
            <div role="tabpanel" id="apps-detail-panel-overview" aria-labelledby="apps-detail-tab-overview" tabIndex={0} className="space-y-7 outline-none">
              <AppsOverviewTab
                sourceEntries={sourceEntries}
                onOpenEntry={onOpenEntry}
                readme={readme}
                about={(
                  <AppsAboutSection
                    entry={entry}
                    developer={aboutDeveloper}
                    fact={null}
                    links={aboutLinks}
                    onOpenProperties={() => setPropertiesOpen(true)}
                  />
                )}
              />
            </div>
          ) : null}

          {activeTab === 'access' ? (
            <div role="tabpanel" id="apps-detail-panel-access" aria-labelledby="apps-detail-tab-access" tabIndex={0} className="space-y-7 outline-none">
              <AppsAccessTabSections
                appAccess={declaredAppAccess}
                aiModelsAvailable={aiModelsAvailable}
                runRequirementsDescription={t('Apps.detail.runRequirementsInstalledDescription')}
              />
            </div>
          ) : null}

          {activeTab === 'ai-models' && aiModelsAvailable ? (
            <div role="tabpanel" id="apps-detail-panel-ai-models" tabIndex={0}>
              <AppsAIConfigSection appId={entry.identity.appId} appDisplayName={entry.identity.displayName}
                allowedRoutes={['local', 'cloud']}
                declaredCapabilityRefs={entry.appInfo?.capabilityContractRefs ?? []}
                onAIConfigChanged={onAIConfigChanged} />
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <AppsPropertiesDialog
        open={propertiesOpen}
        appName={entry.identity.displayName}
        onClose={() => setPropertiesOpen(false)}
        sections={propertiesSections}
      />

      <ConfirmDialog
        open={confirmingUninstall}
        title={t('Apps.confirm.uninstall.title')}
        message={t('Apps.confirm.uninstall.message', { app: entry.identity.displayName })}
        confirmLabel={t('Apps.action.uninstall')}
        cancelLabel={t('Common.cancel')}
        confirmTone="danger"
        pending={activeAction === 'uninstall'}
        onConfirm={() => {
          setConfirmingUninstall(false);
          onAction('uninstall');
        }}
        onClose={() => setConfirmingUninstall(false)}
      />
    </div>
  );
}

const SOURCE_TILE_ICON = Object.freeze({
  local_development: Code2,
  user_imported: PackageOpen,
  verified: BadgeCheck,
} as const);

/**
 * Other sources of the same App, surfaced above the fold as one compact row
 * per source. Each row states what the source means for the user (a
 * downloadable Registry build, a registered local-development project, an
 * installed copy) and links to that source's own page; install, run, and
 * removal stay independent per source.
 */
function AppSourcesBanner({ entries, onOpenEntry, className = '' }: {
  readonly entries: readonly DesktopAppsEntry[];
  readonly onOpenEntry: (entryKey: string) => void;
  readonly className?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  return (
    <section
      data-testid="apps-other-sources"
      aria-label={t('Apps.detail.otherSourcesLabel')}
      className={`rounded-xl border border-[color:var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] px-3.5 py-2.5 ${className}`}
    >
      <ul className="space-y-2">
        {entries.map((sourceEntry) => {
          const source = appSourceForEntry(sourceEntry);
          const downloadable = source === 'verified' && !sourceEntry.committedRelease;
          const Icon = downloadable ? Download : SOURCE_TILE_ICON[source];
          const headlineKey = source === 'verified'
            ? (downloadable ? 'Apps.detail.otherSourcesDownloadTitle' : 'Apps.detail.otherSourcesRegistryInstalledTitle')
            : source === 'local_development'
              ? 'Apps.detail.otherSourcesLocalDevTitle'
              : 'Apps.detail.otherSourcesImportedTitle';
          const statusText = sourceEntry.committedRelease
            ? t('Apps.version.installed', { version: sourceEntry.committedRelease.version })
            : sourceEntry.localDevelopment
              ? sourceEntry.localDevelopment.canonicalProjectRoot
              : t('Apps.version.notInstalled');
          return (
            <li key={sourceEntry.identity.entryKey} className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5 text-[color:var(--nimi-text-primary)]">{t(headlineKey)}</p>
                <p className="truncate text-xs leading-4 text-[color:var(--nimi-text-secondary)]">{statusText}</p>
              </div>
              <Button
                tone="secondary"
                size="sm"
                className="shrink-0"
                data-testid={`apps-source-entry-${sourceEntry.identity.entryKey}`}
                onClick={() => onOpenEntry(sourceEntry.identity.entryKey)}
              >
                {t('Apps.detail.viewSource')}
                <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Overview tab layout shared by every App source: the cross-source banner
 * spans the full width; on wide windows the about band moves into a
 * right-hand rail so the README can use the remaining width instead of
 * leaving the side of the page empty. Below that breakpoint the bands stack
 * in the original order.
 */
function AppsOverviewTab({ sourceEntries, onOpenEntry, about, readme }: {
  readonly sourceEntries: readonly DesktopAppsEntry[];
  readonly onOpenEntry: (entryKey: string) => void;
  readonly about: ReactNode;
  readonly readme: ProjectReadmeState;
}): ReactElement {
  const hasReadme = readme.status !== 'loaded' || Boolean(readme.content);
  return (
    <>
      <AppSourcesBanner entries={sourceEntries} onOpenEntry={onOpenEntry} />
      {hasReadme ? (
        <div className="flex flex-col gap-7 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] xl:items-start">
          <div className="min-w-0 xl:order-2">{about}</div>
          <div className="min-w-0 xl:order-1">
            <AppsReadmeSection readme={readme} />
          </div>
        </div>
      ) : about}
    </>
  );
}

/**
 * About band shared by every App source: the source story plus a compact
 * facts strip. Deep diagnostics stay in the properties dialog behind
 * "more info".
 */
function AppsAboutSection({ entry, developer, fact, fallbackSummary = null, links = [], onOpenProperties }: {
  readonly entry: DesktopAppsEntry;
  readonly developer: string | null;
  readonly fact: { readonly label: string; readonly value: string } | null;
  readonly fallbackSummary?: string | null;
  readonly links?: readonly { readonly label: string; readonly url: string }[];
  readonly onOpenProperties: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { identity } = entry;
  const version = entry.localDevelopment
    ? null
    : entry.committedRelease?.version?.trim() || entry.catalogTarget?.version?.trim();
  // Catalog and package info expose no creation or publication dates.
  // A local installation commit is not the App's online update date.
  const facts = [
    ...(developer ? [{ label: t('Apps.detail.developer'), value: developer }] : []),
    ...(version ? [{ label: t('Apps.detail.catalogVersion'), value: version }] : []),
    ...(fact ? [fact] : []),
  ];
  return (
    <section
      data-testid="apps-about-section"
      aria-label={t('Apps.detail.aboutAppTitle', { name: identity.displayName })}
    >
      <h2 className="text-lg font-semibold text-[color:var(--nimi-text-primary)]">
        {t('Apps.detail.aboutAppTitle', { name: identity.displayName })}
      </h2>
      {entry.summary || !fallbackSummary ? null : (
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
          {fallbackSummary}
        </p>
      )}
      <div className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_38%,transparent)] px-5 py-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
          {facts.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-xs leading-4 text-[color:var(--nimi-text-muted)]">{item.label}</dt>
              <dd className="mt-1 break-words text-sm font-medium leading-5 text-[color:var(--nimi-text-primary)]">{item.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-center">
          <Button
            tone="ghost"
            size="sm"
            className="-ml-2"
            data-testid="apps-about-more"
            onClick={onOpenProperties}
          >
            {t('Apps.detail.moreInfo')}
            <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {links.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          {links.map((link, index) => {
            const href = readmeExternalHref(link.url);
            if (!href) return null;
            return (
              <span key={link.url} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true" className="text-[color:var(--nimi-text-muted)]">·</span> : null}
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-[var(--nimi-action-primary-bg)] underline decoration-[color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,transparent)] underline-offset-2 hover:decoration-current"
                  onClick={(event) => {
                    event.preventDefault();
                    void openExternalUrl(href).catch(() => undefined);
                  }}
                >
                  {link.label}
                </a>
              </span>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/**
 * README document band shared by every App source. Local-development Apps
 * read the project README through the host bridge; installed and Registry
 * Apps read the portable README from the package info.
 */
function AppsReadmeSection({ readme }: { readonly readme: ProjectReadmeState }): ReactElement | null {
  const { t } = useTranslation();
  if (readme.status === 'loaded' && !readme.content) return null;
  return (
    <section data-testid="apps-documents-section">
      <div>
        {readme.status === 'loading' ? (
          <div data-testid="apps-readme-loading" aria-label={t('Apps.loading')} className="space-y-3">
            <div className="h-6 w-1/3 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
            <div className="h-4 w-full animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
          </div>
        ) : readme.status === 'error' ? (
          <InlineAlert tone="warning" data-testid="apps-readme-error">{t('Apps.detail.readmeError')}</InlineAlert>
        ) : readme.status === 'loaded' && readme.content ? (
          <div data-testid="apps-readme" className="max-w-3xl">
            {readme.truncated ? <InlineAlert tone="info" className="mb-3">{t('Apps.detail.readmeTruncated')}</InlineAlert> : null}
            <AppsReadmeMarkdown content={readme.content} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Nimi Access tab shared by every App source: the declared App Access
 * domains plus the run-requirements notes. Local-development Apps pass
 * their registration declaration; installed and Registry Apps pass the
 * release or catalog declaration.
 */
function AppsAccessTabSections({ appAccess, aiModelsAvailable, runRequirementsDescription }: {
  readonly appAccess: readonly string[];
  readonly aiModelsAvailable: boolean;
  readonly runRequirementsDescription: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <DetailSection title={t('Apps.detail.accessTitle')} description={t('Apps.detail.accessDescription')}>
        <InlineAlert
          tone="info"
          icon={<Info className="h-4 w-4" aria-hidden="true" />}
          className="mt-4 max-w-3xl"
        >
          {t('Apps.detail.accessDeclarationNote')}
        </InlineAlert>

        <div data-testid="apps-detail-app-access" className="mt-4">
          {appAccess.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--nimi-border-subtle)] px-5 py-8 text-center">
              <ShieldCheck className="mx-auto h-7 w-7 text-[var(--nimi-status-success)]" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.detail.noAccessTitle')}</h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{t('Apps.detail.noAccessDescription')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--nimi-border-subtle)] rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,transparent)]">
              {appAccess.map((domain) => {
                const copyKey = APP_ACCESS_COPY_KEYS[domain as keyof typeof APP_ACCESS_COPY_KEYS];
                const Icon = (copyKey
                  ? APP_ACCESS_FEATURE_ICON[domain as keyof typeof APP_ACCESS_FEATURE_ICON]
                  : undefined) ?? ShieldQuestion;
                return (
                  <li key={domain} data-app-access={domain} className="flex items-start gap-3 px-5 py-4">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <h3 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">
                          {copyKey ? t(`Apps.accessDomain.${copyKey}.label`) : t('Apps.accessDomain.unknown.label')}
                        </h3>
                        <code className="rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_68%,transparent)] px-1.5 py-0.5 font-mono text-[11px] leading-4 text-[color:var(--nimi-text-muted)]">{domain}</code>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
                        {copyKey ? t(`Apps.accessDomain.${copyKey}.description`) : t('Apps.accessDomain.unknown.description')}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DetailSection>

      <DetailSection title={t('Apps.detail.runRequirementsTitle')}>
        <ul className="mt-4 max-w-3xl divide-y divide-[color:var(--nimi-border-subtle)] rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,transparent)]">
          <li className="flex items-start gap-3 px-5 py-4">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)] text-[color:var(--nimi-text-muted)]">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="min-w-0 self-center text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
              {runRequirementsDescription}
            </p>
          </li>
          {aiModelsAvailable ? (
            <li className="flex items-start gap-3 px-5 py-4">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)] text-[color:var(--nimi-text-muted)]">
                <Bot className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="min-w-0 self-center text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
                {t('Apps.detail.runRequirementsAiNote')}
              </p>
            </li>
          ) : null}
        </ul>
      </DetailSection>
    </>
  );
}

function DetailSection({ title, description, children }: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section>
      <h2 className="text-lg font-semibold text-[color:var(--nimi-text-primary)]">{title}</h2>
      {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{description}</p> : null}
      {children}
    </section>
  );
}

type AppsCatalogTargetFacts = NonNullable<DesktopAppsEntry['catalogTarget']>;

function catalogNativePosture(catalog: AppsCatalogTargetFacts, t: TFunction): string {
  if (catalog.os === 'macos') {
    const subject = catalog.observedSigningSubject || t('Apps.catalog.macosUnsigned');
    const notarization = t(catalog.macosNotarization === 'notarized'
      ? 'Apps.catalog.macosNotarized'
      : catalog.macosNotarization === 'absent'
        ? 'Apps.catalog.macosNotarizationAbsent'
        : 'Apps.catalog.macosNotarizationUnknown');
    return `${subject} · ${notarization}`;
  }
  return catalog.observedSigningSubject
    ? `${catalog.windowsCodeSigning} · ${catalog.observedSigningSubject}`
    : catalog.windowsCodeSigning;
}

/** Publishing and provenance facts of one Registry target, shown as the 线上版本 section of the properties dialog for installed and not-yet-installed Registry Apps alike. */
function catalogRegistryFactRows(catalog: AppsCatalogTargetFacts, t: TFunction): AppsPropertiesRow[] {
  return [
    { label: t('Apps.detail.catalogVersion'), value: catalog.version, mono: true },
    { label: t('Apps.catalog.publisher'), value: `@${catalog.publisherGithubNamespace}`, mono: true },
    { label: t('Apps.catalog.sourceRepository'), value: catalog.sourceRepository, mono: true },
    { label: t('Apps.catalog.license'), value: catalog.sourceLicenseSpdxExpression, mono: true },
    { label: t('Apps.catalog.nativePosture'), value: catalogNativePosture(catalog, t), mono: true },
    { label: t('Apps.catalog.target'), value: `${catalog.targetId} · ${catalog.os}/${catalog.arch}`, mono: true },
    { label: t('Apps.catalog.asset'), value: `${catalog.assetName} · ${catalog.assetSize} bytes`, mono: true },
    { label: t('Apps.catalog.executionProfile'), value: catalog.executionProfileRef, mono: true },
  ];
}

function formatStorageDisclosures(disclosures: readonly { pathPattern: string; purpose: string; expectedSizeBand: string }[], t: TFunction): string {
  return disclosures.map((disclosure) => (
    `${disclosure.pathPattern}: ${disclosure.purpose}; ${t('Apps.detail.expectedStorageSize')}: ${disclosure.expectedSizeBand}`
  )).join(' · ');
}

function formatTimestamp(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function formatDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
  }).format(new Date(timestamp));
}
