import { useState } from 'react';
import { Button, EmptyState, IconButton, ScrollArea, SearchField, cn } from '@nimiplatform/kit/ui';
import type { HeroDemo, HeroDemoAppItem } from '../content/landing-content.js';
import { DemoAppPreview } from './demo-app-preview.js';
import { BackIcon, CodeIcon, MoreIcon, PlayIcon } from './demo-icons.js';

const APP_ICON_TONES = [
  'bg-gradient-to-br from-[#8b93f8] to-[#6d28d9] text-white',
  'bg-gradient-to-br from-[#2fc79a] to-[#22cce7] text-slate-950',
  'bg-gradient-to-br from-[#f9a8d4] to-[#c026d3] text-white',
  'bg-gradient-to-br from-[#fcd34d] to-[#d97706] text-slate-950',
  'bg-gradient-to-br from-[#93c5fd] to-[#2563eb] text-white',
  'bg-gradient-to-br from-[#94a3b8] to-[#475569] text-white',
] as const;

function appIconTone(index: number): string {
  return APP_ICON_TONES[index % APP_ICON_TONES.length] ?? APP_ICON_TONES[0];
}

function AppIconTile({ item, index, size }: { item: HeroDemoAppItem; index: number; size: 'sm' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-2xl font-bold',
        size === 'lg' ? 'h-14 w-14 text-xl' : 'h-9 w-9 text-sm',
        appIconTone(index),
      )}
      aria-hidden="true"
    >
      {Array.from(item.name)[0]}
    </span>
  );
}

export function DemoAppsSurface({
  apps,
  preview,
}: {
  apps: HeroDemo['apps'];
  preview: HeroDemo['appPreview'];
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(apps.items[0]?.id ?? null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [previewAppId, setPreviewAppId] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = normalizedQuery
    ? apps.items.filter((item) => (
      item.name.toLowerCase().includes(normalizedQuery)
      || item.id.toLowerCase().includes(normalizedQuery)
    ))
    : apps.items;
  const selected = apps.items.find((item) => item.id === selectedId) ?? null;
  const selectedIndex = apps.items.findIndex((item) => item.id === selectedId);

  return (
    <div className="flex h-full min-h-0 gap-2">
      <div
        className={cn(
          'w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] md:w-[240px]',
          detailOpen ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="flex shrink-0 items-baseline justify-between px-4 pt-3">
          <span className="text-sm font-semibold text-[var(--nimi-text-primary)]">{apps.title}</span>
          <span className="text-[11px] text-[var(--nimi-text-muted)]">{apps.items.length}{apps.countSuffix}</span>
        </div>
        <div className="shrink-0 px-2 pb-2 pt-2">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={apps.searchPlaceholder}
            aria-label={apps.searchPlaceholder}
          />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-0.5 px-2 pb-2">
            {visibleItems.map((item) => {
              const index = apps.items.indexOf(item);
              const isSelected = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedId(item.id);
                      setDetailOpen(true);
                      setActiveTab(0);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition',
                      isSelected ? 'bg-[var(--nimi-surface-active)]' : 'hover:bg-[var(--nimi-surface-active)]/60',
                    )}
                  >
                    <AppIconTile item={item} index={index} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                      {item.name}
                    </span>
                    {item.localDev ? (
                      <span className="shrink-0 text-[var(--nimi-text-muted)]" title={item.id}>
                        <CodeIcon />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </div>

      <div className={cn('min-w-0 flex-1 flex-col', detailOpen ? 'flex' : 'hidden md:flex')}>
        {selected ? (
          <div className="flex h-full min-h-0 flex-col overflow-y-auto px-1 py-1">
            <div className="md:hidden">
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-surface-active)]"
              >
                <BackIcon />
                {apps.backLabel}
              </button>
            </div>
            <div className="flex items-start gap-3 px-1 pt-1">
              <AppIconTile item={selected} index={selectedIndex} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold tracking-tight text-[var(--nimi-text-primary)]">
                  {selected.name}
                </p>
                <p className="mt-0.5 text-[11px] leading-5 text-[var(--nimi-text-muted)]">{selected.id}</p>
              </div>
              <Button tone="primary" size="sm" leadingIcon={<PlayIcon />} onClick={() => setPreviewAppId(selected.id)}>
                {apps.launchLabel}
              </Button>
              <IconButton aria-label={apps.moreInfoLabel} icon={<MoreIcon />} size="sm" />
            </div>

            <div className="mt-3 flex items-center gap-1 border-b border-[var(--nimi-border-subtle)] px-1">
              {apps.tabs.map((tab, tabIndex) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={tabIndex === activeTab}
                  onClick={() => setActiveTab(tabIndex)}
                  className={cn(
                    'rounded-t-md px-3 py-1.5 text-xs font-semibold transition',
                    tabIndex === activeTab
                      ? 'border-b-2 border-[var(--nimi-action-primary-bg)] text-[var(--nimi-text-primary)]'
                      : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 0 ? (
              <div className="flex flex-col gap-3 py-3 lg:flex-row">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{selected.task}</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {selected.tags.map((tag) => (
                      <li
                        key={tag}
                        className="rounded-full bg-[var(--nimi-surface-active)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-text-secondary)]"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="w-full shrink-0 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 lg:w-52">
                  <p className="text-xs font-semibold text-[var(--nimi-text-primary)]">{apps.aboutTitle} {selected.name}</p>
                  <p className="mt-2 text-[11px] text-[var(--nimi-text-muted)]">{apps.updatedLabel}</p>
                  <p className="text-[11px] font-medium text-[var(--nimi-text-secondary)]">{selected.updatedAt}</p>
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-[var(--nimi-text-muted)]">{apps.tabPlaceholderNote}</p>
            )}
          </div>
        ) : (
          <EmptyState title={apps.title} className="m-auto" />
        )}
      </div>

      <DemoAppPreview
        appId={previewAppId}
        apps={apps}
        preview={preview}
        onClose={() => setPreviewAppId(null)}
      />
    </div>
  );
}
