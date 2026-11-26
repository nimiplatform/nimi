import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiMotionProvider } from '@nimiplatform/kit/ui';
import { SiteRouter } from './site-router.js';
import { syncSystemWebColorScheme } from './theme-scheme.js';
import './foundation.css';

syncSystemWebColorScheme();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root mount node');

createRoot(rootElement).render(
  <React.StrictMode>
    <NimiMotionProvider>
      <SiteRouter />
    </NimiMotionProvider>
  </React.StrictMode>,
);
