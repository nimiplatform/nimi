import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiAIProfile } from '@nimiplatform/sdk/ai';
import { PackageIcon, RefreshIcon, SearchIcon, StarIcon } from './runtime-config-local-model-center-icons.js';
import type { NimiAccountProfileLibraryProjection, LibraryProfile } from './runtime-config-profile-library.js';

type ProfileSource = 'system' | 'custom' | 'imported';

type ProfileTableRow = {
  id: string;
  profile: NimiAIProfile;
  title: string;
  source: ProfileSource;
  sourceLabel: string;
  updatedAt: string;
  capabilityCount: number;
  removable: boolean;
  entry: LibraryProfile | null;
};

function countConfiguredCapabilities(profile: NimiAIProfile): number {
  return Object.values(profile.capabilities).filter((intent) => {
    return intent !== null && intent !== undefined;
  }).length;
}

function originDefaultLabel(origin: LibraryProfile['origin']): string {
  if (origin === 'user') return 'Custom';
  if (origin === 'imported') return 'Imported';
  return origin;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function formatUpdatedAt(updatedAt: string | undefined, fallback: string): string {
  if (!updatedAt) return fallback;
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) return updatedAt;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function SourceDot({ source }: { source: ProfileSource }) {
  const color = source === 'system'
    ? 'bg-[var(--nimi-status-success)]'
    : source === 'imported'
      ? 'bg-[var(--nimi-status-info)]'
      : 'bg-[var(--nimi-action-primary-bg)]';
  return <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />;
}

function TemplateGlyph({ source }: { source: ProfileSource }) {
  const className = source === 'system'
    ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'
    : source === 'imported'
      ? 'bg-[color-mix(in_srgb,var(--nimi-status-info)_16%,transparent)] text-[var(--nimi-status-info)]'
      : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[var(--nimi-action-primary-bg)]';
  return (
    <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${className}`}>
      <PackageIcon className="h-5 w-5" />
    </span>
  );
}

export function AccountProfileLibraryPanel(props: {
  projection: NimiAccountProfileLibraryProjection | null;
  accountDefaultProfile: NimiAIProfile | null;
  loading: boolean;
  onRefresh: () => void;
  onCreateFromDefault: () => void;
  onUseAsBase: (profile: NimiAIProfile) => void;
  onEdit: (entry: LibraryProfile) => void;
  onDelete: (entry: LibraryProfile) => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'library' | 'history'>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | ProfileSource>('all');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(['account-default']));

  const entries = props.projection?.profiles ?? [];
  const defaultCapabilityCount = props.accountDefaultProfile
    ? countConfiguredCapabilities(props.accountDefaultProfile)
    : 0;

  const rows = useMemo<ProfileTableRow[]>(() => {
    const accountDefault: ProfileTableRow[] = props.accountDefaultProfile
      ? [{
        id: 'account-default',
        profile: props.accountDefaultProfile,
        title: props.accountDefaultProfile.title || t('runtimeConfig.profiles.accountDefaultTitle', { defaultValue: 'Default Profile' }),
        source: 'system',
        sourceLabel: t('runtimeConfig.profiles.sourceSystem', { defaultValue: 'System' }),
        updatedAt: t('runtimeConfig.profiles.systemDefaultUpdated', { defaultValue: 'Factory default' }),
        capabilityCount: defaultCapabilityCount,
        removable: false,
        entry: null,
      }]
      : [];

    const libraryRows = entries.map((entry): ProfileTableRow => {
      const source: ProfileSource = entry.origin === 'imported' ? 'imported' : 'custom';
      return {
        id: entry.profileId,
        profile: entry.profile,
        title: entry.profile.title,
        source,
        sourceLabel: t(`runtimeConfig.profiles.origin.${entry.origin}`, {
          defaultValue: originDefaultLabel(entry.origin),
        }),
        updatedAt: formatUpdatedAt(entry.updatedAt, '-'),
        capabilityCount: countConfiguredCapabilities(entry.profile),
        removable: entry.removable,
        entry,
      };
    });

    return [...accountDefault, ...libraryRows];
  }, [defaultCapabilityCount, entries, props.accountDefaultProfile, t]);

  const query = normalized(searchQuery);
  const filteredRows = rows.filter((row) => {
    if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
    if (!query) return true;
    return normalized(`${row.title} ${row.sourceLabel}`).includes(query);
  });

  const toggleFavorite = (id: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section className="space-y-6" data-testid="runtime-profiles-account-library">
      <div className="border-b border-[var(--nimi-border-subtle)]" data-testid="runtime-profiles-tabs">
        <div className="flex flex-wrap gap-7">
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`border-b-2 px-0 py-3 text-sm font-semibold transition-colors ${
              activeTab === 'library'
                ? 'border-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-bg)]'
                : 'border-transparent text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'
            }`}
          >
            {t('runtimeConfig.profiles.tabTemplateLibrary', { defaultValue: 'Template Library' })}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`border-b-2 px-0 py-3 text-sm font-semibold transition-colors ${
              activeTab === 'history'
                ? 'border-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-bg)]'
                : 'border-transparent text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'
            }`}
          >
            {t('runtimeConfig.profiles.tabImportExportHistory', { defaultValue: 'Import / Export History' })}
          </button>
        </div>
      </div>

      {activeTab === 'library' ? (
        <section className="space-y-4" data-testid="runtime-profiles-custom-library">
          <div
            className="flex flex-wrap items-center gap-3"
            data-testid="runtime-profiles-filter-bar"
          >
            <label className="relative min-w-[18rem] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nimi-text-muted)]">
                <SearchIcon className="h-4 w-4" />
              </span>
              <input
                data-testid="runtime-profiles-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('runtimeConfig.profiles.searchPlaceholder', { defaultValue: 'Search templates by name...' })}
                className="h-10 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] pl-9 pr-3 text-sm text-[var(--nimi-text-primary)] outline-none transition-colors placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
              />
            </label>

            <select
              data-testid="runtime-profiles-source-filter"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as 'all' | ProfileSource)}
              className="h-10 min-w-40 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-sm text-[var(--nimi-text-secondary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
            >
              <option value="all">{t('runtimeConfig.profiles.allSources', { defaultValue: 'All Sources' })}</option>
              <option value="system">{t('runtimeConfig.profiles.sourceSystem', { defaultValue: 'System' })}</option>
              <option value="custom">{t('runtimeConfig.profiles.sourceCustom', { defaultValue: 'Custom' })}</option>
              <option value="imported">{t('runtimeConfig.profiles.sourceImported', { defaultValue: 'Imported' })}</option>
            </select>

            <button
              type="button"
              data-testid="runtime-profiles-refresh"
              onClick={props.onRefresh}
              disabled={props.loading}
              className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--nimi-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] hover:text-[var(--nimi-action-primary-bg)] disabled:pointer-events-none disabled:opacity-50"
              title={props.loading
                ? t('runtimeConfig.profiles.loadingShort', { defaultValue: 'Syncing...' })
                : t('runtimeConfig.profiles.reload', { defaultValue: 'Reload' })}
            >
              <RefreshIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed text-left" data-testid="runtime-profiles-table">
                <thead className="bg-[color-mix(in_srgb,var(--nimi-surface-panel)_74%,var(--nimi-surface-card))] text-xs font-semibold text-[var(--nimi-text-secondary)]">
                  <tr>
                    <th
                      className="w-12 px-4 py-3"
                      aria-label={t('runtimeConfig.profiles.favorite', { defaultValue: 'Favorite' })}
                    />
                    <th className="w-[46%] px-4 py-3">{t('runtimeConfig.profiles.tableTemplateName', { defaultValue: 'Template Name' })}</th>
                    <th className="w-[18%] px-4 py-3">{t('runtimeConfig.profiles.tableSource', { defaultValue: 'Source' })}</th>
                    <th className="w-[18%] px-4 py-3">{t('runtimeConfig.profiles.tableUpdated', { defaultValue: 'Updated' })}</th>
                    <th className="w-[18%] px-4 py-3 text-right">{t('runtimeConfig.profiles.tableActions', { defaultValue: 'Actions' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--nimi-border-subtle)]">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--nimi-text-muted)]">
                        {t('runtimeConfig.profiles.noCustom', { defaultValue: 'Create one for this account, or import portable AIProfile JSON from another machine.' })}
                      </td>
                    </tr>
                  ) : filteredRows.map((row) => {
                    const favorite = favoriteIds.has(row.id);
                    return (
                      <tr key={row.id} className="align-middle" data-testid="runtime-profiles-template-row">
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            onClick={() => toggleFavorite(row.id)}
                            className={`inline-flex items-center justify-center transition-colors ${
                              favorite
                                ? 'text-[var(--nimi-status-warning)]'
                                : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-status-warning)]'
                            }`}
                            aria-label={favorite
                              ? t('runtimeConfig.profiles.removeFavorite', { defaultValue: 'Remove favorite' })
                              : t('runtimeConfig.profiles.addFavorite', { defaultValue: 'Add favorite' })}
                          >
                            <StarIcon className="h-4 w-4" />
                          </button>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <TemplateGlyph source={row.source} />
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{row.title}</p>
                                {row.source === 'system' ? (
                                  <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--nimi-status-success)]">
                                    {t('runtimeConfig.profiles.accountDefaultBadge', { defaultValue: 'Account default' })}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 text-[11px] text-[var(--nimi-text-muted)]">
                                {t('runtimeConfig.profiles.capabilityCount', {
                                  defaultValue: '{{count}} configured capabilities',
                                  count: row.capabilityCount,
                                })}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
                            <SourceDot source={row.source} />
                            {row.sourceLabel}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm leading-6 text-[var(--nimi-text-secondary)]">{row.updatedAt}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              data-testid={row.source === 'system' ? 'runtime-profiles-copy-default' : 'runtime-profiles-use-as-base'}
                              onClick={() => (row.source === 'system' ? props.onCreateFromDefault() : props.onUseAsBase(row.profile))}
                              className="inline-flex h-8 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_48%,transparent)] bg-[var(--nimi-surface-card)] px-3 text-xs font-semibold text-[var(--nimi-action-primary-bg)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]"
                            >
                              {t('runtimeConfig.profiles.useAsBase', { defaultValue: 'Use' })}
                            </button>
                            {row.entry ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => props.onEdit(row.entry as LibraryProfile)}
                                  className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-panel)]"
                                >
                                  {t('runtimeConfig.profiles.edit', { defaultValue: 'Edit' })}
                                </button>
                                <button
                                  type="button"
                                  disabled={!row.removable}
                                  onClick={() => props.onDelete(row.entry as LibraryProfile)}
                                  className="inline-flex h-8 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[var(--nimi-surface-card)] px-3 text-xs font-medium text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] disabled:pointer-events-none disabled:opacity-50"
                                >
                                  {t('runtimeConfig.profiles.delete', { defaultValue: 'Delete' })}
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.historyEmptyTitle', { defaultValue: 'No import or export events in this session' })}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.profiles.historyEmptyBody', { defaultValue: 'Successful file actions report status in the header controls.' })}
          </p>
        </section>
      )}

    </section>
  );
}
