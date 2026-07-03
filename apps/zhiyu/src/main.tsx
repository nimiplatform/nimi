import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import './styles.css';
import { App } from './shell/app/App';
import { AuthGate } from './shell/auth/auth-gate';
import { installZhiyuElectronSdkAcceptanceProbe } from './shell/auth/electron-sdk-acceptance';

installNimiShellRuntimeBridge();
installZhiyuElectronSdkAcceptanceProbe();

const root = document.getElementById('root');
if (!root) {
  throw new Error('zhiyu root element is missing');
}

createRoot(root).render(
  <React.StrictMode>
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
      <AuthGate>
        <App />
      </AuthGate>
    </NimiThemeProvider>
  </React.StrictMode>,
);
