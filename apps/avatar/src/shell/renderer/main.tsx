import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Nimi Avatar: root container missing — index.html must include <div id="root"></div>');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
