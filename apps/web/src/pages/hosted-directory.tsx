import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { CAPABILITY_LABELS } from './informational-content.js';
import { DIRECTORY_ENDPOINT, fetchDirectoryPage, isDirectoryMediaUrl, isDirectorySlug, isRecord, readProductSummary } from './hosted-directory-data.js';
import { PublicSiteLink } from './public-site-shell.js';

export type ProductOrigin = 'nimi-official' | 'open-source-adapted' | 'community';

export type ProductTargetRelease = {
  version: string;
  size?: number;
  os?: string;
  arch?: string;
};

export type ProductStorefrontImageRef = {
  media_type: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
  url: string;
};

export type ProductStorefrontHighlight = {
  title: string;
  description: string;
};

export type ProductStorefrontLocale = {
  display_name?: string;
  summary?: string;
  tags?: string[];
  highlights?: ProductStorefrontHighlight[];
  introduction_markdown?: string;
};

export type ProductStorefrontDetail = {
  version: string;
  display_name: string;
  summary: string;
  readme_markdown: string;
  release_notes_markdown: string;
  license: { identifier: string; text: string };
  author: string;
  homepage_url: string;
  support_url: string;
  app_access: string[];
  capability_contract_refs: string[];
  required_standardized_feature_refs: string[];
  storage_policy: { kind: string } | null;
  safety_profile: unknown;
  admission_trust_tier: string | null;
  icon_url: string | null;
  storefront: {
    category: string;
    default_locale: string;
    locales: Record<string, ProductStorefrontLocale>;
    media: {
      cover?: {
        default: ProductStorefrontImageRef;
        locales?: Record<string, ProductStorefrontImageRef>;
      };
      gallery?: Array<{
        id: string;
        kind: string;
        default: ProductStorefrontImageRef;
        locales?: Record<string, ProductStorefrontImageRef>;
        caption?: Record<string, string>;
      }>;
    } | null;
  } | null;
};

export type Product = {
  app_id: string;
  slug: string;
  display_name: string;
  publisher: string;
  repository: string;
  license: string;
  summary: { zh: string; en: string };
  origin?: ProductOrigin | null;
  upstream?: { name: string; url: string } | null;
  pc_targets: string[];
  pc_target_releases?: Record<string, ProductTargetRelease>;
  displayed_version?: string | null;
  capabilities: string[];
  blocked: boolean;
  web: { url: string; version: string } | null;
  has_storefront?: boolean;
  category?: string | null;
  default_locale?: string | null;
  tags?: Record<string, string[]>;
  icon_url?: string | null;
  cover_urls?: { default: string; locales?: Record<string, string> } | null;
  detail_status?: 'published' | 'product_only' | 'blocked' | 'pending';
  detail?: ProductStorefrontDetail | null;
};

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function parseOrigin(value: unknown): ProductOrigin | null {
  if (value === 'nimi-official' || value === 'open-source-adapted' || value === 'community') return value;
  return null;
}

function parseUpstream(value: unknown): { name: string; url: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string' || typeof value.url !== 'string' || !value.url.startsWith('https://')) return null;
  return { name: value.name, url: value.url };
}

function parseTargetReleases(value: unknown): Record<string, ProductTargetRelease> {
  if (!isRecord(value)) return {};
  const out: Record<string, ProductTargetRelease> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isRecord(entry) && typeof entry.version === 'string' && entry.version.length > 0) {
      out[key] = {
        version: entry.version,
        ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
        ...(typeof entry.os === 'string' ? { os: entry.os } : {}),
        ...(typeof entry.arch === 'string' ? { arch: entry.arch } : {}),
      };
    }
  }
  return out;
}

function parseCoverUrls(value: unknown): { default: string; locales?: Record<string, string> } | null {
  if (!isRecord(value) || !isDirectoryMediaUrl(value.default)) return null;
  const out: { default: string; locales?: Record<string, string> } = { default: value.default };
  if (isRecord(value.locales)) {
    const locales: Record<string, string> = {};
    for (const [k, v] of Object.entries(value.locales)) {
      if (isDirectoryMediaUrl(v)) locales[k] = v;
    }
    if (Object.keys(locales).length > 0) out.locales = locales;
  }
  return out;
}

function parseTagsMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value)) {
    if (strings(v)) out[k] = v;
  }
  return out;
}

