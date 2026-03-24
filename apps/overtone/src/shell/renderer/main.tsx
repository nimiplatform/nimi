import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/nimi-kit/ui';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('ROOT_MOUNT_NODE_MISSING');
}

createRoot(rootElement).render(
  <NimiThemeProvider accentPack="overtone-accent" defaultScheme="dark">
    <App />
  </NimiThemeProvider>,
);
