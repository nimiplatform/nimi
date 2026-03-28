import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/nimi-kit/ui';
import { App } from './App.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('LOOKDEV_ROOT_MISSING');
}

createRoot(rootElement).render(
  <StrictMode>
    <NimiThemeProvider accentPack="overtone-accent" defaultScheme="dark">
      <App />
    </NimiThemeProvider>
  </StrictMode>,
);
