import { resolve } from 'node:path';
import {
  listKnowledgeAssetSourceFiles,
  loadKnowledgeAsset,
} from './knowledge-asset-kernel.js';

function assertAssetId(assetId: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assetId)) {
    throw new Error(`knowledge asset id must be kebab-case, got: ${assetId}`);
  }
  if (assetId.endsWith('.json')) {
    throw new Error(`knowledge asset readers take assetId, not a JSON filename: ${assetId}`);
  }
}

function loadDirectoryBackedAsset(dataKnowledgeRoot: string, assetId: string) {
  assertAssetId(assetId);
  return loadKnowledgeAsset({
    dataKnowledgeRoot,
    assetId,
    manifestPath: resolve(dataKnowledgeRoot, 'assets', assetId, 'asset.json'),
  });
}

export function knowledgeAssetSourcePaths(dataKnowledgeRoot: string, assetId: string): string[] {
  return listKnowledgeAssetSourceFiles(loadDirectoryBackedAsset(dataKnowledgeRoot, assetId));
}

export function readKnowledgeAssetData(dataKnowledgeRoot: string, assetId: string): Record<string, unknown> {
  return loadDirectoryBackedAsset(dataKnowledgeRoot, assetId).data;
}
