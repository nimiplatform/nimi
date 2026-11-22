import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ZHIYU_APP_CONTENT_SECURITY_POLICY } from './app-origin-csp.js';

// @nimi-authority: definition.nimi.platform.app-ecosystem.managed-web-desktop-carrier
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043c
export const MANAGED_WEB_EXECUTION_PROFILE_REF = 'nimi-managed-web-v1';
export const MANAGED_WEB_TARGET_ID = 'desktop-universal';
export const MANAGED_WEB_RUNTIME_ENTRY = 'payload/index.html';
export const MANAGED_WEB_MAX_RELEASE_BYTES = 64 * 1024 * 1024;
export const MANAGED_WEB_MAX_RELEASE_ENTRIES = 10_000;
export const MANAGED_WEB_MAX_DIRECTORY_DEPTH = 64;
export const MANAGED_WEB_PAYLOAD_DIGEST_DOMAIN = 'nimi.app-installed-root.v1\0';
export const MANAGED_WEB_CONTENT_SECURITY_POLICY = ZHIYU_APP_CONTENT_SECURITY_POLICY;

const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;
const MAX_DEV_ICON_BYTES = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ManagedWebTitleBarStyle = 'native' | 'hidden';

export type ManagedWebWindowConfig = {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly titleBarStyle: ManagedWebTitleBarStyle;
};

export const DEFAULT_MANAGED_WEB_WINDOW_CONFIG: ManagedWebWindowConfig = Object.freeze({
  width: 1280,
  height: 840,
  minWidth: 480,
  minHeight: 420,
  titleBarStyle: 'native',
});

export type VerifiedManagedWebSnapshot = {
  readonly appId: string;
  readonly version: string;
  readonly displayName: string;
  readonly iconPngBytes?: Buffer;
  readonly windowConfig: ManagedWebWindowConfig;
  readonly payloadFiles: ReadonlyMap<string, Buffer>;
};

export type DevManagedWebMetadata = {
  readonly appId: string;
  readonly version: string;
  readonly displayName: string;
  readonly iconPngBytes?: Buffer;
  readonly windowConfig: ManagedWebWindowConfig;
};

export type OriginalFsLike = Pick<
  typeof nodeFs,
  'lstatSync' | 'readdirSync' | 'readFileSync' | 'realpathSync' | 'openSync' | 'fstatSync' | 'readSync' | 'closeSync' | 'constants'
>;

function resolveOriginalFs(override?: OriginalFsLike): OriginalFsLike {
  if (override) return override;
  if (typeof process.versions?.electron === 'string' && process.versions.electron.length > 0) {
    const req = createRequire(import.meta.url);
    return req('original-fs') as OriginalFsLike;
  }
  return nodeFs;
}

export function isCanonicalSha256DigestRef(value: unknown): value is string {
  return typeof value === 'string' && SHA256_REF_PATTERN.test(value);
}

/**
 * Computes the exact same `sha256:<64-lowercase-hex>` PayloadRootDigest as Go's
 * `nimiapppackage.digestMaterializedRoot` (package.go:939-991) for `os != "macos"`:
 * UTF-8 byte-sorted relative slash paths, uint64LE UTF-8 byte lengths, and raw file bytes.
 */
export function computeManagedWebPayloadRootDigest(entries: ReadonlyMap<string, Buffer>): string {
  const sorted = [...entries.entries()].map(([name, content]) => ({
    name,
    nameBuf: Buffer.from(name, 'utf8'),
    content,
  }));
  sorted.sort((left, right) => Buffer.compare(left.nameBuf, right.nameBuf));

  const hash = createHash('sha256');
  hash.update(Buffer.from(MANAGED_WEB_PAYLOAD_DIGEST_DOMAIN, 'utf8'));
  const lengthBuffer = Buffer.allocUnsafe(8);
  for (const item of sorted) {
    lengthBuffer.writeBigUInt64LE(BigInt(item.nameBuf.byteLength), 0);
    hash.update(lengthBuffer);
    hash.update(item.nameBuf);
    lengthBuffer.writeBigUInt64LE(BigInt(item.content.byteLength), 0);
    hash.update(lengthBuffer);
    hash.update(item.content);
  }
  return `sha256:${hash.digest('hex')}`;
}

