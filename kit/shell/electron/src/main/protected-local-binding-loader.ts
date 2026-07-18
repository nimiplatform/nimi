import { lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const MACOS_ARM64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-darwin-arm64';
const MACOS_PACKAGED_BINDING_COMPONENTS = ['nimi-native', 'protected-local', 'index.cjs'] as const;

type ElectronProcess = NodeJS.Process & { readonly resourcesPath?: string };

export function loadNimiElectronProtectedLocalPackage(packageName: string): unknown {
  const specifier = resolveNimiElectronProtectedLocalPackageSpecifier(packageName, {
    architecture: process.arch,
    platform: process.platform,
    resourcesPath: (process as ElectronProcess).resourcesPath,
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
  },
): string {
  if (input.platform !== 'darwin') return packageName;
  if (input.architecture !== 'arm64' || packageName !== MACOS_ARM64_BINDING_PACKAGE) {
    throw new Error('protected-carrier-required');
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
  requireCanonicalFile(entry);
  requireCanonicalFile(nativeImage);
  return entry;
}

function requireCanonicalDirectory(candidate: string): void {
  const metadata = lstatSync(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(candidate) !== candidate) {
    throw new Error('protected-carrier-required');
  }
}

function requireCanonicalFile(candidate: string): void {
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || realpathSync(candidate) !== candidate) {
    throw new Error('protected-carrier-required');
  }
}

function exactText(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.trim() !== value) {
    throw new Error('protected-carrier-required');
  }
  return value;
}
