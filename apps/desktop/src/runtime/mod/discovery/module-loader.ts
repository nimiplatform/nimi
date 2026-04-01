import type { RuntimeModFactory } from '../types';
import { resolveRuntimeModFactory, type RuntimeModModule } from './types';
import { resolveHostedPackageImportUrl } from './hosted-packages';

const STATIC_IMPORT_OR_EXPORT_SPECIFIER_PATTERN =
  /(\b(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?)(['"])([^'"`]+)\2/g;

const DYNAMIC_IMPORT_SPECIFIER_PATTERN =
  /(\bimport\s*\(\s*)(['"])([^'"`]+)\2(\s*\))/g;

function normalizeFsPath(input: string): string {
  const normalizedInput = String(input || '').replace(/\\/g, '/');
  const driveMatch = normalizedInput.match(/^([a-zA-Z]:)(\/.*)?$/);
  const drivePrefix = driveMatch ? driveMatch[1] : '';
  const pathPart = driveMatch ? (driveMatch[2] || '/') : normalizedInput;
  const isAbsolute = pathPart.startsWith('/');
  const segments: string[] = [];

  for (const segment of pathPart.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push('..');
      }
      continue;
    }
    segments.push(segment);
  }

  const normalizedPath = `${isAbsolute ? '/' : ''}${segments.join('/')}`;
  if (drivePrefix) {
    if (!normalizedPath || normalizedPath === '/') return `${drivePrefix}/`;
    return `${drivePrefix}${normalizedPath}`;
  }
  if (!normalizedPath) return isAbsolute ? '/' : '.';
  return normalizedPath;
}

function dirnameFsPath(entryPath: string): string {
  const normalized = normalizeFsPath(entryPath);
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '.';
  if (index === 0) return '/';
  return normalized.slice(0, index);
}

function resolveFsImportPath(entryPath: string, specifier: string): string | null {
  const normalizedSpecifier = String(specifier || '').replace(/\\/g, '/').trim();
  if (!normalizedSpecifier) return null;
  if (/^[a-zA-Z]:\//.test(normalizedSpecifier) || normalizedSpecifier.startsWith('/')) {
    return normalizeFsPath(normalizedSpecifier);
  }
  if (!normalizedSpecifier.startsWith('./') && !normalizedSpecifier.startsWith('../')) {
    return null;
  }
  return normalizeFsPath(`${dirnameFsPath(entryPath)}/${normalizedSpecifier}`);
}

function shouldSkipRewrite(specifier: string): boolean {
  return /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/)/.test(specifier);
}

function rewriteImportSpecifierForEntryPath(specifier: string, entryPath: string): string {
  if (shouldSkipRewrite(specifier)) {
    return specifier;
  }
  const hostedPackageImportUrl = resolveHostedPackageImportUrl(specifier);
  if (hostedPackageImportUrl) {
    return hostedPackageImportUrl;
  }
  const resolvedPath = resolveFsImportPath(entryPath, specifier);
  if (!resolvedPath) {
    return specifier;
  }
  return toViteFsImportUrl(resolvedPath) ?? toFileImportUrl(resolvedPath);
}

export function rewriteRuntimeModSourceImportSpecifiers(source: string, entryPath: string): string {
  const normalizedEntryPath = normalizeFsPath(entryPath);
  let rewritten = source.replace(
    STATIC_IMPORT_OR_EXPORT_SPECIFIER_PATTERN,
    (fullMatch, prefix: string, quote: string, specifier: string) => {
      const rewrittenSpecifier = rewriteImportSpecifierForEntryPath(specifier, normalizedEntryPath);
      if (rewrittenSpecifier === specifier) {
        return fullMatch;
      }
      return `${prefix}${quote}${rewrittenSpecifier}${quote}`;
    },
  );

  rewritten = rewritten.replace(
    DYNAMIC_IMPORT_SPECIFIER_PATTERN,
    (fullMatch, prefix: string, quote: string, specifier: string, suffix: string) => {
      const rewrittenSpecifier = rewriteImportSpecifierForEntryPath(specifier, normalizedEntryPath);
      if (rewrittenSpecifier === specifier) {
        return fullMatch;
      }
      return `${prefix}${quote}${rewrittenSpecifier}${quote}${suffix}`;
    },
  );

  return rewritten;
}

export async function loadRuntimeModFactoryFromSource(
  source: string,
  options?: {
    entryPath?: string;
  },
): Promise<RuntimeModFactory | null> {
  const entryPath = String(options?.entryPath || '').trim();
  const preparedSource = entryPath
    ? rewriteRuntimeModSourceImportSpecifiers(source, entryPath)
    : source;

  const blob = new Blob([preparedSource], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const moduleExports = (await import(
      /* @vite-ignore */ blobUrl
    )) as RuntimeModModule;
    return resolveRuntimeModFactory(moduleExports);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function toFileImportUrl(entryPath: string): string {
  const normalized = normalizeFsPath(entryPath);
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`);
  }
  if (normalized.startsWith('/')) {
    return encodeURI(`file://${normalized}`);
  }
  return encodeURI(normalized);
}

function toViteFsImportUrl(entryPath: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const origin = typeof window.location?.origin === 'string' ? window.location.origin : '';
  if (!/^https?:\/\//.test(origin)) {
    return null;
  }
  const normalized = normalizeFsPath(entryPath);
  const fsPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `${origin}/@fs${encodeURI(fsPath)}`;
}

export async function loadRuntimeModFactoryFromEntryPath(
  entryPath: string,
): Promise<RuntimeModFactory | null> {
  const importUrls = [
    toViteFsImportUrl(entryPath),
    toFileImportUrl(entryPath),
  ].filter((value): value is string => Boolean(value));

  let lastError: unknown = null;
  for (const importUrl of importUrls) {
    try {
      const moduleExports = (await import(
        /* @vite-ignore */ importUrl
      )) as RuntimeModModule;
      return resolveRuntimeModFactory(moduleExports);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return null;
}