export function parseDesktopWindowConfig(declaration: unknown): ManagedWebWindowConfig {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    throw new Error('managed-web-declaration-invalid');
  }
  const root = declaration as Record<string, unknown>;
  if (root.desktop === undefined) {
    return DEFAULT_MANAGED_WEB_WINDOW_CONFIG;
  }
  if (!root.desktop || typeof root.desktop !== 'object' || Array.isArray(root.desktop)) {
    throw new Error('managed-web-desktop-window-invalid');
  }
  const desktop = root.desktop as Record<string, unknown>;
  for (const key of Object.keys(desktop)) {
    if (key !== 'window') {
      throw new Error(`managed-web-desktop-key-unsupported:${key}`);
    }
  }
  if (desktop.window === undefined) {
    return DEFAULT_MANAGED_WEB_WINDOW_CONFIG;
  }
  if (!desktop.window || typeof desktop.window !== 'object' || Array.isArray(desktop.window)) {
    throw new Error('managed-web-desktop-window-invalid');
  }
  const win = desktop.window as Record<string, unknown>;
  let width = DEFAULT_MANAGED_WEB_WINDOW_CONFIG.width;
  let height = DEFAULT_MANAGED_WEB_WINDOW_CONFIG.height;
  let minWidth = DEFAULT_MANAGED_WEB_WINDOW_CONFIG.minWidth;
  let minHeight = DEFAULT_MANAGED_WEB_WINDOW_CONFIG.minHeight;
  let titleBarStyle: ManagedWebTitleBarStyle = DEFAULT_MANAGED_WEB_WINDOW_CONFIG.titleBarStyle;

  for (const [key, value] of Object.entries(win)) {
    switch (key) {
      case 'width':
        width = parseBoundedInt(value, 400, 2560, 'desktop.window.width');
        break;
      case 'height':
        height = parseBoundedInt(value, 360, 1600, 'desktop.window.height');
        break;
      case 'min_width':
        minWidth = parseBoundedInt(value, 320, 1280, 'desktop.window.min_width');
        break;
      case 'min_height':
        minHeight = parseBoundedInt(value, 320, 960, 'desktop.window.min_height');
        break;
      case 'title_bar_style':
        if (value !== 'native' && value !== 'hidden') {
          throw new Error('managed-web-window-title-bar-style-invalid');
        }
        titleBarStyle = value;
        break;
      default:
        throw new Error(`managed-web-window-key-unsupported:${key}`);
    }
  }
  if (minWidth > width || minHeight > height) {
    throw new Error('managed-web-window-bounds-invalid');
  }
  return Object.freeze({ width, height, minWidth, minHeight, titleBarStyle });
}

function parseBoundedInt(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`managed-web-window-bound-invalid:${label}`);
  }
  return value;
}

/**
 * Loads `<releaseRoot>` once through Electron `original-fs` (rejecting every
 * symlink and enforcing <= 64 MiB and <= 10,000 entries), verifies the exact
 * UTF-8 PayloadRootDigest against Runtime's `--nimi-payload-digest`, parses all
 * control metadata from the verified memory buffers, drops control buffers, and
 * returns an immutable `payload/*` snapshot for zero-TOCTOU protocol serving.
 */
