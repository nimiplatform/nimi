import {
  canImportLocalRuntimeAssetDeclaration,
  formatLocalRuntimeAssetKindLabel,
  normalizeLocalRuntimeAssetDeclaration,
  normalizeLocalRuntimeDependencyAssetDeclaration,
} from '@nimiplatform/sdk/runtime';

export type TesterLocalRuntimeAssetKindProjection = {
  label: string;
  runnableAssetKind: string;
  dependencyAssetKind: string;
  auxiliaryImportable: boolean;
};

export function createTesterLocalRuntimeAssetKindProjection(): TesterLocalRuntimeAssetKindProjection {
  const runnableDeclaration = normalizeLocalRuntimeAssetDeclaration({
    assetKind: 'LOCAL_ASSET_KIND_IMAGE',
    engine: ' media ',
  });
  const dependencyDeclaration = normalizeLocalRuntimeDependencyAssetDeclaration({
    assetKind: 'chat',
    engine: ' sidecar ',
  });
  return {
    label: formatLocalRuntimeAssetKindLabel('LOCAL_ASSET_KIND_CONTROLNET'),
    runnableAssetKind: runnableDeclaration.assetKind,
    dependencyAssetKind: dependencyDeclaration.assetKind,
    auxiliaryImportable: canImportLocalRuntimeAssetDeclaration({
      assetKind: 'auxiliary',
      engine: 'sidecar',
    }),
  };
}
