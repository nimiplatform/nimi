/**
 * Shell-owned route model and deep-link serialization. Apps never install
 * browser-history owners; the Shell serializes routes and instance deep
 * links through one closed grammar.
 *
 * Authority: P-SIM-017; simulator-protocol.md §7.1 and §13 (Shell owns
 * route/deep-link serialization).
 */

export type SimulatorShellRoute =
  | { readonly kind: 'home' }
  | { readonly kind: 'diagnostics' }
  | { readonly kind: 'instance'; readonly instanceId: string; readonly appPath: string };

export type SimulatorShellHistoryPort = {
  currentPath(): string;
  push(path: string): void;
  replace(path: string): void;
};

const INSTANCE_PREFIX = '/instance/';

export function serializeShellRoute(route: SimulatorShellRoute): string {
  switch (route.kind) {
    case 'home':
      return '/';
    case 'diagnostics':
      return '/diagnostics';
    case 'instance': {
      const appPath = route.appPath.startsWith('/') ? route.appPath : `/${route.appPath}`;
      return `${INSTANCE_PREFIX}${encodeURIComponent(route.instanceId)}${appPath === '/' ? '' : appPath}`;
    }
  }
}

export function parseShellRoute(pathname: string): SimulatorShellRoute | null {
  if (typeof pathname !== 'string' || pathname.length === 0) return null;
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (path === '/') return { kind: 'home' };
  if (path === '/diagnostics') return { kind: 'diagnostics' };
  if (path.startsWith(INSTANCE_PREFIX)) {
    const rest = path.slice(INSTANCE_PREFIX.length);
    const slash = rest.indexOf('/');
    const rawId = slash === -1 ? rest : rest.slice(0, slash);
    const appPath = slash === -1 ? '/' : rest.slice(slash);
    let instanceId: string;
    try {
      instanceId = decodeURIComponent(rawId);
    } catch {
      return null;
    }
    if (!/^[0-9]+:instance:[0-9]+$/.test(instanceId)) return null;
    return { kind: 'instance', instanceId, appPath };
  }
  return null;
}

/** Deterministic deep-link for one instance surface. */
export function instanceDeepLink(instanceId: string, appPath = '/'): string {
  return serializeShellRoute({ kind: 'instance', instanceId, appPath });
}