export function loadVerifiedManagedWebSnapshot(
  releaseRoot: string,
  expectedDigest: string,
  fsOverride?: OriginalFsLike,
): VerifiedManagedWebSnapshot {
  if (!isCanonicalSha256DigestRef(expectedDigest)) {
    throw new Error('managed-web-digest-arg-invalid');
  }
  if (typeof releaseRoot !== 'string' || !releaseRoot || !path.isAbsolute(releaseRoot)) {
    throw new Error('managed-web-release-root-invalid');
  }
  const fs = resolveOriginalFs(fsOverride);
  const rootStat = fs.lstatSync(releaseRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('managed-web-release-root-not-directory');
  }
  const canonicalRoot = fs.realpathSync(releaseRoot);
  const allFiles = new Map<string, Buffer>();
  let totalBytes = 0;
  let dirCount = 0;
  const openFlags = fs.constants.O_RDONLY | (typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0);

  const readRegularFileBounded = (fullPath: string, expectedSize: number, maxAllowed: number): Buffer => {
    const fd = fs.openSync(fullPath, openFlags);
    try {
      const fdStat = fs.fstatSync(fd);
      if (!fdStat.isFile()) {
        throw new Error('managed-web-non-regular-entry-rejected');
      }
      if (!Number.isSafeInteger(fdStat.size) || fdStat.size < 0 || fdStat.size !== expectedSize) {
        throw new Error('managed-web-file-size-changed-during-read');
      }
      if (fdStat.size > maxAllowed) {
        throw new Error('managed-web-size-limit-exceeded');
      }
      const chunks: Buffer[] = [];
      let readTotal = 0;
      const chunkSize = Math.min(Math.max(fdStat.size, 1), 64 * 1024);
      const scratch = Buffer.allocUnsafe(chunkSize);
      while (true) {
        const remaining = maxAllowed - readTotal;
        const toRead = Math.min(scratch.byteLength, remaining + 1);
        const bytesRead = fs.readSync(fd, scratch, 0, toRead, null);
        if (bytesRead === 0) break;
        readTotal += bytesRead;
        if (readTotal > maxAllowed) {
          throw new Error('managed-web-size-limit-exceeded');
        }
        chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
      }
      if (readTotal !== expectedSize) {
        throw new Error('managed-web-file-size-changed-during-read');
      }
      return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, readTotal);
    } finally {
      fs.closeSync(fd);
    }
  };

  const visit = (currentDir: string, relativePrefix: string, depth: number): void => {
    if (depth > MANAGED_WEB_MAX_DIRECTORY_DEPTH) {
      throw new Error('managed-web-directory-depth-exceeded');
    }
    const dirents = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const dirent of dirents) {
      const name = dirent.name;
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
        throw new Error('managed-web-entry-name-invalid');
      }
      const fullPath = path.join(currentDir, name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        throw new Error('managed-web-symlink-rejected');
      }
      const relative = relativePrefix ? `${relativePrefix}/${name}` : name;
      if (stat.isDirectory()) {
        dirCount += 1;
        if (dirCount > MANAGED_WEB_MAX_RELEASE_ENTRIES) {
          throw new Error('managed-web-entry-limit-exceeded');
        }
        visit(fullPath, relative, depth + 1);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error('managed-web-non-regular-entry-rejected');
      }
      if (allFiles.size + 1 > MANAGED_WEB_MAX_RELEASE_ENTRIES) {
        throw new Error('managed-web-entry-limit-exceeded');
      }
      const remainingBudget = MANAGED_WEB_MAX_RELEASE_BYTES - totalBytes;
      if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > remainingBudget) {
        throw new Error('managed-web-size-limit-exceeded');
      }
      const content = readRegularFileBounded(fullPath, stat.size, remainingBudget);
      totalBytes += content.byteLength;
      if (totalBytes > MANAGED_WEB_MAX_RELEASE_BYTES) {
        throw new Error('managed-web-size-limit-exceeded');
      }
      allFiles.set(relative, content);
    }
  };

  visit(canonicalRoot, '', 0);

  const observedDigest = computeManagedWebPayloadRootDigest(allFiles);
  if (observedDigest !== expectedDigest) {
    throw new Error('managed-web-payload-digest-mismatch');
  }

  const manifestRaw = allFiles.get('manifest.json');
  const appInfoRaw = allFiles.get('app-info.json');
  const declarationRaw = allFiles.get('nimi.app.yaml');
  if (!manifestRaw || !appInfoRaw || !declarationRaw || !allFiles.has(MANAGED_WEB_RUNTIME_ENTRY)) {
    throw new Error('managed-web-required-entries-missing');
  }

  const manifest = parseJsonRecord(manifestRaw, 'manifest.json');
  const appId = requireExactString(manifest.app_id, 'manifest.app_id');
  const version = requireExactString(manifest.version, 'manifest.version');
  if (!APP_ID_PATTERN.test(appId)) {
    throw new Error('managed-web-app-id-invalid');
  }
  const nativeTrust = requireRecord(manifest.native_trust, 'manifest.native_trust');
  const executionProfile = requireRecord(manifest.execution_profile, 'manifest.execution_profile');
  if (
    manifest.format !== 'nimi.app-package/v2'
    || manifest.target_id !== MANAGED_WEB_TARGET_ID
    || manifest.os !== 'any'
    || manifest.arch !== 'any'
    || manifest.runtime_entry !== MANAGED_WEB_RUNTIME_ENTRY
    || nativeTrust.posture !== 'nimi-managed-carrier'
    || nativeTrust.certificate_subject !== null
    || executionProfile.launch_mode !== MANAGED_WEB_EXECUTION_PROFILE_REF
  ) {
    throw new Error('managed-web-manifest-contract-invalid');
  }

  const appInfo = parseJsonRecord(appInfoRaw, 'app-info.json');
  const storagePolicy = requireRecord(appInfo.storage_policy, 'app-info.storage_policy');
  if (
    appInfo.format !== 'nimi.app-info/v1'
    || appInfo.app_id !== appId
    || appInfo.version !== version
    || appInfo.target_id !== MANAGED_WEB_TARGET_ID
    || storagePolicy.kind !== 'nimi-mediated-default'
  ) {
    throw new Error('managed-web-app-info-contract-invalid');
  }
  const displayName = requireExactString(appInfo.display_name, 'app-info.display_name');
  const iconPngBytes = decodeOptionalPngIcon(appInfo.icon);

  const declarationText = new TextDecoder('utf-8', { fatal: true }).decode(declarationRaw);
  const declaration = parseYaml(declarationText) as Record<string, unknown>;
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration) || declaration.app_id !== appId) {
    throw new Error('managed-web-declaration-contract-invalid');
  }
  const windowConfig = parseDesktopWindowConfig(declaration);

  const payloadFiles = new Map<string, Buffer>();
  for (const [key, value] of allFiles.entries()) {
    if (key.startsWith('payload/')) {
      payloadFiles.set(key.slice('payload/'.length), value);
    }
  }
  allFiles.clear();

  if (!payloadFiles.has('index.html')) {
    throw new Error('managed-web-payload-index-missing');
  }

  return Object.freeze({
    appId,
    version,
    displayName,
    ...(iconPngBytes ? { iconPngBytes } : {}),
    windowConfig,
    payloadFiles,
  });
}

