import { getProductControlSelectedDataRoot } from './product-control';

export type DesktopStorageDirs = {
  nimiDir: string;
  nimiDataDir: string;
  mediaCacheDir: string;
  localModelsDir: string;
  localRuntimeStatePath: string;
};

function pathSeparator(path: string): '/' | '\\' {
  return path.includes('\\') ? '\\' : '/';
}

function trimTrailingSeparator(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function joinPath(base: string, ...parts: string[]): string {
  const separator = pathSeparator(base);
  const trimmedBase = trimTrailingSeparator(base);
  return [trimmedBase, ...parts.map((part) => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))]
    .filter(Boolean)
    .join(separator);
}

function dirname(path: string): string {
  const normalized = trimTrailingSeparator(path.trim());
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return index > 0 ? normalized.slice(0, index) : '';
}

export async function getDesktopStorageDirs(): Promise<DesktopStorageDirs> {
  const projection = await getProductControlSelectedDataRoot();
  const nimiDir = dirname(projection.path || '');
  const dataRoot = projection.dataRoot?.path?.trim() || '';
  if (!nimiDir || !dataRoot) {
    throw new Error(projection.error || 'desktop storage dirs require a selected product-control data root');
  }

  return {
    nimiDir,
    nimiDataDir: dataRoot,
    mediaCacheDir: joinPath(dataRoot, 'cache', 'media'),
    localModelsDir: joinPath(dataRoot, 'models'),
    localRuntimeStatePath: joinPath(nimiDir, 'runtime', 'local-state.json'),
  };
}
