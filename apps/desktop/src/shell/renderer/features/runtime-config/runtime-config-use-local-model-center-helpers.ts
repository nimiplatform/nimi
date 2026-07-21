import type { NimiRuntimeLocalAssetDeclaration, NimiRuntimeLocalAssetKind } from '@nimiplatform/sdk/runtime';
import {
  canImportNimiRuntimeLocalAssetDeclaration,
  isNimiRuntimeLocalRunnableAssetKindId,
  nimiRuntimeLocalCapabilitiesForAssetKind,
  normalizeNimiRuntimeLocalAssetDeclaration,
  normalizeNimiRuntimeLocalDependencyAssetDeclaration,
} from '@nimiplatform/sdk/runtime';

export function isRunnableAssetKind(kind: NimiRuntimeLocalAssetKind): boolean {
  return isNimiRuntimeLocalRunnableAssetKindId(kind);
}

export function normalizeDependencyAssetKind(kind: string | undefined): NimiRuntimeLocalAssetKind {
  return normalizeNimiRuntimeLocalDependencyAssetDeclaration({ assetKind: kind }).assetKind as NimiRuntimeLocalAssetKind;
}

export function normalizeAssetDeclaration(
  declaration?: NimiRuntimeLocalAssetDeclaration,
): NimiRuntimeLocalAssetDeclaration {
  return normalizeNimiRuntimeLocalAssetDeclaration(declaration) as NimiRuntimeLocalAssetDeclaration;
}

export function canImportDeclaration(declaration: NimiRuntimeLocalAssetDeclaration): boolean {
  return canImportNimiRuntimeLocalAssetDeclaration(declaration);
}

export function capabilitiesForAssetKind(kind: NimiRuntimeLocalAssetKind): string[] {
  return nimiRuntimeLocalCapabilitiesForAssetKind(kind);
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
