import type {
  DesktopRendererRoutePort,
  DesktopRendererRouteView,
} from './contract.js';

export function createDesktopBrowserRoutePort(): DesktopRendererRoutePort {
  function read(): DesktopRendererRouteView {
    const fragment = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const route = fragment.startsWith('/')
      ? new URL(fragment, window.location.origin)
      : new URL(window.location.href);
    return Object.freeze({
      pathname: route.pathname || '/',
      search: route.search,
      hash: route.hash,
      state: window.history.state,
      key: String(window.history.state?.key || 'production'),
    });
  }
  let snapshot = read();
  return Object.freeze({
    get: () => snapshot,
    subscribe(listener: () => void) {
      const onRoute = () => {
        snapshot = read();
        listener();
      };
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('popstate', onRoute);
      return () => {
        window.removeEventListener('hashchange', onRoute);
        window.removeEventListener('popstate', onRoute);
      };
    },
    navigate({ to, replace, state }: Parameters<DesktopRendererRoutePort['navigate']>[0]) {
      const href = `#${to.startsWith('/') ? to : `/${to}`}`;
      if (replace) {
        window.history.replaceState(state ?? null, '', href);
      } else {
        window.history.pushState(state ?? null, '', href);
      }
      snapshot = read();
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    go: (delta: number) => window.history.go(delta),
  });
}
