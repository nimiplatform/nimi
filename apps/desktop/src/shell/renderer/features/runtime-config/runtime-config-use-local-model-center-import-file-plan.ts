import { useEffect, useMemo, useState } from 'react';
import {
  localRuntime,
  type LocalRuntimeAssetDeclaration,
  type LocalRuntimeAssetKind,
  type LocalRuntimeInstallPlanDescriptor,
} from '@runtime/local-runtime';
import {
  canImportDeclaration,
  capabilitiesForAssetKind,
  defaultEngineForAnyAssetKind,
} from './runtime-config-use-local-model-center-helpers.js';
import {
  planCanonicalImageCompatibilityHint,
  planRequiresAttachedEndpointInput,
  type AssetEngineOption,
} from './runtime-config-model-center-utils';

export function planAttachedEndpointHint(plan: LocalRuntimeInstallPlanDescriptor | null | undefined): string {
  if (!planRequiresAttachedEndpointInput(plan)) {
    return '';
  }
  return String(plan?.warnings[0] || '').trim()
    || `Attached endpoint required for ${String(plan?.engine || 'this runtime').trim() || 'this runtime'}.`;
}

type UseLocalModelCenterImportFilePlanInput = {
  showImportFileDialog: boolean;
  importFileAssetKind: LocalRuntimeAssetKind;
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

  const importFileDeclaration = useMemo<LocalRuntimeAssetDeclaration>(() => {
    const engine = importFileAssetKind === 'auxiliary'
      ? String(importFileAuxiliaryEngine || '').trim()
      : defaultEngineForAnyAssetKind(importFileAssetKind);
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
    if (importFileDeclaration.assetKind === 'image') {
      setImportEndpointRequired(false);
      setImportEndpointHint('');
      setImportCompatibilityHint('');
      setImportPlanAvailable(true);
      return undefined;
    }
    let cancelled = false;
    setImportPlanAvailable(false);
    void localRuntime.resolveInstallPlan({
      modelId: `local-import/import-preview-${importFileDeclaration.assetKind}`,
      capabilities: capabilitiesForAssetKind(importFileDeclaration.assetKind),
      engine,
    }).then((plan) => {
      if (cancelled) {
        return;
      }
      const required = planRequiresAttachedEndpointInput(plan);
      setImportEndpointRequired(required);
      setImportEndpointHint(required ? planAttachedEndpointHint(plan) : '');
      setImportCompatibilityHint(planCanonicalImageCompatibilityHint(plan));
      setImportPlanAvailable(true);
    }).catch(() => {
      if (cancelled) {
        return;
      }
      setImportEndpointRequired(false);
      setImportEndpointHint('');
      setImportCompatibilityHint('');
      setImportPlanAvailable(true);
    });
    return () => {
      cancelled = true;
    };
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
