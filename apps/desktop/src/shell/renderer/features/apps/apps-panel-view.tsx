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
  Info,
  ListFilter,
  LoaderCircle,
  Plus,
  SearchX,
  X,
} from 'lucide-react';
import {
  ActionMenu,
  Button,
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
  filterAppsEntriesByStatus,
  pinRunningAppsFirst,
  sortAppsEntries,
  type AppsLibraryFilterId,
  type AppsSortId,
} from './apps-card-fields.js';
import { AppArtworkIcon } from './apps-card-visuals.js';
import { AppListRow } from './apps-list-row.js';
import { FrequentAppsSection } from './apps-frequent-section.js';
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

const LIBRARY_FILTER_IDS: readonly AppsLibraryFilterId[] = ['all', 'running', 'attention'];
const LIBRARY_FILTER_LABEL_KEYS: Readonly<Record<AppsLibraryFilterId, string>> = {
  all: 'Apps.filter.all',
  running: 'Apps.library.filterRunning',
  attention: 'Apps.library.filterNeedsAttention',
};

/** The 常用 strip stays a quick-launch subset, not a second full list. */
const FREQUENT_ENTRIES_LIMIT = 3;

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
  const [libraryFilterId, setLibraryFilterId] = useState<AppsLibraryFilterId>('all');
  const railSearchRef = useRef<HTMLInputElement>(null);
  const librarySearchRef = useRef<HTMLInputElement>(null);

  const loadedEntries = projection?.status === 'loaded' ? projection.entries : [];
  const searchedEntries = useMemo(
    () => pinRunningAppsFirst(sortAppsEntries(filterAppsEntries(loadedEntries, searchQuery), sortId)),
    [loadedEntries, searchQuery, sortId],
  );
  const visibleEntries = useMemo(
    () => filterAppsEntriesByStatus(searchedEntries, libraryFilterId),
    [searchedEntries, libraryFilterId],
  );
  const frequentEntries = useMemo(
    () => pinRunningAppsFirst(sortAppsEntries(loadedEntries, 'updated')).slice(0, FREQUENT_ENTRIES_LIMIT),
    [loadedEntries],
  );
  // 常用 only earns its strip when the full list is long enough that a subset
  // adds value, and stays out of the way of search/filter results.
  const showFrequent = libraryFilterId === 'all'
    && searchQuery.trim() === ''
    && loadedEntries.length > FREQUENT_ENTRIES_LIMIT;
  const selectedEntry = loadedEntries.find(
    (entry) => entry.identity.entryKey === selectedEntryKey,
  ) ?? null;
  const detailMode = selectedEntry !== null;

  useEffect(() => {
    const focusAppsSearch = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'f') return;
      const input = librarySearchRef.current ?? railSearchRef.current;
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
        visibleEntries={searchedEntries}
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
            frequentEntries={frequentEntries}
            showFrequent={showFrequent}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            onClearFilters={() => {
              onSearchChange('');
              setLibraryFilterId('all');
            }}
            searchInputRef={librarySearchRef}
            libraryFilterId={libraryFilterId}
            onLibraryFilterChange={setLibraryFilterId}
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
          trailing={searchQuery ? <SearchClearButton testId="apps-search-clear" onClear={onClearSearch} /> : undefined}
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
  frequentEntries,
  showFrequent,
  searchQuery,
  onSearchChange,
  onClearFilters,
  searchInputRef,
  libraryFilterId,
  onLibraryFilterChange,
  activeAction,
  onCardAction,
  onRetry,
  onOpenDeveloperMode,
  actionError,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly visibleEntries: readonly DesktopAppsEntry[];
  readonly frequentEntries: readonly DesktopAppsEntry[];
  readonly showFrequent: boolean;
  readonly searchQuery: string;
  readonly onSearchChange: (value: string) => void;
  readonly onClearFilters: () => void;
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
  readonly libraryFilterId: AppsLibraryFilterId;
  readonly onLibraryFilterChange: (value: AppsLibraryFilterId) => void;
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly onCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly onRetry: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly actionError: string | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <div className="shrink-0 px-5 pt-6 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1
              data-testid="apps-library-title"
              className="text-2xl font-bold leading-8 text-[color:var(--nimi-text-primary)]"
            >
              {t('Apps.library.pageTitle')}
            </h1>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <SearchField
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onClearFilters();
              }}
              trailing={searchQuery ? <SearchClearButton testId="apps-search-clear-library" onClear={onClearFilters} /> : undefined}
              placeholder={t('Apps.library.searchPlaceholder')}
              aria-label={t('Apps.library.searchPlaceholder')}
              className="min-h-9 w-44 sm:w-64"
              inputClassName="text-xs"
            />
            <Button
              data-testid="apps-connect-local"
              tone="primary"
              size="md"
              className="text-white"
              leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={onOpenDeveloperMode}
            >
              {t('Apps.library.connectLocalTitle')}
            </Button>
          </div>
        </div>
      </div>

      {actionError ? (
        <div className="shrink-0 px-5 pt-4 sm:px-7">
          <InlineAlert tone="danger" data-testid="apps-action-error">
            {actionError}
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
          frequentEntries={frequentEntries}
          showFrequent={showFrequent}
          searchQuery={searchQuery}
          libraryFilterId={libraryFilterId}
          onLibraryFilterChange={onLibraryFilterChange}
          activeAction={activeAction}
          onCardAction={onCardAction}
          onClearFilters={onClearFilters}
          onRetry={onRetry}
          onOpenDeveloperMode={onOpenDeveloperMode}
        />
      </ScrollArea>

      {projection?.status === 'loaded' && projection.catalogStatus === 'not-implemented' ? (
        <div className="shrink-0 px-5 pb-4 sm:px-7">
          <p
            data-testid="apps-catalog-unavailable"
            className="flex items-center gap-1.5 text-[11px] leading-4 text-[color:var(--nimi-text-muted)]"
          >
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('Apps.catalogNotImplemented')}
          </p>
        </div>
      ) : null}
    </>
  );
}

