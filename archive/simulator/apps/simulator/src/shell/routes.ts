/** Shell-owned route model and complete deep-link serialization. */

import { isSimulatorRouteState } from '../state-engine/route-state.ts';
import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorRouteState } from '../state-engine/types.ts';

export type SimulatorShellRoute =
  | { readonly kind: 'home' }
  | { readonly kind: 'diagnostics' }
  | { readonly kind: 'instance'; readonly instanceId: string; readonly appRoute: SimulatorRouteState };

export type SimulatorShellLocation = {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
};

export type SimulatorShellHistoryPort = {
  currentPath(): string;
  push(path: string): void;
  replace(path: string): void;
};

const INSTANCE_PREFIX = '/instance/';
const ROOT_APP_ROUTE: SimulatorRouteState = Object.freeze({ pathname: '/', search: [], fragment: null });

export function sameSimulatorRouteState(left: SimulatorRouteState, right: SimulatorRouteState): boolean {
  return left.pathname === right.pathname
    && left.fragment === right.fragment
    && left.search.length === right.search.length
    && left.search.every((entry, index) => (
      entry.key === right.search[index]?.key && entry.value === right.search[index]?.value
    ));
}

function serializeAppRoute(route: SimulatorRouteState): string {
  const params = new URLSearchParams();
  for (const entry of route.search) params.append(entry.key, entry.value);
  const query = params.toString();
  const fragment = route.fragment === null ? '' : `#${encodeURIComponent(route.fragment)}`;
  return `${route.pathname}${query ? `?${query}` : ''}${fragment}`;
}

export function serializeShellRoute(route: SimulatorShellRoute): string {
  switch (route.kind) {
    case 'home':
      return '/';
    case 'diagnostics':
      return '/diagnostics';
    case 'instance': {
      const appRoute = serializeAppRoute(route.appRoute);
      const suffix = appRoute.startsWith('/') ? appRoute.slice(1) : appRoute;
      return `${INSTANCE_PREFIX}${encodeURIComponent(route.instanceId)}${suffix ? `/${suffix}` : ''}`;
    }
  }
}

export function parseShellRoute(location: SimulatorShellLocation): SimulatorShellRoute | null {
  const { pathname, search, hash } = location;
  if (typeof pathname !== 'string' || typeof search !== 'string' || typeof hash !== 'string') return null;
  if (pathname === '/') return search || hash ? null : { kind: 'home' };
  if (pathname === '/diagnostics') return search || hash ? null : { kind: 'diagnostics' };
  if (!pathname.startsWith(INSTANCE_PREFIX)) return null;
  const rest = pathname.slice(INSTANCE_PREFIX.length);
  const slash = rest.indexOf('/');
  const rawId = slash === -1 ? rest : rest.slice(0, slash);
  let instanceId: string;
  let fragment: string | null = null;
  try {
    instanceId = decodeURIComponent(rawId);
    fragment = hash ? decodeURIComponent(hash.startsWith('#') ? hash.slice(1) : hash) : null;
  } catch {
    return null;
  }
  if (!/^[0-9]+:instance:[0-9]+$/u.test(instanceId)) return null;
  const appRoute = {
    pathname: slash === -1 ? '/' : rest.slice(slash),
    search: [...new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)]
      .map(([key, value]) => Object.freeze({ key, value })),
    fragment,
  } as unknown as JsonValue;
  if (!isSimulatorRouteState(appRoute)) return null;
  return Object.freeze({ kind: 'instance', instanceId, appRoute });
}

export function instanceDeepLink(instanceId: string, appRoute: SimulatorRouteState = ROOT_APP_ROUTE): string {
  return serializeShellRoute({ kind: 'instance', instanceId, appRoute });
}
