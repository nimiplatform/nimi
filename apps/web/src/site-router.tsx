import { Suspense, lazy, useRef, useState, type RefObject } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Link,
  Outlet,
  Route,
  RouterProvider,
  ScrollRestoration,
} from 'react-router-dom';

const LandingApp = lazy(async () => ({
  default: (await import('./landing/App.js')).App,
}));
const StaticPage = lazy(async () => ({
  default: (await import('./pages/static-page.js')).StaticPage,
}));
const PlatformPage = lazy(async () => ({
  default: (await import('./pages/platform-page.js')).PlatformPage,
}));
const DevelopersPage = lazy(async () => ({
  default: (await import('./pages/developers-page.js')).DevelopersPage,
}));
const PublicNotFoundPage = lazy(async () => ({
  default: (await import('./pages/public-site-shell.js')).PublicNotFoundPage,
}));
const PublicRouteErrorBoundary = lazy(async () => ({
  default: (await import('./pages/public-site-shell.js')).PublicRouteErrorBoundary,
}));

const WebAccountPage = lazy(async () => {
  const [{ initializeWebAccountI18n }, module] = await Promise.all([
    import('./auth/i18n.js'),
    import('./auth/web-account-page.js'),
  ]);
  await initializeWebAccountI18n().catch(() => undefined);
  return { default: module.WebAccountPage };
});
const AccountRecoveryPage = lazy(async () => {
  const [{ initializeWebAccountI18n }, module] = await Promise.all([
    import('./auth/i18n.js'),
    import('./auth/account-recovery-page.js'),
  ]);
  await initializeWebAccountI18n().catch(() => undefined);
  return { default: module.AccountRecoveryPage };
});
const AccountManagementPage = lazy(async () => {
  const [{ initializeWebAccountI18n }, module] = await Promise.all([
    import('./auth/i18n.js'),
    import('./auth/account-management-page.js'),
  ]);
  await initializeWebAccountI18n().catch(() => undefined);
  return { default: module.AccountManagementPage };
});
const ProviderLinkCallbackPage = lazy(async () => {
  const [{ initializeWebAccountI18n }, module] = await Promise.all([
    import('./auth/i18n.js'),
    import('./auth/provider-link-callback-page.js'),
  ]);
  await initializeWebAccountI18n().catch(() => undefined);
  return { default: module.ProviderLinkCallbackPage };
});

type AccountConfirmation = { loginLocationKey: string; account: Record<string, unknown> };
export type AccountRouteContext = RefObject<AccountConfirmation | null>;

function AccountRoutes() {
  // The just-confirmed account crosses an SPA navigation in memory only.
  const confirmation = useRef<AccountConfirmation | null>(null);
  return <Outlet context={confirmation} />;
}

function detectFallbackLocale(): 'zh' | 'en' {
  if (typeof window === 'undefined') return 'en';
  const lang = new URLSearchParams(window.location.search).get('lang');
  if (lang === 'zh' || lang === 'en') return lang;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function OfflineErrorFallback() {
  const locale = detectFallbackLocale();
  const isZh = locale === 'zh';
  return (
    <main className="web-account-status" role="alert">
      <img src="/logo.svg" width={44} height={44} alt="Nimi" />
      <h1>{isZh ? '页面暂时无法加载' : 'This page is temporarily unavailable'}</h1>
      <div className="web-account-session-actions">
        <button type="button" className="story-button" onClick={() => window.location.reload()}>
          {isZh ? '重新加载' : 'Reload'}
        </button>
        <Link to={`/?lang=${locale}`}>{isZh ? '返回官网首页' : 'Back to overview'}</Link>
      </div>
    </main>
  );
}

function SharedRouteErrorElement() {
  return (
    <Suspense fallback={<OfflineErrorFallback />}>
      <PublicRouteErrorBoundary />
    </Suspense>
  );
}

function RootRouteLayout() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
export function SiteRouter() {
  const [router] = useState(() =>
    createBrowserRouter(
      createRoutesFromElements(
        <Route element={<RootRouteLayout />} errorElement={<SharedRouteErrorElement />}>
          <Route path="/" element={<LandingApp />} />
          <Route path="/index.html" element={<LandingApp />} />
          <Route element={<AccountRoutes />}>
            <Route path="/login" element={<WebAccountPage />} />
            <Route path="/register" element={<WebAccountPage />} />
            <Route path="/account/recovery" element={<AccountRecoveryPage />} />
            <Route path="/account/2fa" element={<WebAccountPage />} />
            <Route
              path="/account/*"
              element={<AccountManagementPage />}
              errorElement={<SharedRouteErrorElement />}
            />
            <Route path="/account/oauth/callback" element={<ProviderLinkCallbackPage />} />
          </Route>
          <Route path="/home" element={<StaticPage kind="home" />} />
          <Route path="/home.html" element={<StaticPage kind="home" />} />
          <Route path="/apps" element={<StaticPage kind="apps" />} />
          <Route path="/apps.html" element={<StaticPage kind="apps" />} />
          <Route path="/apps/:slug" element={<StaticPage kind="apps" />} />
          <Route path="/platform" element={<PlatformPage />} />
          <Route path="/platform.html" element={<PlatformPage />} />
          <Route path="/developers" element={<DevelopersPage />} />
          <Route path="/developers.html" element={<DevelopersPage />} />
          <Route path="/download" element={<StaticPage kind="download" />} />
          <Route path="/download.html" element={<StaticPage kind="download" />} />
          <Route path="/code-signing" element={<StaticPage kind="code-signing" />} />
          <Route path="/code-signing.html" element={<StaticPage kind="code-signing" />} />
          <Route path="/privacy" element={<StaticPage kind="privacy" />} />
          <Route path="/terms" element={<StaticPage kind="terms" />} />
          <Route path="*" element={<PublicNotFoundPage />} />
        </Route>,
      ),
    ),
  );
  return (
    <Suspense fallback={<div className="public-route-loading-shell" aria-busy="true" />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
