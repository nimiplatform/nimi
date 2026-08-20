import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiDesktopOpenAppsSection } from '@nimiplatform/kit/core/desktop-open';
import { Box, CheckCircle2, Code2, LoaderCircle, Play, SearchX } from 'lucide-react';
import {
  Button,
  ScrollArea,
  SidebarItem,
  SidebarSearch,
  SidebarShell,
  Surface,
} from '@nimiplatform/kit/ui';
import {
  isLocalDevelopmentRunActive,
  type AppCardActionId,
} from './apps-card-actions.js';
import { AppsDetailView } from './apps-detail-view.js';
import type { DesktopAppsEntry, DesktopAppsPanelProjection } from './apps-panel-projection.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a

export interface AppsPanelViewProps {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly selectedAppId: string | null;
  readonly requestedDetailSection: NimiDesktopOpenAppsSection | null;
  readonly requestedDetailNavigationRevision: number;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  readonly onBack: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onRetry: () => void;
  readonly actionError: string | null;
  readonly activeAction: Readonly<{ appId: string; action: AppCardActionId }> | null;
}

export function AppsPanelView({
  projection,
  selectedAppId,
  requestedDetailSection,
  requestedDetailNavigationRevision,
  onCardAction,
  onBack,
  onOpenDeveloperMode,
  onRetry,
  actionError,
  activeAction,
}: AppsPanelViewProps): ReactElement {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const loadedEntries = projection?.status === 'loaded' ? projection.entries : [];
  const visibleEntries = useMemo(() => (
    normalizedQuery
      ? loadedEntries.filter(({ registration }) => (
        registration.displayName.toLocaleLowerCase().includes(normalizedQuery)
        || registration.appId.toLocaleLowerCase().includes(normalizedQuery)
      ))
      : loadedEntries
  ), [loadedEntries, normalizedQuery]);
  const selectedEntry = visibleEntries.find(
    (entry) => entry.registration.appId === selectedAppId,
  ) ?? null;

  useEffect(() => {
    const focusAppsSearch = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'f') return;
      const input = document.querySelector<HTMLInputElement>('[data-testid="apps-sidebar-search"] input');
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', focusAppsSearch);
    return () => window.removeEventListener('keydown', focusAppsSearch);
  }, []);

  const showDetailOnCompactViewport = selectedEntry !== null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2 lg:flex-row">
      <SidebarShell
        className={`${showDetailOnCompactViewport ? 'hidden lg:flex' : 'flex'} max-h-[min(52vh,440px)] w-full lg:max-h-none lg:w-[304px]`}
        data-testid="apps-sidebar"
      >
        <div className="flex min-h-[var(--nimi-sidebar-header-height)] shrink-0 items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">
              {t('Navigation.apps', { defaultValue: 'Apps' })}
            </h1>
            <p className="mt-0.5 truncate text-xs text-[color:var(--nimi-text-muted)]">
              {projection?.status === 'loaded'
                ? t('Apps.inventoryCount', { count: projection.entries.length })
                : t('Apps.sidebar.subtitle')}
            </p>
          </div>
        </div>

        {projection?.status === 'loaded' && projection.entries.length > 0 ? (
          <div data-testid="apps-sidebar-search">
            <SidebarSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery('')}
              placeholder={t('Apps.sidebar.searchPlaceholder')}
              ariaLabel={t('Apps.sidebar.searchLabel')}
              clearLabel={t('Apps.sidebar.clearSearch')}
            />
          </div>
        ) : null}

        <ScrollArea className="min-h-0 flex-1" contentClassName="px-2 pb-2 pt-1">
          <SidebarBody
            projection={projection}
            visibleEntries={visibleEntries}
            selectedAppId={selectedAppId}
            onCardAction={onCardAction}
            onClearSearch={() => setSearchQuery('')}
            onRetry={onRetry}
          />
        </ScrollArea>

        {actionError ? (
          <p data-testid="apps-action-error" role="alert" className="mx-3 mb-2 break-words rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--nimi-status-danger)]">
            {actionError}
          </p>
        ) : null}

        <div className="shrink-0 border-t border-[color:var(--nimi-border-subtle)] p-3">
          <Button
            data-testid="apps-open-developer-mode"
            tone="ghost"
            size="sm"
            onClick={onOpenDeveloperMode}
            className="w-full justify-start"
          >
            <Code2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('Apps.developerCard.action')}
          </Button>
          <p className="mt-1.5 px-2 text-xs leading-5 text-[color:var(--nimi-text-muted)]">
            {t('Apps.sidebar.developerHint')}
          </p>
        </div>
      </SidebarShell>

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className={`${showDetailOnCompactViewport ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]`}
      >
        {projection === null ? (
          <DetailLoading />
        ) : projection.status === 'error' ? (
          <DetailMessage
            title={t('Apps.detail.loadFailedTitle')}
            description={t('Apps.error', { detail: projection.detail })}
          />
        ) : projection.entries.length === 0 ? (
          <DetailMessage
            title={t('Apps.emptyConnectedTitle')}
            description={t('Apps.emptyConnectedDescription')}
          />
        ) : selectedEntry ? (
          <AppsDetailView
            entry={selectedEntry}
            requestedSection={requestedDetailSection}
            requestedNavigationRevision={requestedDetailNavigationRevision}
            onBack={onBack}
            onAction={(action) => onCardAction(selectedEntry.registration.appId, action)}
            activeAction={activeAction?.appId === selectedEntry.registration.appId ? activeAction.action : null}
          />
        ) : (
          <DetailMessage
            title={normalizedQuery ? t('Apps.sidebar.noResultsTitle') : t('Apps.detail.selectTitle')}
            description={normalizedQuery ? t('Apps.sidebar.noResultsDescription') : t('Apps.detail.selectDescription')}
          />
        )}
      </Surface>
    </div>
  );
}

