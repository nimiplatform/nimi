import path from 'node:path';

export const WINDOWS_ELECTRON_LAYOUT_APP_NAME = 'Nimi';
export const WINDOWS_ELECTRON_LAYOUT_DIRECTORY = 'nimi-desktop-local-development-win32-x64';
export const WINDOWS_ELECTRON_LAYOUT_NOTICE = 'LOCAL-DEVELOPMENT-NON-PRODUCT-CANDIDATE.txt';

export const REQUIRED_WINDOWS_ELECTRON_ASAR_ENTRIES = Object.freeze([
  'avatar/dist/index.html',
  'dist/index.html',
  'dist-electron/chat-ai-store-worker.js',
  'dist-electron/main.js',
  'dist-electron/preload.cjs',
  'node_modules/@img/sharp-win32-x64/index.cjs',
  'node_modules/@nimiplatform/kit-protected-local-win32-x64/index.cjs',
  'node_modules/@nimiplatform/kit-protected-local-win32-x64/nimi_shell_protected_local.node',
  'node_modules/sharp/dist/index.cjs',
  'package.json',
]);

export function assertNativeWindowsX64(platform, architecture) {
  if (platform !== 'win32' || architecture !== 'x64') {
    throw new Error(`Windows Electron layout must be built natively on win32/x64, received ${platform}/${architecture}`);
  }
}

export function exactReleaseVersion(value) {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(value)) {
    throw new Error('Windows Electron layout package version is invalid');
  }
  return value;
}

export function resolveWindowsElectronLayoutOutput(desktopRoot) {
  const root = path.resolve(desktopRoot);
  const windowsRoot = path.join(root, 'dist', 'windows');
  const output = path.join(windowsRoot, WINDOWS_ELECTRON_LAYOUT_DIRECTORY);
  const relative = path.relative(windowsRoot, output);
  if (relative !== WINDOWS_ELECTRON_LAYOUT_DIRECTORY || path.isAbsolute(relative)) {
    throw new Error('Windows Electron layout output is not the admitted deterministic dist/windows child');
  }
  return output;
}

export function windowsElectronPackagerOptions({
  dir,
  electronVersion,
  icon,
  out,
  resource,
  version,
}) {
  return Object.freeze({
    appCopyright: 'Copyright Nimi',
    appVersion: exactReleaseVersion(version),
    arch: 'x64',
    asar: { unpack: '**/*.{node,dll}' },
    dir,
    electronVersion: exactReleaseVersion(electronVersion),
    executableName: WINDOWS_ELECTRON_LAYOUT_APP_NAME,
    extraResource: resource,
    icon,
    name: WINDOWS_ELECTRON_LAYOUT_APP_NAME,
    out,
    overwrite: false,
    platform: 'win32',
    prune: false,
    quiet: true,
    win32metadata: {
      CompanyName: 'Nimi',
      FileDescription: 'Nimi',
      InternalName: WINDOWS_ELECTRON_LAYOUT_APP_NAME,
      OriginalFilename: `${WINDOWS_ELECTRON_LAYOUT_APP_NAME}.exe`,
      ProductName: 'Nimi',
      'requested-execution-level': 'asInvoker',
    },
  });
}

export function windowsElectronCandidateNotice({ electronVersion, version }) {
  return [
    'Nimi Desktop Windows x64 local-development layout',
    '',
    'NON-PRODUCT CANDIDATE.',
    'This is an unpacked Electron application layout, not an installer or uninstaller.',
    'Nimi-owned executable code uses the local-development Authenticode identity only.',
    'It is not SignPath/production signed and must not be published as an RC or Stable release.',
    `Desktop version: ${exactReleaseVersion(version)}`,
    `Electron version: ${exactReleaseVersion(electronVersion)}`,
    'Target: win32/x64',
    '',
  ].join('\n');
}

export function assertWindowsElectronAsarInventory(entries, mainSource) {
  const normalized = new Set(entries.map(normalizeAsarEntry));
  const missing = REQUIRED_WINDOWS_ELECTRON_ASAR_ENTRIES.filter((entry) => !normalized.has(entry));
  if (missing.length > 0) {
    throw new Error(`Windows Electron layout is missing required application content: ${missing.join(', ')}`);
  }
  for (const [label, pattern] of [
    ['Sharp x64 native binding', /^node_modules\/@img\/sharp-win32-x64\/lib\/sharp-win32-x64-[0-9.]+\.node$/u],
    ['Sharp x64 libvips runtime', /^node_modules\/@img\/sharp-win32-x64\/lib\/libvips-[0-9]+\.dll$/u],
  ]) {
    if (![...normalized].some((entry) => pattern.test(entry))) {
      throw new Error(`Windows Electron layout is missing required application content: ${label}`);
    }
  }
  if (normalized.has('node_modules/@nimiplatform/desktop-product-control-win32-x64/index.cjs')) {
    throw new Error('Windows Electron layout contains the retired product-control native placeholder');
  }
  const bundledMain = String(mainSource);
  for (const token of [
    '@nimiplatform/kit-protected-local-win32-x64',
    'product_control_record_get',
    'product_control_record_admit_ready_for_use',
  ]) {
    if (!bundledMain.includes(token)) {
      throw new Error(`Windows Electron main bundle is missing required host content: ${token}`);
    }
  }
}

export function assertWindowsX64Pe(bytes, label) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`${label} is not a Windows PE image`);
  }
  const headerOffset = buffer.readUInt32LE(0x3c);
  if (headerOffset > buffer.length - 6
    || buffer.readUInt32LE(headerOffset) !== 0x00004550
    || buffer.readUInt16LE(headerOffset + 4) !== 0x8664) {
    throw new Error(`${label} is not an x64 Windows PE image`);
  }
}

function normalizeAsarEntry(value) {
  return String(value).replaceAll('\\', '/').replace(/^\/+/, '');
}
