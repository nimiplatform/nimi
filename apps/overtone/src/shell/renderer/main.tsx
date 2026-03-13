import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('ROOT_MOUNT_NODE_MISSING');
}

createRoot(rootElement).render(<App />);
