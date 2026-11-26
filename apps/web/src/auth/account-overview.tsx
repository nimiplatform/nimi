import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Check,
  ChevronRight,
  Clipboard,
  Compass,
  Copy,
  Info,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
  X,
} from 'lucide-react';
import { fetchDirectoryPage, isRecord, readProductSummary } from '../pages/hosted-directory-data.js';
import { createWebBrowserRealm } from './browser-realm.js';
import { AccountAvatar, AccountFeedback } from './account-center-layout.js';
import { accountCenterCopy, type AccountCopyKey } from './account-center-copy.js';
import { accountHandle } from './account-center-model.js';
import { withLocaleQuery } from '../landing/config/landing-links.js';
import { useCopyFeedback } from '../landing/components/use-copy-command.js';
import {
  detectVisitorPlatform,
  NIMI_MACOS_DOWNLOAD_URL,
  NIMI_WINDOWS_DOWNLOAD_URL,
  type DetectedPlatform,
} from '../pages/download-assets.js';

export type PrimaryRuntimeBindingSummary = {
  bindingId: string;
  displayName: string;
  validAfter: string;
};

export type OverviewRuntimeStatus =
  | { kind: 'loading' }
  | { kind: 'unbound' }
  | { kind: 'bound'; binding: PrimaryRuntimeSummary }
  | { kind: 'error'; message: string };

export type PrimaryRuntimeSummary = PrimaryRuntimeBindingSummary;

export const HOSTED_WEB_APP_CATEGORIES = [
  'companions-worlds',
  'lifestyle',
  'writing-notes',
  'design-diagrams',
  'audio-music',
  'video-media',
  'research-learning',
  'productivity-automation',
  'developer-tools',
] as const;

export type HostedWebAppCategory = (typeof HOSTED_WEB_APP_CATEGORIES)[number];

const HOSTED_CATEGORY_SET = new Set<string>(HOSTED_WEB_APP_CATEGORIES);

const HOSTED_CATEGORY_LABELS: Readonly<Record<HostedWebAppCategory, readonly [en: string, zh: string]>> = {
  'companions-worlds': ['Companions & Worlds', '伙伴与世界'],
  lifestyle: ['Lifestyle & Personal', '生活与个人'],
  'writing-notes': ['Writing & Notes', '写作与笔记'],
  'design-diagrams': ['Design & Diagrams', '设计与图表'],
  'audio-music': ['Audio & Music', '音频与音乐'],
  'video-media': ['Video & Media', '视频与媒体'],
  'research-learning': ['Research & Learning', '研究与学习'],
  'productivity-automation': ['Productivity & Automation', '效率与自动化'],
  'developer-tools': ['Developer Tools', '开发者工具'],
};

export type HostedWebAppEntry = {
  slug: string;
  displayName: string;
  summary: { zh: string; en: string };
  iconUrl: string | null;
  web: { url: string; version: string };
  category?: HostedWebAppCategory;
  tags?: { zh?: string[]; en?: string[] };
};

function parseLocalizedTags(value: unknown): { zh?: string[]; en?: string[] } | undefined {
  if (!isRecord(value)) return undefined;
  const parseList = (raw: unknown): string[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const cleaned = raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  };
  const zh = parseList(value.zh);
  const en = parseList(value.en);
  if (!zh && !en) return undefined;
  return {
    ...(zh ? { zh } : {}),
    ...(en ? { en } : {}),
  };
}

export function hostedWebAppsFromProducts(products: readonly unknown[]): HostedWebAppEntry[] {
  const entries: HostedWebAppEntry[] = [];
  for (const item of products) {
    if (!isRecord(item)) continue;
    const summary = readProductSummary(item);
    if (!summary || summary.blocked || !summary.web) continue;
    const category = typeof item.category === 'string' && HOSTED_CATEGORY_SET.has(item.category)
      ? (item.category as HostedWebAppCategory)
      : undefined;
    const tags = parseLocalizedTags(item.tags);
    entries.push({
      slug: summary.slug,
      displayName: summary.display_name,
      summary: summary.summary,
      iconUrl: summary.icon_url,
      web: summary.web,
      ...(category ? { category } : {}),
      ...(tags ? { tags } : {}),
    });
  }
  return entries;
}