export function loadDevManagedWebProjectMetadata(
  workingDirectory: string,
  fsOverride?: OriginalFsLike,
): DevManagedWebMetadata {
  const fs = resolveOriginalFs(fsOverride);
  const canonicalRoot = fs.realpathSync(workingDirectory);
  const manifestPath = path.join(canonicalRoot, 'nimi.app.yaml');
  const raw = fs.readFileSync(manifestPath);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const declaration = parseYaml(text) as Record<string, unknown>;
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    throw new Error('managed-web-dev-manifest-invalid');
  }
  const appId = requireExactString(declaration.app_id ?? declaration.appId, 'app_id');
  const displayName = requireExactString(declaration.display_name ?? declaration.displayName, 'display_name');
  if (!APP_ID_PATTERN.test(appId)) {
    throw new Error('managed-web-dev-app-id-invalid');
  }
  let version = '0.0.0-dev';
  try {
    const pkgRaw = fs.readFileSync(path.join(canonicalRoot, 'package.json'));
    const pkg = JSON.parse(pkgRaw.toString('utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      version = pkg.version.trim();
    }
  } catch {
    // Keep dev fallback version if package.json is absent.
  }
  const windowConfig = parseDesktopWindowConfig(declaration);
  let iconPngBytes: Buffer | undefined;
  const metadata = declaration.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const iconRel = (metadata as Record<string, unknown>).icon;
    if (typeof iconRel === 'string' && iconRel && !path.isAbsolute(iconRel) && !iconRel.includes('\\')
      && !iconRel.split('/').some((seg) => !seg || seg === '.' || seg === '..')) {
      try {
        const iconPath = path.join(canonicalRoot, iconRel);
        const stat = fs.lstatSync(iconPath);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_DEV_ICON_BYTES) {
          const bytes = fs.readFileSync(iconPath);
          if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
            iconPngBytes = bytes;
          }
        }
      } catch {
        // Optional dev icon.
      }
    }
  }
  return Object.freeze({
    appId,
    version,
    displayName,
    ...(iconPngBytes ? { iconPngBytes } : {}),
    windowConfig,
  });
}

// Reused verbatim from kit/shell/electron/src/main/app-asset-protocol.ts:302
export function parseHttpRange(
  value: string | null,
  total: number,
): { readonly offset: number; readonly length: number } | undefined | null {
  if (value === null) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2]) || value.includes(',')) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    if (total <= 0) return null;
    const length = Math.min(suffix, total);
    return { offset: total - length, length };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) {
    return null;
  }
  return { offset: start, length: Math.min(end, total - 1) - start + 1 };
}