function LibraryBody({
  projection,
  visibleEntries,
  frequentEntries,
  showFrequent,
  searchQuery,
  libraryFilterId,
  onLibraryFilterChange,
  activeAction,
  onCardAction,
  onClearFilters,
  onRetry,
  onOpenDeveloperMode,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly visibleEntries: readonly DesktopAppsEntry[];
  readonly frequentEntries: readonly DesktopAppsEntry[];
  readonly showFrequent: boolean;
  readonly searchQuery: string;
  readonly libraryFilterId: AppsLibraryFilterId;
  readonly onLibraryFilterChange: (value: AppsLibraryFilterId) => void;
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly onCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly onClearFilters: () => void;
  readonly onRetry: () => void;
  readonly onOpenDeveloperMode: () => void;
}): ReactElement {
  const { t } = useTranslation();

  if (projection === null) {
    return (
      <div data-testid="apps-panel-loading" aria-label={t('Apps.loading')} className="space-y-2 px-5 py-5 sm:px-7">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex animate-pulse items-center gap-4 rounded-2xl px-3 py-3">
            <div className="h-16 w-16 shrink-0 rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/3 rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
              <div className="h-3 w-1/2 rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
            </div>
            <div className="h-8 w-16 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-active)_54%,transparent)]" />
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

  return (
    <div className="space-y-8 px-5 py-5 sm:px-7">
      {showFrequent ? (
        <FrequentAppsSection
          entries={frequentEntries}
          activeAction={activeAction}
          onAction={onCardAction}
        />
      ) : null}

      <section data-testid="apps-entry-list" data-app-list aria-label={t('Apps.library.allAppsTitle')}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
          <h2 className="flex min-w-0 items-baseline gap-2 text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
            <span className="truncate">{t('Apps.library.allAppsTitle')}</span>
            <span className="shrink-0 text-xs font-normal text-[color:var(--nimi-text-muted)]">
              {t('Apps.library.allAppsCount', { count: visibleEntries.length })}
            </span>
          </h2>
          <div className="flex items-center gap-1" role="group" aria-label={t('Apps.filter.label')}>
            {LIBRARY_FILTER_IDS.map((filterId) => (
              <button
                key={filterId}
                type="button"
                data-testid={`apps-filter-${filterId}`}
                aria-pressed={filterId === libraryFilterId}
                onClick={() => onLibraryFilterChange(filterId)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] ${filterId === libraryFilterId
                  ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]'
                  : 'text-[color:var(--nimi-text-muted)] hover:text-[color:var(--nimi-text-primary)]'
                }`}
              >
                {t(LIBRARY_FILTER_LABEL_KEYS[filterId])}
              </button>
            ))}
          </div>
        </div>
        {visibleEntries.length === 0 ? (
          <LibraryListEmpty
            searching={searchQuery.trim() !== ''}
            onClearFilters={onClearFilters}
          />
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-4">
            {visibleEntries.map((entry) => (
              <AppListRow
                key={entry.identity.entryKey}
                entry={entry}
                activeAction={activeAction && activeAction.entryKey === entry.identity.entryKey ? activeAction.action : null}
                onAction={(action) => onCardAction(entry.identity.entryKey, action)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LibraryListEmpty({
  searching,
  onClearFilters,
}: {
  readonly searching: boolean;
  readonly onClearFilters: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="apps-filter-empty" className="py-10 text-center">
      <SearchX className="mx-auto h-7 w-7 text-[var(--nimi-text-muted)]" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-[color:var(--nimi-text-primary)]">
        {searching ? t('Apps.sidebar.noResultsTitle') : t('Apps.filter.empty')}
      </p>
      {searching ? (
        <p className="mt-1 text-xs leading-5 text-[color:var(--nimi-text-muted)]">
          {t('Apps.sidebar.noResultsDescription')}
        </p>
      ) : null}
      <Button tone="ghost" size="sm" className="mt-2" onClick={onClearFilters}>
        {searching ? t('Apps.sidebar.clearSearch') : t('Apps.filter.reset')}
      </Button>
    </div>
  );
}

function SearchClearButton({
  testId,
  onClear,
}: {
  readonly testId: string;
  readonly onClear: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <IconButton
      data-testid={testId}
      icon={<X className="h-3 w-3" aria-hidden="true" />}
      tone="ghost"
      size="sm"
      aria-label={t('Apps.sidebar.clearSearch')}
      title={t('Apps.sidebar.clearSearch')}
      className="h-5 w-5 min-h-0 shrink-0 rounded-full text-[var(--nimi-text-muted)]"
      onClick={onClear}
    />
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