function SidebarBody({
  projection,
  visibleEntries,
  selectedAppId,
  onCardAction,
  onClearSearch,
  onRetry,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly visibleEntries: readonly DesktopAppsEntry[];
  readonly selectedAppId: string | null;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  readonly onClearSearch: () => void;
  readonly onRetry: () => void;
}): ReactElement {
  const { t } = useTranslation();

  if (projection === null) {
    return (
      <div data-testid="apps-panel-loading" className="space-y-2 px-1 py-2" aria-label={t('Apps.loading')}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
        ))}
      </div>
    );
  }

  if (projection.status === 'error') {
    return (
      <div className="px-2 py-4">
        <p data-testid="apps-error" role="alert" className="break-words text-sm leading-6 text-[var(--nimi-status-danger)]">
          {t('Apps.error', { detail: projection.detail })}
        </p>
        <Button data-testid="apps-retry-projection" tone="secondary" size="sm" className="mt-3" onClick={onRetry}>
          {t('Developer.developerModeRetry')}
        </Button>
      </div>
    );
  }

  if (projection.entries.length === 0) {
    return (
      <div data-testid="apps-empty-local-development" data-state="empty" className="px-2 py-6 text-center">
        <Box className="mx-auto h-7 w-7 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.emptyConnectedTitle')}</p>
        <p className="mt-1 text-xs leading-5 text-[color:var(--nimi-text-muted)]">{t('Apps.sidebar.emptyHint')}</p>
      </div>
    );
  }

  if (visibleEntries.length === 0) {
    return (
      <div data-testid="apps-filter-empty" className="px-2 py-6 text-center">
        <SearchX className="mx-auto h-7 w-7 text-[color:var(--nimi-text-muted)]" aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.sidebar.noResultsTitle')}</p>
        <p className="mt-1 text-xs leading-5 text-[color:var(--nimi-text-muted)]">{t('Apps.sidebar.noResultsDescription')}</p>
        <Button tone="ghost" size="sm" className="mt-2" onClick={onClearSearch}>{t('Apps.sidebar.clearSearch')}</Button>
      </div>
    );
  }

  return (
    <nav data-testid="apps-entry-list" data-app-list aria-label={t('Apps.sidebar.listLabel')} className="space-y-1">
      {visibleEntries.map((entry, index) => {
        const { registration } = entry;
        const active = registration.appId === selectedAppId;
        return (
          <SidebarItem
            key={registration.selector}
            kind="nav-row"
            active={active}
            tabIndex={active || (!selectedAppId && index === 0) ? 0 : -1}
            data-app-row
            data-testid={`apps-entry-${registration.appId}`}
            data-local-development-shell={registration.shell}
            data-source-generation={registration.sourceGeneration}
            data-declaration-generation={registration.declarationGeneration}
            onClick={() => onCardAction(registration.appId, 'details')}
            onKeyDown={handleListKeyDown}
            className="min-h-16 py-2"
            icon={(
              <span data-testid={`apps-entry-${registration.appId}-icon`} className={`flex h-10 w-10 items-center justify-center rounded-xl ${active
                ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]'
                : 'bg-[color-mix(in_srgb,var(--nimi-surface-active)_72%,transparent)] text-[color:var(--nimi-text-secondary)]'
              }`}>
                <Box className="h-5 w-5" aria-hidden="true" />
              </span>
            )}
            label={<span data-testid={`apps-entry-${registration.appId}-name`}>{registration.displayName}</span>}
            description={<span data-testid={`apps-entry-${registration.appId}-kind`}>{t('Apps.card.local')} · {registration.appId}</span>}
            trailing={<RunStateLabel entry={entry} />}
          />
        );
      })}
    </nav>
  );
}

