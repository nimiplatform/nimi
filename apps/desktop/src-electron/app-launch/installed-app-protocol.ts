import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES,
  createDesktopInstalledAppLaunchError,
} from '../../src/shell/shared/installed-app-launch-contract.js';

export const DESKTOP_INSTALLED_APP_PROTOCOL_SCHEME = 'nimi-installed-app';

export type DesktopInstalledAppProtocolBinding = {
  readonly scheme: typeof DESKTOP_INSTALLED_APP_PROTOCOL_SCHEME;
  readonly origin: string;
  readonly entryUrl: string;
  readonly entryFilePath: string;
  readonly releaseRoot: string;
  readonly allowedOrigins: readonly string[];
};

export type DesktopInstalledAppProtocolBindingInput = {
  readonly appId: string;
  readonly releaseDescriptorRef: string;
  readonly activeReleaseRoot: string;
  readonly runtimeEntryRef: string;
};

export type DesktopInstalledAppElectronProtocol = {
  readonly handle: (
    scheme: string,
    handler: (request: { readonly url: string }) => Promise<Response> | Response,
  ) => void;
};

export function createDesktopInstalledAppProtocolBinding(
  input: DesktopInstalledAppProtocolBindingInput,
): DesktopInstalledAppProtocolBinding {
  const appId = requireProtocolText(input.appId, 'appId');
  requireProtocolText(input.releaseDescriptorRef, 'releaseDescriptorRef');
  const releaseRoot = path.resolve(requireProtocolText(input.activeReleaseRoot, 'activeReleaseRoot'));
  const runtimeEntryRef = normalizeRuntimeEntryRef(input.runtimeEntryRef);
  const entryFilePath = resolveInsideReleaseRoot(releaseRoot, runtimeEntryRef, 'runtimeEntryRef');
  const origin = `${DESKTOP_INSTALLED_APP_PROTOCOL_SCHEME}://${appId}`;
  return {
    scheme: DESKTOP_INSTALLED_APP_PROTOCOL_SCHEME,
    origin,
    entryUrl: `${origin}/${runtimeEntryRef.split('/').map(encodeURIComponent).join('/')}`,
    entryFilePath,
    releaseRoot,
    allowedOrigins: [origin],
  };
}

export function createDesktopInstalledAppProtocolRegistrar(input: {
  readonly protocol: DesktopInstalledAppElectronProtocol;
  readonly readFile?: (filePath: string) => Promise<Buffer>;
}): (bindingInput: DesktopInstalledAppProtocolBindingInput) => DesktopInstalledAppProtocolBinding {
  const protocol = input.protocol;
  const read = input.readFile ?? readFile;
  const bindings = new Map<string, DesktopInstalledAppProtocolBinding>();
  let registered = false;
  return (bindingInput) => {
    const binding = createDesktopInstalledAppProtocolBinding(bindingInput);
    bindings.set(binding.origin, binding);
    if (!registered) {
      registered = true;
      protocol.handle(DESKTOP_INSTALLED_APP_PROTOCOL_SCHEME, async (request) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        const appBinding = bindings.get(origin);
        if (!appBinding) {
          return new Response('installed app origin is not registered', { status: 403 });
        }
        const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/u, '')) || 'index.html';
        const filePath = resolveInsideReleaseRoot(appBinding.releaseRoot, relativePath, 'request.url');
        return new Response(new Uint8Array(await read(filePath)), {
          headers: {
            'content-type': contentTypeForPath(filePath),
            'cache-control': 'no-store',
            'access-control-allow-origin': appBinding.origin,
          },
        });
      });
    }
    return binding;
  };
}

function normalizeRuntimeEntryRef(value: unknown): string {
  const normalized = requireProtocolText(value, 'runtimeEntryRef').replace(/\\/g, '/').replace(/^\/+/u, '');
  if (normalized.includes('\0') || normalized.split('/').some((part) => part === '..' || part === '')) {
    throw createDesktopInstalledAppLaunchError({
      message: 'Desktop installed app runtimeEntryRef must be a relative file path inside the active release root',
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
      details: { field: 'runtimeEntryRef' },
    });
  }
  return normalized;
}

function resolveInsideReleaseRoot(releaseRoot: string, relativePath: string, field: string): string {
  const resolved = path.resolve(releaseRoot, relativePath);
  const relative = path.relative(releaseRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw createDesktopInstalledAppLaunchError({
      message: `Desktop installed app ${field} escapes the Runtime-attested release root`,
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
      details: { field },
    });
  }
  return resolved;
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function requireProtocolText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw createDesktopInstalledAppLaunchError({
      message: `Desktop installed app protocol binding requires ${field}`,
      reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
      details: { field },
    });
  }
  return normalized;
}
