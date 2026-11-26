import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiMotionProvider, NimiThemeProvider } from '@nimiplatform/kit/ui';
import App from './App';
import './styles/tokens.css';
import './styles/field.css';
import './styles/panes.css';
import './styles/spatial-tide.css';
import './styles/modules.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

createRoot(root).render(
  <StrictMode>
    <NimiThemeProvider scheme="dark" accentPack="nimi-accent">
      <NimiMotionProvider>
        <App />
      </NimiMotionProvider>
    </NimiThemeProvider>
  </StrictMode>,
);
