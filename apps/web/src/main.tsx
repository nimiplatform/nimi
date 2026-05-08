import { isWebShellHashRoute, isWebShellPathRoute } from './site-entry-hash.js';

function isPostPermalinkPath(pathname: string): boolean {
  return /^\/posts\/[^/]+$/.test(pathname);
}

async function bootstrapSiteEntry(): Promise<void> {
  if (isPostPermalinkPath(window.location.pathname)) {
    await import('./post-permalink-main.js');
    return;
  }

  if (isWebShellPathRoute(window.location.pathname) || isWebShellHashRoute(window.location.hash)) {
    await import('./web-shell-main.js');
    return;
  }

  await import('./landing-main.js');
}

void bootstrapSiteEntry();
