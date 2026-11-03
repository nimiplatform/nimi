import { useState } from 'react';
import { ArrowLeft, ChevronRight, Code2, MoreHorizontal, Play } from 'lucide-react';
import { Button, IconButton, NimiTabs, ScrollArea, SearchField, cn } from '@nimiplatform/kit/ui';
import type { HeroDemo, HeroDemoAppItem } from '../content/landing-content.js';
import { DemoAppPreview } from './demo-app-preview.js';

/**
 * Identity-tile gradients mirrored from the desktop apps panel
 * (apps-card-fields.ts). The same FNV-1a hash keeps an App on the same
 * palette here as in the desktop library.
 */
const APP_ICON_BACKGROUNDS = [
  'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
  'linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)',
  'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #fb7185 0%, #e11d48 100%)',
  'linear-gradient(135deg, #fbbf24 0%, #f97316 100%)',
  'linear-gradient(135deg, #818cf8 0%, #4f46e5 100%)',
  'linear-gradient(135deg, #34d399 0%, #059669 100%)',
  'linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)',
] as const;

function appIconBackground(appId: string): string {
  let hash = 2166136261;
  for (let index = 0; index < appId.length; index += 1) {
    hash ^= appId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return APP_ICON_BACKGROUNDS[(hash >>> 0) % APP_ICON_BACKGROUNDS.length] ?? APP_ICON_BACKGROUNDS[0];
}

function deriveIconGlyph(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  return (Array.from(trimmed)[0] ?? '?').toLocaleUpperCase();
}

const ICON_SIZE_CLASS = {
  xs: 'h-6 w-6 rounded-md text-xs',
  lg: 'h-16 w-16 rounded-2xl text-2xl',
} as const;

/** Replica of the desktop AppArtworkIcon: real icon when shipped, gradient glyph tile otherwise. */
export function AppArtworkIcon({
  item,
  size,
}: {
  item: HeroDemoAppItem;
  size: keyof typeof ICON_SIZE_CLASS;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold text-white',
        ICON_SIZE_CLASS[size],
      )}
      style={{
        background: item.iconSrc ? 'transparent' : appIconBackground(item.id),
        fontFamily: 'var(--nimi-font-display)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 6px rgba(15,23,42,0.18)',
      }}
    >
      {item.iconSrc ? (
        <img
          src={item.iconSrc}
          alt=""
          loading="lazy"
          decoding="async"
          width={size === 'xs' ? 24 : 64}
          height={size === 'xs' ? 24 : 64}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        deriveIconGlyph(item.name)
      )}
    </span>
  );
}

