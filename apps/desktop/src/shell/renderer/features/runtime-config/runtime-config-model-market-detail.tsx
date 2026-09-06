import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge, Surface } from '@nimiplatform/kit/ui';

import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { formatBytes, formatCompactCount } from './runtime-config-model-center-utils';

// HuggingFace-style model detail building blocks. Every piece renders only
// data the Runtime market feed actually returned; absent fields simply omit
// their row so the page never invents placeholder content.

// Two-column model detail layout: main content column plus a fixed-width
// sidebar for stats and specs, stacking on narrow panels.
export function MarketDetailColumns(props: {
  readonly main: ReactNode;
  readonly sidebar: ReactNode;
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">{props.main}</div>
      <aside className="min-w-0 space-y-4">{props.sidebar}</aside>
    </div>
  );
}

// HuggingFace-style identity row: org avatar, "author / title" headline, and
// trust badges (verified / installed).
export function ModelIdentityHeader(props: {
  readonly author?: string;
  readonly title: string;
  readonly verified?: boolean;
  readonly badges?: ReactNode;
}) {
  const { t } = useTranslation();
  const author = (props.author ?? '').trim();
  return (
    <div className="flex min-w-0 items-start gap-3">
      <AuthorAvatar author={props.author} size="lg" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="break-all text-xl font-semibold text-[var(--nimi-text-primary)]">
            {author ? <span className="text-[var(--nimi-text-muted)]">{author} / </span> : null}
            {props.title}
          </h1>
          {props.verified ? (
            <StatusBadge tone="success" shape="soft">
              {t('runtimeConfig.recommend.verified', { defaultValue: 'Verified' })}
            </StatusBadge>
          ) : null}
          {props.badges}
        </div>
      </div>
    </div>
  );
}

// HuggingFace-style tag chips under the header (task, library, license, …).
export function ModelTagRow(props: { readonly tags: readonly string[] }) {
  const tags = props.tags.map((tag) => tag.trim()).filter(Boolean);
  if (tags.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <StatusBadge key={tag} tone="neutral" shape="soft">{tag}</StatusBadge>
      ))}
    </div>
  );
}

// Sidebar stat block mirroring the HuggingFace model page right rail: big
// compact numbers for downloads/likes plus the last-updated timestamp.
export function ModelStatsCard(props: {
  readonly downloads?: number;
  readonly likes?: number;
  readonly updatedAt?: string;
  readonly installed?: boolean;
}) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const stats: Array<{ key: string; value: string; label: string; title: string }> = [];
  if (props.downloads) {
    stats.push({
      key: 'downloads',
      value: formatCompactCount(props.downloads),
      label: t('runtimeConfig.recommend.detailStatDownloads', { defaultValue: 'Downloads' }),
      title: t('runtimeConfig.recommend.downloads', { count: props.downloads, defaultValue: '{{count}} downloads' }),
    });
  }
  if (props.likes) {
    stats.push({
      key: 'likes',
      value: formatCompactCount(props.likes),
      label: t('runtimeConfig.recommend.detailStatLikes', { defaultValue: 'Likes' }),
      title: t('runtimeConfig.recommend.likes', { count: props.likes, defaultValue: '{{count}} likes' }),
    });
  }
  if (stats.length === 0 && !props.updatedAt && !props.installed) {
    return null;
  }
  return (
    <Surface tone="card" className="space-y-3 p-4">
      {stats.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {stats.map((stat) => (
            <div key={stat.key} title={stat.title}>
              <p className="text-lg font-semibold text-[var(--nimi-text-primary)]">{stat.value}</p>
              <p className="text-xs text-[var(--nimi-text-muted)]">{stat.label}</p>
            </div>
          ))}
        </div>
      ) : null}
      {props.updatedAt ? (
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.recommend.updatedAt', { when: i18n.formatRelativeTime(props.updatedAt), defaultValue: 'Updated {{when}}' })}
        </p>
      ) : null}
      {props.installed ? (
        <div>
          <StatusBadge tone="success" shape="soft">
            {t('runtimeConfig.recommend.installedState', { defaultValue: 'Already installed' })}
          </StatusBadge>
        </div>
      ) : null}
    </Surface>
  );
}

