import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/nimi-kit/ui';
import { buildDesktopWebAuthLaunchUrl, resolveDesktopCallbackRequestFromLocation } from '@nimiplatform/nimi-kit/auth';
import { App } from './App.js';
import { getBridge } from './bridge/electron-bridge.js';
import { initI18n } from './i18n/index.js';
import { useAppStore, type AuthState } from './app-shell/providers/app-store.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

async function prepareRelayRenderer(): Promise<boolean> {
  const desktopCallbackRequest = resolveDesktopCallbackRequestFromLocation();
  if (desktopCallbackRequest && typeof window !== 'undefined') {
    const redirectUrl = buildDesktopWebAuthLaunchUrl({
      callbackUrl: desktopCallbackRequest.callbackUrl,
      state: desktopCallbackRequest.state,
    });
    if (redirectUrl && redirectUrl !== window.location.href) {
      window.location.replace(redirectUrl);
      return false;
    }
  }

  await initI18n();

  try {
    const bridge = getBridge();
    const status = await bridge.auth.getStatus();
    useAppStore.getState().setAuthState(status.state as AuthState, status.error);
  } catch {
    // Keep default auth state; App subscribes to main-process auth updates after mount.
  }

  return true;
}

void prepareRelayRenderer().then((shouldRender) => {
  if (!shouldRender) {
    return;
  }

  createRoot(root).render(
    <StrictMode>
      <NimiThemeProvider accentPack="desktop-accent" defaultScheme="light">
        <App />
      </NimiThemeProvider>
    </StrictMode>,
  );
});
