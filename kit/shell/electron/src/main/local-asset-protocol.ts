import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { isSameOrChildPath, normalizeRequiredToken, normalizeText } from './paths.js';
import type {
  NimiElectronShellFileProtocolPrivileges,
  NimiElectronShellFileProtocolApi,
  NimiElectronShellFileProtocolHost,
} from './types.js';

export const NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME = 'nimi-shell-file';
export const NIMI_ELECTRON_SHELL_FILE_PROTOCOL_PRIVILEGES: NimiElectronShellFileProtocolPrivileges = {
  standard: true,
  secure: true,
  corsEnabled: true,
  supportFetchAPI: true,
  stream: true,
};
export const NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION = {
  scheme: NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME,
  privileges: NIMI_ELECTRON_SHELL_FILE_PROTOCOL_PRIVILEGES,
} as const;

export type CreateElectronShellFileProtocolHostOptions = {
  readonly protocol: NimiElectronShellFileProtocolApi;
  readonly roots?: readonly string[];
  readonly readFile?: (filePath: string) => Promise<Uint8Array>;
};

/**
 * Shared `nimi-shell-file://local/?path=<base64url(absPath)>` protocol host
 * for Electron standard shells. Serves only files that are inside an admitted
 * root or explicitly registered as readable; everything else fails closed with
 * a 4xx response.
 */
export function createElectronShellFileProtocolHost(
  options: CreateElectronShellFileProtocolHostOptions,
): NimiElectronShellFileProtocolHost {
  const roots = (options.roots ?? []).map((root) => normalizeText(root)).filter(Boolean);
  const readFileBytes = options.readFile ?? (async (filePath: string) => readFile(filePath));
  const readableFiles = new Set<string>();

  const canonicalRoots = async (): Promise<readonly string[]> =>
    Promise.all(roots.map((root) => canonicalCandidatePath(path.resolve(root))));

  const isAllowedCanonicalPath = async (canonical: string): Promise<boolean> => {
    if (readableFiles.has(canonical)) {
      return true;
    }
    return (await canonicalRoots()).some((root) => isSameOrChildPath(root, canonical));
  };

  return {
    protocolScheme: NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME,
    registerPrivilegedSchemes: () => {
      options.protocol.registerSchemesAsPrivileged([NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION]);
    },
    registerProtocolHandler: () => {
      options.protocol.handle(NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME, async (request) => {
        try {
          const filePath = decodeElectronShellFileUrl(request.url);
          const canonical = await realpath(filePath);
          if (!await isAllowedCanonicalPath(canonical)) {
            return new Response('file is not admitted for the Electron shell file protocol', {
              status: 403,
              headers: { 'access-control-allow-origin': '*' },
            });
          }
          return new Response(toArrayBufferView(await readFileBytes(canonical)), {
            headers: {
              'content-type': electronShellFileContentType(canonical),
              'cache-control': 'no-store',
              'access-control-allow-origin': '*',
            },
          });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error || 'file read failed'), {
            status: 404,
            headers: { 'access-control-allow-origin': '*' },
          });
        }
      });
    },
    registerReadableFile: async (absolutePath) => {
      const canonical = await canonicalCandidatePath(normalizeRequiredToken(absolutePath, 'absolutePath'));
      readableFiles.add(canonical);
      return canonical;
    },
    unregisterReadableFile: async (absolutePath) => {
      const canonical = await canonicalCandidatePath(normalizeRequiredToken(absolutePath, 'absolutePath'));
      readableFiles.delete(canonical);
    },
    resolveLocalAssetUrl: (absolutePath) =>
      `${NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME}://local/?path=${encodeElectronShellFilePath(path.resolve(normalizeRequiredToken(absolutePath, 'absolutePath')))}`,
    hasReadableFile: async (absolutePath) => {
      const normalized = normalizeText(absolutePath);
      if (!normalized) {
        return false;
      }
      return readableFiles.has(await canonicalCandidatePath(normalized));
    },
  };
}

export function decodeElectronShellFileUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== `${NIMI_ELECTRON_SHELL_FILE_PROTOCOL_SCHEME}:`) {
    throw new Error(`unsupported Electron shell file protocol: ${url.protocol}`);
  }
  const encodedPath = normalizeText(url.searchParams.get('path'));
  if (!encodedPath) {
    throw new Error('Electron shell file protocol path token is required');
  }
  return decodeElectronShellFilePath(encodedPath);
}

async function canonicalCandidatePath(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  return realpath(resolved).catch(() => resolved);
}

function encodeElectronShellFilePath(filePath: string): string {
  return Buffer.from(filePath, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeElectronShellFilePath(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Electron shell file protocol path token is invalid');
  }
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  return Buffer.from(padded.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
}

function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>;
}

function electronShellFileContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.json') return 'application/json';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}
