import { useEffect, useMemo, useState } from 'react';
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
  importFileEndpoint: string;
};

export function useLocalModelCenterImportFilePlan({
  showImportFileDialog,
  importFileAssetKind,
  importFileAuxiliaryEngine,
  importFileEndpoint,
}: UseLocalModelCenterImportFilePlanInput) {
  const [importEndpointRequired, setImportEndpointRequired] = useState(false);
  const [importEndpointHint, setImportEndpointHint] = useState('');
  const [importCompatibilityHint, setImportCompatibilityHint] = useState('');
  const [importPlanAvailable, setImportPlanAvailable] = useState(true);

  const importFileDeclaration = useMemo<NimiRuntimeLocalAssetDeclaration>(() => {
    const engine = importFileAssetKind === 'auxiliary'
      ? String(importFileAuxiliaryEngine || '').trim()
      : '';
    return {
      assetKind: importFileAssetKind,
      ...(engine ? { engine } : {}),
    };
  }, [importFileAssetKind, importFileAuxiliaryEngine]);

  useEffect(() => {
    if (!showImportFileDialog) {
      return undefined;
    }
    if (importFileDeclaration.assetKind === 'auxiliary') {
      setImportEndpointRequired(false);
      setImportEndpointHint('');
      setImportCompatibilityHint('');
      setImportPlanAvailable(true);
      return undefined;
    }
    const engine = String(importFileDeclaration.engine || '').trim();
    if (engine !== 'media' && engine !== 'speech') {
      setImportEndpointRequired(false);
      setImportEndpointHint('');
      setImportCompatibilityHint('');
      setImportPlanAvailable(true);
      return undefined;
    }
    setImportEndpointRequired(false);
    setImportEndpointHint('');
    setImportCompatibilityHint('');
    setImportPlanAvailable(true);
    return undefined;
  }, [importFileDeclaration, showImportFileDialog]);

  const canChooseImportFile = useMemo(
    () => importPlanAvailable
      && canImportDeclaration(importFileDeclaration)
      && (!importEndpointRequired || Boolean(String(importFileEndpoint || '').trim())),
    [importEndpointRequired, importFileDeclaration, importFileEndpoint, importPlanAvailable],
  );

  return {
    canChooseImportFile,
    importCompatibilityHint,
    importEndpointHint,
    importEndpointRequired,
    importFileDeclaration,
  };
}
