import React from 'react';
import { createRoot } from 'react-dom/client';
import { SiteRouter } from './site-router.js';
import { initializeWebAccountI18n } from './auth/i18n.js';
import './foundation.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root mount node');

void initializeWebAccountI18n().then(() => {
  createRoot(rootElement).render(
    <React.StrictMode>
      <SiteRouter />
    </React.StrictMode>,
  );
});
