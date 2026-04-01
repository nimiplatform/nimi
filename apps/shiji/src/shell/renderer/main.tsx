import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/nimi-kit/ui';
import './styles.css';
import { App } from './App.js';

// i18n must init before React renders (eagerly imports locales)
import './i18n/index.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('[shiji] Root element not found — check index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    {/* ShiJi is light-only (SJ-SHELL-004) — no dark mode for K-12 students */}
    <NimiThemeProvider accentPack="shiji-accent" defaultScheme="light">
      <App />
    </NimiThemeProvider>
  </StrictMode>,
);