export function DemoAppsSurface({
  apps,
  preview,
  initialAppId,
}: {
  apps: HeroDemo['apps'];
  preview: HeroDemo['appPreview'];
  initialAppId?: string;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialAppId ?? null);
  const [detailOpen, setDetailOpen] = useState(Boolean(initialAppId));
  const [activeTab, setActiveTab] = useState('0');
  const [previewAppId, setPreviewAppId] = useState<string | null>(null);

  const t = (zh: string, en: string) => (preview.locale === 'zh' ? zh : en);
  const [infoOpen, setInfoOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = normalizedQuery
    ? apps.items.filter(
        (item) =>
          item.name.toLowerCase().includes(normalizedQuery) ||
          item.id.toLowerCase().includes(normalizedQuery),
      )
    : apps.items;
  const selected = apps.items.find((item) => item.id === selectedId) ?? null;
  const tabItems = apps.tabs
    .slice(0, selected?.id === 'nimi.zhiyu' ? 2 : undefined)
    .map((label, index) => ({ value: String(index), label }));

  return (
    <div className="demo-apps-workspace flex h-full min-h-0 gap-2">
      <aside
        className={cn(
          'demo-apps-sidebar w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] md:w-[248px]',
          detailOpen ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="flex min-h-[var(--nimi-sidebar-header-height,56px)] shrink-0 items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <p className="text-base font-semibold leading-6 text-[var(--nimi-text-primary)]">{apps.title}</p>
            <p className="truncate text-[11px] text-[var(--nimi-text-muted)]">
              {apps.items.length}
              {apps.countSuffix}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={apps.searchPlaceholder}
            aria-label={apps.searchPlaceholder}
            className="min-h-8 min-w-0 flex-1"
          />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-0.5 px-2 pb-2">
            {visibleItems.map((item) => {
              const isSelected = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedId(item.id);
                      setDetailOpen(true);
                      setActiveTab('0');
                    }}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 pl-2 pr-1 text-left transition-colors',
                      isSelected
                        ? 'bg-[var(--nimi-surface-active)]'
                        : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)]',
                    )}
                  >
                    <AppArtworkIcon item={item} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-[var(--nimi-text-primary)]">
                      {item.name}
                    </span>
                    {item.localDev ? (
                      <span
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[var(--nimi-text-muted)]"
                        title={item.id}
                      >
                        <Code2 className="h-3 w-3" aria-hidden="true" />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </aside>

      <section
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] shadow-[var(--nimi-elevation-base)]',
          'flex',
        )}
      >
        {selected ? (
          <>
            <header className="shrink-0 px-5 pt-4 sm:px-7 sm:pt-5">
              <Button
                tone="ghost"
                size="sm"
                className="-ml-2 mb-3"
                onClick={() => {
                  setDetailOpen(false);
                  setSelectedId(null);
                }}
              >
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                {apps.backLabel}
              </Button>

              <div className="demo-app-detail-summary flex min-w-0 items-center gap-5">
                <AppArtworkIcon item={selected} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-2xl font-semibold leading-8 text-[var(--nimi-text-primary)]">
                    {selected.name}
                  </h3>
                  <p className="mt-1.5 break-words text-sm leading-6 text-[var(--nimi-text-secondary)]">
                    {selected.task}
                  </p>
                </div>
                <div className="demo-app-detail-actions flex shrink-0 items-center gap-2">
                  <Button tone="primary" onClick={() => setPreviewAppId(selected.id)}>
                    <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                    {apps.launchLabel}
                  </Button>
                  <IconButton
                    tone="secondary"
                    aria-label={apps.moreInfoLabel}
                    title={apps.moreInfoLabel}
                    icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setInfoOpen(!infoOpen)}
                  />
                </div>
              </div>

              {infoOpen && (
                <p className="demo-muted mt-3">
                  {selected.id} · {t('演示数据', 'Sample data')}
                </p>
              )}
              <NimiTabs
                className="mt-5"
                items={tabItems}
                value={activeTab}
                onValueChange={setActiveTab}
                ariaLabel={apps.title}
              />
            </header>

            <ScrollArea className="min-h-0 flex-1" viewportClassName="bg-transparent">
              <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-7">
                {activeTab === '0' ? (
                  <div className="flex flex-col gap-7 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] xl:items-start">
                    <section
                      className="min-w-0 xl:order-2"
                      aria-label={`${apps.aboutTitle} ${selected.name}`}
                    >
                      <h4 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
                        {apps.aboutTitle} {selected.name}
                      </h4>
                      <div className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-active)_38%,transparent)] px-5 py-4">
                        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
                          <div className="min-w-0">
                            <dt className="text-xs leading-4 text-[var(--nimi-text-muted)]">
                              {apps.updatedLabel}
                            </dt>
                            <dd className="mt-1 break-words text-sm font-medium leading-5 text-[var(--nimi-text-primary)]">
                              {selected.updatedAt}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-4 flex items-center">
                          <Button
                            tone="ghost"
                            size="sm"
                            className="-ml-2"
                            onClick={() => setInfoOpen(!infoOpen)}
                          >
                            {apps.moreInfoLabel}
                            <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </section>

                    <div className="min-w-0 max-w-3xl xl:order-1">
                      <h4 className="mb-3 text-xl font-semibold leading-8 text-[var(--nimi-text-primary)]">
                        {selected.name}
                      </h4>
                      <p className="my-3 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                        {selected.task}
                      </p>
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {selected.tags.map((tag) => (
                          <li
                            key={tag}
                            className="rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_68%,transparent)] px-1.5 py-0.5 text-xs leading-4 text-[var(--nimi-text-muted)]"
                          >
                            {tag}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="demo-management-card">
                    <h2>{activeTab === '1' ? 'Nimi Access' : t('AI 配置', 'AI configuration')}</h2>
                    <p className="demo-muted mt-3">
                      {activeTab === '1'
                        ? t(
                            '此应用使用 Nimi 管理的身份、能力与授权。',
                            'This app uses identity, capabilities, and permissions managed by Nimi.',
                          )
                        : t(
                            '应用可使用本机配置，也可以选择专属的云端模型。',
                            'Use the local configuration or choose a cloud model for this app.',
                          )}
                    </p>
                    {selected.tags.map((tag) => (
                      <div key={tag} className="demo-setting-row">
                        <strong>{tag}</strong>
                        <span className="demo-success">{t('已配置 · 示例', 'Configured · Sample')}</span>
                      </div>
                    ))}
                    <p className="demo-simulation-note">{apps.previewBadge}</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="demo-apps-overview">
            <h1>{t('应用中心', 'App center')}</h1>
            <h2 className="mt-6 mb-4">{t('最近活跃', 'Recently active')}</h2>
            <div className="demo-app-grid">
              {visibleItems.map((item) => (
                <article key={item.id} className="demo-management-card">
                  <button
                    type="button"
                    className="demo-app-overview-title"
                    onClick={() => {
                      setSelectedId(item.id);
                      setDetailOpen(true);
                      setActiveTab('0');
                    }}
                  >
                    <AppArtworkIcon item={item} size="lg" />
                    <h2>{item.name}</h2>
                  </button>
                  <p className="demo-muted my-3">{item.task}</p>
                  <Button size="sm" tone="secondary" onClick={() => setPreviewAppId(item.id)}>
                    <Play size={13} />
                    {apps.launchLabel}
                  </Button>
                </article>
              ))}
            </div>
            {visibleItems.length === 0 && (
              <p className="demo-empty">{t('没有匹配的应用', 'No matching apps')}</p>
            )}
          </div>
        )}
      </section>

      <DemoAppPreview
        appId={previewAppId}
        apps={apps}
        preview={preview}
        onClose={() => setPreviewAppId(null)}
      />
    </div>
  );
}
