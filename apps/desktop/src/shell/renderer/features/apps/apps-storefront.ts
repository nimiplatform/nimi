// Pure Desktop Storefront projection helpers (zero direct HTTP JSON calls).
// Verified entries may load declared static media by exact content digest via
// <img src>; user_imported packages stay strictly local.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c

import type {
  AppStorefrontImageRef,
  AppStorefrontInfo,
  AppStorefrontLocale,
  AppStorefrontLocalizedImage,
} from '@nimiplatform/sdk/runtime/wire-types';
import type { LocalDevelopmentProjectStorefront } from '../local-development/local-development-bridge.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import { appSourceForEntry } from './apps-card-fields.js';

export const DESKTOP_STOREFRONT_MEDIA_BASE = 'https://nimi.ai/.well-known/nimi-apps/media';

export const STOREFRONT_CATEGORIES = Object.freeze([
  'companions-worlds',
  'lifestyle',
  'writing-notes',
  'design-diagrams',
  'audio-music',
  'video-media',
  'research-learning',
  'productivity-automation',
  'developer-tools',
] as const);

export type StorefrontCategoryId = (typeof STOREFRONT_CATEGORIES)[number];
export type ProductOriginId = 'nimi-official' | 'open-source-adapted' | 'community';

export interface ResolvedStorefrontGallerySlide {
  readonly id: string;
  readonly url: string;
  readonly caption: string;
}

export interface ResolvedStorefrontHighlight {
  readonly title: string;
  readonly description: string;
}

export interface ResolvedStorefrontView {
  readonly hasStorefront: boolean;
  readonly category: string | null;
  readonly displayName: string;
  readonly summary: string | null;
  readonly introductionMarkdown: string | null;
  readonly tags: readonly string[];
  readonly highlights: readonly ResolvedStorefrontHighlight[];
  readonly coverUrl: string | null;
  readonly gallery: readonly ResolvedStorefrontGallerySlide[];
}

export function normalizeUiLocale(language: string): string {
  const lower = String(language || 'en').trim().toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('en')) return 'en';
  const primary = lower.split(/[-_]/u)[0];
  return primary || 'en';
}

export function verifiedStorefrontImageUrl(appId: string, ref: AppStorefrontImageRef | undefined): string | null {
  if (!ref || !ref.sha256 || !/^[0-9a-f]{64}$/u.test(ref.sha256)) return null;
  const ext = ref.mediaType === 'image/png' ? 'png' : ref.mediaType === 'image/webp' ? 'webp' : null;
  if (!ext) return null;
  return `${DESKTOP_STOREFRONT_MEDIA_BASE}/${encodeURIComponent(appId)}/${ref.sha256}.${ext}`;
}

function findLocaleEntry(
  locales: readonly AppStorefrontLocale[],
  targetLocale: string,
): AppStorefrontLocale | undefined {
  return locales.find((item) => item.locale.toLowerCase() === targetLocale)
    ?? locales.find((item) => item.locale.toLowerCase().startsWith(`${targetLocale}-`));
}

function pickLocalizedImageRef(
  defaultImage: AppStorefrontImageRef | undefined,
  locales: readonly AppStorefrontLocalizedImage[],
  targetLocale: string,
): AppStorefrontImageRef | undefined {
  const matched = locales.find((item) => item.locale.toLowerCase() === targetLocale)
    ?? locales.find((item) => item.locale.toLowerCase().startsWith(`${targetLocale}-`));
  return matched?.image ?? defaultImage;
}

function pickCaption(caption: Readonly<Record<string, string>> | undefined, targetLocale: string, defaultLocale: string): string {
  if (!caption) return '';
  if (caption[targetLocale]) return caption[targetLocale]!;
  const prefixMatch = Object.entries(caption).find(([key]) => key.toLowerCase().startsWith(`${targetLocale}-`))?.[1];
  if (prefixMatch) return prefixMatch;
  if (caption[defaultLocale]) return caption[defaultLocale]!;
  return Object.values(caption)[0] ?? '';
}

export function resolvePackageStorefrontView(
  entry: DesktopAppsEntry,
  language: string,
): ResolvedStorefrontView {
  const locale = normalizeUiLocale(language);
  const info = entry.appInfo;
  const sf: AppStorefrontInfo | undefined = info?.storefront;
  const baseDisplayName = info?.displayName || entry.identity.displayName;
  const baseSummary = info?.summary || entry.summary || null;
  const baseIntro = info?.readmeMarkdown || null;

  if (!sf) {
    return {
      hasStorefront: false,
      category: null,
      displayName: baseDisplayName,
      summary: baseSummary,
      introductionMarkdown: baseIntro,
      tags: [],
      highlights: [],
      coverUrl: null,
      gallery: [],
    };
  }

  const defaultLocale = normalizeUiLocale(sf.defaultLocale || 'en');
  const localized = findLocaleEntry(sf.locales, locale);
  const fallbackDefault = findLocaleEntry(sf.locales, defaultLocale);
  const displayName = (locale !== defaultLocale && localized?.displayName) ? localized.displayName : baseDisplayName;
  const summary = (locale !== defaultLocale && localized?.summary) ? localized.summary : baseSummary;
  const introductionMarkdown = (locale !== defaultLocale && localized?.introductionMarkdown)
    ? localized.introductionMarkdown
    : baseIntro;
  const tags = localized?.tags?.length ? localized.tags : (fallbackDefault?.tags ?? []);
  const highlights = localized?.highlights?.length ? localized.highlights : (fallbackDefault?.highlights ?? []);

  // Strict source isolation: only verified packages may request public storefront media.
  const canLoadPublicMedia = appSourceForEntry(entry) === 'verified';
  const coverRef = canLoadPublicMedia && sf.media?.cover
    ? pickLocalizedImageRef(sf.media.cover.defaultImage, sf.media.cover.locales, locale)
    : undefined;
  const coverUrl = coverRef ? verifiedStorefrontImageUrl(entry.identity.appId, coverRef) : null;

  const gallery: ResolvedStorefrontGallerySlide[] = [];
  if (canLoadPublicMedia && sf.media?.gallery?.length) {
    for (const item of sf.media.gallery) {
      if (item.kind !== 'image') continue;
      const ref = pickLocalizedImageRef(item.defaultImage, item.locales, locale);
      const url = verifiedStorefrontImageUrl(entry.identity.appId, ref);
      if (!url) continue;
      gallery.push({
        id: item.id,
        url,
        caption: pickCaption(item.caption, locale, defaultLocale),
      });
    }
  }

  return {
    hasStorefront: true,
    category: sf.category || null,
    displayName,
    summary,
    introductionMarkdown,
    tags,
    highlights,
    coverUrl,
    gallery,
  };
}

