import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
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

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
export function SiteRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<LandingApp />} />
          <Route path="/login" element={<WebAccountPage />} />
          <Route path="/register" element={<WebAccountPage />} />
          <Route path="/account/recovery" element={<AccountRecoveryPage />} />
          <Route path="/account/2fa" element={<WebAccountPage />} />
          <Route path="/account" element={<AccountManagementPage />} />
          <Route path="/account/security" element={<AccountManagementPage />} />
          <Route path="/account/oauth/callback" element={<ProviderLinkCallbackPage />} />
          <Route path="/home" element={<StaticPage kind="home" />} />
          <Route path="/apps" element={<StaticPage kind="apps" />} />
          <Route path="/apps/:slug" element={<StaticPage kind="apps" />} />
          <Route path="/download" element={<StaticPage kind="download" />} />
          <Route path="/code-signing" element={<StaticPage kind="code-signing" />} />
          <Route path="/privacy" element={<StaticPage kind="privacy" />} />
          <Route path="/terms" element={<StaticPage kind="terms" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
