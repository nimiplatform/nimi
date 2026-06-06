import {
  canImportNimiRuntimeLocalAssetDeclaration,
  formatNimiRuntimeLocalAssetKindLabel,
  normalizeNimiRuntimeLocalAssetDeclaration,
  normalizeNimiRuntimeLocalDependencyAssetDeclaration,
} from '@nimiplatform/sdk/runtime';

export type TesterLocalRuntimeAssetKindProjection = {
  label: string;
  runnableAssetKind: string;
  dependencyAssetKind: string;
  auxiliaryImportable: boolean;
};

export function createTesterLocalRuntimeAssetKindProjection(): TesterLocalRuntimeAssetKindProjection {
  const runnableDeclaration = normalizeNimiRuntimeLocalAssetDeclaration({
    assetKind: 'LOCAL_ASSET_KIND_IMAGE',
    engine: ' media ',
  });
  const dependencyDeclaration = normalizeNimiRuntimeLocalDependencyAssetDeclaration({
    assetKind: 'chat',
    engine: ' sidecar ',
  });
  return {
    label: formatNimiRuntimeLocalAssetKindLabel('LOCAL_ASSET_KIND_CONTROLNET'),
    runnableAssetKind: runnableDeclaration.assetKind,
    dependencyAssetKind: dependencyDeclaration.assetKind,
    auxiliaryImportable: canImportNimiRuntimeLocalAssetDeclaration({
      assetKind: 'auxiliary',
      engine: 'sidecar',
    }),
  };
}
