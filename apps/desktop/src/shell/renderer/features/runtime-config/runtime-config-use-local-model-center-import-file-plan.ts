import { useMemo } from 'react';
import {
  type NimiRuntimeLocalAssetDeclaration,
  type NimiRuntimeLocalAssetKind,
} from '@nimiplatform/sdk/runtime';
import {
  canImportDeclaration,
} from './runtime-config-use-local-model-center-helpers.js';
import {
  type AssetEngineOption,
} from './runtime-config-model-center-utils';

type UseLocalModelCenterImportFilePlanInput = {
  showImportFileDialog: boolean;
  importFileAssetKind: NimiRuntimeLocalAssetKind;
  importFileAuxiliaryEngine: AssetEngineOption | '';
};

export function useLocalModelCenterImportFilePlan({
  showImportFileDialog,
  importFileAssetKind,
  importFileAuxiliaryEngine,
}: UseLocalModelCenterImportFilePlanInput) {
  const importFileDeclaration = useMemo<NimiRuntimeLocalAssetDeclaration>(() => {
    const engine = importFileAssetKind === 'auxiliary'
      ? String(importFileAuxiliaryEngine || '').trim()
      : '';
    return {
      assetKind: importFileAssetKind,
      ...(engine ? { engine } : {}),
    };
  }, [importFileAssetKind, importFileAuxiliaryEngine]);

  const canChooseImportFile = useMemo(
    () => !showImportFileDialog || canImportDeclaration(importFileDeclaration),
    [importFileDeclaration, showImportFileDialog],
  );

  return {
    canChooseImportFile,
    importFileDeclaration,
  };
}
