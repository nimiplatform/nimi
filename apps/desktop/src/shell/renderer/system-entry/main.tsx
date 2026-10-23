import { createRoot } from 'react-dom/client';
import { SystemEntryApp } from './system-entry-app.js';
import './system-entry.css';

// This document intentionally has no Home runtime bridge, SDK, auth or router.
const container = document.getElementById('root');
if (!container) throw new Error('system-entry-root-missing');
createRoot(container).render(<SystemEntryApp />);
