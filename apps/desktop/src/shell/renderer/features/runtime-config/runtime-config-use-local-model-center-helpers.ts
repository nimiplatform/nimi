import type { NimiRuntimeLocalAssetDeclaration, NimiRuntimeLocalAssetKind } from '@nimiplatform/sdk/runtime';
import {
  NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS,
  canImportNimiRuntimeLocalAssetDeclaration,
  isNimiRuntimeLocalRunnableAssetKindId,
  nimiRuntimeLocalCapabilitiesForAssetKind,
  normalizeNimiRuntimeLocalAssetDeclaration,
  normalizeNimiRuntimeLocalDependencyAssetDeclaration,
} from '@nimiplatform/sdk/runtime';

export const RUNNABLE_ASSET_KINDS = new Set(NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS);

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
