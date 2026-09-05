import { lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const MACOS_ARM64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-darwin-arm64';
const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';
const MACOS_PACKAGED_BINDING_COMPONENTS = ['nimi-native', 'protected-local', 'index.cjs'] as const;

type ElectronProcess = NodeJS.Process & {
  readonly defaultApp?: boolean;
  readonly resourcesPath?: string;
};

export function loadNimiElectronProtectedLocalPackage(packageName: string): unknown {
  const specifier = resolveNimiElectronProtectedLocalPackageSpecifier(packageName, {
    architecture: process.arch,
    platform: process.platform,
    resourcesPath: (process as ElectronProcess).resourcesPath,
    sourceDefaultApp: (process as ElectronProcess).defaultApp === true,
    sourceSourceLocalDevelopment: process.platform === 'win32'
      ? process.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT
      : process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT,
    sourceEntry: process.platform === 'win32'
      ? process.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY
      : process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT_NATIVE_ENTRY,
  });
  return createRequire(import.meta.url)(specifier) as unknown;
}

/** @internal Contract-test seam; not exported from the Kit public entrypoint. */
export function resolveNimiElectronProtectedLocalPackageSpecifier(
  packageName: string,
  input: {
    readonly architecture: string;
    readonly platform: string;
    readonly resourcesPath?: string;
    readonly sourceDefaultApp?: boolean;
    readonly sourceSourceLocalDevelopment?: string;
    readonly sourceEntry?: string;
  },
): string {
  const sourceRequested = input.sourceDefaultApp
    || input.sourceSourceLocalDevelopment !== undefined
    || input.sourceEntry !== undefined;
  if (input.platform === 'win32') {
    if (!sourceRequested) return packageName;
    if (input.architecture !== 'x64'
      || packageName !== WINDOWS_X64_BINDING_PACKAGE
      || input.sourceSourceLocalDevelopment !== '1') {
      throw new Error('protected-carrier-required');
    }
    // @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-037a
    if (input.sourceDefaultApp !== true) {
      if (input.sourceEntry !== undefined) throw new Error('protected-carrier-required');
      return packageName;
    }
    const entry = path.resolve(exactText(input.sourceEntry));
    const expectedTail = path.join(
      'kit',
      'shell',
      'protected-local-node',
      'npm',
      'win32-x64',
      'index.cjs',
    );
    if (!entry.toLowerCase().endsWith(`${path.sep}${expectedTail}`.toLowerCase())) {
      throw new Error('protected-carrier-required');
    }
    requireCanonicalFile(entry, true);
    requireCanonicalFile(path.join(path.dirname(entry), 'nimi_shell_protected_local.node'), true);
    return entry;
  }
  if (input.platform !== 'darwin') return packageName;
  if (input.architecture !== 'arm64' || packageName !== MACOS_ARM64_BINDING_PACKAGE) {
    throw new Error('protected-carrier-required');
  }
  if (sourceRequested) {
    if (input.sourceDefaultApp !== true || input.sourceSourceLocalDevelopment !== '1') {
      throw new Error('protected-carrier-required');
    }
    const entry = path.resolve(exactText(input.sourceEntry));
    const expectedTail = path.join(
      'kit',
      'shell',
      'protected-local-node',
      'npm',
      'darwin-arm64',
      'index.cjs',
    );
    if (!entry.endsWith(`${path.sep}${expectedTail}`)) {
      throw new Error('protected-carrier-required');
    }
    requireCanonicalCurrentUserFile(entry);
    requireCanonicalCurrentUserFile(path.join(path.dirname(entry), 'nimi_shell_protected_local.node'));
    return entry;
  }
  const resourcesPath = path.resolve(exactText(input.resourcesPath));
  if (path.basename(resourcesPath) !== 'Resources' || realpathSync(resourcesPath) !== resourcesPath) {
    throw new Error('protected-carrier-required');
  }
  let current = resourcesPath;
  requireCanonicalDirectory(current);
  for (const component of MACOS_PACKAGED_BINDING_COMPONENTS.slice(0, -1)) {
    current = path.join(current, component);
    requireCanonicalDirectory(current);
  }
  const entry = path.join(current, MACOS_PACKAGED_BINDING_COMPONENTS.at(-1)!);
  const nativeImage = path.join(current, 'nimi_shell_protected_local.node');
  requireCanonicalFile(entry, false);
  requireCanonicalFile(nativeImage, false);
  return entry;
}

function requireCanonicalDirectory(candidate: string): void {
  const metadata = lstatSync(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(candidate) !== candidate) {
    throw new Error('protected-carrier-required');
  }
}

function requireCanonicalFile(candidate: string, caseInsensitive: boolean): void {
  const metadata = lstatSync(candidate);
  const canonical = realpathSync(candidate);
  const samePath = caseInsensitive
    ? canonical.toLowerCase() === candidate.toLowerCase()
    : canonical === candidate;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || !samePath) {
    throw new Error('protected-carrier-required');
  }
}

function requireCanonicalCurrentUserFile(candidate: string): void {
  requireCanonicalFile(candidate, false);
  const metadata = lstatSync(candidate);
  const uid = process.geteuid?.();
  if (uid === undefined || uid === 0 || metadata.uid !== uid || (metadata.mode & 0o022) !== 0) {
    throw new Error('protected-carrier-required');
  }
}

function exactText(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.trim() !== value) {
    throw new Error('protected-carrier-required');
  }
  return value;
}
