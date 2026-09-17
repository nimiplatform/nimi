import type { JsonValue } from './json-value.ts';
import type { SimulatorRouteState } from './types.ts';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isSimulatorRouteState(value: JsonValue): value is SimulatorRouteState & JsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const route = value as Readonly<Record<string, JsonValue>>;
  let decodedPathname: string;
  try {
    decodedPathname = typeof route.pathname === 'string' ? decodeURIComponent(route.pathname) : '';
  } catch {
    return false;
  }
  if (typeof route.pathname !== 'string'
    || !route.pathname.startsWith('/')
    || route.pathname.startsWith('//')
    || utf8Bytes(route.pathname) > 512
    || SCHEME.test(route.pathname)
    || route.pathname.includes('\\')
    || route.pathname.includes('?')
    || route.pathname.includes('#')
    || CONTROL_CHARACTER.test(route.pathname)
    || !decodedPathname.startsWith('/')
    || decodedPathname.startsWith('//')
    || decodedPathname.includes('\\')
    || CONTROL_CHARACTER.test(decodedPathname)
    || decodedPathname.split('/').some((segment) => segment === '..')) return false;
  if (!Array.isArray(route.search) || route.search.some((entry) => (
    !entry
    || typeof entry !== 'object'
    || Array.isArray(entry)
    || typeof (entry as Readonly<Record<string, JsonValue>>).key !== 'string'
    || typeof (entry as Readonly<Record<string, JsonValue>>).value !== 'string'
  ))) return false;
  return route.fragment === null || (typeof route.fragment === 'string' && !CONTROL_CHARACTER.test(route.fragment));
}
