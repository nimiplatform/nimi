import { Suspense, lazy, useState } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Link,
  Route,
  RouterProvider,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { App as LandingApp } from './landing/App.js';
import { StaticPage } from './pages/static-page.js';

const WebAccountPage = lazy(async () => ({
  default: (await import('./auth/web-account-page.js')).WebAccountPage,
}));
const AccountRecoveryPage = lazy(async () => ({
  default: (await import('./auth/account-recovery-page.js')).AccountRecoveryPage,
}));
const AccountManagementPage = lazy(async () => ({
  default: (await import('./auth/account-management-page.js')).AccountManagementPage,
}));
const ProviderLinkCallbackPage = lazy(async () => ({
  default: (await import('./auth/provider-link-callback-page.js')).ProviderLinkCallbackPage,
}));

function AccountRouteUnavailable() {
  const { t } = useTranslation();
  return (
    <main className="web-account-status" role="alert">
      <img src="/logo.svg" width={40} height={40} alt="Nimi" />
      <h1>{t('Account.pageUnavailable')}</h1>
      <button type="button" onClick={() => window.location.reload()}>
        {t('AccountSecurity.retry')}
      </button>
      <Link to="/">{t('Account.backHome')}</Link>
    </main>
  );
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
export function SiteRouter() {
  const [router] = useState(() =>
    createBrowserRouter(
      createRoutesFromElements(
        <>
          <Route path="/" element={<LandingApp />} />
          <Route path="/login" element={<WebAccountPage />} />
          <Route path="/register" element={<WebAccountPage />} />
          <Route path="/account/recovery" element={<AccountRecoveryPage />} />
          <Route path="/account/2fa" element={<WebAccountPage />} />
          <Route
            path="/account/*"
            element={<AccountManagementPage />}
            errorElement={<AccountRouteUnavailable />}
          />
          <Route path="/account/oauth/callback" element={<ProviderLinkCallbackPage />} />
          <Route path="/home" element={<StaticPage kind="home" />} />
          <Route path="/apps" element={<StaticPage kind="apps" />} />
          <Route path="/apps/:slug" element={<StaticPage kind="apps" />} />
          <Route path="/download" element={<StaticPage kind="download" />} />
          <Route path="/code-signing" element={<StaticPage kind="code-signing" />} />
          <Route path="/privacy" element={<StaticPage kind="privacy" />} />
          <Route path="/terms" element={<StaticPage kind="terms" />} />
        </>,
      ),
    ),
  );
  return (
    <Suspense fallback={null}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
