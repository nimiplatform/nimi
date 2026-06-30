import React from 'react';
import { createRoot } from 'react-dom/client';
import '@nimiplatform/kit/ui/styles.css';
import './styles.css';
import { App } from './App.js';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Nimi App Platform fixture root element is missing');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