function product(value: unknown): Product {
  if (!isRecord(value)) throw Error('Invalid public product');
  const summary = readProductSummary(value);
  if (!summary || typeof value.app_id !== 'string' || typeof value.publisher !== 'string'
    || typeof value.repository !== 'string' || !/^https:\/\/github\.com\/[a-z\d-]+\/[\w.-]+$/i.test(value.repository)
    || typeof value.license !== 'string' || !strings(value.pc_targets) || !strings(value.capabilities)) {
    throw Error('Invalid public product');
  }
  const detailStatus =
    value.detail_status === 'published' ||
    value.detail_status === 'product_only' ||
    value.detail_status === 'blocked' ||
    value.detail_status === 'pending'
      ? value.detail_status
      : undefined;

  return {
    app_id: value.app_id,
    ...summary,
    publisher: value.publisher,
    repository: value.repository,
    license: value.license,
    origin: parseOrigin(value.origin),
    upstream: parseUpstream(value.upstream),
    pc_targets: value.pc_targets,
    pc_target_releases: parseTargetReleases(value.pc_target_releases),
    displayed_version: typeof value.displayed_version === 'string' ? value.displayed_version : null,
    capabilities: value.capabilities,
    has_storefront: Boolean(value.has_storefront),
    category: typeof value.category === 'string' ? value.category : null,
    default_locale: typeof value.default_locale === 'string' ? value.default_locale : null,
    tags: parseTagsMap(value.tags),
    cover_urls: parseCoverUrls(value.cover_urls),
    detail_status: detailStatus,
    detail: isRecord(value.detail) ? (value.detail as unknown as ProductStorefrontDetail) : null,
  };
}

type State = {
  slug?: string;
  status: 'loading' | 'ok' | 'missing' | 'unavailable';
  products: Product[];
  next: string | null;
};
const empty = (slug?: string): State => ({ slug, status: 'loading', products: [], next: null });
export function useHostedDirectory(slug?: string) {
  const [state, setState] = useState<State>(() => empty(slug));
  const [after, setAfter] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    if (slug && !isDirectorySlug(slug)) {
      setState({ ...empty(slug), status: 'missing' });
      return;
    }
    if (slug || !after) setState(empty(slug));
    void (async () => {
      if (slug) {
        const response = await fetch(DIRECTORY_ENDPOINT + '/' + slug, { signal: abort.signal, credentials: 'omit' });
        if (response.status === 404) {
          setState({ ...empty(slug), status: 'missing' });
          return;
        }
        if (!response.ok) throw Error('Directory unavailable');
        const item = product(await response.json());
        if (item.slug !== slug) throw Error('Mismatched slug');
        setState({ slug, status: 'ok', products: [item], next: null });
      } else {
        const { products, next } = await fetchDirectoryPage(after, abort.signal);
        const items = products.map(product);
        setState((prev) => ({
          slug,
          status: 'ok',
          products: after && !prev.slug ? [...prev.products, ...items] : items,
          next,
        }));
      }
    })().catch(() => {
      if (!abort.signal.aborted) setState((prev) => ({ ...prev, slug, status: 'unavailable', next: null }));
    });
    return () => abort.abort();
  }, [slug, after]);
  useEffect(() => setAfter(null), [slug]);
  const more = useCallback(() => {
    if (state.next) setAfter(state.next);
  }, [state.next]);
  return { state: state.slug === slug ? state : empty(slug), more };
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.hosted-web-publication
export function WebLaunch({ item, locale }: { item: Product; locale: LandingLocale }) {
  if (item.blocked)
    return <p role="status">{locale === 'zh' ? '此产品已停用。' : 'This product is suspended.'}</p>;
  if (!item.web) return null;
  return (
    <div className="public-app-posture-callout">
      <a className="story-button" href={item.web.url}>
        {locale === 'zh' ? '在浏览器打开' : 'Open in browser'}
      </a>
      <p>
        {locale === 'zh'
          ? '使用 Runtime 功能时，请保持主 PC 在线并可直连，首次接入需在 Nimi Home 确认。'
          : 'Runtime features require your primary PC to be online and reachable. Confirm first access in Nimi Home.'}
      </p>
    </div>
  );
}

const pcTargets: Record<string, string> = {
  'windows-x86_64': 'Windows x86_64',
  'macos-aarch64': 'macOS arm64',
  'desktop-universal': 'macOS · Windows',
};

const ORIGIN_LABELS: Record<LandingLocale, Record<ProductOrigin, string>> = {
  zh: {
    'nimi-official': 'Nimi 原生',
    'open-source-adapted': '开源项目 · Nimi 适配',
    community: '社区应用',
  },
  en: {
    'nimi-official': 'Nimi Native',
    'open-source-adapted': 'Open-Source · Nimi Adapted',
    community: 'Community App',
  },
};

