import {
  toLocalRuntimeAssetKindRequestValue,
  toLocalRuntimeAssetStatusRequestValue,
} from './local-asset-kind.js';
import type { RuntimeLocalServiceClient } from './types-client-interfaces.js';

const DEFAULT_LOCAL_ASSET_PAGE_SIZE = 200;

export type RuntimeLocalAssetEntryProjection = {
  localAssetId: string;
  assetId: string;
  kind: number;
  engine: string;
  status: number;
};

export type RuntimeLocalAssetListClient = {
  readonly local: Pick<RuntimeLocalServiceClient, 'listLocalAssets'>;
};

function trimText(value: unknown): string {
  return String(value || '').trim();
}

export function projectRuntimeLocalAssetEntry(input: {
  localAssetId?: unknown;
  assetId?: unknown;
  kind?: unknown;
  engine?: unknown;
  status?: unknown;
}): RuntimeLocalAssetEntryProjection {
  return {
    localAssetId: trimText(input.localAssetId),
    assetId: trimText(input.assetId),
    kind: toLocalRuntimeAssetKindRequestValue(input.kind),
    engine: trimText(input.engine),
    status: toLocalRuntimeAssetStatusRequestValue(input.status),
  };
}

export async function listRuntimeLocalAssetEntries(
  runtime: RuntimeLocalAssetListClient,
  input?: {
    pageSize?: number;
  },
): Promise<RuntimeLocalAssetEntryProjection[]> {
  const assets: RuntimeLocalAssetEntryProjection[] = [];
  const pageSize = Math.max(1, Math.floor(Number(input?.pageSize || DEFAULT_LOCAL_ASSET_PAGE_SIZE)));
  let pageToken = '';
  do {
    const response = await runtime.local.listLocalAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize,
      pageToken,
    });
    for (const asset of response.assets || []) {
      assets.push(projectRuntimeLocalAssetEntry(asset));
    }
    pageToken = trimText(response.nextPageToken);
  } while (pageToken);
  return assets;
}
