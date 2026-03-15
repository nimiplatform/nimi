import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initI18n } from '@renderer/i18n';
import { App as LandingApp } from './landing/App.js';
import { isWebShellHashRoute } from './site-entry-hash.js';
import { PostPermalinkPage } from './post-permalink-page.js';
import './web-styles.css';
import './landing/styles.css';

let appI18nInitPromise: Promise<void> | null = null;

const WebShellApp = lazy(async () => {
  appI18nInitPromise ??= initI18n();
  await appI18nInitPromise;
  const mod = await import('@renderer/App');
  return { default: mod.default };
});

function SiteEntry() {
  const pathname = window.location.pathname;
  const postMatch = pathname.match(/^\/posts\/([^/]+)$/);
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    function handleHashChange() {
      setHash(window.location.hash);
    }

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  if (postMatch) {
    return (
      <Suspense fallback={null}>
        <PostPermalinkPage postId={postMatch[1]!} />
      </Suspense>
    );
  }

  if (!isWebShellHashRoute(hash)) {
    return <LandingApp />;
  }

  return (
    <Suspense fallback={null}>
      <WebShellApp />
    </Suspense>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root mount node');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <SiteEntry />
  </React.StrictMode>,
);
