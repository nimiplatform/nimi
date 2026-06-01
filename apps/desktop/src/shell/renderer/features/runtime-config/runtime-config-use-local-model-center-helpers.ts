import type { LocalRuntimeAssetDeclaration, LocalRuntimeAssetKind } from '@nimiplatform/sdk/runtime';
import {
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  canImportLocalRuntimeAssetDeclaration,
  isLocalRuntimeRunnableAssetKindId,
  localRuntimeCapabilitiesForAssetKind,
  normalizeLocalRuntimeAssetDeclaration,
  normalizeLocalRuntimeDependencyAssetDeclaration,
} from '@nimiplatform/sdk/runtime';

export const RUNNABLE_ASSET_KINDS = new Set(LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS);

export function isRunnableAssetKind(kind: LocalRuntimeAssetKind): boolean {
  return isLocalRuntimeRunnableAssetKindId(kind);
}

export function normalizeDependencyAssetKind(kind: string | undefined): LocalRuntimeAssetKind {
  return normalizeLocalRuntimeDependencyAssetDeclaration({ assetKind: kind }).assetKind as LocalRuntimeAssetKind;
}

export function normalizeAssetDeclaration(
  declaration?: LocalRuntimeAssetDeclaration,
): LocalRuntimeAssetDeclaration {
  return normalizeLocalRuntimeAssetDeclaration(declaration) as LocalRuntimeAssetDeclaration;
}

export function canImportDeclaration(declaration: LocalRuntimeAssetDeclaration): boolean {
  return canImportLocalRuntimeAssetDeclaration(declaration);
}

export function capabilitiesForAssetKind(kind: LocalRuntimeAssetKind): string[] {
  return localRuntimeCapabilitiesForAssetKind(kind);
}

export function manifestPathFromSourceRepo(repo: string | undefined): string | undefined {
  const normalized = String(repo || '').trim();
  if (!normalized.toLowerCase().startsWith('file://')) {
    return undefined;
  }
  try {
    return decodeURIComponent(new URL(normalized).pathname);
  } catch {
    return normalized.slice('file://'.length);
  }
}
