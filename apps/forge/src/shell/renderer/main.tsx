import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/nimi-ui';
import './styles.css';
import { App } from './App.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <NimiThemeProvider accentPack="forge-accent" defaultScheme="light">
      <App />
    </NimiThemeProvider>
  </StrictMode>,
);
