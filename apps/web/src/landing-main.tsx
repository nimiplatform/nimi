import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './landing/App.js';
import './landing/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root mount node');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
