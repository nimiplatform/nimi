import React from 'react';
import { createRoot } from 'react-dom/client';
import { SiteRouter } from './site-router.js';
import { initializeWebAccountI18n } from './auth/i18n.js';
import '@nimiplatform/kit/ui/styles.css';
import '@nimiplatform/kit/ui/themes/light.css';
import '@nimiplatform/kit/auth/styles.css';
import './landing/styles.css';
import './site.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root mount node');

void initializeWebAccountI18n().then(() => {
  createRoot(rootElement).render(
    <React.StrictMode>
      <SiteRouter />
    </React.StrictMode>,
  );
});
