import {
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import {
  Router,
  type Navigator,
  type To,
} from 'react-router-dom';

import type { DesktopRendererRoutePort } from './contract.js';

function toRouteString(to: To): string {
  if (typeof to === 'string') {
    return to;
  }
  return `${to.pathname || ''}${to.search || ''}${to.hash || ''}` || '/';
}

export function createDesktopRouteProvider(route: DesktopRendererRoutePort) {
  return function DesktopRouteProvider({ children }: PropsWithChildren) {
    const location = useSyncExternalStore(route.subscribe, route.get, route.get);
    const navigator = useMemo<Navigator>(() => ({
      createHref: toRouteString,
      encodeLocation(to) {
        return typeof to === 'string'
          ? { pathname: to, search: '', hash: '' }
          : {
              pathname: to.pathname || '',
              search: to.search || '',
              hash: to.hash || '',
            };
      },
      go: route.go,
      push(to, state) {
        route.navigate({ to: toRouteString(to), replace: false, state });
      },
      replace(to, state) {
        route.navigate({ to: toRouteString(to), replace: true, state });
      },
    }), [route]);
    return (
      <Router location={location} navigator={navigator}>
        {children}
      </Router>
    );
  };
}
