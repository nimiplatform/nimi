import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiDesktopOpenAppsSection } from '@nimiplatform/kit/core/desktop-open';
import type { NimiAIConfigOverwriteResult } from '@nimiplatform/kit/core/sdk-contract';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  Download,
  FolderOpen,
  Info,
  MoreHorizontal,
  Play,
  ShieldCheck,
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
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import {
  actionPlanForEntry,
  canRequestCatalogInstall,
  canRequestUninstall,
  type AppCardActionId,
} from './apps-card-actions.js';
import { appRunVisualState, appSourceForEntry } from './apps-card-fields.js';
import { AppArtworkIcon, AppPackageStatusLine, AppRunStatusBadge, AppSourceBadge } from './apps-card-visuals.js';
import { AppsReadmeMarkdown } from './apps-readme-markdown.js';
import { createDesktopAppsLiveBridge } from './apps-live-bridge.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001
// @nimi-authority: rule.nimi.desktop.shell-ui.r061

type AppsDetailTab = 'overview' | 'access' | 'ai-models' | 'developer';

const APP_ACCESS_COPY_KEYS = Object.freeze({
  'realm.data': 'realmData',
  'runtime.consume': 'runtimeConsume',
  'agent.local': 'agentLocal',
  'agent.configure': 'agentConfigure',
} as const);

type ProjectReadmeState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly content: string | null }
  | { readonly status: 'error' };

