import { useCallback, useEffect, useState } from 'react';
import {
  localRuntime,
  type LocalRuntimeAssetDeclaration,
  type LocalRuntimeAssetKind,
  type LocalRuntimeUnregisteredAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
import {
  defaultAssetDeclaration,
  type AssetEngineOption,
} from './runtime-config-model-center-utils';
import {
  normalizeAssetDeclaration,
} from './runtime-config-use-local-model-center-helpers.js';

export function useLocalModelCenterUnregisteredAssets() {
  const [unregisteredAssets, setUnregisteredAssets] = useState<LocalRuntimeUnregisteredAssetDescriptor[]>([]);
  const [unregisteredAssetDrafts, setUnregisteredAssetDrafts] = useState<Record<string, LocalRuntimeAssetDeclaration>>({});
  const [unregisteredEndpointByPath, setUnregisteredEndpointByPath] = useState<Record<string, string>>({});
  const [unregisteredEndpointRequiredByPath, setUnregisteredEndpointRequiredByPath] = useState<Record<string, boolean>>({});
  const [unregisteredEndpointHintByPath, setUnregisteredEndpointHintByPath] = useState<Record<string, string>>({});
  const [unregisteredCompatibilityHintByPath, setUnregisteredCompatibilityHintByPath] = useState<Record<string, string>>({});
  const [unregisteredImportAllowedByPath, setUnregisteredImportAllowedByPath] = useState<Record<string, boolean>>({});

  const refreshUnregisteredAssets = useCallback(async (requestIsCurrent?: () => boolean) => {
    try {
      const rows = await localRuntime.scanUnregisteredAssets();
      if (requestIsCurrent && !requestIsCurrent()) {
        return;
      }
      setUnregisteredAssets(rows);
      setUnregisteredAssetDrafts((prev) => {
        const next: Record<string, LocalRuntimeAssetDeclaration> = {};
        for (const item of rows) {
          const existing = prev[item.path];
          if (existing) {
            next[item.path] = existing;
            continue;
          }
          if (item.declaration) {
            next[item.path] = normalizeAssetDeclaration(item.declaration);
          }
        }
        return next;
      });
    } catch {
      if (requestIsCurrent && !requestIsCurrent()) {
        return;
      }
      setUnregisteredAssets([]);
      setUnregisteredAssetDrafts({});
    }
  }, []);

  const resolveUnregisteredAssetDraft = useCallback((asset: LocalRuntimeUnregisteredAssetDescriptor): LocalRuntimeAssetDeclaration => (
    unregisteredAssetDrafts[asset.path]
    || normalizeAssetDeclaration(asset.declaration)
    || defaultAssetDeclaration('runnable')
  ), [unregisteredAssetDrafts]);

  const setUnregisteredAssetDraft = useCallback((
    assetPath: string,
    nextDeclaration: LocalRuntimeAssetDeclaration,
  ) => {
    setUnregisteredAssetDrafts((prev) => ({
      ...prev,
      [assetPath]: nextDeclaration,
    }));
  }, []);

  const setUnregisteredAssetKind = useCallback((assetPath: string, assetKind: LocalRuntimeAssetKind) => {
    setUnregisteredAssetDraft(assetPath, {
      assetKind,
    });
  }, [setUnregisteredAssetDraft]);

  const setUnregisteredAuxiliaryEngine = useCallback((assetPath: string, engine: AssetEngineOption | '') => {
    setUnregisteredAssetDrafts((prev) => {
      const current = normalizeAssetDeclaration(prev[assetPath] || {
        assetKind: 'auxiliary',
      });
      return {
        ...prev,
        [assetPath]: {
          ...current,
          assetKind: 'auxiliary',
          ...(engine ? { engine } : {}),
        },
      };
    });
  }, []);

  const setUnregisteredEndpoint = useCallback((assetPath: string, endpoint: string) => {
    setUnregisteredEndpointByPath((prev) => ({
      ...prev,
      [assetPath]: endpoint,
    }));
  }, []);

  useEffect(() => {
    const currentPaths = new Set(unregisteredAssets.map((asset) => asset.path));
    setUnregisteredEndpointByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
    setUnregisteredEndpointRequiredByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
    setUnregisteredEndpointHintByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
    setUnregisteredCompatibilityHintByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
    setUnregisteredImportAllowedByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
  }, [unregisteredAssets]);

  useEffect(() => {
    for (const asset of unregisteredAssets) {
      const declaration = resolveUnregisteredAssetDraft(asset);
      if (declaration.assetKind === 'auxiliary') {
        continue;
      }
      const engine = String(declaration.engine || '').trim();
      if (engine !== 'media' && engine !== 'speech') {
        setUnregisteredEndpointRequiredByPath((prev) => ({ ...prev, [asset.path]: false }));
        setUnregisteredEndpointHintByPath((prev) => ({ ...prev, [asset.path]: '' }));
        setUnregisteredCompatibilityHintByPath((prev) => ({ ...prev, [asset.path]: '' }));
        setUnregisteredImportAllowedByPath((prev) => ({ ...prev, [asset.path]: true }));
        continue;
      }
      setUnregisteredEndpointRequiredByPath((prev) => ({ ...prev, [asset.path]: false }));
      setUnregisteredEndpointHintByPath((prev) => ({ ...prev, [asset.path]: '' }));
      setUnregisteredCompatibilityHintByPath((prev) => ({ ...prev, [asset.path]: '' }));
      setUnregisteredImportAllowedByPath((prev) => ({ ...prev, [asset.path]: true }));
    }
  }, [resolveUnregisteredAssetDraft, unregisteredAssets]);

  return {
    refreshUnregisteredAssets,
    resolveUnregisteredAssetDraft,
    setUnregisteredAssetKind,
    setUnregisteredAuxiliaryEngine,
    setUnregisteredEndpoint,
    unregisteredAssetDrafts,
    unregisteredAssets,
    unregisteredCompatibilityHintByPath,
    unregisteredEndpointByPath,
    unregisteredEndpointHintByPath,
    unregisteredEndpointRequiredByPath,
    unregisteredImportAllowedByPath,
  };
}
