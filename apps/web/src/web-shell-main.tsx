import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, applyNimiThemeAttributes } from '@nimiplatform/kit/ui';
import { installBundledImportMetaEnv } from './import-meta-env.js';
import './web-styles.css';

installBundledImportMetaEnv(import.meta.env);
applyNimiThemeAttributes({ scheme: 'light', accentPack: 'nimi-accent' });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root mount node');
}
const mountElement = rootElement;

async function bootstrapWebShell(): Promise<void> {
  const { initI18n } = await import('@desktop-public/i18n');
  await initI18n();
  const { default: WebShellApp } = await import('@desktop-public/app');

  createRoot(mountElement).render(
    <React.StrictMode>
      <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
        <WebShellApp />
      </NimiThemeProvider>
    </React.StrictMode>,
  );
}

void bootstrapWebShell();