export interface AppsDetailViewProps {
  readonly entry: DesktopAppsEntry;
  readonly requestedSection: NimiDesktopOpenAppsSection | null;
  readonly requestedNavigationRevision: number;
  readonly onBack: () => void;
  readonly onAction: (action: AppCardActionId) => void;
  readonly activeAction: AppCardActionId | null;
  readonly actionError: string | null;
  readonly onAIConfigChanged: (result: NimiAIConfigOverwriteResult) => void;
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
  requestedSection,
  requestedNavigationRevision,
  onBack,
  onAction,
  activeAction,
  actionError,
  onAIConfigChanged,
}: AppsDetailViewProps): ReactElement {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<AppsDetailTab>('overview');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
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
        if (alive) setReadme({ status: 'loaded', content: result.content });
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
    actionPlan.primary?.id === 'stop'
      ? {
        id: 'stop',
        label: t('Apps.action.stop'),
        icon: <Square className="h-4 w-4" aria-hidden="true" />,
        disabled: activeAction !== null,
        onSelect: () => onAction('stop'),
      }
      : {
        id: 'launch',
        label: t('Apps.action.launch'),
        icon: <Play className="h-4 w-4" aria-hidden="true" />,
        disabled: activeAction !== null,
        onSelect: () => onAction('launch'),
      },
    ...(actionPlan.secondary.some((action) => action.id === 'cancel-job') ? [{
      id: 'cancel-job',
      label: t('Apps.action.cancel'),
      icon: <X className="h-4 w-4" aria-hidden="true" />,
      disabled: activeAction !== null,
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
      disabled: activeAction !== null,
      onSelect: () => setConfirmingRemove(true),
    },
  ];

  const tabItems = [
    { value: 'overview', label: t('Apps.detail.overviewTab') },
    { value: 'access', label: t('Apps.detail.accessTab') },
    ...(aiModelsAvailable ? [{ value: 'ai-models', label: t('Apps.detail.aiModelsTab') }] : []),
    { value: 'developer', label: t('Apps.detail.developerTab') },
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

        <div className="flex min-w-0 items-start gap-4">
          <AppArtworkIcon
            appId={identity.appId}
            displayName={identity.displayName}
            iconUrl={entry.iconUrl}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 data-testid="apps-detail-title" className="break-words text-2xl font-semibold leading-8 text-[color:var(--nimi-text-primary)]">
                {identity.displayName}
              </h1>
              <AppRunStatusBadge entry={entry} />
              <AppSourceBadge source={appSourceForEntry(entry)} className="px-2 py-1 text-xs" />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {actionPlan.primary?.id === 'stop' ? (
                <Button
                  data-testid="apps-detail-stop"
                  tone="secondary"
                  size="sm"
                  loading={activeAction === 'stop'}
                  disabled={activeAction !== null}
                  onClick={() => onAction('stop')}
                >
                  <Square className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  {t('Apps.action.stop')}
                </Button>
              ) : (
                <Button
                  data-testid="apps-detail-launch"
                  tone="primary"
                  size="sm"
                  loading={activeAction === 'launch'}
                  disabled={activeAction !== null}
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
                    size="sm"
                    aria-label={t('Apps.detail.moreActions')}
                    title={t('Apps.detail.moreActions')}
                  />
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={6} className="p-1">
                  <ActionMenu items={menuItems} ariaLabel={t('Apps.detail.moreActions')} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="mt-2.5">
              <AppPackageStatusLine entry={entry} />
            </div>
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
            <div role="tabpanel" id="apps-detail-panel-overview" aria-labelledby="apps-detail-tab-overview" tabIndex={0} className="outline-none">
              {readme.status === 'loading' ? (
                <div data-testid="apps-readme-loading" aria-label={t('Apps.loading')} className="max-w-3xl space-y-3 rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,transparent)] p-5 sm:p-6">
                  <div className="h-6 w-1/3 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
                  <div className="h-4 w-full animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
                </div>
              ) : readme.status === 'loaded' && readme.content ? (
                <section data-testid="apps-readme" className="max-w-3xl rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,transparent)] p-5 sm:p-6">
                  <AppsReadmeMarkdown content={readme.content} />
                </section>
              ) : (
                <div className="max-w-3xl space-y-4">
                  <div data-testid="apps-readme-empty" className="rounded-xl border border-dashed border-[color:var(--nimi-border-subtle)] px-5 py-8 text-center">
                    <BookOpen className="mx-auto h-7 w-7 text-[var(--nimi-text-muted)]" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.detail.readmeEmptyTitle')}</h3>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{t('Apps.detail.readmeEmptyDescription')}</p>
                  </div>
                  <OverviewCard title={t('Apps.detail.aboutTitle')}>
                    <div className="divide-y divide-[color:var(--nimi-border-subtle)]">
                      <div className="flex items-center justify-between gap-3 py-2">
                        <span className="shrink-0 text-xs text-[color:var(--nimi-text-muted)]">{t('Apps.detail.source')}</span>
                        <AppSourceBadge source={appSourceForEntry(entry)} />
                      </div>
                      <CardRow label={t('Apps.detail.registeredAt')} value={registeredAt} />
                      <CardRow label={t('Apps.detail.lastUpdated')} value={updatedAt} />
                    </div>
                  </OverviewCard>
                </div>
              )}
            </div>
          ) : null}

          {activeTab === 'access' ? (
            <div role="tabpanel" id="apps-detail-panel-access" aria-labelledby="apps-detail-tab-access" tabIndex={0} className="space-y-7 outline-none">
              <DetailSection title={t('Apps.detail.accessTitle')} description={t('Apps.detail.accessDescription')}>
                <div className="mt-4 flex items-start gap-3 rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)] p-4">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
                  <p className="text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{t('Apps.detail.accessDeclarationNote')}</p>
                </div>

                <div data-testid="apps-detail-app-access" className="mt-4">
                  {registration.appAccess.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[color:var(--nimi-border-subtle)] px-5 py-8 text-center">
                      <ShieldCheck className="mx-auto h-7 w-7 text-[var(--nimi-status-success)]" aria-hidden="true" />
                      <h3 className="mt-3 text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.detail.noAccessTitle')}</h3>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{t('Apps.detail.noAccessDescription')}</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-[color:var(--nimi-border-subtle)] border-y border-[color:var(--nimi-border-subtle)]">
                      {registration.appAccess.map((domain) => {
                        const copyKey = APP_ACCESS_COPY_KEYS[domain as keyof typeof APP_ACCESS_COPY_KEYS];
                        return (
                          <li key={domain} data-app-access={domain} className="flex items-start gap-3 py-4">
                            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
                              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">
                                {copyKey ? t(`Apps.accessDomain.${copyKey}.label`) : t('Apps.accessDomain.unknown.label')}
                              </h3>
                              <p className="mt-1 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
                                {copyKey ? t(`Apps.accessDomain.${copyKey}.description`) : t('Apps.accessDomain.unknown.description')}
                              </p>
                              <code className="mt-2 inline-flex rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_68%,transparent)] px-2 py-1 text-xs text-[color:var(--nimi-text-muted)]">{domain}</code>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </DetailSection>
            </div>
          ) : null}

          {activeTab === 'ai-models' && aiModelsAvailable ? (
            <div role="tabpanel" id="apps-detail-panel-ai-models" aria-labelledby="apps-detail-tab-ai-models" tabIndex={0} className="outline-none">
              <AppsAIConfigSection
                appId={identity.appId}
                appDisplayName={identity.displayName}
                allowedRoutes={registration.aiConfigAllowedRoutes}
                onAIConfigChanged={onAIConfigChanged}
              />
            </div>
          ) : null}

          {activeTab === 'developer' ? (
            <div role="tabpanel" id="apps-detail-panel-developer" aria-labelledby="apps-detail-tab-developer" tabIndex={0} className="space-y-7 outline-none">
              <DetailSection title={t('Apps.detail.developerInfoTitle')} description={t('Apps.detail.developerInfoDescription')}>
                <dl className="mt-4 divide-y divide-[color:var(--nimi-border-subtle)] border-y border-[color:var(--nimi-border-subtle)]">
                  <DetailRow label={t('LocalDevelopment.field.app')} value={identity.appId} mono />
                  <DetailRow label={t('LocalDevelopment.field.projectRoot')} value={registration.canonicalProjectRoot} icon={<FolderOpen className="h-4 w-4" />} mono />
                  <DetailRow label={t('LocalDevelopment.field.shell')} value={shellLabel} />
                  <DetailRow label={t('LocalDevelopment.field.sourceGeneration')} value={String(registration.sourceGeneration)} mono />
                  <DetailRow label={t('LocalDevelopment.field.declarationGeneration')} value={String(registration.declarationGeneration)} mono />
                  <DetailRow label={t('Apps.detail.registeredAt')} value={registeredAt} />
                  <DetailRow label={t('Apps.detail.lastUpdated')} value={updatedAt} />
                </dl>
              </DetailSection>

              <DetailSection title={t('Apps.detail.runCardTitle')} description={t('Apps.detail.runDiagnosticsDescription')}>
                <dl className="mt-4 divide-y divide-[color:var(--nimi-border-subtle)] border-y border-[color:var(--nimi-border-subtle)]">
                  <DetailRow label={t('Apps.detail.runState')} value={t(`Apps.runState.${appRunVisualState(entry.run?.state ?? null)}`)} />
                  {entry.run?.message ? (
                    <DetailRow label={t('Apps.detail.runMessage')} value={entry.run.message} />
                  ) : null}
                  {entry.run?.reasonCode ? (
                    <DetailRow label={t('Apps.detail.runReasonCode')} value={entry.run.reasonCode} mono />
                  ) : null}
                </dl>
              </DetailSection>
            </div>
          ) : null}
        </div>
      </ScrollArea>

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
  onBack,
  onAction,
  activeAction,
  actionError,
}: AppsDetailViewProps): ReactElement {
  const { t } = useTranslation();
  const release = entry.committedRelease;
  const catalog = entry.catalogTarget;
  const installedRun = entry.run && 'accessAvailable' in entry.run ? entry.run : null;
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);

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

        <div className="flex min-w-0 items-start gap-4">
          <AppArtworkIcon
            appId={entry.identity.appId}
            displayName={entry.identity.displayName}
            iconUrl={entry.iconUrl}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 data-testid="apps-detail-title" className="break-words text-2xl font-semibold leading-8 text-[color:var(--nimi-text-primary)]">
                {entry.identity.displayName}
              </h1>
              <AppSourceBadge source={appSourceForEntry(entry)} className="px-2 py-1 text-xs" />
            </div>
            <p className="mt-2 font-mono text-xs text-[color:var(--nimi-text-muted)]">
              {entry.identity.appId}
            </p>
            <div className="mt-2.5">
              <AppPackageStatusLine entry={entry} />
            </div>
            {catalog?.policyBlocked ? (
              <InlineAlert tone="danger" className="mt-3" data-testid="apps-catalog-policy-blocked">
                {t('Apps.catalog.policyBlocked', {
                  reason: catalog.policyReason ?? t('Apps.catalog.policyBlockedFallback'),
                  revision: catalog.policyRevision,
                })}
              </InlineAlert>
            ) : catalog ? (
              <InlineAlert tone="info" className="mt-3" data-testid="apps-catalog-approved">
                {t('Apps.catalog.registryApproved')}
              </InlineAlert>
            ) : null}
            {release ? (
              <div className="mt-3 space-y-3" data-testid="apps-installed-run">
                <div className="flex flex-wrap items-center gap-3">
                  <AppRunStatusBadge entry={entry} />
                  <span className="text-sm" data-testid="apps-installed-access">
                    {t(installedRun?.accessAvailable ? 'Apps.installedAccess.ready' : 'Apps.installedAccess.unavailable')}
                  </span>
                </div>
                {installedRun?.message ? <InlineAlert tone="danger">{installedRun.message}</InlineAlert> : null}
                <div className="flex gap-2">
                  {actionPlanForEntry(entry).primary ? (
                    <Button tone="primary" size="sm" data-testid="apps-installed-launch"
                      loading={activeAction === 'launch'} disabled={activeAction !== null} onClick={() => onAction('launch')}>
                      {t(installedRun?.state === 'running' ? 'Apps.action.focus' : 'Apps.action.launch')}
                    </Button>
                  ) : null}
                  {installedRun?.state === 'running' ? (
                    <Button tone="secondary" size="sm" data-testid="apps-installed-stop"
                      loading={activeAction === 'stop'} disabled={activeAction !== null} onClick={() => onAction('stop')}>
                      {t('Apps.action.stop')}
                    </Button>
                  ) : null}
                  {canRequestUninstall(entry) ? (
                    <Button tone="danger" size="sm" data-testid="apps-installed-uninstall" disabled={activeAction !== null}
                      loading={activeAction === 'uninstall'} onClick={() => setConfirmingUninstall(true)}>
                      {t('Apps.action.uninstall')}
                    </Button>
                  ) : null}
                </div>
                <ConfirmDialog open={confirmingUninstall} title={t('Apps.confirm.uninstall.title')}
                  message={t('Apps.confirm.uninstall.message', { app: entry.identity.displayName })}
                  confirmLabel={t('Apps.action.uninstall')} cancelLabel={t('Common.cancel')} confirmTone="danger"
                  pending={activeAction === 'uninstall'} onClose={() => setConfirmingUninstall(false)}
                  onConfirm={() => { setConfirmingUninstall(false); onAction('uninstall'); }} />
              </div>
            ) : null}
            {canRequestCatalogInstall(entry) ? (
              <Button
                data-testid="apps-detail-install"
                tone="primary"
                size="sm"
                className="mt-3"
                loading={activeAction === 'install'}
                disabled={activeAction !== null}
                onClick={() => onAction('install')}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('Apps.action.install')}
              </Button>
            ) : null}
            {entry.packageJob?.cancelable ? (
              <Button
                data-testid="apps-detail-cancel-job"
                tone="secondary"
                size="sm"
                className="mt-3"
                loading={activeAction === 'cancel-job'}
                disabled={activeAction !== null}
                onClick={() => onAction('cancel-job')}
              >
                <X className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('Apps.action.cancel')}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-7">
          {actionError ? (
            <InlineAlert tone="danger" data-testid="apps-action-error" className="mb-5">
              {actionError}
            </InlineAlert>
          ) : null}
          <OverviewCard title={t('Apps.detail.aboutTitle')}>
            <dl className="divide-y divide-[color:var(--nimi-border-subtle)]">
              <DetailRow label={t('LocalDevelopment.field.app')} value={entry.identity.appId} mono />
              <DetailRow label={t('Apps.detail.source')} value={t('Apps.sourceBadge.verified')} />
              <DetailRow label={t('Apps.detail.catalogVersion', { defaultValue: 'Version' })} value={release?.version ?? catalog?.version ?? t('Apps.version.notInstalled')} mono />
              {release ? <DetailRow label={t('Apps.detail.releaseRef', { defaultValue: 'Release reference' })} value={release.releaseRef} mono /> : null}
              {catalog ? (
                <>
                  <DetailRow label={t('Apps.catalog.publisher')} value={`@${catalog.publisherGithubNamespace}`} mono />
                  <DetailRow label={t('Apps.catalog.sourceRepository')} value={catalog.sourceRepository} mono />
                  <DetailRow label={t('Apps.catalog.license')} value={catalog.sourceLicenseSpdxExpression} mono />
                  <DetailRow label={t('Apps.catalog.target')} value={`${catalog.targetId} · ${catalog.os}/${catalog.arch}`} mono />
                  <DetailRow label={t('Apps.catalog.asset')} value={`${catalog.assetName} · ${catalog.assetSize} bytes`} mono />
                  <DetailRow label={t('Apps.catalog.nativePosture')} value={catalog.observedSigningSubject ? `${catalog.windowsCodeSigning} · ${catalog.observedSigningSubject}` : catalog.windowsCodeSigning} mono />
                  <DetailRow label={t('Apps.catalog.executionProfile')} value={catalog.executionProfileRef} mono />
                  <DetailRow label={t('Apps.catalog.appAccess')} value={catalog.appAccess.join(', ') || t('Apps.catalog.none')} mono />
                  <DetailRow label={t('Apps.catalog.capabilities')} value={catalog.capabilityContractRefs.join(', ') || t('Apps.catalog.none')} mono />
                  <DetailRow label={t('Apps.catalog.requiredFeatures')} value={catalog.requiredStandardizedFeatureRefs.join(', ') || t('Apps.catalog.none')} mono />
                  <DetailRow label={t('Apps.catalog.storage')} value={catalog.storagePolicyKind} mono />
                  <DetailRow
                    label={t('Apps.catalog.storageDisclosures')}
                    value={catalog.osStorageDisclosures.map((disclosure) => (
                      `${disclosure.pathPattern}: ${disclosure.purpose}; ${disclosure.retention}; ${disclosure.removal}`
                    )).join(' · ') || t('Apps.catalog.none')}
                    mono
                  />
                </>
              ) : null}
            </dl>
          </OverviewCard>
        </div>
      </ScrollArea>
    </div>
  );
}

function OverviewCard({ title, children }: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,transparent)] p-4">
      <h2 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{title}</h2>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </section>
  );
}

function CardRow({ label, value }: {
  readonly label: string;
  readonly value: string;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="shrink-0 text-xs text-[color:var(--nimi-text-muted)]">{label}</span>
      <span className="min-w-0 truncate text-sm text-[color:var(--nimi-text-primary)]">{value}</span>
    </div>
  );
}

function DetailSection({ title, description, children }: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section>
      <h2 className="text-lg font-semibold text-[color:var(--nimi-text-primary)]">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{description}</p>
      {children}
    </section>
  );
}

function DetailRow({ label, value, icon, mono = false }: {
  readonly label: string;
  readonly value: string;
  readonly icon?: ReactNode;
  readonly mono?: boolean;
}): ReactElement {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[minmax(140px,0.34fr)_minmax(0,1fr)] sm:items-start sm:gap-5">
      <dt className="flex items-center gap-2 text-sm text-[color:var(--nimi-text-muted)]">
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        {label}
      </dt>
      <dd className={`min-w-0 break-words text-sm text-[color:var(--nimi-text-primary)] sm:text-right ${mono ? 'font-mono text-xs leading-6' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function formatTimestamp(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
