import React from 'react';
import { createRoot } from 'react-dom/client';
import { SiteRouter } from './site-router.js';
import './foundation.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root mount node');

createRoot(rootElement).render(
  <React.StrictMode>
    <SiteRouter />
  </React.StrictMode>,
);
