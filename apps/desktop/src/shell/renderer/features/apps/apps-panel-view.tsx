import {
  memo,
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
  BadgeCheck,
  Box,
  Check,
  Code2,
  Download,
  Info,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  PackageOpen,
  Play,
  Plus,
  SearchX,
  Square,
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
import {
  actionPlanForEntry,
  hasAvailableCatalogUpdate,
  type AppCardActionId,
} from './apps-card-actions.js';
import {
  appRunVisualState,
  entryNeedsAttention,
  sortAppsEntries,
  type AppsSortId,
} from './apps-card-fields.js';
import { AppArtworkIcon } from './apps-card-visuals.js';
import { AppListRow } from './apps-list-row.js';
import { AppsDetailView } from './apps-detail-view.js';
import { AppsInstallConfirmationDialog } from './apps-install-confirmation.js';
import type { AppsInstallIntentSnapshot } from './apps-install-intent.js';
import { useAppEntryMenu } from './apps-entry-menu.js';
import {
  filterAppGroups,
  groupAppsEntries,
  reconcileAppGroups,
  siblingSourceEntries,
  sortAppGroups,
  splitRunningGroups,
  type DesktopAppGroup,
} from './apps-entry-groups.js';
import type {
  DesktopAppsCatalogProjection,
  DesktopAppsEntry,
  DesktopAppsPanelProjection,
  DesktopAppSourceClass,
} from './apps-panel-projection.js';
import type { AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';
import type { AppsDownloadsContextValue } from './apps-downloads-context.js';
import { AppsDownloadsView, isAppDownloadJob } from './apps-downloads-view.js';
import { packageJobIsTerminal } from './apps-downloads-observer.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a

export interface AppsPanelViewProps {
  readonly downloads?: AppsDownloadsContextValue;
  readonly onViewDownloadApp?: (job: AppPackageJob) => void;
  readonly onRetryDownload?: (job: AppPackageJob) => void;
  readonly projection: DesktopAppsPanelProjection | null;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly selectedEntryKey: string | null;
  readonly requestedDetailSection: NimiDesktopOpenAppsSection | null;
  readonly requestedDetailNavigationRevision: number;
  readonly onCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly onBack: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onImportLocal: () => void;
  readonly onRetry: () => void;
  readonly onAIConfigChanged: (entryKey: string, result: NimiAIConfigOverwriteResult) => void;
  readonly actionError: string | null;
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly installConfirmation: AppsInstallIntentSnapshot | null;
  readonly onConfirmInstall: () => void;
  readonly onCancelInstall: () => void;
}

const SORT_IDS: readonly AppsSortId[] = ['updated', 'name', 'activity'];
const SORT_LABEL_KEYS: Readonly<Record<AppsSortId, string>> = {
  updated: 'Apps.library.sortUpdated',
  name: 'Apps.library.sortName',
  activity: 'Apps.library.sortActivity',
};

/** The home 最近活跃 section stays a quick-launch subset, not a second list. */
const RECENT_GROUPS_LIMIT = 6;

export function AppsPanelView({
  downloads,
  onViewDownloadApp,
  onRetryDownload,
  projection,
  searchQuery,
  onSearchChange,
  selectedEntryKey,
  requestedDetailSection,
  requestedDetailNavigationRevision,
  onCardAction,
  onBack,
  onOpenDeveloperMode,
  onImportLocal,
  onRetry,
  onAIConfigChanged,
  actionError,
  activeAction,
  installConfirmation,
  onConfirmInstall,
  onCancelInstall,
}: AppsPanelViewProps): ReactElement {
  const { t } = useTranslation();
  const [sortId, setSortId] = useState<AppsSortId>('updated');
  const railSearchRef = useRef<HTMLInputElement>(null);

  const loadedEntries = projection?.status === 'loaded' ? projection.entries : [];
  // Group-level structural sharing: quiet polls keep group identity so the
  // memoized rail rows skip re-rendering.
  const reconciledGroupsRef = useRef<readonly DesktopAppGroup[]>([]);
  const groups = useMemo(() => {
    const next = reconcileAppGroups(reconciledGroupsRef.current, groupAppsEntries(loadedEntries));
    reconciledGroupsRef.current = next;
    return next;
  }, [loadedEntries]);
  // Stable per-entry dispatchers keep memoized rows referentially quiet even
  // though `onCardAction` itself is re-created around each new projection.
  const onCardActionRef = useRef(onCardAction);
  onCardActionRef.current = onCardAction;
  const actionDispatchersRef = useRef(new Map<string, (action: AppCardActionId) => void>());
  const actionDispatcherFor = (entryKey: string): ((action: AppCardActionId) => void) => {
    let dispatcher = actionDispatchersRef.current.get(entryKey);
    if (!dispatcher) {
      dispatcher = (action) => onCardActionRef.current(entryKey, action);
      actionDispatchersRef.current.set(entryKey, dispatcher);
    }
    return dispatcher;
  };
  const searching = searchQuery.trim() !== '';
  const sortedGroups = useMemo(
    () => sortAppGroups(filterAppGroups(groups, searchQuery), sortId),
    [groups, searchQuery, sortId],
  );
  // Steam-style rail: a 运行中 section on top, one flat list below; searching
  // collapses the sections into a single result set.
  const { running: runningGroups, rest: restGroups } = useMemo(
    () => (searching ? { running: [] as readonly DesktopAppGroup[], rest: sortedGroups } : splitRunningGroups(sortedGroups)),
    [searching, sortedGroups],
  );
  const attentionEntries = useMemo(
    () => sortAppsEntries(loadedEntries.filter(entryNeedsAttention), 'updated'),
    [loadedEntries],
  );
  const updateEntries = useMemo(
    () => sortAppsEntries(loadedEntries.filter(hasAvailableCatalogUpdate), 'updated'),
    [loadedEntries],
  );
  const recentGroups = useMemo(
    () => sortAppGroups(groups, 'activity').slice(0, RECENT_GROUPS_LIMIT),
    [groups],
  );
  const selectedEntry = loadedEntries.find(
    (entry) => entry.identity.entryKey === selectedEntryKey,
  ) ?? null;
  const detailMode = selectedEntry !== null;
  const sourceEntries = useMemo(
    () => (selectedEntry ? siblingSourceEntries(loadedEntries, selectedEntry) : []),
    [loadedEntries, selectedEntry],
  );

  useEffect(() => {
    const focusAppsSearch = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'f') return;
      const input = railSearchRef.current;
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
        groupsCount={groups.length}
        runningGroups={runningGroups}
        restGroups={restGroups}
        selectedEntryKey={selectedEntryKey}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onClearSearch={() => onSearchChange('')}
        searchInputRef={railSearchRef}
        sortId={sortId}
        sortMenuItems={sortMenuItems}
        downloads={downloads}
        activeAction={activeAction}
        actionDispatcherFor={actionDispatcherFor}
        onLeaveDownloads={onBack}
        onRetry={onRetry}
      />

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]"
      >
        {downloads?.view === 'downloads' && onViewDownloadApp && onRetryDownload ? (
          <AppsDownloadsView downloads={downloads} entries={loadedEntries} onViewApp={onViewDownloadApp} onRetry={onRetryDownload} />
        ) : detailMode ? (
          <>
            {projection?.status === 'loaded' && projection.runtimeError ? (
              <div className="shrink-0 px-5 pt-4 sm:px-7">
                <InlineAlert tone="danger" data-testid="apps-runtime-error">
                  {t('Apps.error', { detail: projection.runtimeError })}
                </InlineAlert>
              </div>
            ) : null}
            <AppsDetailView
              entry={selectedEntry}
              sourceEntries={sourceEntries}
              requestedSection={requestedDetailSection}
              requestedNavigationRevision={requestedDetailNavigationRevision}
              onBack={onBack}
              onOpenEntry={(entryKey) => onCardAction(entryKey, 'details')}
              onAction={(action) => onCardAction(selectedEntry.identity.entryKey, action)}
              activeAction={activeAction && activeAction.entryKey === selectedEntry.identity.entryKey ? activeAction.action : null}
              actionsDisabled={activeAction !== null}
              actionError={actionError}
              onAIConfigChanged={(result) => onAIConfigChanged(selectedEntry.identity.entryKey, result)}
            />
          </>
        ) : (
          <AppsHome
            projection={projection}
            attentionEntries={attentionEntries}
            updateEntries={updateEntries}
            recentGroups={recentGroups}
            activeAction={activeAction}
            actionDispatcherFor={actionDispatcherFor}
            onRetry={onRetry}
            onOpenDeveloperMode={onOpenDeveloperMode}
            onImportLocal={onImportLocal}
            onFocusRailSearch={() => railSearchRef.current?.focus()}
            actionError={actionError}
          />
        )}
      </Surface>
      <AppsInstallConfirmationDialog
        intent={installConfirmation}
        pending={activeAction?.action === 'install'}
        onConfirm={onConfirmInstall}
        onClose={onCancelInstall}
      />
    </div>
  );
}

function AppsRail({
  projection,
  groupsCount,
  runningGroups,
  restGroups,
  selectedEntryKey,
  searchQuery,
  onSearchChange,
  onClearSearch,
  searchInputRef,
  sortId,
  sortMenuItems,
  downloads,
  activeAction,
  actionDispatcherFor,
  onLeaveDownloads,
  onRetry,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly groupsCount: number;
  readonly runningGroups: readonly DesktopAppGroup[];
  readonly restGroups: readonly DesktopAppGroup[];
  readonly selectedEntryKey: string | null;
  readonly searchQuery: string;
  readonly onSearchChange: (value: string) => void;
  readonly onClearSearch: () => void;
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
  readonly sortId: AppsSortId;
  readonly sortMenuItems: NimiMenuItem[];
  readonly downloads?: AppsDownloadsContextValue;
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly actionDispatcherFor: (entryKey: string) => (action: AppCardActionId) => void;
  readonly onLeaveDownloads: () => void;
  readonly onRetry: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const flatGroups = useMemo(() => [...runningGroups, ...restGroups], [runningGroups, restGroups]);
  const selectedGroupVisible = flatGroups.some((group) => (
    group.entries.some((entry) => entry.identity.entryKey === selectedEntryKey)
  ));
  const tabbableEntryKey = selectedGroupVisible ? selectedEntryKey : flatGroups[0]?.primary.identity.entryKey ?? null;
  const renderRow = (group: DesktopAppGroup) => (
    <RailGroupRow
      key={group.appId}
      group={group}
      active={group.entries.some((entry) => entry.identity.entryKey === selectedEntryKey)}
      tabIndex={group.entries.some((entry) => entry.identity.entryKey === tabbableEntryKey) ? 0 : -1}
      activeAction={activeAction && group.entries.some((entry) => entry.identity.entryKey === activeAction.entryKey) ? activeAction.action : null}
      actionsDisabled={activeAction !== null}
      onAction={actionDispatcherFor(group.primary.identity.entryKey)}
      onKeyDown={handleRailKeyDown}
    />
  );
  return (
    <SidebarShell className="h-56 min-h-0 w-full lg:h-auto lg:w-[248px]" data-testid="apps-sidebar">
      <div className="flex min-h-[var(--nimi-sidebar-header-height)] shrink-0 items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
            {t('Navigation.apps', { defaultValue: 'Apps' })}
          </h1>
          <p className="truncate text-[11px] text-[color:var(--nimi-text-muted)]">
            {projection?.status === 'loaded'
              ? t('Apps.inventoryCount', { count: groupsCount })
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
        ) : flatGroups.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <SearchX className="mx-auto h-5 w-5 text-[var(--nimi-text-muted)]" aria-hidden="true" />
            <p className="mt-2 text-xs leading-5 text-[color:var(--nimi-text-muted)]">{t('Apps.sidebar.noResultsDescription')}</p>
            <Button tone="ghost" size="sm" className="mt-2" onClick={onClearSearch}>{t('Apps.sidebar.clearSearch')}</Button>
          </div>
        ) : (
          <div data-app-rail-list>
            {runningGroups.length > 0 ? (
              <section data-testid="apps-rail-running-section" aria-label={t('Apps.rail.runningSection')} className="mb-2">
                <h2 className="px-2 pb-1 text-[11px] font-semibold leading-4 text-[color:var(--nimi-text-muted)]">
                  {t('Apps.rail.runningSection')}
                </h2>
                <div className="space-y-0.5">
                  {runningGroups.map(renderRow)}
                </div>
              </section>
            ) : null}
            <div className="space-y-0.5">
              {restGroups.map(renderRow)}
            </div>
          </div>
        )}
      </ScrollArea>

      {downloads ? <RailDownloadsEntry downloads={downloads} onLeaveDownloads={onLeaveDownloads} /> : null}
    </SidebarShell>
  );
}

