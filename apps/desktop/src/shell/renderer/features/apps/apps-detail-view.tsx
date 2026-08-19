import { useEffect, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Code2,
  FolderOpen,
  Info,
  Play,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import { Button, ScrollArea, StatusBadge } from '@nimiplatform/kit/ui';
import {
  AppsAIConfigSection,
  appsAIConfigCapabilityContracts,
} from './apps-ai-config-section.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import {
  actionPlanForLocalDevelopmentEntry,
  type AppCardActionId,
} from './apps-card-actions.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001

type AppsDetailTab = 'overview' | 'access' | 'developer';

const APP_ACCESS_COPY_KEYS = Object.freeze({
  'realm.data': 'realmData',
  'runtime.consume': 'runtimeConsume',
  'agent.local': 'agentLocal',
  'agent.configure': 'agentConfigure',
} as const);

export interface AppsDetailViewProps {
  readonly entry: DesktopAppsEntry;
  readonly onBack: () => void;
  readonly onAction: (action: AppCardActionId) => void;
  readonly activeAction: AppCardActionId | null;
}

export function AppsDetailView({ entry, onBack, onAction, activeAction }: AppsDetailViewProps): ReactElement {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<AppsDetailTab>('overview');
  const { registration } = entry;
  const aiConfigCapabilityContracts = appsAIConfigCapabilityContracts(registration.appAccess);
  const actionPlan = actionPlanForLocalDevelopmentEntry(entry.run?.state ?? null);
  const runState = entry.run?.state ?? 'stopped';

  useEffect(() => setActiveTab('overview'), [registration.appId]);

  const registeredAt = formatTimestamp(registration.registeredAtUnixMs, i18n.language);
  const updatedAt = formatTimestamp(registration.updatedAtUnixMs, i18n.language);

  return (
    <div data-testid="apps-detail-body" className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-[color:var(--nimi-border-subtle)] px-5 pt-5 sm:px-7 sm:pt-6">
        <Button tone="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2 lg:hidden">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('Apps.detail.backToApps')}
        </Button>

        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,var(--nimi-surface-active))] text-[var(--nimi-action-primary-bg)]">
              <Box className="h-7 w-7" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 data-testid="apps-detail-title" className="break-words text-2xl font-semibold leading-8 text-[color:var(--nimi-text-primary)]">
                  {registration.displayName}
                </h1>
                <StatusBadge tone="success">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {runState === 'running' ? t('Apps.runState.running') : t('Apps.card.registered')}
                </StatusBadge>
              </div>
              <p className="mt-1 text-sm text-[color:var(--nimi-text-muted)]">
                {t('Apps.card.local')} · {t(`LocalDevelopment.shell.${registration.shell}`, { defaultValue: registration.shell })}
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
                {t('Apps.detail.localSummary')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actionPlan.primary?.id === 'launch' ? (
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
            ) : (
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
            )}
            <Button
              data-testid="apps-detail-remove"
              tone="ghost"
              size="sm"
              loading={activeAction === 'remove'}
              disabled={activeAction !== null}
              onClick={() => {
                if (window.confirm(t('Apps.confirm.removeDevelopment.message', { app: registration.displayName }))) {
                  onAction('remove');
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('Apps.action.removeDevelopment')}
            </Button>
          </div>
        </div>

        <div role="tablist" aria-label={t('Apps.detail.tabsLabel')} className="mt-5 flex min-w-0 gap-1 overflow-x-auto">
          <DetailTabButton id="overview" activeTab={activeTab} onSelect={setActiveTab} label={t('Apps.detail.overviewTab')} />
          <DetailTabButton id="access" activeTab={activeTab} onSelect={setActiveTab} label={t('Apps.detail.accessTab')} />
          <DetailTabButton id="developer" activeTab={activeTab} onSelect={setActiveTab} label={t('Apps.detail.developerTab')} />
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent" contentClassName="mx-auto w-full max-w-5xl px-5 py-6 sm:px-7 sm:py-7">
        {activeTab === 'overview' ? (
          <div role="tabpanel" id="apps-detail-panel-overview" aria-labelledby="apps-detail-tab-overview" tabIndex={0} className="space-y-7 outline-none">
            <DetailSection title={t('Apps.detail.aboutTitle')} description={t('Apps.detail.aboutDescription')}>
              <dl className="mt-4 divide-y divide-[color:var(--nimi-border-subtle)] border-y border-[color:var(--nimi-border-subtle)]">
                <DetailRow label={t('Apps.detail.registrationState')} value={t('Apps.card.registered')} icon={<CheckCircle2 className="h-4 w-4 text-[var(--nimi-status-success)]" />} />
                <DetailRow label={t('Apps.detail.runState')} value={t(`Apps.runState.${runState === 'running' ? 'running' : runState === 'stopped' ? 'stopped' : 'starting'}`)} icon={runState === 'running' ? <CheckCircle2 className="h-4 w-4 text-[var(--nimi-status-success)]" /> : <Play className="h-4 w-4" />} />
                <DetailRow label={t('Apps.detail.source')} value={t('Apps.card.local')} icon={<Code2 className="h-4 w-4" />} />
                <DetailRow label={t('Apps.detail.hostShell')} value={t(`LocalDevelopment.shell.${registration.shell}`, { defaultValue: registration.shell })} icon={<Box className="h-4 w-4" />} />
                <DetailRow label={t('Apps.detail.lastUpdated')} value={updatedAt} />
              </dl>
            </DetailSection>

            <div className="flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_7%,transparent)] p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.detail.currentScopeTitle')}</h2>
                <p className="mt-1 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{t('Apps.detail.currentScopeDescription')}</p>
              </div>
            </div>
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

            {aiConfigCapabilityContracts.length > 0 ? (
              <div className="border-t border-[var(--nimi-border-subtle)] pt-6">
                <AppsAIConfigSection
                  appId={registration.appId}
                  appDisplayName={registration.displayName}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'developer' ? (
          <div role="tabpanel" id="apps-detail-panel-developer" aria-labelledby="apps-detail-tab-developer" tabIndex={0} className="space-y-7 outline-none">
            <DetailSection title={t('Apps.detail.developerInfoTitle')} description={t('Apps.detail.developerInfoDescription')}>
              <dl className="mt-4 divide-y divide-[color:var(--nimi-border-subtle)] border-y border-[color:var(--nimi-border-subtle)]">
                <DetailRow label={t('LocalDevelopment.field.app')} value={registration.appId} mono />
                <DetailRow label={t('LocalDevelopment.field.projectRoot')} value={registration.canonicalProjectRoot} icon={<FolderOpen className="h-4 w-4" />} mono />
                <DetailRow label={t('LocalDevelopment.field.shell')} value={t(`LocalDevelopment.shell.${registration.shell}`, { defaultValue: registration.shell })} />
                <DetailRow label={t('LocalDevelopment.field.sourceGeneration')} value={String(registration.sourceGeneration)} mono />
                <DetailRow label={t('LocalDevelopment.field.declarationGeneration')} value={String(registration.declarationGeneration)} mono />
                <DetailRow label={t('Apps.detail.registeredAt')} value={registeredAt} />
                <DetailRow label={t('Apps.detail.lastUpdated')} value={updatedAt} />
              </dl>
            </DetailSection>
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}

function DetailTabButton({
  id,
  activeTab,
  onSelect,
  label,
}: {
  readonly id: AppsDetailTab;
  readonly activeTab: AppsDetailTab;
  readonly onSelect: (tab: AppsDetailTab) => void;
  readonly label: string;
}): ReactElement {
  const active = id === activeTab;
  return (
    <button
      type="button"
      role="tab"
      id={`apps-detail-tab-${id}`}
      aria-selected={active}
      aria-controls={`apps-detail-panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={handleDetailTabKeyDown}
      className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors ${active
        ? 'border-[var(--nimi-action-primary-bg)] text-[color:var(--nimi-text-primary)]'
        : 'border-transparent text-[color:var(--nimi-text-muted)] hover:text-[color:var(--nimi-text-primary)]'
      }`}
    >
      {label}
    </button>
  );
}

function handleDetailTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabList = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
  const tabs = Array.from(tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
  const currentIndex = tabs.indexOf(event.currentTarget);
  if (currentIndex < 0 || tabs.length === 0) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : event.key === 'ArrowRight'
        ? (currentIndex + 1) % tabs.length
        : (currentIndex - 1 + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
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
