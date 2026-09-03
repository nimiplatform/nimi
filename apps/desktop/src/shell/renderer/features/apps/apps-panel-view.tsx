import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiDesktopOpenAppsSection } from '@nimiplatform/kit/core/desktop-open';
import type { NimiAIConfigOverwriteResult } from '@nimiplatform/kit/core/sdk-contract';
import {
  Box,
  Check,
  Code2,
  ListFilter,
  LoaderCircle,
  SearchX,
} from 'lucide-react';
import {
  ActionMenu,
  Button,
  DashedAddButton,
  EmptyState,
  IconButton,
  InlineAlert,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  SearchField,
  SidebarShell,
  Surface,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import type { AppCardActionId } from './apps-card-actions.js';
import {
  appRunVisualState,
  filterAppsEntries,
  pinRunningAppsFirst,
  sortAppsEntries,
  type AppsSortId,
} from './apps-card-fields.js';
import { AppArtworkIcon } from './apps-card-visuals.js';
import { AppGridCard } from './apps-grid-card.js';
import { AppsDetailView } from './apps-detail-view.js';
import type { DesktopAppsEntry, DesktopAppsPanelProjection } from './apps-panel-projection.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a

export interface AppsPanelViewProps {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly selectedEntryKey: string | null;
  readonly requestedDetailSection: NimiDesktopOpenAppsSection | null;
  readonly requestedDetailNavigationRevision: number;
  readonly onCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly onBack: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onRetry: () => void;
  readonly onAIConfigChanged: (entryKey: string, result: NimiAIConfigOverwriteResult) => void;
  readonly actionError: string | null;
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
}

const SORT_IDS: readonly AppsSortId[] = ['updated', 'name', 'activity'];
const SORT_LABEL_KEYS: Readonly<Record<AppsSortId, string>> = {
  updated: 'Apps.library.sortUpdated',
  name: 'Apps.library.sortName',
  activity: 'Apps.library.sortActivity',
};

export function AppsPanelView({
  projection,
  searchQuery,
  onSearchChange,
  selectedEntryKey,
  requestedDetailSection,
  requestedDetailNavigationRevision,
  onCardAction,
  onBack,
  onOpenDeveloperMode,
  onRetry,
  onAIConfigChanged,
  actionError,
  activeAction,
}: AppsPanelViewProps): ReactElement {
  const { t } = useTranslation();
  const [sortId, setSortId] = useState<AppsSortId>('updated');
  const railSearchRef = useRef<HTMLInputElement>(null);
  const compactSearchRef = useRef<HTMLInputElement>(null);

  const loadedEntries = projection?.status === 'loaded' ? projection.entries : [];
  const visibleEntries = useMemo(
    () => pinRunningAppsFirst(sortAppsEntries(filterAppsEntries(loadedEntries, searchQuery), sortId)),
    [loadedEntries, searchQuery, sortId],
  );
  const selectedEntry = loadedEntries.find(
    (entry) => entry.identity.entryKey === selectedEntryKey,
  ) ?? null;
  const detailMode = selectedEntry !== null;

  useEffect(() => {
    const focusAppsSearch = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'f') return;
      const input = railSearchRef.current ?? compactSearchRef.current;
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', focusAppsSearch);
    return () => window.removeEventListener('keydown', focusAppsSearch);
  }, []);

  const sortMenuItems: NimiMenuItem[] = SORT_IDS.map((id) => ({
    id,
    label: t(SORT_LABEL_KEYS[id]),
    trailingIcon: id === sortId ? <Check className="h-4 w-4" aria-hidden="true" /> : undefined,
    onSelect: () => setSortId(id),
  }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2 lg:flex-row">
      <AppsRail
        projection={projection}
        visibleEntries={visibleEntries}
        selectedEntryKey={selectedEntryKey}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onClearSearch={() => onSearchChange('')}
        searchInputRef={railSearchRef}
        sortId={sortId}
        sortMenuItems={sortMenuItems}
        onCardAction={onCardAction}
        onRetry={onRetry}
      />

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]"
      >
        {detailMode && projection?.status === 'loaded' && projection.runtimeError ? (
          <div className="shrink-0 px-5 pt-4 sm:px-7">
            <InlineAlert tone="danger" data-testid="apps-runtime-error">
              {t('Apps.error', { detail: projection.runtimeError })}
            </InlineAlert>
          </div>
        ) : null}
        {detailMode ? (
          <AppsDetailView
            entry={selectedEntry}
            requestedSection={requestedDetailSection}
            requestedNavigationRevision={requestedDetailNavigationRevision}
            onBack={onBack}
            onAction={(action) => onCardAction(selectedEntry.identity.entryKey, action)}
            activeAction={activeAction && activeAction.entryKey === selectedEntry.identity.entryKey ? activeAction.action : null}
            actionError={actionError}
            onAIConfigChanged={(result) => onAIConfigChanged(selectedEntry.identity.entryKey, result)}
          />
        ) : (
          <LibraryContent
            projection={projection}
            visibleEntries={visibleEntries}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            onClearSearch={() => onSearchChange('')}
            searchInputRef={compactSearchRef}
            sortMenuItems={sortMenuItems}
            activeSortLabel={t(SORT_LABEL_KEYS[sortId])}
            activeAction={activeAction}
            onCardAction={onCardAction}
            onRetry={onRetry}
            onOpenDeveloperMode={onOpenDeveloperMode}
            actionError={actionError}
          />
        )}
      </Surface>
    </div>
  );
}