function RailDownloadsEntry({
  downloads,
  onLeaveDownloads,
}: {
  readonly downloads: AppsDownloadsContextValue;
  readonly onLeaveDownloads: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const activeCount = downloads.jobs.filter((job) => isAppDownloadJob(job) && !packageJobIsTerminal(job)).length;
  const active = downloads.view === 'downloads';
  return (
    <div className="shrink-0 border-t border-[var(--nimi-border-subtle)] px-2 py-2">
      <button
        type="button"
        data-testid="apps-downloads-entry"
        aria-pressed={active}
        onClick={() => {
          if (active) {
            downloads.showLibrary();
            onLeaveDownloads();
          } else {
            downloads.openDownloads();
          }
        }}
        className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] ${active
          ? 'bg-[var(--nimi-surface-active)] font-medium text-[color:var(--nimi-text-primary)]'
          : 'font-medium text-[color:var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)]'
        }`}
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t('Apps.downloads.title')}</span>
        {activeCount > 0 ? (
          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-1.5 py-0.5 text-[11px] font-medium leading-3 tabular-nums text-[var(--nimi-action-primary-bg)]">
            {activeCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

const RAIL_SOURCE_GLYPH: Readonly<Record<DesktopAppSourceClass, {
  readonly icon: typeof Code2;
  readonly labelKey: string;
  readonly className: string;
}>> = Object.freeze({
  local_development: {
    icon: Code2,
    labelKey: 'Apps.sourceBadge.localDevelopment',
    className: 'text-[color:var(--nimi-text-muted)]',
  },
  user_imported: {
    icon: PackageOpen,
    labelKey: 'Apps.sourceBadge.userImported',
    className: 'text-[var(--nimi-status-info-soft-text)]',
  },
  verified: {
    icon: BadgeCheck,
    labelKey: 'Apps.sourceBadge.verified',
    className: 'text-[var(--nimi-status-success-soft-text)]',
  },
});

function RailSourceGlyph({ source }: { readonly source: DesktopAppSourceClass }): ReactElement {
  const { t } = useTranslation();
  const meta = RAIL_SOURCE_GLYPH[source];
  const Icon = meta.icon;
  return (
    <span title={t(meta.labelKey)} className={`inline-flex shrink-0 items-center ${meta.className}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{t(meta.labelKey)}</span>
    </span>
  );
}

