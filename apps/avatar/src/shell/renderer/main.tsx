// IMPORTANT: i18n is imported FIRST so its synchronous init runs before any
// component module that calls t() / useTranslation() at module evaluation
// time. Wave 2 / app-shell-contract.md NAV-SHELL-COMPANION-* + DEGRADED-* all
// rely on i18n being ready at first paint — no loading flash, no async
// fallback path.
import './i18n/index.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { t } from './i18n/index.js';
import './app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Nimi Avatar: root container missing — index.html must include <div id="root"></div>');
}

if (typeof document !== 'undefined') {
  document.title = t('Avatar.shell.document_title');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
