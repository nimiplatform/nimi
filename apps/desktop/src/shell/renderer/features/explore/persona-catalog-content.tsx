import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Button,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  SearchField,
  SidebarShell,
  Surface,
} from '@nimiplatform/kit/ui';
import { characterSourceRefKey } from './character-source-materialization';
import { SourceDetailPanel } from '../source-detail/source-detail-panel';
import type { ExplorePersonaSourceCardData } from './explore-cards';

/**
 * Persona counterpart of the world catalog: left rail listing persona sources,
 * right side shows the selected persona's full profile (SourceDetailPanel).
 */
// @nimi-authority: rule.nimi.desktop.shell-ui.r002
// @nimi-authority: rule.nimi.desktop.product-surfaces.r005
export function PersonaCatalogContent({
  personas,
  searchQuery,
  onSearchQueryChange,
  loading = false,
  error = false,
  onRetry,
  embedded = false,
  railFlap,
}: {
  personas: readonly ExplorePersonaSourceCardData[];
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  embedded?: boolean;
  railFlap?: ReactNode;
}) {
  const { t } = useTranslation();
  const query = searchQuery ?? '';
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedPersona = useMemo(() => {
    return (
      personas.find((persona) => characterSourceRefKey(persona.sourceRef) === selectedKey)
      ?? personas[0]
      ?? null
    );
  }, [personas, selectedKey]);

  const content = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:flex-row">
      <SidebarShell className="min-h-0 w-full lg:w-[272px]" data-testid="persona-rail">
        <div className="flex min-h-[var(--nimi-sidebar-header-height)] shrink-0 items-center gap-2.5 px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
              {t('Explore.sectionPersonas')}
            </h1>
            <p className="truncate text-[11px] text-[color:var(--nimi-text-muted)]">
              {t('Explore.personaCount', { count: personas.length })}
            </p>
          </div>
          {railFlap}
        </div>

        <div className="flex shrink-0 items-center gap-1 px-2 pb-2" data-testid="persona-rail-search">
          <SearchField
            value={query}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onSearchQueryChange?.('');
            }}
            placeholder={t('Explore.searchPlaceholder')}
            aria-label={t('Explore.searchPlaceholder')}
            className="min-h-8 flex-1"
            inputClassName="text-xs"
          />
        </div>

        <div
          data-persona-rail-list
          className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-2 pb-2 lg:flex-col lg:gap-0 lg:overflow-x-hidden lg:overflow-y-auto"
        >
          {loading ? (
            <div aria-hidden="true" className="w-full space-y-2 px-2 py-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-11 animate-pulse rounded-lg bg-[var(--nimi-surface-active)]" />
              ))}
            </div>
          ) : error ? (
            <p className="px-2 py-4 text-xs leading-5 text-[color:var(--nimi-status-danger-soft-text)]">
              {t('Explore.personaSourcesLoadError', { defaultValue: 'Could not load personas.' })}
            </p>
          ) : personas.length === 0 ? (
            <p className="px-2 py-4 text-xs leading-5 text-[color:var(--nimi-text-muted)]">
              {t('Explore.personaSourcesEmpty')}
            </p>
          ) : (
            <div className="flex gap-2 lg:flex-col lg:gap-0.5">
              {personas.map((persona, index) => (
                <PersonaRailRow
                  key={persona.id}
                  persona={persona}
                  selected={selectedPersona?.id === persona.id}
                  tabIndex={selectedPersona?.id === persona.id || (!selectedPersona && index === 0) ? 0 : -1}
                  onSelect={() => setSelectedKey(characterSourceRefKey(persona.sourceRef))}
                  onKeyDown={handleRailKeyDown}
                />
              ))}
            </div>
          )}
        </div>
      </SidebarShell>

      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-[24px] border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)] max-lg:min-h-[420px]"
      >
        {loading ? (
          <div className="flex min-h-0 flex-1 items-center p-6">
            <LoadingSkeleton
              lines={4}
              label={t('Common.loading', { defaultValue: 'Loading personas…' })}
              className="w-full"
            />
          </div>
        ) : error ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <InlineAlert
              tone="danger"
              className="w-full max-w-md"
              action={onRetry ? (
                <Button type="button" tone="secondary" size="sm" onClick={onRetry}>
                  {t('Explore.retryPersonas', { defaultValue: 'Retry' })}
                </Button>
              ) : undefined}
            >
              {t('Explore.personaSourcesLoadError', { defaultValue: 'Could not load personas.' })}
            </InlineAlert>
          </div>
        ) : personas.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <EmptyState title={t('Explore.personaSourcesEmpty')} />
          </div>
        ) : selectedPersona ? (
          <SourceDetailPanel
            key={characterSourceRefKey(selectedPersona.sourceRef)}
            sourceRef={selectedPersona.sourceRef}
            onBack={null}
          />
        ) : null}
      </Surface>
    </div>
  );

  if (embedded) {
    return content;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      {content}
    </div>
  );
}

function PersonaRailRow({
  persona,
  selected,
  tabIndex,
  onSelect,
  onKeyDown,
}: {
  persona: ExplorePersonaSourceCardData;
  selected: boolean;
  tabIndex?: number;
  onSelect: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const subtitle = persona.handle ? `@${persona.handle}` : persona.worldName;
  return (
    <button
      type="button"
      data-persona-row
      data-testid={`persona-rail-entry-${persona.id}`}
      aria-pressed={selected}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`flex w-[208px] min-w-0 shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] lg:w-full ${selected
        ? 'bg-[var(--nimi-surface-active)]'
        : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)]'
      }`}
    >
      <Avatar
        alt={persona.name}
        src={persona.avatarUrl}
        size="sm"
        fallback={persona.name.trim().charAt(0).toUpperCase() || 'P'}
        fallbackClassName="bg-[image:var(--nimi-surface-hero)] text-[var(--nimi-action-primary-text)]"
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[13px] leading-5 text-[color:var(--nimi-text-primary)] ${selected ? 'font-semibold' : 'font-medium'}`}
          title={persona.name}
        >
          {persona.name}
        </span>
        {subtitle ? (
          <span className="block truncate text-[11px] leading-4 text-[color:var(--nimi-text-muted)]">{subtitle}</span>
        ) : null}
      </span>
      {persona.isOnline ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
      ) : null}
    </button>
  );
}

function handleRailKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const list = event.currentTarget.closest<HTMLElement>('[data-persona-rail-list]');
  const rows = Array.from(list?.querySelectorAll<HTMLButtonElement>('[data-persona-row]') ?? []);
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
}
