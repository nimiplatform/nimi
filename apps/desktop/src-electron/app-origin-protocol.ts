import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import type { Protocol } from 'electron';

export const NIMI_DESKTOP_APP_PROTOCOL_SCHEME = 'nimi-app';
export const NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES = {
  standard: true,
  secure: true,
  corsEnabled: false,
  supportFetchAPI: true,
  stream: true,
} as const;

export function desktopRendererOrigin(rendererUrl: string): string {
  const parsed = new URL(rendererUrl);
  if (parsed.protocol === 'file:') return 'file://';
  return parsed.origin === 'null' && parsed.host
    ? `${parsed.protocol}//${parsed.host}`
    : parsed.origin;
}

type AppHost = 'desktop' | 'avatar';

export function createDesktopAppOriginProtocol(input: {
  readonly protocol: Pick<Protocol, 'handle'>;
  readonly roots: Readonly<Record<AppHost, string>>;
}) {
  const roots = Object.fromEntries(Object.entries(input.roots).map(([host, root]) => [host, path.resolve(root)])) as Record<AppHost, string>;
  const previews = new Map<string, Uint8Array>();
  let previewSequence = 0;

  const register = () => {
    input.protocol.handle(NIMI_DESKTOP_APP_PROTOCOL_SCHEME, async (request) => {
      try {
        const url = new URL(request.url);
        const host = url.hostname as AppHost;
        if (host !== 'desktop' && host !== 'avatar') return new Response('unknown app host', { status: 404 });
        const pathname = decodeURIComponent(url.pathname);
        if (host === 'desktop' && pathname.startsWith('/__nimi/avatar-preview/')) {
          const bytes = previews.get(pathname);
          return bytes
            ? new Response(Uint8Array.from(bytes), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } })
            : new Response('preview not found', { status: 404 });
        }
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const root = await realpath(roots[host]);
        const candidate = path.resolve(root, relative);
        const canonical = await realpath(candidate);
        const boundary = path.relative(root, canonical);
        if (boundary.startsWith('..') || path.isAbsolute(boundary)) return new Response('path not admitted', { status: 403 });
        return new Response(Uint8Array.from(await readFile(canonical)), {
          headers: { 'content-type': contentType(canonical), 'cache-control': 'no-store' },
        });
      } catch {
        return new Response('app asset not found', { status: 404 });
      }
    });
  };

  return {
    register,
    rendererUrl(host: AppHost): string {
      return `${NIMI_DESKTOP_APP_PROTOCOL_SCHEME}://${host}/index.html`;
    },
    publishAvatarPreview(bytes: Uint8Array): string {
      previewSequence += 1;
      const pathname = `/__nimi/avatar-preview/${previewSequence}.png`;
      previews.clear();
      previews.set(pathname, Uint8Array.from(bytes));
      return pathname;
    },
    clear() { previews.clear(); },
  };
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}
