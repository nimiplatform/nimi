import React from 'react';
import { createRoot } from 'react-dom/client';
import { PostPermalinkPage } from './post-permalink-page.js';
import './web-styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root mount node');
}

const postMatch = window.location.pathname.match(/^\/posts\/([^/]+)$/);
if (!postMatch) {
  throw new Error('Missing post permalink id');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <PostPermalinkPage postId={postMatch[1]!} />
  </React.StrictMode>,
);