export function resolveLocalDevStorefrontView(
  entry: DesktopAppsEntry,
  language: string,
  devStorefront: LocalDevelopmentProjectStorefront | null,
  fallbackReadme: string | null,
): ResolvedStorefrontView & { readonly introductionErrorField?: string } {
  const locale = normalizeUiLocale(language);
  const baseDisplayName = entry.identity.displayName;
  const baseSummary = entry.summary || null;
  if (!devStorefront) {
    return {
      hasStorefront: false,
      category: null,
      displayName: baseDisplayName,
      summary: baseSummary,
      introductionMarkdown: fallbackReadme,
      tags: [],
      highlights: [],
      coverUrl: null,
      gallery: [],
    };
  }
  const defaultLocale = devStorefront.defaultLocale.toLowerCase();
  const requestedLocale = (language || locale).toLowerCase().replaceAll('_', '-');
  const forLocale = (tag: string) => devStorefront.locales.find((item) => item.locale.toLowerCase() === tag);
  const fallbackDefault = forLocale(defaultLocale);
  const regionalFallback = normalizeUiLocale(defaultLocale) === locale
    ? fallbackDefault
    : devStorefront.locales.find((item) => item.locale.toLowerCase().startsWith(`${locale}-`));
  const localized = requestedLocale === defaultLocale
    ? fallbackDefault
    : forLocale(requestedLocale) ?? forLocale(locale) ?? regionalFallback;
  const displayName = localized?.displayName || baseDisplayName;
  const summary = localized?.summary || baseSummary;
  const translation = localized?.introductionMarkdown;
  const introductionMarkdown = translation === undefined ? fallbackReadme : translation;
  const tags = localized?.tags?.length ? localized.tags : (fallbackDefault?.tags ?? []);
  const highlights = localized?.highlights?.length ? localized.highlights : (fallbackDefault?.highlights ?? []);
  const coverUrl = devStorefront.cover
    ? (devStorefront.cover.localeUrls[locale] ?? devStorefront.cover.defaultUrl ?? null)
    : null;
  const gallery: ResolvedStorefrontGallerySlide[] = [];
  for (const item of devStorefront.gallery) {
    const url = item.localeUrls[locale] ?? item.defaultUrl;
    if (!url) continue;
    gallery.push({
      id: item.id,
      url,
      caption: pickCaption(item.caption, locale, defaultLocale),
    });
  }
  return {
    hasStorefront: true,
    category: devStorefront.category || null,
    displayName,
    summary,
    introductionMarkdown,
    ...(translation === null && localized ? { introductionErrorField: `metadata.storefront.locales.${localized.locale}.introduction` } : {}),
    tags,
    highlights,
    coverUrl,
    gallery,
  };
}

export function resolveEntryLocalizedName(entry: DesktopAppsEntry, language: string): string {
  const sf = entry.appInfo?.storefront;
  const baseName = entry.appInfo?.displayName || entry.identity.displayName;
  if (!sf) return baseName;
  const locale = normalizeUiLocale(language);
  const defaultLocale = normalizeUiLocale(sf.defaultLocale || 'en');
  if (locale === defaultLocale) return baseName;
  return findLocaleEntry(sf.locales, locale)?.displayName || baseName;
}

export function resolveEntryLocalizedSummary(entry: DesktopAppsEntry, language: string): string | null {
  const sf = entry.appInfo?.storefront;
  const baseSummary = entry.appInfo?.summary || entry.summary || null;
  if (!sf) return baseSummary;
  const locale = normalizeUiLocale(language);
  const defaultLocale = normalizeUiLocale(sf.defaultLocale || 'en');
  if (locale === defaultLocale) return baseSummary;
  return findLocaleEntry(sf.locales, locale)?.summary || baseSummary;
}

export function resolveEntryOrigin(entry: DesktopAppsEntry): ProductOriginId | null {
  const raw = entry.catalogTarget?.productOrigin;
  if (raw === 'nimi-official' || raw === 'open-source-adapted' || raw === 'community') return raw;
  return null;
}

export function formatPackageByteSize(bytes: bigint | number | string | null | undefined): string | null {
  if (bytes === null || bytes === undefined || bytes === '') return null;
  const value = typeof bytes === 'bigint' ? Number(bytes) : typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}
