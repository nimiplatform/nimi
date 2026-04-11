import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/nimi-kit/ui';
import { App } from './App.js';
import { installParentosGlobalErrorLogging } from './infra/telemetry/renderer-log.js';
import './styles.css';

installParentosGlobalErrorLogging();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NimiThemeProvider accentPack="desktop-accent" defaultScheme="light">
      <App />
    </NimiThemeProvider>
  </StrictMode>,
);