export function managedWebContentType(relativePath: string): string {
  switch (path.extname(relativePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    case '.wasm':
      return 'application/wasm';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

export function createManagedWebProtocolHandler(
  snapshot: Pick<VerifiedManagedWebSnapshot, 'appId' | 'payloadFiles'>,
): (request: Request) => Response {
  const expectedHost = snapshot.appId.toLowerCase();
  return (request: Request): Response => {
    const method = (request.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('method not allowed', {
        status: 405,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      return new Response('invalid app url', {
        status: 400,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    if (parsed.protocol !== 'nimi-app:' || parsed.hostname.toLowerCase() !== expectedHost) {
      return new Response('unknown app host', {
        status: 404,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    let decodedPathname: string;
    try {
      decodedPathname = decodeURIComponent(parsed.pathname);
    } catch {
      return new Response('invalid app path', {
        status: 400,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    if (decodedPathname.includes('\0') || decodedPathname.includes('\\')) {
      return new Response('path not admitted', {
        status: 403,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    const relative = decodedPathname === '/' ? 'index.html' : decodedPathname.replace(/^\/+/u, '');
    const segments = relative.split('/');
    if (!relative || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      return new Response('path not admitted', {
        status: 403,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    const payload = snapshot.payloadFiles.get(relative);
    if (!payload) {
      return new Response('app asset not found', {
        status: 404,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    const contentType = managedWebContentType(relative);
    const total = payload.byteLength;
    const rangeHeader = request.headers.get('range');
    const parsedRange = parseHttpRange(rangeHeader, total);
    if (parsedRange === null) {
      return new Response(null, {
        status: 416,
        headers: {
          'content-range': `bytes */${total}`,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    const baseHeaders: Record<string, string> = {
      'content-type': contentType,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(contentType.startsWith('text/html') ? { 'content-security-policy': MANAGED_WEB_CONTENT_SECURITY_POLICY } : {}),
    };
    if (parsedRange) {
      const slice = payload.subarray(parsedRange.offset, parsedRange.offset + parsedRange.length);
      const end = parsedRange.offset + parsedRange.length - 1;
      const body = method === 'HEAD'
        ? null
        : new Uint8Array(slice.buffer as ArrayBuffer, slice.byteOffset, slice.byteLength);
      return new Response(body, {
        status: 206,
        headers: {
          ...baseHeaders,
          'content-range': `bytes ${parsedRange.offset}-${end}/${total}`,
          'content-length': String(slice.byteLength),
        },
      });
    }
    const body = method === 'HEAD'
      ? null
      : new Uint8Array(payload.buffer as ArrayBuffer, payload.byteOffset, payload.byteLength);
    return new Response(body, {
      status: 200,
      headers: {
        ...baseHeaders,
        'content-length': String(total),
      },
    });
  };
}

/**
 * Restricts top-level navigation in installed Mode C strictly to the verified
 * `nimi-app://<app-id>/index.html` document (allowing only query/hash updates),
 * preventing same-origin SVG or other non-HTML resources from opening as
 * CSP-free top-level documents.
 */
export function isAllowedManagedWebNavigationUrl(candidateUrl: string, expectedEntryUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const expected = new URL(expectedEntryUrl);
    return candidate.protocol === expected.protocol
      && candidate.host.toLowerCase() === expected.host.toLowerCase()
      && candidate.pathname === expected.pathname;
  } catch {
    return false;
  }
}

export type ManagedWebCarrierLaunch =
  | {
    readonly mode: 'installed';
    readonly workingDirectory: string;
    readonly payloadDigest: string;
  }
  | {
    readonly mode: 'dev';
    readonly workingDirectory: string;
    readonly rendererOrigin: string;
    readonly cdpPort?: number;
  };

const FORBIDDEN_CHROMIUM_FLAGS = [
  '--disable-sandbox',
  '--disable-setuid-sandbox',
  '--disable-site-isolation-trials',
  '--disable-web-security',
  '--inspect',
  '--js-flags',
  '--no-sandbox',
  '--remote-allow-origins',
];

export function parseManagedWebCarrierArguments(input: {
  readonly argv: readonly string[];
  readonly workingDirectory: string;
  readonly allowLeadingScriptArgument?: boolean;
}): ManagedWebCarrierLaunch {
  const rawArgs = input.argv.slice(1);
  if (rawArgs.length === 0 || !path.isAbsolute(input.workingDirectory)) {
    throw new Error('managed-web-launch-arguments-invalid');
  }
  const args = [...rawArgs];
  if (args.some((arg) => FORBIDDEN_CHROMIUM_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))) {
    throw new Error('managed-web-launch-forbidden-flag');
  }

  const hasInstalledFlag = args.includes('--nimi-managed-web-app');
  const hasDevFlag = args.includes('--nimi-managed-web-dev');
  if (hasInstalledFlag === hasDevFlag) {
    throw new Error('managed-web-launch-mode-ambiguous');
  }

  if (hasInstalledFlag) {
    if (input.allowLeadingScriptArgument && args.length > 0 && !args[0]!.startsWith('-')) {
      const scriptName = path.basename(args[0]!);
      if (scriptName !== 'managed-web-carrier.js' && scriptName !== 'main.mjs') {
        throw new Error('managed-web-launch-script-invalid');
      }
      args.shift();
    }
    if (args.length !== 2 || args[0] !== '--nimi-managed-web-app' || !args[1]!.startsWith('--nimi-payload-digest=')) {
      throw new Error('managed-web-installed-arguments-invalid');
    }
    const payloadDigest = args[1]!.slice('--nimi-payload-digest='.length);
    if (!isCanonicalSha256DigestRef(payloadDigest)) {
      throw new Error('managed-web-installed-digest-invalid');
    }
    return Object.freeze({
      mode: 'installed',
      workingDirectory: input.workingDirectory,
      payloadDigest,
    });
  }

  let sawDev = false;
  let sawScript = false;
  let rendererOrigin: string | undefined;
  let userDataDir: string | undefined;
  let debugAddress: string | undefined;
  let cdpPort: number | undefined;
  for (const arg of args) {
    if (arg === '--nimi-managed-web-dev') {
      if (sawDev) throw new Error('managed-web-dev-arguments-duplicate');
      sawDev = true;
      continue;
    }
    if (arg.startsWith('--user-data-dir=')) {
      if (userDataDir !== undefined) throw new Error('managed-web-dev-arguments-duplicate');
      userDataDir = arg.slice('--user-data-dir='.length);
      if (!userDataDir || !path.isAbsolute(userDataDir)) throw new Error('managed-web-dev-user-data-invalid');
      continue;
    }
    if (arg.startsWith('--nimi-dev-renderer-url=')) {
      if (rendererOrigin !== undefined) throw new Error('managed-web-dev-arguments-duplicate');
      rendererOrigin = exactLoopbackOrigin(arg.slice('--nimi-dev-renderer-url='.length));
      continue;
    }
    if (arg === '--remote-debugging-address=127.0.0.1') {
      if (debugAddress !== undefined) throw new Error('managed-web-dev-arguments-duplicate');
      debugAddress = '127.0.0.1';
      continue;
    }
    if (arg.startsWith('--remote-debugging-port=')) {
      if (cdpPort !== undefined) throw new Error('managed-web-dev-arguments-duplicate');
      const rawPort = arg.slice('--remote-debugging-port='.length);
      if (!/^(?:0|[1-9][0-9]*)$/u.test(rawPort)) throw new Error('managed-web-dev-cdp-port-invalid');
      const parsed = Number(rawPort);
      if (!Number.isSafeInteger(parsed) || (parsed !== 0 && (parsed < 1024 || parsed > 65535))) {
        throw new Error('managed-web-dev-cdp-port-invalid');
      }
      cdpPort = parsed;
      continue;
    }
    if (input.allowLeadingScriptArgument && !sawScript && !arg.startsWith('-')) {
      const scriptName = path.basename(arg);
      if (scriptName === 'managed-web-carrier.js' || scriptName === 'main.mjs') {
        sawScript = true;
        continue;
      }
    }
    throw new Error('managed-web-dev-argument-unknown');
  }
  if (!sawDev || !rendererOrigin || !userDataDir || (debugAddress !== undefined) !== (cdpPort !== undefined)) {
    throw new Error('managed-web-dev-arguments-incomplete');
  }
  return Object.freeze({
    mode: 'dev',
    workingDirectory: input.workingDirectory,
    rendererOrigin,
    ...(cdpPort === undefined ? {} : { cdpPort }),
  });
}

function exactLoopbackOrigin(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.origin !== value
  ) {
    throw new Error('managed-web-dev-renderer-origin-invalid');
  }
  return parsed.origin;
}

function parseJsonRecord(buffer: Buffer, label: string): Record<string, unknown> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  const parsed = JSON.parse(text) as unknown;
  return requireRecord(parsed, label);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`managed-web-object-required:${label}`);
  }
  return value as Record<string, unknown>;
}

function requireExactString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.includes('\0')) {
    throw new Error(`managed-web-string-required:${label}`);
  }
  return value;
}

function decodeOptionalPngIcon(icon: unknown): Buffer | undefined {
  if (!icon || typeof icon !== 'object' || Array.isArray(icon)) return undefined;
  const record = icon as Record<string, unknown>;
  if (record.media_type !== 'image/png' || typeof record.data_base64 !== 'string' || !record.data_base64) {
    return undefined;
  }
  const bytes = Buffer.from(record.data_base64, 'base64');
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return undefined;
  }
  return bytes;
}
