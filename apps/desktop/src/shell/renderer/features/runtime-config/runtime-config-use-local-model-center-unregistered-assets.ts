import { useCallback, useState } from 'react';
import type {
  NimiRuntimeLocalAssetDeclaration,
  NimiRuntimeLocalAssetKind,
  NimiRuntimeLocalUnregisteredAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
import { useRuntimeConfigLocalAssetAdminClient } from './runtime-config-local-model-center-sdk-service';
import {
  defaultAssetDeclaration,
  type AssetEngineOption,
} from './runtime-config-model-center-utils';
import { normalizeAssetDeclaration } from './runtime-config-use-local-model-center-helpers.js';

export function useLocalModelCenterUnregisteredAssets() {
  const runtimeConfigLocalAssetAdminClient = useRuntimeConfigLocalAssetAdminClient();
  const [unregisteredAssets, setUnregisteredAssets] = useState<NimiRuntimeLocalUnregisteredAssetDescriptor[]>([]);
  const [unregisteredAssetDrafts, setUnregisteredAssetDrafts] = useState<Record<string, NimiRuntimeLocalAssetDeclaration>>({});

  const refreshUnregisteredAssets = useCallback(async (requestIsCurrent?: () => boolean) => {
    try {
      const rows = await runtimeConfigLocalAssetAdminClient.scanUnregisteredAssets();
      if (requestIsCurrent && !requestIsCurrent()) {
        return;
      }
      setUnregisteredAssets([...rows]);
      setUnregisteredAssetDrafts((prev) => {
        const next: Record<string, NimiRuntimeLocalAssetDeclaration> = {};
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

  const resolveUnregisteredAssetDraft = useCallback((asset: NimiRuntimeLocalUnregisteredAssetDescriptor): NimiRuntimeLocalAssetDeclaration => (
    unregisteredAssetDrafts[asset.path]
    || normalizeAssetDeclaration(asset.declaration)
    || defaultAssetDeclaration('runnable')
  ), [unregisteredAssetDrafts]);

  const setUnregisteredAssetDraft = useCallback((
    assetPath: string,
    nextDeclaration: NimiRuntimeLocalAssetDeclaration,
  ) => {
    setUnregisteredAssetDrafts((prev) => ({
      ...prev,
      [assetPath]: nextDeclaration,
    }));
  }, []);

  const setUnregisteredAssetKind = useCallback((assetPath: string, assetKind: NimiRuntimeLocalAssetKind) => {
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

  return {
    refreshUnregisteredAssets,
    resolveUnregisteredAssetDraft,
    setUnregisteredAssetKind,
    setUnregisteredAuxiliaryEngine,
    unregisteredAssetDrafts,
    unregisteredAssets,
  };
}
