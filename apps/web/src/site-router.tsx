import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { App as LandingApp } from './landing/App.js';
import { WebAccountPage } from './auth/web-account-page.js';
import { AccountRecoveryPage } from './auth/account-recovery-page.js';
import { AccountManagementPage } from './auth/account-management-page.js';
import { ProviderLinkCallbackPage } from './auth/provider-link-callback-page.js';
import { StaticPage } from './site/static-page.js';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
export function SiteRouter() {
  return (
    <BrowserRouter>
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
        <Route path="/privacy" element={<StaticPage kind="privacy" />} />
        <Route path="/terms" element={<StaticPage kind="terms" />} />
      </Routes>
    </BrowserRouter>
  );
}
