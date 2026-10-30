import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiDesktopOpenAppsSection } from '@nimiplatform/kit/core/desktop-open';
import { AppsAttentionSection } from './apps-attention-section.js';
import { AppsActionErrorAlert } from './apps-action-error.js';
import type { AppsActionError } from './apps-panel-controller.js';
import type { NimiAIConfigOverwriteResult } from '@nimiplatform/kit/core/sdk-contract';
import {
  Box,
  Check,
  ChevronRight,
  Code2,
  Download,
  Info,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
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
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  SearchField,
  Surface,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import { DesktopModuleSidebar, type DesktopModuleSidebarHandle } from '../../components/desktop-module-sidebar.js';
import {
  appsActionsLocked,
  hasAvailableCatalogUpdate,
  pendingActionForApp,
  pendingActionForEntry,
  type AppCardActionId,
  type AppsPendingAction,
} from './apps-card-actions.js';
import {
  appRunTransition,
  appRunVisualState,
  entryNeedsAttention,
  sortAppsEntries,
} from './apps-card-fields.js';
import { AppArtworkIcon } from './apps-card-visuals.js';
import { AppListRow } from './apps-list-row.js';
import { AppsDetailView } from './apps-detail-view.js';
import { AppsInstallConfirmationDialog } from './apps-install-confirmation.js';
import type { AppsInstallIntentSnapshot } from './apps-install-intent.js';
import { useAppEntryMenu } from './apps-entry-menu.js';
import {
  appIconUrlsForEntries,
  filterAppGroups,
  filterAppGroupsByState,
  groupAppsEntries,
  hideBlockedDiscoveryEntries,
  reconcileAppGroups,
  siblingSourceEntries,
  sortAppGroups,
  splitRunningGroups,
  type AppsRailFilterId,
  type DesktopAppGroup,
} from './apps-entry-groups.js';
import type {
  DesktopAppsCatalogProjection,
  DesktopAppsEntry,
  DesktopAppsPanelProjection,
  DesktopAppsProjectionSource,
} from './apps-panel-projection.js';
import {
  markAppUpdateAutoPrompted,
  planAppUpdateAutoPrompt,
  subscribeAppUpdatePreferences,
} from './apps-update-preferences.js';
import type { AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';
import type { AppsDownloadsContextValue } from './apps-downloads-context.js';
import { AppsDownloadsView, isAppDownloadJob } from './apps-downloads-view.js';
import { packageJobIsTerminal } from './apps-downloads-observer.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a

export interface AppsPanelViewProps {
  readonly downloadsOnly?: boolean;
  readonly downloads?: AppsDownloadsContextValue;
  readonly onViewDownloadApp?: (job: AppPackageJob) => void;
  readonly onRetryDownload?: (job: AppPackageJob) => void;
  readonly projection: DesktopAppsPanelProjection | null;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly selectedEntryKey: string | null;
  readonly requestedDetailSection: NimiDesktopOpenAppsSection | null;
  readonly navigationEntryKey: string;
  readonly onCardAction: (entryKey: string, action: AppCardActionId) => void;
  readonly onBack: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onImportLocal: () => void;
  readonly onRetry: () => void;
  readonly onAIConfigChanged: (entryKey: string, result: NimiAIConfigOverwriteResult) => void;
  readonly actionError: AppsActionError | null;
  readonly sourceChoiceNotice?: string | null;
  readonly pendingActions: readonly AppsPendingAction[];
  readonly installConfirmation: AppsInstallIntentSnapshot | null;
  readonly onConfirmInstall: () => void;
  readonly onCancelInstall: () => void;
  readonly readPackageInfo?: DesktopAppsProjectionSource['readPackageInfo'];
}

const FILTER_IDS: readonly AppsRailFilterId[] = ['all', 'running', 'updates', 'attention'];
const FILTER_LABEL_KEYS: Readonly<Record<AppsRailFilterId, string>> = {
  all: 'Apps.library.filterAll',
  running: 'Apps.library.filterRunning',
  updates: 'Apps.library.filterUpdates',
  attention: 'Apps.library.filterAttention',
};

/** The home 最近活跃 section stays a quick-launch subset, not a second list. */
const RECENT_GROUPS_LIMIT = 6;

export function AppsPanelView({
  downloadsOnly = false,
  downloads,
  onViewDownloadApp,
  onRetryDownload,
  projection,
  searchQuery,
  onSearchChange,
  selectedEntryKey,
  requestedDetailSection,
  navigationEntryKey,
  onCardAction,
  onBack,
  onOpenDeveloperMode,
  onImportLocal,
  onRetry,
  onAIConfigChanged,
  actionError,
  sourceChoiceNotice,
  pendingActions,
  installConfirmation,
  onConfirmInstall,
  onCancelInstall,
  readPackageInfo,
}: AppsPanelViewProps): ReactElement {
  const { t } = useTranslation();
  const [filterId, setFilterId] = useState<AppsRailFilterId>('all');
  const railSearchRef = useRef<HTMLInputElement>(null);
  const railRef = useRef<DesktopModuleSidebarHandle>(null);

  const loadedEntries = projection?.status === 'loaded' ? projection.entries : [];
  // Ordinary discovery lists hide Catalog-only rows blocked by current policy;
  // the projection keeps them so detail and installed joins stay exact.
  const discoveryEntries = useMemo(() => hideBlockedDiscoveryEntries(loadedEntries), [loadedEntries]);
  // Group-level structural sharing: quiet polls keep group identity so the
  // memoized rail rows skip re-rendering.
  const reconciledGroupsRef = useRef<readonly DesktopAppGroup[]>([]);
  const groups = useMemo(() => {
    const next = reconcileAppGroups(reconciledGroupsRef.current, groupAppsEntries(discoveryEntries));
    reconciledGroupsRef.current = next;
    return next;
  }, [discoveryEntries]);
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
  const filtering = filterId !== 'all';
  const sortedGroups = useMemo(
    () => sortAppGroups(filterAppGroupsByState(filterAppGroups(groups, searchQuery), filterId), 'updated'),
    [groups, searchQuery, filterId],
  );
  // Steam-style rail: a 运行中 section on top, one flat list below; searching
  // or filtering collapses the sections into a single result set.
  const { running: runningGroups, rest: restGroups } = useMemo(
    () => (searching || filtering ? { running: [] as readonly DesktopAppGroup[], rest: sortedGroups } : splitRunningGroups(sortedGroups)),
    [searching, filtering, sortedGroups],
  );
  const attentionEntries = useMemo(
    () => sortAppsEntries(discoveryEntries.filter(entryNeedsAttention), 'updated'),
    [discoveryEntries],
  );
  const updateEntries = useMemo(
    () => sortAppsEntries(discoveryEntries.filter(hasAvailableCatalogUpdate), 'updated'),
    [discoveryEntries],
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
      if (!railRef.current) return;
      event.preventDefault();
      railRef.current.focusSearch();
    };
    window.addEventListener('keydown', focusAppsSearch);
    return () => window.removeEventListener('keydown', focusAppsSearch);
  }, []);

  // Per-app 自动更新 policy: start the standard update flow once per newly
  // available Registry version; the install confirmation still gates install.
  const [updatePreferenceRevision, setUpdatePreferenceRevision] = useState(0);
  useEffect(
    () => subscribeAppUpdatePreferences(() => setUpdatePreferenceRevision((value) => value + 1)),
    [],
  );
  useEffect(() => {
    if (projection?.status !== 'loaded' || pendingActions.length > 0 || installConfirmation) return;
    const candidate = planAppUpdateAutoPrompt(projection.entries);
    if (!candidate) return;
    try {
      markAppUpdateAutoPrompted(candidate.appId, candidate.version);
    } catch {
      // Without persistence the prompt record cannot be kept; fail closed
      // instead of re-prompting on every poll.
      return;
    }
    onCardActionRef.current(candidate.entryKey, 'update');
  }, [pendingActions, installConfirmation, projection, updatePreferenceRevision]);

  const filterMenuItems: NimiMenuItem[] = FILTER_IDS.map((id) => ({
    id,
    label: t(FILTER_LABEL_KEYS[id]),
    trailingIcon: id === filterId ? <Check className="h-4 w-4" aria-hidden="true" /> : undefined,
    onSelect: () => setFilterId(id),
  }));

  return (
    <div className="desktop-module-workspace px-3 pb-3 pt-2">
      {!downloadsOnly ? (
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
        sidebarRef={railRef}
        filterId={filterId}
        filterMenuItems={filterMenuItems}
        downloads={downloads}
        pendingActions={pendingActions}
        actionDispatcherFor={actionDispatcherFor}
        onLeaveDownloads={onBack}
        onRetry={onRetry}
      />
      ) : null}

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="desktop-module-panel flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)]"
      >
        {downloadsOnly && downloads && onViewDownloadApp && onRetryDownload ? (
          <AppsDownloadsView downloads={downloads} entries={loadedEntries} onViewApp={onViewDownloadApp} onRetry={onRetryDownload} />
        ) : detailMode ? (
          <>
            {projection?.status === 'loaded' && projection.runtimeError ? (
              <div className="shrink-0 px-5 pt-4 sm:px-7">
                <AppsActionErrorAlert testId="apps-runtime-error" error={{ message: t('Apps.lifecycleReadFailed'), detail: projection.runtimeError }} />
              </div>
            ) : null}
            <AppsDetailView
              entry={selectedEntry}
              iconUrl={groups.find((group) => group.appId === selectedEntry.identity.appId)?.iconUrl ?? selectedEntry.iconUrl}
              sourceEntries={sourceEntries}
              requestedSection={requestedDetailSection}
              navigationEntryKey={navigationEntryKey}
              onBack={onBack}
              onOpenEntry={(entryKey) => onCardAction(entryKey, 'details')}
              onRemoveSource={(entryKey) => onCardAction(entryKey, 'remove')}
              onAction={(action) => onCardAction(selectedEntry.identity.entryKey, action)}
              activeAction={pendingActionForEntry(pendingActions, selectedEntry.identity.entryKey)}
              actionsDisabled={appsActionsLocked(pendingActions, selectedEntry.identity.appId)}
              actionError={actionError}
              onAIConfigChanged={(result) => onAIConfigChanged(selectedEntry.identity.entryKey, result)}
              readPackageInfo={readPackageInfo}
            />
          </>
        ) : (
          <AppsHome
            projection={projection}
            attentionEntries={attentionEntries}
            updateEntries={updateEntries}
            recentGroups={recentGroups}
            pendingActions={pendingActions}
            actionDispatcherFor={actionDispatcherFor}
            onRetry={onRetry}
            onOpenDeveloperMode={onOpenDeveloperMode}
            onImportLocal={onImportLocal}
            onFocusRailSearch={() => railRef.current?.focusSearch()}
            actionError={actionError}
            sourceChoiceNotice={sourceChoiceNotice}
          />
        )}
      </Surface>
      <AppsInstallConfirmationDialog
        intent={installConfirmation}
        pending={pendingActions.some((item) => item.action === 'install')}
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
  sidebarRef,
  filterId,
  filterMenuItems,
  downloads,
  pendingActions,
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
  readonly sidebarRef: React.Ref<DesktopModuleSidebarHandle>;
  readonly filterId: AppsRailFilterId;
  readonly filterMenuItems: NimiMenuItem[];
  readonly downloads?: AppsDownloadsContextValue;
  readonly pendingActions: readonly AppsPendingAction[];
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
      activeAction={pendingActionForApp(pendingActions, group.appId)}
      actionsDisabled={appsActionsLocked(pendingActions, group.appId)}
      onAction={actionDispatcherFor(group.primary.identity.entryKey)}
      onKeyDown={handleRailKeyDown}
    />
  );
  return (
    <DesktopModuleSidebar ref={sidebarRef} searchInputRef={searchInputRef} label={t('Navigation.apps')} selectionKey={selectedEntryKey} data-testid="apps-sidebar">
      <div className="desktop-sidebar__header">
        <h1 className="desktop-sidebar__title font-semibold text-[var(--nimi-text-primary)]">
          {t('Navigation.apps', { defaultValue: 'Apps' })}
        </h1>
        <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
          {projection?.status === 'loaded'
            ? t('Apps.inventoryCount', { count: groupsCount })
            : t('Apps.sidebar.subtitle')}
        </p>
      </div>

      <div className="desktop-sidebar__search flex items-center" data-testid="apps-sidebar-search">
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
          className="min-h-10 min-w-0 flex-1"
        />
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              data-testid="apps-filter-menu"
              icon={<ListFilter className="h-3.5 w-3.5" aria-hidden="true" />}
              tone="ghost"
              size="sm"
              aria-label={t('Apps.library.filterLabel')}
              title={`${t('Apps.library.filterLabel')} · ${t(FILTER_LABEL_KEYS[filterId])}`}
              className="desktop-sidebar__icon-action shrink-0"
            />
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="p-1">
            <ActionMenu items={filterMenuItems} ariaLabel={t('Apps.library.filterLabel')} />
          </PopoverContent>
        </Popover>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:!block" contentClassName="desktop-sidebar__body">
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
          <div className="desktop-sidebar__groups" data-app-rail-list>
            {runningGroups.length > 0 ? (
              <section data-testid="apps-rail-running-section" aria-label={t('Apps.rail.runningSection')} className="desktop-sidebar__items">
                <h2 className="desktop-sidebar__section-label font-semibold text-[color:var(--nimi-text-muted)]">
                  {t('Apps.rail.runningSection')}
                </h2>
                <div className="desktop-sidebar__items">
                  {runningGroups.map(renderRow)}
                </div>
              </section>
            ) : null}
            <div className="desktop-sidebar__items">
              {restGroups.map(renderRow)}
            </div>
          </div>
        )}
      </ScrollArea>

      {downloads ? <RailDownloadsEntry downloads={downloads} onLeaveDownloads={onLeaveDownloads} /> : null}
    </DesktopModuleSidebar>
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
    <div className="desktop-sidebar__footer border-t border-[var(--nimi-border-subtle)]">
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
        className="desktop-sidebar__row flex w-full min-w-0 items-center text-left font-medium text-[var(--nimi-text-secondary)] transition-colors"
        data-active={active}
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{t('Apps.downloads.title')}</span>
        {activeCount > 0 ? (
          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-1.5 py-0.5 text-[11px] font-medium leading-3 tabular-nums text-[var(--nimi-action-primary-bg)]">
            {activeCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/** Marks a merged rail row that also carries a local-development registration; other source kinds stay silent in the rail. */
function RailSourceGlyph(): ReactElement {
  const { t } = useTranslation();
  return (
    <span title={t('Apps.sourceBadge.localDevelopment')} className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[color:var(--nimi-text-muted)]">
      <Code2 className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{t('Apps.sourceBadge.localDevelopment')}</span>
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
  const transition = appRunTransition(visual, activeAction);
  // A not-yet-installed Catalog row keeps a muted, Steam-like look.
  const notInstalled = primary.committedRelease === null && primary.localDevelopment === null;
  const { menuItems, confirmElement } = useAppEntryMenu({
    entry: primary,
    actionsDisabled,
    removePending: activeAction === 'remove',
    activeAction,
    onAction,
  });
  const rowButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState<{ readonly x: number; readonly y: number } | null>(null);
  // Pointer coordinates are viewport-relative. A fixed DOM anchor inside the
  // rail can acquire a different containing block from an ancestor's effects.
  const menuAnchorRef = useMemo(() => menuPoint ? {
    current: {
      getBoundingClientRect: () => new DOMRect(menuPoint.x, menuPoint.y, 0, 0),
    },
  } : null, [menuPoint]);

  const openContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    let point = { x: event.clientX, y: event.clientY };
    if (point.x === 0 && point.y === 0) {
      // A keyboard-triggered context menu carries no pointer position;
      // anchor it to the row instead of the window corner.
      const rect = event.currentTarget.getBoundingClientRect();
      point = { x: rect.right, y: rect.top };
    }
    setMenuPoint(point);
    setMenuOpen(true);
  };

  return (
    <div className="group/rail-row relative" data-rail-group={group.appId}>
      <Popover
        open={menuOpen}
        onOpenChange={(next) => {
          setMenuOpen(next);
          if (!next) setMenuPoint(null);
        }}
      >
        <div
          className="desktop-sidebar__row-surface flex w-full min-w-0 items-center transition-colors"
          data-active={active}
          onContextMenu={openContextMenu}
        >
          <button
            type="button"
            ref={rowButtonRef}
            data-app-row
            aria-current={active ? 'page' : undefined}
            data-testid={`apps-rail-app-${group.appId}`}
            tabIndex={tabIndex}
            onClick={() => onAction('details')}
            onKeyDown={onKeyDown}
            className="desktop-sidebar__row flex min-w-0 flex-1 items-center text-left"
          >
            <AppArtworkIcon
              appId={group.appId}
              displayName={group.displayName}
              iconUrl={group.iconUrl}
              size="xs"
              className={`desktop-sidebar__icon ${notInstalled ? 'opacity-60' : ''}`}
            />
            <span className={`desktop-sidebar__label min-w-0 flex-1 ${notInstalled
              ? 'font-medium text-[color:var(--nimi-text-muted)]'
              : visual === 'running'
                ? 'font-semibold text-[color:var(--nimi-text-primary)]'
                : 'font-medium text-[color:var(--nimi-text-primary)]'
            }`}>
              {group.displayName}
            </span>
            {transition ? (
              <span data-rail-transition={transition} className="inline-flex shrink-0 items-center gap-1 text-[var(--nimi-action-primary-bg)]">
                <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <span className="sr-only">{t(`Apps.runState.${transition}`)}</span>
              </span>
            ) : visual === 'running' ? (
              <span className="inline-flex shrink-0 items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
                <span className="sr-only">{t('Apps.runState.running')}</span>
              </span>
            ) : visual === 'failed' ? (
              <span className="inline-flex shrink-0 items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-danger)]" aria-hidden="true" />
                <span className="sr-only">{t('Apps.runState.failed')}</span>
              </span>
            ) : null}
            {group.sourceClasses.length > 1 && group.sourceClasses.includes('local_development') ? (
              <span className="inline-flex shrink-0 items-center justify-end group-focus-within/rail-row:hidden group-has-[[aria-expanded=true]]/rail-row:hidden">
                <RailSourceGlyph />
              </span>
            ) : null}
          </button>
          {/* Actions live in the row's context menu; the ⋯ stays out of the
              mouse flow and only appears for keyboard focus so it never
              competes with the name for the narrow row. */}
          <PopoverTrigger asChild>
            <IconButton
              data-testid={`apps-rail-app-${group.appId}-menu`}
              icon={<MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
              tone="ghost"
              size="sm"
              aria-label={t('Apps.library.cardMenuLabel')}
              title={t('Apps.library.cardMenuLabel')}
              className="desktop-sidebar__icon-action mr-1 hidden shrink-0 group-focus-within/rail-row:inline-flex group-has-[[aria-expanded=true]]/rail-row:inline-flex"
            />
          </PopoverTrigger>
        </div>
        {menuAnchorRef ? <PopoverAnchor virtualRef={menuAnchorRef} /> : null}
        <PopoverContent
          align={menuPoint ? 'start' : 'end'}
          sideOffset={menuPoint ? 2 : 6}
          className="p-1"
          onCloseAutoFocus={(event) => {
            // The ⋯ trigger hides again once the menu closes; return focus to
            // the row so keyboard users keep their place.
            event.preventDefault();
            rowButtonRef.current?.focus();
          }}
        >
          <ActionMenu items={menuItems} ariaLabel={t('Apps.library.cardMenuLabel')} />
        </PopoverContent>
      </Popover>
      {confirmElement}
    </div>
  );
}, railGroupRowPropsEqual);

function AppsHome({
  projection,
  attentionEntries,
  updateEntries,
  recentGroups,
  pendingActions,
  actionDispatcherFor,
  onRetry,
  onOpenDeveloperMode,
  onImportLocal,
  onFocusRailSearch,
  actionError,
  sourceChoiceNotice,
}: {
  readonly projection: DesktopAppsPanelProjection | null;
  readonly attentionEntries: readonly DesktopAppsEntry[];
  readonly updateEntries: readonly DesktopAppsEntry[];
  readonly recentGroups: readonly DesktopAppGroup[];
  readonly pendingActions: readonly AppsPendingAction[];
  readonly actionDispatcherFor: (entryKey: string) => (action: AppCardActionId) => void;
  readonly onRetry: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onImportLocal: () => void;
  readonly onFocusRailSearch: () => void;
  readonly actionError: AppsActionError | null;
  readonly sourceChoiceNotice?: string | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:!block" contentClassName="desktop-module-content desktop-module-stack">
      <header className="desktop-module-header">
        <h1 data-testid="apps-library-title" className="desktop-module-title">
          {t('Apps.library.pageTitle')}
        </h1>
        <div className="flex min-w-0 items-center gap-2">
          <AppsAddMenu onImport={onImportLocal} onDeveloper={onOpenDeveloperMode} onBrowse={onFocusRailSearch} />
        </div>
      </header>

      {actionError ? (
        <AppsActionErrorAlert error={actionError} />
      ) : null}
      {sourceChoiceNotice ? (
        <InlineAlert tone="info" data-testid="apps-choose-source">{sourceChoiceNotice}</InlineAlert>
      ) : null}

      {projection?.status === 'loaded' && projection.runtimeError ? (
        <AppsActionErrorAlert testId="apps-runtime-error" error={{ message: t('Apps.lifecycleReadFailed'), detail: projection.runtimeError }} />
      ) : null}

      <AppsHomeBody
        projection={projection}
        attentionEntries={attentionEntries}
        updateEntries={updateEntries}
        recentGroups={recentGroups}
        pendingActions={pendingActions}
        actionDispatcherFor={actionDispatcherFor}
        onRetry={onRetry}
        onOpenDeveloperMode={onOpenDeveloperMode}
        onImportLocal={onImportLocal}
        onFocusRailSearch={onFocusRailSearch}
      />
    </ScrollArea>
  );
}

function AppsHomeBody({
  projection,
  attentionEntries,
  updateEntries,
  recentGroups,
  pendingActions,
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
  readonly pendingActions: readonly AppsPendingAction[];
  readonly actionDispatcherFor: (entryKey: string) => (action: AppCardActionId) => void;
  readonly onRetry: () => void;
  readonly onOpenDeveloperMode: () => void;
  readonly onImportLocal: () => void;
  readonly onFocusRailSearch: () => void;
}): ReactElement {
  const { t } = useTranslation();

  if (projection === null) {
    return (
      <div data-testid="apps-panel-loading" aria-label={t('Apps.loading')} className="space-y-2">
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
      <div>
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
      <div>
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
        <CatalogStatusNote status={projection.catalogStatus} onRetry={onRetry} />
      </div>
    );
  }

  const iconUrls = appIconUrlsForEntries(hideBlockedDiscoveryEntries(projection.entries));

  return (
    <div className="desktop-module-stack">
      <AppsAttentionSection entries={attentionEntries} iconUrls={iconUrls} pendingActions={pendingActions}
        actionDispatcherFor={actionDispatcherFor} onRefresh={onRetry} />

      {updateEntries.length > 0 ? (
        <Surface as="section" tone="card" padding="none" className="desktop-module-card" data-testid="apps-home-updates" aria-label={t('Apps.home.updatesTitle')}>
          <h2 className="desktop-module-section-title flex min-w-0 items-baseline gap-2">
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
                iconUrl={iconUrls.get(entry.identity.appId)}
                showSourceBadge
                presentation="update"
                activeAction={pendingActionForEntry(pendingActions, entry.identity.entryKey)}
                actionsDisabled={appsActionsLocked(pendingActions, entry.identity.appId)}
                onAction={actionDispatcherFor(entry.identity.entryKey)}
              />
            ))}
          </div>
        </Surface>
      ) : null}

      <Surface as="section" tone="card" padding="none" className="desktop-module-card" data-testid="apps-home-recent" aria-label={t('Apps.home.recentTitle')}>
        <h2 className="desktop-module-section-title">
          {t('Apps.home.recentTitle')}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-4">
          {recentGroups.map((group) => (
            <AppListRow
              key={group.primary.identity.entryKey}
              entry={group.primary}
              iconUrl={group.iconUrl}
              showSourceBadge={group.entries.length > 1}
              activeAction={pendingActionForEntry(pendingActions, group.primary.identity.entryKey)}
              actionsDisabled={appsActionsLocked(pendingActions, group.appId)}
              onAction={actionDispatcherFor(group.primary.identity.entryKey)}
            />
          ))}
        </div>
      </Surface>

      <CatalogStatusNote status={projection.catalogStatus} onRetry={onRetry} />
    </div>
  );
}

function CatalogStatusNote({ status, onRetry }: {
  readonly status: DesktopAppsCatalogProjection['status'];
  readonly onRetry?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  if (status === 'unavailable') {
    return (
      <p role="status" data-testid="apps-catalog-read-failed" className="mt-4 flex flex-wrap items-center gap-1.5 px-1 text-xs text-[var(--nimi-text-muted)]">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('Apps.catalog.readFailed')}
        {onRetry ? <Button tone="ghost" size="sm" onClick={onRetry}>{t('Apps.action.retry')}</Button> : null}
      </p>
    );
  }
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
      className="h-8 w-8 min-h-8 shrink-0 rounded-full text-[var(--nimi-text-muted)]"
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