function railGroupRowPropsEqual(
  prev: RailGroupRowProps,
  next: RailGroupRowProps,
): boolean {
  const sameGroup = prev.group === next.group || (
    prev.group.appId === next.group.appId
    && prev.group.primary === next.group.primary
    && prev.group.displayName === next.group.displayName
    && prev.group.iconUrl === next.group.iconUrl
    && prev.group.running === next.group.running
    && prev.group.starting === next.group.starting
    && prev.group.sourceClasses.length === next.group.sourceClasses.length
    && prev.group.sourceClasses.every((source, index) => source === next.group.sourceClasses[index])
  );
  return sameGroup
    && prev.active === next.active
    && prev.tabIndex === next.tabIndex
    && prev.activeAction === next.activeAction
    && prev.actionsDisabled === next.actionsDisabled
    && prev.onAction === next.onAction
    && prev.onKeyDown === next.onKeyDown;
}

interface RailGroupRowProps {
  readonly group: DesktopAppGroup;
  readonly active: boolean;
  readonly tabIndex?: number;
  readonly activeAction: AppCardActionId | null;
  readonly actionsDisabled: boolean;
  readonly onAction: (action: AppCardActionId) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

const RailGroupRow = memo(function RailGroupRow({
  group,
  active,
  tabIndex,
  activeAction,
  actionsDisabled,
  onAction,
  onKeyDown,
}: RailGroupRowProps): ReactElement {
  const { t } = useTranslation();
  const primary = group.primary;
  const visual = appRunVisualState(primary.run?.state ?? null);
  const { menuItems, confirmElement } = useAppEntryMenu({
    entry: primary,
    actionsDisabled,
    removePending: activeAction === 'remove',
    onAction,
  });
  return (
    <div className="group relative" data-rail-group={group.appId}>
      <div className={`flex w-full min-w-0 items-center rounded-lg transition-colors ${active
        ? 'bg-[var(--nimi-surface-active)]'
        : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)]'
      }`}>
        <button
          type="button"
          data-app-row
          data-testid={`apps-rail-app-${group.appId}`}
          tabIndex={tabIndex}
          onClick={() => onAction('details')}
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]"
        >
          <AppArtworkIcon
            appId={group.appId}
            displayName={group.displayName}
            iconUrl={group.iconUrl}
            size="xs"
          />
          <span className={`min-w-0 flex-1 truncate text-[13px] leading-5 ${visual === 'running' ? 'font-semibold text-[color:var(--nimi-text-primary)]' : 'font-medium text-[color:var(--nimi-text-primary)]'}`}>
            {group.displayName}
          </span>
          {visual === 'running' ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
              <span className="sr-only">{t('Apps.runState.running')}</span>
            </span>
          ) : null}
          {visual === 'starting' ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[var(--nimi-action-primary-bg)]">
              <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
              <span className="sr-only">{t('Apps.runState.starting')}</span>
            </span>
          ) : null}
          {visual === 'failed' ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-danger)]" aria-hidden="true" />
              <span className="sr-only">{t('Apps.runState.failed')}</span>
            </span>
          ) : null}
          {group.sourceClasses.length > 1 ? (
            <span className="inline-flex shrink-0 items-center gap-1 group-hover:hidden group-focus-within:hidden">
              {group.sourceClasses.map((source) => <RailSourceGlyph key={source} source={source} />)}
            </span>
          ) : null}
        </button>
        <span className="hidden shrink-0 items-center pr-1 group-hover:flex group-focus-within:flex">
          <RailQuickAction
            entry={primary}
            activeAction={activeAction}
            actionsDisabled={actionsDisabled}
            onAction={onAction}
          />
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                data-testid={`apps-rail-app-${group.appId}-menu`}
                icon={<MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
                tone="ghost"
                size="sm"
                aria-label={t('Apps.library.cardMenuLabel')}
                title={t('Apps.library.cardMenuLabel')}
                className="h-6 w-6 min-h-0"
              />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="p-1">
              <ActionMenu items={menuItems} ariaLabel={t('Apps.library.cardMenuLabel')} />
            </PopoverContent>
          </Popover>
        </span>
      </div>
      {confirmElement}
    </div>
  );
}, railGroupRowPropsEqual);