export async function loadHostedWebApps(signal: AbortSignal): Promise<HostedWebAppEntry[]> {
  const apps: HostedWebAppEntry[] = [];
  const cursors = new Set<string>();
  let after: string | null = null;
  do {
    const page = await fetchDirectoryPage(after, signal);
    apps.push(...hostedWebAppsFromProducts(page.products));
    after = page.next;
    if (after && cursors.has(after)) throw Error('Repeated directory cursor');
    if (after) cursors.add(after);
  } while (after);
  return apps;
}

function copyForLocale(locale: 'zh' | 'en') {
  const index = locale === 'zh' ? 1 : 0;
  return (key: AccountCopyKey) => accountCenterCopy[key][index];
}

function categoryLabel(category: HostedWebAppCategory, locale: 'zh' | 'en'): string {
  return HOSTED_CATEGORY_LABELS[category][locale === 'zh' ? 1 : 0];
}

function resolveAppSceneBadge(app: HostedWebAppEntry, locale: 'zh' | 'en'): string | null {
  const localizedTag = app.tags?.[locale]?.[0];
  if (localizedTag) return localizedTag;
  if (app.category) return categoryLabel(app.category, locale);
  return null;
}

export function InstallNimiPanel({
  platform,
  locale,
  compact = false,
  showAllPlatformsLink = true,
}: {
  platform: DetectedPlatform;
  locale: 'zh' | 'en';
  compact?: boolean;
  showAllPlatformsLink?: boolean;
}) {
  const c = copyForLocale(locale);
  const { copyText: copyDesktopLinkText, status: desktopCopyStatus } = useCopyFeedback(2000);
  const copiedLink = desktopCopyStatus === 'copied';
  const copyLinkFailed = desktopCopyStatus === 'error';
  const scopeId = useId();
  const warningId = useId();
  const downloadHref = '/account/download';

  async function copyDesktopLink() {
    await copyDesktopLinkText('https://nimi.ai/download');
  }

  const scopeText = platform === 'macos'
    ? c('overviewScopeMac')
    : platform === 'windows'
      ? c('overviewScopeWin')
      : platform === 'mobile'
        ? c('overviewScopeMobile')
        : platform === 'linux'
          ? c('overviewScopeLinux')
          : c('overviewScopeGeneric');

  return (
    <div className={`ac-install-panel${compact ? ' ac-install-panel--compact' : ''}`}>
      <p id={scopeId} className="ac-install-scope">{scopeText}</p>
      {platform === 'windows' ? (
        <p id={warningId} className="ac-install-warning">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{c('overviewWinWarning')}</span>
        </p>
      ) : null}
      <div className="ac-actions ac-install-actions">
        {platform === 'macos' ? (
          <>
            <a
              className="ac-button ac-button--pill"
              href={NIMI_MACOS_DOWNLOAD_URL}
              aria-describedby={scopeId}
            >
              <ArrowDownToLine size={16} aria-hidden="true" />
              <span>{c('overviewDownloadMac')}</span>
            </a>
            {showAllPlatformsLink ? (
              <Link className="ac-button ac-button--secondary ac-button--pill" to={downloadHref}>
                <span>{c('overviewAllPlatforms')}</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            ) : null}
          </>
        ) : platform === 'windows' ? (
          <>
            <a
              className="ac-button ac-button--pill"
              href={NIMI_WINDOWS_DOWNLOAD_URL}
              aria-describedby={`${scopeId} ${warningId}`}
            >
              <ArrowDownToLine size={16} aria-hidden="true" />
              <span>{c('overviewDownloadWin')}</span>
            </a>
            {showAllPlatformsLink ? (
              <Link className="ac-button ac-button--secondary ac-button--pill" to={downloadHref}>
                <span>{c('overviewAllPlatforms')}</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            ) : null}
          </>
        ) : platform === 'mobile' ? (
          <>
            <button type="button" className="ac-button ac-button--pill" onClick={() => void copyDesktopLink()}>
              {copiedLink ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
              <span>{c(copiedLink ? 'overviewCopiedDesktopLink' : 'overviewCopyDesktopLink')}</span>
            </button>
            {showAllPlatformsLink ? (
              <Link className="ac-button ac-button--secondary ac-button--pill" to={downloadHref}>
                <span>{c('overviewAllPlatforms')}</span>
              </Link>
            ) : null}
            <span className="sr-only" role="status" aria-live="polite">
              {copiedLink ? c('overviewCopiedDesktopLink') : copyLinkFailed ? c('copyLinkFailed') : ''}
            </span>
            {copyLinkFailed ? <p className="ac-feedback ac-feedback--error" role="alert">{c('copyLinkFailed')}</p> : null}
          </>
        ) : (
          showAllPlatformsLink ? (
            <Link className="ac-button ac-button--pill" to={downloadHref}>
              <ArrowDownToLine size={16} aria-hidden="true" />
              <span>{c('overviewGoDownload')}</span>
            </Link>
          ) : null
        )}
      </div>
    </div>
  );
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005e
// @nimi-authority: rule.nimi.platform.product-lifecycle.primary-runtime-confirmation
export function AccountOverviewView({
  user,
  runtimeStatus,
  onRetryRuntime,
  hostedWebApps = [],
  pendingReceivedCount = null,
  platform,
  locale = 'zh',
  nowMs,
}: {
  user: Record<string, unknown>;
  runtimeStatus: OverviewRuntimeStatus;
  onRetryRuntime?: () => void;
  hostedWebApps?: HostedWebAppEntry[];
  pendingReceivedCount?: number | null;
  platform: DetectedPlatform;
  locale?: 'zh' | 'en';
  nowMs?: number;
}) {
  const c = copyForLocale(locale);
  const { copyText: copyHandleText, status: handleCopyStatus } = useCopyFeedback(2000);
  const copiedHandle = handleCopyStatus === 'copied';
  const copyHandleFailed = handleCopyStatus === 'error';
  const [selectedCategory, setSelectedCategory] = useState<'all' | HostedWebAppCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({});
  const displayName = String(user.displayName || user.handle || c('profile'));
  const handle = accountHandle(user.handle);
  const twoFactor = user.isTwoFactorEnabled === true;
  const homeHref = withLocaleQuery('/home', locale);
  const appsHref = withLocaleQuery('/apps', locale);

  const availableCategories = useMemo(() => {
    const present = new Set<HostedWebAppCategory>();
    for (const app of hostedWebApps) {
      if (app.category) present.add(app.category);
    }
    return HOSTED_WEB_APP_CATEGORIES.filter((cat) => present.has(cat));
  }, [hostedWebApps]);

  const activeCategory: 'all' | HostedWebAppCategory =
    selectedCategory === 'all' || availableCategories.includes(selectedCategory)
      ? selectedCategory
      : 'all';

  const filteredApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return hostedWebApps.filter((app) => {
      if (activeCategory !== 'all' && app.category !== activeCategory) return false;
      if (!query) return true;
      const inName = app.displayName.toLowerCase().includes(query);
      const inSummary =
        app.summary.zh.toLowerCase().includes(query)
        || app.summary.en.toLowerCase().includes(query);
      const inCategory = app.category
        ? categoryLabel(app.category, 'zh').toLowerCase().includes(query)
          || categoryLabel(app.category, 'en').toLowerCase().includes(query)
        : false;
      const inTags = [
        ...(app.tags?.zh ?? []),
        ...(app.tags?.en ?? []),
      ].some((tag) => tag.toLowerCase().includes(query));
      return inName || inSummary || inCategory || inTags;
    });
  }, [activeCategory, hostedWebApps, searchQuery]);

  async function copyUsername() {
    if (!handle) return;
    await copyHandleText(`@${handle}`);
  }

  if (runtimeStatus.kind === 'loading') {
    return (
      <div className="ac-overview" data-overview-mode="loading">
        <div className="ac-overview-loading" role="status" aria-busy="true">
          <div className="ac-skeleton-block ac-skeleton-portal-hero" />
          <div className="ac-skeleton-toolbar">
            <div className="ac-skeleton-block ac-skeleton-pills" />
            <div className="ac-skeleton-block ac-skeleton-search" />
          </div>
          <div className="ac-launchpad-grid">
            <div className="ac-skeleton-block ac-skeleton-tile" />
            <div className="ac-skeleton-block ac-skeleton-tile" />
            <div className="ac-skeleton-block ac-skeleton-tile" />
            <div className="ac-skeleton-block ac-skeleton-tile" />
            <div className="ac-skeleton-block ac-skeleton-tile" />
            <div className="ac-skeleton-block ac-skeleton-tile" />
          </div>
          <p className="ac-muted">{c('loading')}</p>
        </div>
      </div>
    );
  }

  if (runtimeStatus.kind === 'bound') {
    const { binding } = runtimeStatus;
    const validAfterMs = binding.validAfter ? Date.parse(binding.validAfter) : Number.NaN;
    const referenceNow = nowMs ?? Date.now();
    const showPendingActivation = Number.isFinite(validAfterMs) && validAfterMs > referenceNow;
    const validAfterText = showPendingActivation
      ? new Date(validAfterMs).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US')
      : null;
    const showCategoryBar = availableCategories.length >= 2;
    const showSearchBar = hostedWebApps.length >= 4;
    const showToolbar = showCategoryBar || showSearchBar;
    const isFiltering = activeCategory !== 'all' || searchQuery.trim().length > 0;

    return (
      <div className="ac-overview ac-overview--bound" data-overview-mode="bound">
        <header className="ac-space-header">
          <div className="ac-space-identity">
            <AccountAvatar user={user} size="normal" />
            <div className="ac-portal-greeting">
              <div className="ac-portal-greeting-row">
                <h1 tabIndex={-1}>
                  {c('overviewBoundHeading')}
                  {locale === 'en' ? ' ' : ''}
                  {displayName}
                </h1>
                {handle ? <span className="ac-space-handle">@{handle}</span> : null}
              </div>
              <p className="ac-space-subtitle">{c('welcome')}</p>
            </div>
          </div>

          <div className="ac-space-status-bar">
            <div className="ac-space-host-card" aria-label={c('overviewBoundBadge')}>
              <span className="ac-space-host-icon" aria-hidden="true">
                <Monitor size={18} />
              </span>
              <div className="ac-space-host-copy">
                <div className="ac-space-host-inline">
                  <span className="ac-space-host-name">{binding.displayName || c('runtime')}</span>
                  <span className="ac-space-host-state">{c('overviewBoundBadge')}</span>
                </div>
                {validAfterText ? (
                  <span className="ac-space-activation">
                    {c('runtimeActivationTime')}{' '}
                    <time dateTime={binding.validAfter}>{validAfterText}</time>
                  </span>
                ) : (
                  <span className="ac-space-host-note">{c('overviewHostShortNote')}</span>
                )}
              </div>
              <Link to="/account/runtime" className="ac-space-inline-link">
                <span>{c('overviewManageHost')}</span>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>

            {pendingReceivedCount && pendingReceivedCount > 0 ? (
              <Link to="/account/friends?view=received" className="ac-space-pending-link">
                <UsersRound size={14} aria-hidden="true" />
                <span>
                  {pendingReceivedCount} {c('overviewPendingRequests')}
                </span>
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </header>

        <section className="ac-launchpad" aria-labelledby="ac-webapps-title">
          <div className="ac-launchpad-bar">
            <div className="ac-launchpad-title-group">
              <div className="ac-launchpad-title-row">
                <h2 id="ac-webapps-title">
                  {hostedWebApps.length > 0 ? c('overviewWebAppsTitle') : c('overviewNoWebAppsTitle')}
                </h2>
                {hostedWebApps.length > 0 ? (
                  <span className="ac-launchpad-count">
                    {isFiltering ? `${filteredApps.length} / ${hostedWebApps.length}` : hostedWebApps.length}
                  </span>
                ) : null}
              </div>
              {hostedWebApps.length > 0 ? (
                <div className="ac-launchpad-notice">
                  <Info size={14} aria-hidden="true" />
                  <p className="ac-launchpad-note">{c('overviewWebAppsNote')}</p>
                </div>
              ) : null}
            </div>

            <div className="ac-launchpad-controls">
              <Link className="ac-launchpad-explore" to={appsHref}>
                <span>{c('overviewExploreApps')}</span>
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>

          {hostedWebApps.length > 0 ? (
            <>
              {showToolbar ? (
                <div className="ac-launchpad-toolbar">
                  {showCategoryBar ? (
                    <div
                      className="ac-category-pills"
                      role="group"
                      aria-label={c('overviewWebAppsTitle')}
                    >
                      <button
                        type="button"
                        className={`ac-category-pill${activeCategory === 'all' ? ' is-active' : ''}`}
                        aria-pressed={activeCategory === 'all'}
                        onClick={() => setSelectedCategory('all')}
                      >
                        <span>{c('overviewCategoryAll')}</span>
                        <span className="ac-category-count">{hostedWebApps.length}</span>
                      </button>
                      {availableCategories.map((cat) => {
                        const count = hostedWebApps.filter((item) => item.category === cat).length;
                        const active = activeCategory === cat;
                        return (
                          <button
                            key={cat}
                            type="button"
                            className={`ac-category-pill${active ? ' is-active' : ''}`}
                            aria-pressed={active}
                            onClick={() => setSelectedCategory(cat)}
                          >
                            <span>{categoryLabel(cat, locale)}</span>
                            <span className="ac-category-count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {showSearchBar ? (
                    <div className="ac-launchpad-search">
                      <Search size={15} aria-hidden="true" className="ac-launchpad-search-icon" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && searchQuery) {
                            event.preventDefault();
                            setSearchQuery('');
                          }
                        }}
                        placeholder={c('overviewSearchAppsPlaceholder')}
                        aria-label={c('overviewSearchAppsPlaceholder')}
                      />
                      {searchQuery ? (
                        <button
                          type="button"
                          className="ac-launchpad-search-clear"
                          aria-label={locale === 'zh' ? '清空搜索' : 'Clear search'}
                          onClick={() => setSearchQuery('')}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {filteredApps.length > 0 ? (
                <div className="ac-launchpad-grid">
                  {filteredApps.map((app) => {
                    const badge = resolveAppSceneBadge(app, locale);
                    const showIcon = Boolean(app.iconUrl && !failedIcons[app.slug]);
                    return (
                      <article className="ac-app-tile" key={app.slug}>
                        <div className="ac-app-tile-head">
                          <span className="ac-app-tile-icon-frame">
                            {showIcon && app.iconUrl ? (
                              <img
                                src={app.iconUrl}
                                alt=""
                                width={48}
                                height={48}
                                className="ac-app-tile-icon"
                                loading="lazy"
                                decoding="async"
                                onError={() => setFailedIcons((prev) => ({ ...prev, [app.slug]: true }))}
                              />
                            ) : (
                              <span className="ac-app-tile-icon ac-app-tile-icon--fallback" aria-hidden="true">
                                <Blocks size={20} />
                              </span>
                            )}
                          </span>
                          <div className="ac-app-tile-meta">
                            <strong>{app.displayName}</strong>
                            {badge ? <span className="ac-app-tile-category">{badge}</span> : null}
                          </div>
                        </div>

                        <p className="ac-app-tile-summary">{app.summary[locale]}</p>

                        <div className="ac-app-tile-actions">
                          <a
                            className="ac-launch-link"
                            href={app.web.url}
                            rel="noreferrer"
                            aria-label={`${c('overviewOpenAppAria')} ${app.displayName}`}
                          >
                            <span>{c('overviewOpenInBrowser')}</span>
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </a>
                          <Link
                            className="ac-tile-detail-link"
                            to={withLocaleQuery(`/apps/${app.slug}`, locale)}
                          >
                            <span>{c('overviewAppDetails')}</span>
                            <ChevronRight size={13} aria-hidden="true" />
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="ac-launchpad-empty">
                  <span className="ac-launchpad-empty-icon" aria-hidden="true">
                    <Search size={20} />
                  </span>
                  <strong>{c('overviewSearchNoMatches')}</strong>
                  <p>{c('overviewSearchNoMatchesBody')}</p>
                  <button
                    type="button"
                    className="ac-button ac-button--secondary ac-button--pill ac-button--small"
                    onClick={() => {
                      setSelectedCategory('all');
                      setSearchQuery('');
                    }}
                  >
                    {c('overviewResetFilters')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="ac-section ac-launchpad-fallback">
              <p>{c('overviewNoWebAppsBody')}</p>
              <div className="ac-actions ac-webapps-fallback-actions">
                <Link className="ac-button ac-button--secondary ac-button--pill ac-button--small" to={appsHref}>
                  <Blocks size={15} aria-hidden="true" />
                  <span>{c('overviewExploreApps')}</span>
                </Link>
                <Link className="ac-button ac-button--secondary ac-button--pill ac-button--small" to={homeHref}>
                  <Compass size={15} aria-hidden="true" />
                  <span>{c('overviewExploreHome')}</span>
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div
      className="ac-overview ac-overview--onboarding"
      data-overview-mode={runtimeStatus.kind === 'error' ? 'degraded' : 'onboarding'}
    >
      {runtimeStatus.kind === 'error' ? (
        <div className="ac-runtime-error-bar">
          <AccountFeedback error={runtimeStatus.message} />
          {onRetryRuntime ? (
            <button type="button" className="ac-text-button" onClick={onRetryRuntime}>
              <RefreshCw size={14} aria-hidden="true" />
              <span>{c('retry')}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="ac-hero-card ac-onboarding-hero" aria-labelledby="ac-onboarding-title">
        <ol className="ac-stepper" aria-label={c('navGroupStart')}>
          <li className="ac-step is-done">
            <span className="ac-step-dot" aria-hidden="true">
              <Check size={12} />
            </span>
            <span>{c('overviewStep1')}</span>
          </li>
          <li className="ac-step is-current" aria-current="step">
            <span className="ac-step-dot" aria-hidden="true">2</span>
            <span>{c('overviewStep2')}</span>
          </li>
          <li className="ac-step">
            <span className="ac-step-dot" aria-hidden="true">3</span>
            <span>{c('overviewStep3')}</span>
          </li>
        </ol>

        <div className="ac-hero-header">
          <span className="ac-pill ac-pill--brand">
            {c('overviewReadyBadge')}
            {handle ? ` · @${handle}` : ''}
          </span>
          <h1 id="ac-onboarding-title" tabIndex={-1}>
            {c('overviewHeroTitle')}
            {locale === 'en' ? ' ' : ''}
            {displayName}
          </h1>
          <p className="ac-hero-lead">{c('overviewHeroLead')}</p>
        </div>

        <InstallNimiPanel platform={platform} locale={locale} />

        <div className="ac-hero-footnote">
          <span>{c('overviewAlreadyInstalled')}</span>
          <Link className="ac-text-link" to="/account/runtime">
            <span>{c('overviewBindLink')}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="ac-next-section" aria-labelledby="ac-while-downloading">
        <h2 id="ac-while-downloading" className="ac-section-kicker">{c('overviewWhileDownloading')}</h2>
        <div className="ac-overview-grid">
          <article className="ac-section ac-overview-card">
            <div className="ac-identity-compact">
              <AccountAvatar user={user} />
              <div className="ac-identity-compact-body">
                <h3>{c('overviewClaimTitle')}</h3>
                <small>{displayName}{handle ? ` · @${handle}` : ''}</small>
              </div>
            </div>
            <p>{c('overviewClaimBody')}</p>
            <div className="ac-actions ac-card-actions">
              <Link className="ac-button ac-button--secondary ac-button--pill ac-button--small" to="/account/profile">
                {c('edit')}
              </Link>
              {handle ? (
                <>
                  <button
                    type="button"
                    className="ac-text-button"
                    onClick={() => void copyUsername()}
                  >
                    {copiedHandle ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    <span>{c(copiedHandle ? 'copied' : 'copy')}</span>
                  </button>
                  <span className="sr-only" role="status" aria-live="polite">
                    {copiedHandle ? c('copied') : copyHandleFailed ? c('copyFailed') : ''}
                  </span>
                </>
              ) : null}
            </div>
            {copyHandleFailed ? <p className="ac-feedback ac-feedback--error" role="alert">{c('copyFailed')}</p> : null}
          </article>

          <article className="ac-section ac-overview-card">
            <div className="ac-identity-compact">
              <span className="ac-overview-card-icon" aria-hidden="true">
                <Compass size={20} />
              </span>
              <div className="ac-identity-compact-body">
                <h3>{c('overviewExploreTitle')}</h3>
                <small>Nimi Home &amp; Apps</small>
              </div>
            </div>
            <p>{c('overviewExploreBody')}</p>
            <div className="ac-actions ac-card-actions">
              <Link className="ac-button ac-button--secondary ac-button--pill ac-button--small" to={homeHref}>
                <Compass size={15} aria-hidden="true" />
                <span>{c('overviewExploreHome')}</span>
              </Link>
              <Link className="ac-button ac-button--secondary ac-button--pill ac-button--small" to={appsHref}>
                <Blocks size={15} aria-hidden="true" />
                <span>{c('overviewExploreApps')}</span>
              </Link>
            </div>
          </article>
        </div>
      </section>

      <div className="ac-status-strip">
        <div className="ac-status-strip-item">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            {c('overviewStatusSecurity')}
            <span className={`ac-state${twoFactor ? ' is-enabled' : ''}`}>
              {c('twoFactor')} · {c(twoFactor ? 'enabled' : 'notEnabled')}
            </span>
          </span>
          <Link className="ac-text-link" to="/account/security">{c('overviewStatusManage')}</Link>
        </div>
        <div className="ac-status-strip-item">
          <UsersRound size={16} aria-hidden="true" />
          <span>
            {c('overviewStatusPeople')}
            {pendingReceivedCount && pendingReceivedCount > 0 ? (
              <span className="ac-badge">{pendingReceivedCount}</span>
            ) : null}
          </span>
          <Link
            className="ac-text-link"
            to={pendingReceivedCount && pendingReceivedCount > 0 ? '/account/friends?view=received' : '/account/friends'}
          >
            {c('overviewStatusView')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function AccountOverview({
  user,
  pendingReceivedCount = null,
}: {
  user: Record<string, unknown>;
  pendingReceivedCount?: number | null;
}) {
  const { i18n } = useTranslation();
  const locale: 'zh' | 'en' = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const c = useCallback((key: AccountCopyKey) => accountCenterCopy[key][locale === 'zh' ? 1 : 0], [locale]);
  const accountId = String(user.id ?? '');
  const [platform, setPlatform] = useState<DetectedPlatform>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<OverviewRuntimeStatus>({ kind: 'loading' });
  const [hostedWebApps, setHostedWebApps] = useState<HostedWebAppEntry[]>([]);
  const generation = useRef(0);

  useEffect(() => {
    setPlatform(detectVisitorPlatform());
  }, []);

  const loadRuntime = useCallback(async () => {
    const current = ++generation.current;
    setRuntimeStatus({ kind: 'loading' });
    try {
      const snapshot = await createWebBrowserRealm().generated.getMyPrimaryRuntime({ path: {} });
      if (current !== generation.current) return;
      if (snapshot.accountId !== accountId) {
        setRuntimeStatus({ kind: 'error', message: c('runtimeWrongAccount') });
        return;
      }
      if (snapshot.binding) {
        setRuntimeStatus({
          kind: 'bound',
          binding: {
            bindingId: snapshot.binding.bindingId,
            displayName: snapshot.binding.displayName,
            validAfter: snapshot.binding.validAfter,
          },
        });
      } else {
        setRuntimeStatus({ kind: 'unbound' });
      }
    } catch {
      if (current === generation.current) {
        setRuntimeStatus({ kind: 'error', message: c('overviewRuntimeLoadError') });
      }
    }
  }, [accountId, c]);

  useEffect(() => {
    void loadRuntime();
    return () => {
      generation.current += 1;
    };
  }, [loadRuntime]);

  useEffect(() => {
    if (runtimeStatus.kind !== 'bound') {
      setHostedWebApps([]);
      return;
    }
    const abort = new AbortController();
    void loadHostedWebApps(abort.signal).then((apps) => {
      if (!abort.signal.aborted) setHostedWebApps(apps);
    }).catch(() => {
      if (!abort.signal.aborted) setHostedWebApps([]);
    });
    return () => abort.abort();
  }, [runtimeStatus.kind]);

  return (
    <AccountOverviewView
      user={user}
      runtimeStatus={runtimeStatus}
      onRetryRuntime={() => void loadRuntime()}
      hostedWebApps={hostedWebApps}
      pendingReceivedCount={pendingReceivedCount}
      platform={platform}
      locale={locale}
    />
  );
}