function RunStateLabel({ entry }: { readonly entry: DesktopAppsEntry }): ReactElement {
  const { t } = useTranslation();
  const state = entry.run?.state ?? 'stopped';
  if (state === 'running') {
    return (
      <span data-testid={`apps-entry-${entry.registration.appId}-state`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--nimi-status-success)]">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t('Apps.runState.running')}
      </span>
    );
  }
  if (isLocalDevelopmentRunActive(state)) {
    return (
      <span data-testid={`apps-entry-${entry.registration.appId}-state`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--nimi-action-primary-bg)]">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {t('Apps.runState.starting')}
      </span>
    );
  }
  return (
    <span data-testid={`apps-entry-${entry.registration.appId}-state`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--nimi-text-muted)]">
      <Play className="h-3.5 w-3.5" aria-hidden="true" />
      {t('Apps.runState.stopped')}
    </span>
  );
}

function handleListKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const list = event.currentTarget.closest<HTMLElement>('[data-app-list]');
  const rows = Array.from(list?.querySelectorAll<HTMLButtonElement>('[data-app-row]') ?? []);
  const currentIndex = rows.indexOf(event.currentTarget);
  if (currentIndex < 0 || rows.length === 0) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? rows.length - 1
      : event.key === 'ArrowDown'
        ? (currentIndex + 1) % rows.length
        : (currentIndex - 1 + rows.length) % rows.length;
  rows[nextIndex]?.focus();
  rows[nextIndex]?.click();
}

function DetailLoading(): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col" data-testid="apps-detail-loading" aria-label={t('Apps.loading')}>
      <div className="border-b border-[color:var(--nimi-border-subtle)] px-6 py-6">
        <div className="h-16 w-full max-w-xl animate-pulse rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
      </div>
      <div className="space-y-3 p-6">
        <div className="h-32 animate-pulse rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
        <div className="h-48 animate-pulse rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
      </div>
    </div>
  );
}

function DetailMessage({ title, description }: { readonly title: string; readonly description: string }): ReactElement {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <Box className="mx-auto h-8 w-8 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold text-[color:var(--nimi-text-primary)]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">{description}</p>
      </div>
    </div>
  );
}
