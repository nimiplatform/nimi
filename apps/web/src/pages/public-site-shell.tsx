import { Surface } from '@nimiplatform/kit/ui';
import { useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { ArrowLeft, Compass, Download, Menu, UserRound, X } from 'lucide-react';
import { Link, useInRouterContext, useLocation } from 'react-router-dom';
import { LanguageToggle } from '../landing/components/language-toggle.js';
import { resolveLandingLinks, resolveLocalizedLinks, withLocaleQuery, type LandingLinks } from '../landing/config/landing-links.js';
import type { LandingLocale } from '../landing/i18n/locale.js';
import { loadWebLocaleFont } from '../fonts.js';
import { useHashScroll } from '../landing/hooks/use-hash-scroll.js';
import { usePublicPageLocale } from './use-page-locale.js';

const SHELL_LOCALE_OPTIONS = {
  zh: {
    en: 'English',
    zh: '中文',
    switchToEn: '切换为英文',
    switchToZh: '切换为中文',
  },
  en: {
    en: 'English',
    zh: '中文',
    switchToEn: 'Switch to English',
    switchToZh: 'Switch to Chinese',
  },
} as const;

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
export type PublicSiteRouteId =
  | 'overview'
  | 'home'
  | 'apps'
  | 'platform'
  | 'developers'
  | 'download'
  | 'code-signing';

export type PublicNavItem = {
  readonly id: PublicSiteRouteId;
  readonly path: string;
  readonly exact?: boolean;
  readonly label: Readonly<Record<LandingLocale, string>>;
};

/**
 * Declarative navigation manifest for the Nimi Official Website.
 * Pages can be merged, split, reordered, or added here without rewriting
 * per-page header/footer chrome.
 */
export const PUBLIC_SITE_NAV_ITEMS: ReadonlyArray<PublicNavItem> = [
  { id: 'overview', path: '/', exact: true, label: { zh: '概览', en: 'Overview' } },
  { id: 'home', path: '/home', label: { zh: 'Home 与伙伴', en: 'Home & Companions' } },
  { id: 'apps', path: '/apps', label: { zh: '应用生态', en: 'Apps' } },
  { id: 'platform', path: '/platform', label: { zh: '平台底座', en: 'Platform' } },
  { id: 'developers', path: '/developers', label: { zh: '开发者', en: 'Developers' } },
];

const SHELL_COPY: Readonly<Record<LandingLocale, {
  skipToContent: string;
  navAriaLabel: string;
  languageLabel: string;
  accountLabel: string;
  downloadCta: string;
  openMenu: string;
  closeMenu: string;
  footerTagline: string;
  footerProductHeading: string;
  footerResourcesHeading: string;
  footerTrustHeading: string;
  footerDownload: string;
  footerSigning: string;
  footerDocs: string;
  footerGithub: string;
  footerDiscord: string;
  footerSecurity: string;
  footerTerms: string;
  footerPrivacy: string;
  notFoundEyebrow: string;
  notFoundTitle: string;
  notFoundBody: string;
  notFoundBackHome: string;
  notFoundBrowseApps: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
}>> = {
  zh: {
    skipToContent: '跳转到主要内容',
    navAriaLabel: 'Nimi 官网导航',
    languageLabel: '语言',
    accountLabel: '我的账号',
    downloadCta: '下载 Beta',
    openMenu: '打开导航菜单',
    closeMenu: '关闭导航菜单',
    footerTagline: '个人 AI 底座 · 本地算力与跨应用上下文连续',
    footerProductHeading: '产品与架构',
    footerResourcesHeading: '开发者与社区',
    footerTrustHeading: '信任与条款',
    footerDownload: '下载与平台支持',
    footerSigning: '代码签名政策',
    footerDocs: '技术文档',
    footerGithub: 'GitHub 开源仓库',
    footerDiscord: 'Discord 社区',
    footerSecurity: '安全漏洞报告',
    footerTerms: '服务条款',
    footerPrivacy: '隐私政策',
    notFoundEyebrow: '404 · 页面不存在',
    notFoundTitle: '未找到你要访问的页面',
    notFoundBody: '该链接可能已变更或输入有误。你可以返回官网首页了解 Nimi 的个人 AI 底座定位，或前往对应板块继续浏览。',
    notFoundBackHome: '返回官网首页',
    notFoundBrowseApps: '浏览应用生态',
    errorTitle: '页面暂时无法加载',
    errorBody: '加载当前页面时遇到了意外问题，请刷新重试或返回首页。',
    errorRetry: '重新加载',
  },
  en: {
    skipToContent: 'Skip to main content',
    navAriaLabel: 'Nimi official site',
    languageLabel: 'Language',
    accountLabel: 'My account',
    downloadCta: 'Download Beta',
    openMenu: 'Open navigation menu',
    closeMenu: 'Close navigation menu',
    footerTagline: 'Personal AI foundation · Local compute & cross-app continuity',
    footerProductHeading: 'Product & Architecture',
    footerResourcesHeading: 'Developers & Community',
    footerTrustHeading: 'Trust & Legal',
    footerDownload: 'Downloads & platforms',
    footerSigning: 'Code signing policy',
    footerDocs: 'Documentation',
    footerGithub: 'GitHub repository',
    footerDiscord: 'Discord community',
    footerSecurity: 'Report a vulnerability',
    footerTerms: 'Terms of service',
    footerPrivacy: 'Privacy policy',
    notFoundEyebrow: '404 · Page not found',
    notFoundTitle: 'We couldn’t find that page',
    notFoundBody: 'The address may have moved or been mistyped. Return to the overview to explore the Nimi personal AI foundation, or jump to a product page below.',
    notFoundBackHome: 'Back to overview',
    notFoundBrowseApps: 'Explore Nimi Apps',
    errorTitle: 'Unable to load this page',
    errorBody: 'Something unexpected happened while opening this page. Please reload or return to the overview.',
    errorRetry: 'Reload page',
  },
};

export function useResolvedPublicLinks(locale: LandingLocale): LandingLinks {
  const baseLinks = useMemo(
    () =>
      resolveLandingLinks(
        typeof import.meta.env === 'object' && import.meta.env !== null
          ? {
            VITE_LANDING_APP_URL: import.meta.env.VITE_LANDING_APP_URL,
            VITE_LANDING_WEB_APP_URL: import.meta.env.VITE_LANDING_WEB_APP_URL,
            VITE_LANDING_DISCORD_URL: import.meta.env.VITE_LANDING_DISCORD_URL,
            VITE_LANDING_DOCS_URL: import.meta.env.VITE_LANDING_DOCS_URL,
            VITE_LANDING_GITHUB_URL: import.meta.env.VITE_LANDING_GITHUB_URL,
            VITE_LANDING_DOCS_SOURCE_URL: import.meta.env.VITE_LANDING_DOCS_SOURCE_URL,
            VITE_LANDING_PROTOCOL_URL: import.meta.env.VITE_LANDING_PROTOCOL_URL,
            VITE_LANDING_DESKTOP_DOWNLOAD_URL: import.meta.env.VITE_LANDING_DESKTOP_DOWNLOAD_URL,
            VITE_LANDING_MODELS_URL: import.meta.env.VITE_LANDING_MODELS_URL,
          }
          : {},
      ),
    [],
  );
  return useMemo(() => resolveLocalizedLinks(baseLinks, locale), [baseLinks, locale]);
}

export function usePublicDocumentMetadata(title: string, description: string, path: string, locale: LandingLocale) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    loadWebLocaleFont(locale);
    document.title = title;
    const canonical = path === '/' ? 'https://nimi.ai' : `https://nimi.ai${path}`;
    const targets = [
      ['meta[name="description"]', description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[property="og:url"]', canonical],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description],
      ['link[rel="canonical"]', canonical],
    ] as const;
    for (const [selector, value] of targets) {
      const element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
      if (element instanceof HTMLMetaElement) element.content = value;
      else element?.setAttribute('href', value);
    }
  }, [description, locale, path, title]);
}

