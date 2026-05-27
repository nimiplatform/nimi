import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('VIDEO_FOOD_MAP_ROOT_MISSING');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