/** Compact icon-only twin of AppRowActionButton for the merged rail rows. */
function RailQuickAction({
  entry,
  activeAction,
  actionsDisabled,
  onAction,
}: {
  readonly entry: DesktopAppsEntry;
  readonly activeAction: AppCardActionId | null;
  readonly actionsDisabled: boolean;
  readonly onAction: (action: AppCardActionId) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const visual = appRunVisualState(entry.run?.state ?? null);
  const plan = actionPlanForEntry(entry);
  if (!plan.primary) return null;
  if (visual === 'starting') {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center text-[var(--nimi-action-primary-bg)]" role="status" aria-label={t('Apps.runState.starting')}>
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      </span>
    );
  }
  if (plan.primary.id === 'stop') {
    return (
      <IconButton
        data-testid={`apps-rail-app-${entry.identity.appId}-stop`}
        icon={activeAction === 'stop' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Square className="h-3.5 w-3.5" aria-hidden="true" />}
        tone="ghost"
        size="sm"
        disabled={actionsDisabled}
        aria-label={t('Apps.action.stop')}
        title={t('Apps.action.stop')}
        className="h-6 w-6 min-h-0"
        onClick={() => onAction('stop')}
      />
    );
  }
  const launchLabel = t(entry.committedRelease && entry.run?.state === 'running' ? 'Apps.action.focus' : visual === 'failed' ? 'Apps.action.retry' : 'Apps.action.launch');
  return (
    <IconButton
      data-testid={`apps-rail-app-${entry.identity.appId}-launch`}
      icon={activeAction === 'launch' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
      tone="ghost"
      size="sm"
      disabled={actionsDisabled}
      aria-label={launchLabel}
      title={launchLabel}
      className="h-6 w-6 min-h-0"
      onClick={() => onAction('launch')}
    />
  );
}

function AppsHome({
  projection,
  attentionEntries,
  updateEntries,
  recentGroups,
  activeAction,
  actionDispatcherFor,
  onRetry,
  onOpenDeveloperMode,
  onImportLocal,
  onFocusRailSearch,
  actionError,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly attentionEntries: readonly DesktopAppsEntry[];
  readonly updateEntries: readonly DesktopAppsEntry[];
  readonly recentGroups: readonly DesktopAppGroup[];
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly actionDispatcherFor: (entryKey: string) => (action: AppCardActionId) => void;
  readonly onRetry: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onImportLocal: () => void;
  readonly onFocusRailSearch: () => void;
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
            <AppsAddMenu onImport={onImportLocal} onDeveloper={onOpenDeveloperMode} onBrowse={onFocusRailSearch} />
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
        <AppsHomeBody
          projection={projection}
          attentionEntries={attentionEntries}
          updateEntries={updateEntries}
          recentGroups={recentGroups}
          activeAction={activeAction}
          actionDispatcherFor={actionDispatcherFor}
          onRetry={onRetry}
          onOpenDeveloperMode={onOpenDeveloperMode}
          onImportLocal={onImportLocal}
          onFocusRailSearch={onFocusRailSearch}
        />
      </ScrollArea>
    </>
  );
}

function AppsHomeBody({
  projection,
  attentionEntries,
  updateEntries,
  recentGroups,
  activeAction,
  actionDispatcherFor,
  onRetry,
  onOpenDeveloperMode,
  onImportLocal,
  onFocusRailSearch,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly attentionEntries: readonly DesktopAppsEntry[];
  readonly updateEntries: readonly DesktopAppsEntry[];
  readonly recentGroups: readonly DesktopAppGroup[];
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly actionDispatcherFor: (entryKey: string) => (action: AppCardActionId) => void;
  readonly onRetry: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onImportLocal: () => void;
  readonly onFocusRailSearch: () => void;
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
            <AppsAddMenu onImport={onImportLocal} onDeveloper={onOpenDeveloperMode} onBrowse={onFocusRailSearch} />
          )}
        />
        <CatalogStatusNote status={projection.catalogStatus} />
      </div>
    );
  }

  return (
    <div className="space-y-8 px-5 py-5 sm:px-7">
      {attentionEntries.length > 0 ? (
        <section data-testid="apps-home-attention" aria-label={t('Apps.home.attentionTitle')}>
          <h2 className="flex min-w-0 items-baseline gap-2 px-1 text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
            <span className="truncate">{t('Apps.home.attentionTitle')}</span>
            <span className="shrink-0 text-xs font-normal text-[color:var(--nimi-text-muted)]">
              {t('Apps.library.allAppsCount', { count: attentionEntries.length })}
            </span>
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-4">
            {attentionEntries.map((entry) => (
              <AppListRow
                key={entry.identity.entryKey}
                entry={entry}
                showSourceBadge
                activeAction={activeAction && activeAction.entryKey === entry.identity.entryKey ? activeAction.action : null}
                actionsDisabled={activeAction !== null}
                onAction={actionDispatcherFor(entry.identity.entryKey)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {updateEntries.length > 0 ? (
        <section data-testid="apps-home-updates" aria-label={t('Apps.home.updatesTitle')}>
          <h2 className="flex min-w-0 items-baseline gap-2 px-1 text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
            <span className="truncate">{t('Apps.home.updatesTitle')}</span>
            <span className="shrink-0 text-xs font-normal text-[color:var(--nimi-text-muted)]">
              {t('Apps.library.allAppsCount', { count: updateEntries.length })}
            </span>
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-4">
            {updateEntries.map((entry) => (
              <AppListRow
                key={entry.identity.entryKey}
                entry={entry}
                showSourceBadge
                activeAction={activeAction && activeAction.entryKey === entry.identity.entryKey ? activeAction.action : null}
                actionsDisabled={activeAction !== null}
                onAction={actionDispatcherFor(entry.identity.entryKey)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section data-testid="apps-home-recent" aria-label={t('Apps.home.recentTitle')}>
        <h2 className="px-1 text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
          {t('Apps.home.recentTitle')}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-4">
          {recentGroups.map((group) => (
            <AppListRow
              key={group.primary.identity.entryKey}
              entry={group.primary}
              showSourceBadge={group.entries.length > 1}
              activeAction={activeAction && activeAction.entryKey === group.primary.identity.entryKey ? activeAction.action : null}
              actionsDisabled={activeAction !== null}
              onAction={actionDispatcherFor(group.primary.identity.entryKey)}
            />
          ))}
        </div>
      </section>

      <CatalogStatusNote status={projection.catalogStatus} />
    </div>
  );
}

function CatalogStatusNote({ status }: {
  readonly status: DesktopAppsCatalogProjection['status'];
}): ReactElement | null {
  const { t } = useTranslation();
  if (status === 'loading') {
    return (
      <p role="status" className="mt-4 flex items-center gap-1.5 px-1 text-xs text-[var(--nimi-text-muted)]">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {t('Apps.catalog.loading')}
      </p>
    );
  }
  if (status === 'not-implemented') {
    return (
      <p
        data-testid="apps-catalog-unavailable"
        className="mt-4 flex items-center gap-1.5 px-1 text-[11px] leading-4 text-[color:var(--nimi-text-muted)]"
      >
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('Apps.catalogNotImplemented')}
      </p>
    );
  }
  return null;
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

function AppsAddMenu({ onImport, onDeveloper, onBrowse }: { readonly onImport: () => void; readonly onDeveloper: () => void; readonly onBrowse: () => void }): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const select = (action: () => void) => () => { setOpen(false); action(); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button data-testid="apps-connect-local" tone="primary" size="md" className="text-white" leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('Apps.library.connectLocalTitle')}</Button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={6} className="p-1">
      <ActionMenu ariaLabel={t('Apps.library.connectLocalTitle')} items={[
        { id: 'catalog', label: t('Apps.localImport.browseCatalog'), onSelect: select(onBrowse) },
        { id: 'local-import', label: t('Apps.localImport.action'), onSelect: select(onImport) },
        { id: 'development', label: t('Apps.localImport.connectDevelopment'), onSelect: select(onDeveloper) },
      ]} />
    </PopoverContent>
  </Popover>;
}