function normalizeRoutePathname(pathname: string): string {
  if (pathname === '/index.html') return '/';
  const stripped = pathname.replace(/\.html$/u, '');
  return stripped || '/';
}

function isRouteActive(pathname: string, item: PublicNavItem): boolean {
  const normalized = normalizeRoutePathname(pathname);
  if (item.exact) return normalized === item.path;
  return normalized === item.path || normalized.startsWith(`${item.path}/`);
}

/**
 * Renders a client-side React Router `<Link>` whenever inside a Router context
 * for SPA routes, while falling back cleanly to `<a href>` in standalone SSR
 * unit tests or for static standalone `.html` legal documents.
 */
export function PublicSiteLink({
  to,
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
}) {
  const inRouter = useInRouterContext();
  const isSpaInternal = to.startsWith('/') && !/^\/(?:terms|privacy)\.html(?:[?#]|$)/u.test(to);
  if (inRouter && isSpaInternal) {
    return (
      <Link to={to} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={to} {...rest}>
      {children}
    </a>
  );
}

export function PublicSiteHeader({
  locale,
  onLocaleChange,
  activePath,
  navId = 'public-site-navigation',
  className = '',
}: {
  locale: LandingLocale;
  onLocaleChange: (locale: LandingLocale) => void;
  activePath?: string;
  navId?: string;
  className?: string;
}) {
  const copy = SHELL_COPY[locale];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPanelRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  let currentPathname = activePath ?? '/';
  try {
    const location = useLocation();
    if (!activePath) currentPathname = location.pathname;
  } catch {
    // Allow standalone SSR unit tests that render without a Router wrapper.
  }

  useEffect(() => {
    setMenuOpen(false);
  }, [currentPathname]);

  useEffect(() => {
    if (!menuOpen) return;
    menuPanelRef.current?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setMenuOpen(false);
      menuButtonRef.current?.focus({ preventScroll: true });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuPanelRef.current?.contains(event.target) || menuButtonRef.current?.contains(event.target)) {
        return;
      }
      setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen]);

  const downloadActive = normalizeRoutePathname(currentPathname) === '/download';

  return (
    <Surface
      as="header"
      material="glass-chrome"
      padding="none"
      className={`story-nav public-site-nav${className ? ` ${className}` : ''}`}
    >
      <PublicSiteLink to={withLocaleQuery('/', locale)} className="story-brand">
        <img src="/logo.svg" alt="" width={29} height={29} />
        <strong>Nimi</strong>
      </PublicSiteLink>

      <nav
        id={navId}
        ref={menuPanelRef}
        aria-label={copy.navAriaLabel}
        className={menuOpen ? 'is-open' : undefined}
      >
        {PUBLIC_SITE_NAV_ITEMS.map((item) => {
          const active = isRouteActive(currentPathname, item);
          const href = withLocaleQuery(item.path, locale);
          return (
            <PublicSiteLink
              key={item.id}
              to={href}
              aria-current={active ? 'page' : undefined}
              className={active ? 'is-active' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {item.label[locale]}
            </PublicSiteLink>
          );
        })}
        <PublicSiteLink
          to={withLocaleQuery('/account', locale)}
          className="story-mobile-account-link"
          onClick={() => setMenuOpen(false)}
        >
          <UserRound size={16} aria-hidden="true" />
          <span>{copy.accountLabel}</span>
        </PublicSiteLink>
      </nav>

      <div className="story-nav-actions">
        <LanguageToggle
          locale={locale}
          label={copy.languageLabel}
          options={SHELL_LOCALE_OPTIONS[locale]}
          onChange={(next) => {
            setMenuOpen(false);
            onLocaleChange(next);
          }}
        />
        <PublicSiteLink
          className="story-account"
          to={withLocaleQuery('/account', locale)}
          aria-label={copy.accountLabel}
          title={copy.accountLabel}
        >
          <UserRound size={18} aria-hidden="true" />
        </PublicSiteLink>
        <PublicSiteLink
          className={`story-download${downloadActive ? ' is-active' : ''}`}
          to={withLocaleQuery('/download', locale)}
          aria-current={downloadActive ? 'page' : undefined}
        >
          <Download size={14} aria-hidden="true" />
          <span>{copy.downloadCta}</span>
        </PublicSiteLink>
        <button
          ref={menuButtonRef}
          className="story-menu-toggle"
          type="button"
          aria-controls={navId}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? copy.closeMenu : copy.openMenu}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
    </Surface>
  );
}

export function PublicSiteFooter({
  locale,
  links,
}: {
  locale: LandingLocale;
  links: LandingLinks;
}) {
  const copy = SHELL_COPY[locale];

  return (
    <footer className="public-site-footer">
      <div className="public-site-footer-inner">
        <div className="public-site-footer-brand">
          <PublicSiteLink to={withLocaleQuery('/', locale)} className="story-brand">
            <img src="/logo.svg" alt="" width={28} height={28} />
            <strong>Nimi</strong>
          </PublicSiteLink>
          <p>{copy.footerTagline}</p>
          <small>Nimi Network Limited</small>
        </div>

        <div className="public-site-footer-columns">
          <div>
            <h2>{copy.footerProductHeading}</h2>
            <ul>
              {PUBLIC_SITE_NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <PublicSiteLink to={withLocaleQuery(item.path, locale)}>{item.label[locale]}</PublicSiteLink>
                </li>
              ))}
              <li>
                <PublicSiteLink to={links.downloadUrl}>{copy.footerDownload}</PublicSiteLink>
              </li>
            </ul>
          </div>

          <div>
            <h2>{copy.footerResourcesHeading}</h2>
            <ul>
              <li>
                <a href={links.docsUrl}>{copy.footerDocs}</a>
              </li>
              <li>
                <a href={links.githubUrl}>{copy.footerGithub}</a>
              </li>
              <li>
                <a href={links.discordUrl}>{copy.footerDiscord}</a>
              </li>
            </ul>
          </div>

          <div>
            <h2>{copy.footerTrustHeading}</h2>
            <ul>
              <li>
                <PublicSiteLink to={withLocaleQuery('/code-signing', locale)}>{copy.footerSigning}</PublicSiteLink>
              </li>
              <li>
                <a href="https://github.com/nimiplatform/nimi/security/advisories/new">{copy.footerSecurity}</a>
              </li>
              <li>
                <a href="/terms.html">{copy.footerTerms}</a>
              </li>
              <li>
                <a href="/privacy.html">{copy.footerPrivacy}</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function PublicSiteShell({
  locale,
  onLocaleChange,
  activePath,
  mainId = 'main-content',
  shellClassName = '',
  mainClassName = 'public-page-main',
  children,
}: {
  locale: LandingLocale;
  onLocaleChange: (locale: LandingLocale) => void;
  activePath?: string;
  mainId?: string;
  shellClassName?: string;
  mainClassName?: string;
  children: ReactNode;
}) {
  const copy = SHELL_COPY[locale];
  const links = useResolvedPublicLinks(locale);
  useHashScroll(true);

  return (
    <div
      className={`story-site public-site-shell${shellClassName ? ` ${shellClassName}` : ''}`}
      lang={locale === 'zh' ? 'zh-CN' : 'en'}
      onDragStart={(event) => event.preventDefault()}
    >
      <a href={`#${mainId}`} className="skip-link">
        {copy.skipToContent}
      </a>
      <PublicSiteHeader locale={locale} onLocaleChange={onLocaleChange} activePath={activePath} />
      <main id={mainId} className={mainClassName}>
        {children}
      </main>
      <PublicSiteFooter locale={locale} links={links} />
    </div>
  );
}

export function PublicNotFoundPage() {
  const [locale, setLocale] = usePublicPageLocale();
  const copy = SHELL_COPY[locale];
  usePublicDocumentMetadata(`${copy.notFoundTitle} | Nimi`, copy.notFoundBody, '/404', locale);

  return (
    <PublicSiteShell locale={locale} onLocaleChange={setLocale} activePath="/404">
      <section className="public-page-container public-status-card" aria-labelledby="not-found-heading">
        <span className="public-eyebrow">{copy.notFoundEyebrow}</span>
        <h1 id="not-found-heading">{copy.notFoundTitle}</h1>
        <p>{copy.notFoundBody}</p>
        <div className="public-hero-actions">
          <PublicSiteLink to={withLocaleQuery('/', locale)} className="story-button">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>{copy.notFoundBackHome}</span>
          </PublicSiteLink>
          <PublicSiteLink to={withLocaleQuery('/apps', locale)} className="story-button story-button-outline">
            <Compass size={16} aria-hidden="true" />
            <span>{copy.notFoundBrowseApps}</span>
          </PublicSiteLink>
        </div>
      </section>
    </PublicSiteShell>
  );
}

export function PublicRouteErrorBoundary() {
  const [locale, setLocale] = usePublicPageLocale();
  const copy = SHELL_COPY[locale];

  return (
    <PublicSiteShell locale={locale} onLocaleChange={setLocale} activePath="/error">
      <section className="public-page-container public-status-card" role="alert" aria-labelledby="route-error-heading">
        <h1 id="route-error-heading">{copy.errorTitle}</h1>
        <p>{copy.errorBody}</p>
        <div className="public-hero-actions">
          <button type="button" className="story-button" onClick={() => window.location.reload()}>
            {copy.errorRetry}
          </button>
          <PublicSiteLink to={withLocaleQuery('/', locale)} className="story-button story-button-outline">
            {copy.notFoundBackHome}
          </PublicSiteLink>
        </div>
      </section>
    </PublicSiteShell>
  );
}