export function pcTargetLabels(targets: string[]) {
  return targets.map((target) => pcTargets[target] ?? target);
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function resolveDetailContent(item: Product, locale: LandingLocale) {
  const sf = item.detail?.storefront;
  const defaultLocale = sf?.default_locale ?? item.default_locale ?? 'en';
  const loc = sf?.locales?.[locale];
  const fallbackLoc = sf?.locales?.[defaultLocale];
  const displayName = (locale !== defaultLocale && loc?.display_name)
    ? loc.display_name
    : (item.detail?.display_name || item.display_name);
  const summary = (locale !== defaultLocale && loc?.summary)
    ? loc.summary
    : (sf && locale === defaultLocale && item.detail?.summary ? item.detail.summary : item.summary[locale]);
  const intro = (locale !== defaultLocale && loc?.introduction_markdown)
    ? loc.introduction_markdown
    : (item.detail?.readme_markdown || '');
  const tags = loc?.tags?.length ? loc.tags : (fallbackLoc?.tags ?? item.tags?.[locale] ?? []);
  const highlights = loc?.highlights?.length ? loc.highlights : (fallbackLoc?.highlights ?? []);
  const gallery = (sf?.media?.gallery || []).map((slide) => {
    const chosen = slide.locales?.[locale] ?? slide.default;
    const caption = slide.caption?.[locale] ?? slide.caption?.[defaultLocale] ?? '';
    return { id: slide.id, url: chosen.url, caption };
  });
  const coverRef = sf?.media?.cover ? (sf.media.cover.locales?.[locale] ?? sf.media.cover.default) : null;
  const coverUrl = coverRef?.url ?? item.cover_urls?.locales?.[locale] ?? item.cover_urls?.default ?? null;
  return { displayName, summary, intro, tags, highlights, gallery, coverUrl };
}

function renderInertInline(text: string): Array<string | ReactElement> {
  const nodes: Array<string | ReactElement> = [];
  const tokenPattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\))/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2] !== undefined) {
      nodes.push(<strong key={key++} className="font-semibold">{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<code key={key++} className="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">{match[3]}</code>);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      nodes.push(
        <a key={key++} href={match[5]} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {match[4]}
        </a>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function InertMarkdownBlocks({ content }: { content: string }) {
  if (!content.trim()) return null;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Array<{ kind: 'h2' | 'h3' | 'li' | 'p'; text: string }> = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === '---') continue;
    if (line.startsWith('### ')) blocks.push({ kind: 'h3', text: line.slice(4) });
    else if (line.startsWith('## ')) blocks.push({ kind: 'h2', text: line.slice(3) });
    else if (line.startsWith('# ')) blocks.push({ kind: 'h2', text: line.slice(2) });
    else if (/^[-*]\s+/u.test(line)) blocks.push({ kind: 'li', text: line.replace(/^[-*]\s+/u, '') });
    else blocks.push({ kind: 'p', text: line });
  }
  return (
    <div className="space-y-3 text-sm leading-7">
      {blocks.map((b, idx) => {
        if (b.kind === 'h2') return <h2 key={idx} className="mt-5 text-lg font-semibold">{renderInertInline(b.text)}</h2>;
        if (b.kind === 'h3') return <h3 key={idx} className="mt-4 text-base font-semibold">{renderInertInline(b.text)}</h3>;
        if (b.kind === 'li') return <p key={idx} className="pl-4">• {renderInertInline(b.text)}</p>;
        return <p key={idx}>{renderInertInline(b.text)}</p>;
      })}
    </div>
  );
}

export function PublicProduct({
  item,
  locale,
  detail,
  onOpenInteractivePreview,
  previewActionLabel,
}: {
  item: Product;
  locale: LandingLocale;
  detail?: boolean;
  onOpenInteractivePreview?: () => void;
  previewActionLabel?: string;
}) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const content = resolveDetailContent(item, locale);
  const labels = CAPABILITY_LABELS[locale];

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen]);

  if (!detail) {
    const coverSrc = item.cover_urls?.locales?.[locale] ?? item.cover_urls?.default ?? null;
    return (
      <article className="public-app-card-body">
        {coverSrc && !failedImages[coverSrc] ? (
          <img
            src={coverSrc}
            alt={content.displayName}
            loading="lazy"
            decoding="async"
            className="mb-3 aspect-video w-full rounded-xl object-cover"
            onError={() => setFailedImages((prev) => ({ ...prev, [coverSrc]: true }))}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {item.origin ? (
            <span className="public-app-badge" data-origin={item.origin}>
              {ORIGIN_LABELS[locale][item.origin]}
            </span>
          ) : null}
          {item.displayed_version ? (
            <span className="text-xs opacity-70">v{item.displayed_version}</span>
          ) : null}
        </div>
        <h3>
          <PublicSiteLink to={withLocaleQuery('/apps/' + item.slug, locale)}>{content.displayName}</PublicSiteLink>
        </h3>
        <p>{content.summary}</p>
        <p>
          {locale === 'zh' ? '发布者' : 'Publisher'} ·{' '}
          <a href={item.repository} rel="noreferrer">
            {item.publisher}
          </a>{' '}
          · {item.license}
        </p>
        {item.pc_targets.length > 0 && (
          <p>PC · {pcTargetLabels(item.pc_targets).join(' · ')}</p>
        )}
      </article>
    );
  }

  if (item.blocked || item.detail_status === 'blocked') {
    return (
      <article className="story-container public-app-detail" data-testid="web-product-blocked">
        <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="public-back-link">
          {locale === 'zh' ? '← 返回应用目录' : '← Back to Apps'}
        </PublicSiteLink>
        <h1>{item.display_name}</h1>
        <div className="public-app-posture-callout" role="status">
          <strong>{locale === 'zh' ? '已暂停发行' : 'Distribution suspended'}</strong>
          <p>{locale === 'zh' ? '此产品当前已停用，暂不提供下载或在线访问。' : 'This product is currently suspended and unavailable for download or Web access.'}</p>
        </div>
      </article>
    );
  }

  const slides = content.gallery.length > 0
    ? content.gallery
    : content.coverUrl
      ? [{ id: 'cover', url: content.coverUrl, caption: '' }]
      : [];
  const currentSlide = slides[Math.min(activeSlide, Math.max(0, slides.length - 1))];
  const targetEntries = Object.entries(item.pc_target_releases ?? {});
  const capabilityPills = item.capabilities.map((cap) => labels[cap] ?? cap);
  const resolvedIconUrl = item.icon_url ?? item.detail?.icon_url ?? null;

  return (
    <article className="story-container public-app-detail" data-testid="web-product-detail">
      <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="public-back-link">
        {locale === 'zh' ? '← 返回应用目录' : '← Back to Apps'}
      </PublicSiteLink>

      <div className="public-app-detail-header">
        <div className="public-app-detail-identity">
          {resolvedIconUrl && !failedImages[resolvedIconUrl] ? (
            <img
              src={resolvedIconUrl}
              alt=""
              width={64}
              height={64}
              className="public-app-detail-icon rounded-2xl"
              onError={() => setFailedImages((prev) => ({ ...prev, [resolvedIconUrl]: true }))}
            />
          ) : null}
          <div>
            <div className="public-app-badges">
              {item.origin ? (
                <span className="public-app-badge" data-origin={item.origin}>
                  {ORIGIN_LABELS[locale][item.origin]}
                </span>
              ) : null}
              {item.displayed_version ? (
                <span className="public-app-badge is-posture">
                  v{item.displayed_version}
                </span>
              ) : null}
              <span className="public-app-badge is-posture">{item.license}</span>
            </div>
            <h1>{content.displayName}</h1>
          </div>
        </div>
        {onOpenInteractivePreview && previewActionLabel ? (
          <button type="button" className="story-button" onClick={onOpenInteractivePreview}>
            {previewActionLabel}
          </button>
        ) : null}
      </div>

      <p className="public-app-detail-summary">{content.summary}</p>
      <WebLaunch item={item} locale={locale} />
      {!item.blocked && !item.web && item.pc_targets.length > 0 ? (
        <div className="public-app-posture-callout" data-testid="web-pc-install-guidance">
          <p>
            {locale === 'zh'
              ? '在电脑上打开 Nimi Home，进入「应用」目录即可安装并使用此应用。'
              : 'Open Nimi Home on your computer and install this app from the Apps catalog.'}
          </p>
          <PublicSiteLink to={withLocaleQuery('/download', locale)} className="story-button story-button-outline">
            {locale === 'zh' ? '下载 Nimi Home' : 'Download Nimi Home'}
          </PublicSiteLink>
        </div>
      ) : null}

      {item.detail_status === 'pending' ? (
        <div className="public-app-posture-callout" role="status">
          <p>{locale === 'zh' ? '该版本的图文介绍正在同步准备中，请稍后刷新查看。' : 'Storefront presentation for this version is currently syncing.'}</p>
        </div>
      ) : null}

      {slides.length > 0 && currentSlide ? (
        <section className="my-6 space-y-3" data-testid="web-storefront-gallery">
          <div className="overflow-hidden rounded-2xl border border-black/10 bg-black/5">
            {failedImages[currentSlide.url] ? (
              <div className="flex aspect-video items-center justify-center p-6 text-sm opacity-75">
                {locale === 'zh' ? '展示图片暂不可用' : 'Preview image unavailable'}
              </div>
            ) : (
              <button type="button" className="block w-full cursor-zoom-in" onClick={() => setLightboxOpen(true)}>
                <img
                  src={currentSlide.url}
                  alt={currentSlide.caption || content.displayName}
                  className="aspect-video w-full object-cover"
                  onError={() => setFailedImages((prev) => ({ ...prev, [currentSlide.url]: true }))}
                />
              </button>
            )}
            {currentSlide.caption ? (
              <p className="px-4 py-2.5 text-xs opacity-80">{currentSlide.caption}</p>
            ) : null}
          </div>
          {slides.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {slides.map((slide, idx) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => setActiveSlide(idx)}
                  className={`aspect-video w-28 shrink-0 overflow-hidden rounded-lg border-2 ${
                    idx === activeSlide ? 'border-current opacity-100' : 'border-black/15 opacity-75 hover:opacity-100'
                  }`}
                >
                  <img src={slide.url} alt={slide.caption || `${content.displayName} ${idx + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
          {lightboxOpen && !failedImages[currentSlide.url] ? (
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
              onClick={() => setLightboxOpen(false)}
            >
              <img src={currentSlide.url} alt={currentSlide.caption || content.displayName} className="max-h-[84vh] max-w-[90vw] rounded-xl object-contain" />
            </div>
          ) : null}
        </section>
      ) : null}

      {content.tags.length > 0 ? (
        <div className="my-4 flex flex-wrap gap-2">
          {content.tags.map((tag) => (
            <span key={tag} className="public-capability-pill">{tag}</span>
          ))}
        </div>
      ) : null}

      {content.highlights.length > 0 ? (
        <section className="my-6 grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="web-storefront-highlights">
          {content.highlights.map((h) => (
            <div key={h.title} className="public-app-meta-card">
              <h3 className="text-base font-semibold">{h.title}</h3>
              <p className="mt-1 text-sm opacity-80">{h.description}</p>
            </div>
          ))}
        </section>
      ) : null}

      {content.intro ? (
        <section className="my-6" data-testid="web-storefront-intro">
          <InertMarkdownBlocks content={content.intro} />
        </section>
      ) : null}

      <dl className="public-app-meta-grid">
        <div className="public-app-meta-card">
          <dt>{locale === 'zh' ? '此 App 使用的 AI 能力' : 'AI Capabilities'}</dt>
          <dd className="public-capability-pills">
            {capabilityPills.length > 0
              ? capabilityPills.map((cap) => <span key={cap} className="public-capability-pill">{cap}</span>)
              : <span>—</span>}
          </dd>
        </div>
        <div className="public-app-meta-card">
          <dt>{locale === 'zh' ? '支持平台与下载体积' : 'Platforms & Download Size'}</dt>
          <dd>
            {targetEntries.length > 0
              ? targetEntries
                  .map(([tid, rel]) => `${pcTargets[tid] ?? tid} (v${rel.version}${rel.size ? ` · ${formatSize(rel.size)}` : ''})`)
                  .join(' / ')
              : item.pc_targets.length > 0
                ? pcTargetLabels(item.pc_targets).join(' · ')
                : item.web
                  ? 'Web'
                  : '—'}
          </dd>
        </div>
        {item.upstream ? (
          <div className="public-app-meta-card">
            <dt>{locale === 'zh' ? '上游开源项目' : 'Upstream Project'}</dt>
            <dd>
              <a href={item.upstream.url} target="_blank" rel="noreferrer" className="public-external-link">
                {item.upstream.name}
              </a>
            </dd>
          </div>
        ) : null}
        <div className="public-app-meta-card">
          <dt>{locale === 'zh' ? '发布者与源码仓库' : 'Publisher & Repository'}</dt>
          <dd>
            <a href={item.repository} target="_blank" rel="noreferrer" className="public-external-link">
              @{item.publisher} · {item.repository.replace('https://github.com/', '')}
            </a>
          </dd>
        </div>
      </dl>

      {item.detail?.release_notes_markdown ? (
        <details className="my-6 rounded-xl border border-black/10 p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {locale === 'zh' ? '版本更新日志' : 'Release Notes'} · v{item.detail.version}
          </summary>
          <div className="mt-3">
            <InertMarkdownBlocks content={item.detail.release_notes_markdown} />
          </div>
        </details>
      ) : null}
    </article>
  );
}