function AppsRail({
  projection,
  visibleEntries,
  selectedEntryKey,
  searchQuery,
  onSearchChange,
  onClearSearch,
  searchInputRef,
  sortId,
  sortMenuItems,
  onCardAction,
  onRetry,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly visibleEntries: readonly DesktopAppsEntry[];
  readonly selectedEntryKey: string | null;
  readonly searchQuery: string;
  readonly onSearchChange: (value: string) => void;
  readonly onClearSearch: () => void;
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
  readonly sortId: AppsSortId;
  readonly sortMenuItems: NimiMenuItem[];
  readonly onCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly onRetry: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <SidebarShell className="hidden w-[248px] lg:flex" data-testid="apps-sidebar">
      <div className="flex min-h-[var(--nimi-sidebar-header-height)] shrink-0 items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
            {t('Navigation.apps', { defaultValue: 'Apps' })}
          </h1>
          <p className="truncate text-[11px] text-[color:var(--nimi-text-muted)]">
            {projection?.status === 'loaded'
              ? t('Apps.inventoryCount', { count: projection.entries.length })
              : t('Apps.sidebar.subtitle')}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2 pb-2" data-testid="apps-sidebar-search">
        <SearchField
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClearSearch();
          }}
          placeholder={t('Apps.sidebar.searchPlaceholder')}
          aria-label={t('Apps.sidebar.searchLabel')}
          className="min-h-8 flex-1"
          inputClassName="text-xs"
        />
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              data-testid="apps-sort-menu"
              icon={<ListFilter className="h-3.5 w-3.5" aria-hidden="true" />}
              tone="ghost"
              size="sm"
              aria-label={t('Apps.library.sortLabel')}
              title={`${t('Apps.library.sortLabel')} · ${t(SORT_LABEL_KEYS[sortId])}`}
              className="h-8 w-8 shrink-0"
            />
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="p-1">
            <ActionMenu items={sortMenuItems} ariaLabel={t('Apps.library.sortLabel')} />
          </PopoverContent>
        </Popover>
      </div>

      <ScrollArea className="min-h-0 flex-1" contentClassName="px-2 pb-2">
        {projection === null ? (
          <div className="space-y-1.5 px-1 py-2" aria-label={t('Apps.loading')}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-8 animate-pulse rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
            ))}
          </div>
        ) : projection.status === 'error' ? (
          <div className="px-2 py-4">
            <p role="alert" className="break-words text-xs leading-5 text-[var(--nimi-status-danger)]">
              {t('Apps.error', { detail: projection.detail })}
            </p>
            <Button data-testid="apps-retry-projection" tone="secondary" size="sm" className="mt-3" onClick={onRetry}>
              {t('Developer.developerModeRetry')}
            </Button>
          </div>
        ) : projection.entries.length === 0 ? (
          <p className="px-2 py-4 text-xs leading-5 text-[color:var(--nimi-text-muted)]">
            {t('Apps.sidebar.emptyHint')}
          </p>
        ) : visibleEntries.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <SearchX className="mx-auto h-5 w-5 text-[var(--nimi-text-muted)]" aria-hidden="true" />
            <p className="mt-2 text-xs leading-5 text-[color:var(--nimi-text-muted)]">{t('Apps.sidebar.noResultsDescription')}</p>
            <Button tone="ghost" size="sm" className="mt-2" onClick={onClearSearch}>{t('Apps.sidebar.clearSearch')}</Button>
          </div>
        ) : (
          <div data-app-rail-list>
            <div className="space-y-0.5">
              {visibleEntries.map((entry, index) => (
                <RailAppRow
                  key={entry.identity.entryKey}
                  entry={entry}
                  active={entry.identity.entryKey === selectedEntryKey}
                  tabIndex={entry.identity.entryKey === selectedEntryKey || (!selectedEntryKey && index === 0) ? 0 : -1}
                  onOpen={() => onCardAction(entry.identity.entryKey, 'details')}
                  onKeyDown={handleRailKeyDown}
                />
              ))}
            </div>
          </div>
        )}
      </ScrollArea>
    </SidebarShell>
  );
}