export type ModelSpecEntry = {
  readonly key: string;
  readonly label: string;
  readonly value?: string;
};

// Sidebar definition list for model facts (variant, format, license, …).
// Entries without a value are dropped.
export function ModelSpecsCard(props: {
  readonly title: string;
  readonly entries: readonly ModelSpecEntry[];
}) {
  const visible = props.entries.filter((entry) => Boolean(entry.value && entry.value.trim()));
  if (visible.length === 0) {
    return null;
  }
  return (
    <Surface tone="card" className="space-y-2 p-4">
      <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h3>
      <dl className="space-y-1.5">
        {visible.map((entry) => (
          <div key={entry.key} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="shrink-0 text-[var(--nimi-text-muted)]">{entry.label}</dt>
            <dd className="min-w-0 break-all text-right font-medium text-[var(--nimi-text-secondary)]">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </Surface>
  );
}

// HuggingFace-style market card meta row: one inline line of icon+text items
// joined by dot separators instead of chip badges.
export function MarketMeta(props: {
  readonly categories: readonly string[];
  readonly format?: string;
  readonly size?: number;
  readonly license?: string;
  readonly updatedAt?: string;
  readonly downloads?: number;
  readonly likes?: number;
}) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const items: Array<{ key: string; node: ReactNode }> = [];
  const categoryLabel = props.categories
    .map((value) => t(`runtimeConfig.recommend.capability.${value}`, { defaultValue: value }))
    .join(' / ');
  if (categoryLabel) {
    items.push({
      key: 'category',
      node: (
        <span className="inline-flex items-center gap-1">
          <TaskTypeIcon className="h-3.5 w-3.5" />
          {categoryLabel}
        </span>
      ),
    });
  }
  if (props.format) {
    items.push({ key: 'format', node: <span>{props.format}</span> });
  }
  if (props.size) {
    items.push({ key: 'size', node: <span>{formatBytes(props.size)}</span> });
  }
  if (props.license) {
    items.push({ key: 'license', node: <span>{props.license}</span> });
  }
  if (props.updatedAt) {
    items.push({
      key: 'updated',
      node: <span>{t('runtimeConfig.recommend.updatedAt', { when: i18n.formatRelativeTime(props.updatedAt), defaultValue: 'Updated {{when}}' })}</span>,
    });
  }
  if (props.downloads) {
    items.push({
      key: 'downloads',
      node: (
        <span
          className="inline-flex items-center gap-1"
          title={t('runtimeConfig.recommend.downloads', { count: props.downloads, defaultValue: '{{count}} downloads' })}
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {formatCompactCount(props.downloads)}
        </span>
      ),
    });
  }
  if (props.likes) {
    items.push({
      key: 'likes',
      node: (
        <span
          className="inline-flex items-center gap-1"
          title={t('runtimeConfig.recommend.likes', { count: props.likes, defaultValue: '{{count}} likes' })}
        >
          <HeartIcon className="h-3.5 w-3.5" />
          {formatCompactCount(props.likes)}
        </span>
      ),
    });
  }
  return items.length > 0 ? (
    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--nimi-text-muted)]">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {item.node}
        </Fragment>
      ))}
    </div>
  ) : null;
}

// Local stand-in for organization avatars: deterministic color tile with the
// author's initial, so cards keep the HuggingFace-style org marker without any
// remote image dependency. Swap for an <img> once the model-index feed carries
// real avatar URLs.
export function AuthorAvatar(props: { readonly author?: string; readonly size?: 'sm' | 'lg' }) {
  const author = (props.author ?? '').trim();
  const initial = author ? (Array.from(author)[0] ?? '').toUpperCase() : '';
  if (!initial) {
    return null;
  }
  let hash = 0;
  for (const ch of author) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  const sizeClass = props.size === 'lg'
    ? 'h-9 w-9 rounded-lg text-sm'
    : 'h-5 w-5 rounded-md text-[11px]';
  return (
    <span
      aria-hidden="true"
      title={author}
      className={`flex shrink-0 select-none items-center justify-center font-semibold text-white ${sizeClass}`}
      style={{ backgroundColor: `hsl(${hash % 360} 45% 42%)` }}
    >
      {initial}
    </span>
  );
}

function TaskTypeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function HeartIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}