function RailAppRow({
  entry,
  active,
  tabIndex,
  onOpen,
  onKeyDown,
}: {
  readonly entry: DesktopAppsEntry;
  readonly active: boolean;
  readonly tabIndex?: number;
  readonly onOpen: () => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const { t } = useTranslation();
  const visual = appRunVisualState(entry.run?.state ?? null);
  return (
    <button
      type="button"
      data-app-row
      data-testid={`apps-rail-entry-${entry.identity.entryKey}`}
      tabIndex={tabIndex}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] ${active
        ? 'bg-[var(--nimi-surface-active)]'
        : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)]'
      }`}
    >
      <AppArtworkIcon
        appId={entry.identity.appId}
        displayName={entry.identity.displayName}
        iconUrl={entry.iconUrl}
        size="xs"
      />
      <span className={`min-w-0 flex-1 truncate text-[13px] leading-5 ${visual === 'running' ? 'font-semibold text-[color:var(--nimi-text-primary)]' : 'font-medium text-[color:var(--nimi-text-primary)]'}`}>
        {entry.identity.displayName}
      </span>
      {visual === 'running' ? (
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
          <span className="sr-only">{t('Apps.runState.running')}</span>
        </span>
      ) : null}
      {visual === 'starting' ? (
        <span className="inline-flex items-center gap-1 text-[var(--nimi-action-primary-bg)]">
          <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
          <span className="sr-only">{t('Apps.runState.starting')}</span>
        </span>
      ) : null}
    </button>
  );
}

function LibraryContent({
  projection,
  visibleEntries,
  searchQuery,
  onSearchChange,
  onClearSearch,
  searchInputRef,
  sortMenuItems,
  activeSortLabel,
  activeAction,
  onCardAction,
  onRetry,
  onOpenDeveloperMode,
  actionError,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly visibleEntries: readonly DesktopAppsEntry[];
  readonly searchQuery: string;
  readonly onSearchChange: (value: string) => void;
  readonly onClearSearch: () => void;
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
  readonly sortMenuItems: NimiMenuItem[];
  readonly activeSortLabel: string;
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly onCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly onRetry: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly actionError: string | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <div className="shrink-0 border-b border-[color:var(--nimi-border-subtle)] px-5 pb-4 pt-5 lg:hidden">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">
            {t('Navigation.apps', { defaultValue: 'Apps' })}
          </h1>
          <p className="mt-0.5 text-xs text-[color:var(--nimi-text-muted)]">
            {projection?.status === 'loaded'
              ? t('Apps.inventoryCount', { count: projection.entries.length })
              : t('Apps.sidebar.subtitle')}
          </p>
        </div>
        {projection?.status === 'loaded' && projection.entries.length > 0 ? (
          <div className="mt-4 flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchField
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') onClearSearch();
                }}
                placeholder={t('Apps.sidebar.searchPlaceholder')}
                aria-label={t('Apps.sidebar.searchLabel')}
                inputClassName="text-xs"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <IconButton
                  data-testid="apps-sort-menu-compact"
                  icon={<ListFilter className="h-3.5 w-3.5" aria-hidden="true" />}
                  tone="ghost"
                  size="sm"
                  aria-label={t('Apps.library.sortLabel')}
                  title={`${t('Apps.library.sortLabel')} · ${activeSortLabel}`}
                  className="h-8 w-8 shrink-0"
                />
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="p-1">
                <ActionMenu items={sortMenuItems} ariaLabel={t('Apps.library.sortLabel')} />
              </PopoverContent>
            </Popover>
          </div>
        ) : null}
      </div>

      {actionError ? (
        <div className="shrink-0 px-5 pt-4 sm:px-7">
          <InlineAlert tone="danger" data-testid="apps-action-error">
            {actionError}
          </InlineAlert>
        </div>
      ) : null}

      {projection?.status === 'loaded' && projection.catalogStatus === 'not-implemented' ? (
        <div className="shrink-0 px-5 pt-4 sm:px-7">
          <InlineAlert tone="info" data-testid="apps-catalog-unavailable">
            {t('Apps.catalogNotImplemented')}
          </InlineAlert>
        </div>
      ) : null}

      {projection?.status === 'loaded' && projection.runtimeError ? (
        <div className="shrink-0 px-5 pt-4 sm:px-7">
          <InlineAlert tone="danger" data-testid="apps-runtime-error">
            {t('Apps.error', { detail: projection.runtimeError })}
          </InlineAlert>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent">
        <LibraryBody
          projection={projection}
          visibleEntries={visibleEntries}
          activeAction={activeAction}
          onCardAction={onCardAction}
          onClearSearch={onClearSearch}
          onRetry={onRetry}
          onOpenDeveloperMode={onOpenDeveloperMode}
        />
      </ScrollArea>
    </>
  );
}

function LibraryBody({
  projection,
  visibleEntries,
  activeAction,
  onCardAction,
  onClearSearch,
  onRetry,
  onOpenDeveloperMode,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly visibleEntries: readonly DesktopAppsEntry[];
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly onCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly onClearSearch: () => void;
  readonly onRetry: () => void;
  readonly onOpenDeveloperMode: () => void;
}): ReactElement {
  const { t } = useTranslation();

  if (projection === null) {
    return (
      <div data-testid="apps-panel-loading" aria-label={t('Apps.loading')} className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 px-5 py-5 sm:px-7">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="animate-pulse rounded-2xl border border-[color:var(--nimi-border-subtle)] p-4">
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 shrink-0 rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
                <div className="h-3 w-1/2 rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (projection.status === 'error') {
    return (
      <div className="px-5 py-6 sm:px-7">
        <InlineAlert
          tone="danger"
          data-testid="apps-error"
          action={(
            <Button data-testid="apps-retry-projection" tone="secondary" size="sm" onClick={onRetry}>
              {t('Developer.developerModeRetry')}
            </Button>
          )}
        >
          {t('Apps.error', { detail: projection.detail })}
        </InlineAlert>
      </div>
    );
  }

  if (projection.entries.length === 0) {
    return (
      <div className="px-5 py-6 sm:px-7">
        <EmptyState
          data-testid="apps-empty-local-development"
          data-state="empty"
          icon={<Box className="h-5 w-5" aria-hidden="true" />}
          title={t('Apps.emptyConnectedTitle')}
          description={t('Apps.emptyConnectedDescription')}
          action={(
            <Button tone="primary" size="sm" onClick={onOpenDeveloperMode}>
              <Code2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('Apps.developerCard.action')}
            </Button>
          )}
        />
      </div>
    );
  }

  if (visibleEntries.length === 0) {
    return (
      <div data-testid="apps-filter-empty" className="px-5 py-10 text-center sm:px-7">
        <SearchX className="mx-auto h-7 w-7 text-[var(--nimi-text-muted)]" aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('Apps.sidebar.noResultsTitle')}</p>
        <p className="mt-1 text-xs leading-5 text-[color:var(--nimi-text-muted)]">{t('Apps.sidebar.noResultsDescription')}</p>
        <Button tone="ghost" size="sm" className="mt-2" onClick={onClearSearch}>{t('Apps.sidebar.clearSearch')}</Button>
      </div>
    );
  }

  return (
    <div data-testid="apps-entry-list" data-app-list className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 px-5 py-5 sm:px-7">
      {visibleEntries.map((entry) => (
        <AppGridCard
          key={entry.identity.entryKey}
          entry={entry}
          activeAction={activeAction && activeAction.entryKey === entry.identity.entryKey ? activeAction.action : null}
          onAction={(action) => onCardAction(entry.identity.entryKey, action)}
        />
      ))}
      <DashedAddButton
        shape="tile"
        data-testid="apps-connect-local"
        icon={<Code2 className="h-5 w-5" aria-hidden="true" />}
        label={t('Apps.library.connectLocalTitle')}
        onClick={onOpenDeveloperMode}
        className="h-full min-h-[150px]"
      />
    </div>
  );
}

function handleRailKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const list = event.currentTarget.closest<HTMLElement>('[data-app-rail-list]');
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
  // Arrow keys move focus only; Enter/Space activates the focused row through
  // native button behavior, so browsing no longer hijacks the detail surface.
  rows[nextIndex]?.focus();
}
