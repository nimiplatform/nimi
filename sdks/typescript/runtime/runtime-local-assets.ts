import type {
  ListLocalAssetsRequest,
  ListLocalAssetsResponse,
  LocalAssetRecord,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  parseNimiRuntimeLocalAssetKindId,
  parseNimiRuntimeLocalAssetStatusId,
  toNimiRuntimeLocalAssetKindRequestValue,
  toNimiRuntimeLocalAssetStatusRequestValue,
  type NimiRuntimeLocalAssetKindId,
  type NimiRuntimeLocalAssetStatusId,
} from './local-asset-vocabulary';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';

export const NIMI_RUNTIME_LOCAL_ASSET_ENTRY_DEFAULT_PAGE_SIZE = 200;

export interface NimiRuntimeLocalAssetEntry {
  readonly localAssetId: string;
  readonly assetId: string;
  readonly logicalModelId?: string;
  readonly displayName?: string;
  readonly sourceFileName?: string;
  readonly kind: NimiRuntimeLocalAssetKindId;
  readonly engine: string;
  readonly status: NimiRuntimeLocalAssetStatusId;
  readonly family?: string;
  readonly modelFamily?: string;
  readonly artifactRoles?: readonly string[];
  /** Canonical content identity for import and catalog integrity checks. */
  readonly expectedVerifiedContentId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NimiRuntimeLocalAssetListClient {
  readonly local: {
    listLocalAssets(
      request: ListLocalAssetsRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<ListLocalAssetsResponse>;
  };
}

export interface NimiRuntimeLocalAssetListInput {
  readonly kind?: NimiRuntimeLocalAssetKindId | string | null;
  readonly status?: NimiRuntimeLocalAssetStatusId | string | null;
  readonly engine?: string | null;
  readonly pageSize?: number;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export function projectNimiRuntimeLocalAssetEntry(
  input: LocalAssetRecord,
): NimiRuntimeLocalAssetEntry {
  const localAssetId = normalizeText(input.localAssetId);
  if (!localAssetId) {
    throw localAssetProjectionError(
      'Runtime local asset record is missing localAssetId',
      'provide_runtime_local_asset_id',
    );
  }
  const kind = parseNimiRuntimeLocalAssetKindId(input.kind);
  if (!kind) {
    throw localAssetProjectionError(
      `Runtime local asset ${localAssetId} has unsupported kind ${String(input.kind)}`,
      'check_runtime_local_asset_kind',
    );
  }
  const status = parseNimiRuntimeLocalAssetStatusId(input.status);
  if (!status) {
    throw localAssetProjectionError(
      `Runtime local asset ${localAssetId} has unsupported status ${String(input.status)}`,
      'check_runtime_local_asset_status',
    );
  }
  const family = normalizeText(input.family);
  const metadata = nonEmptyRecord(fromNimiRuntimeProtoStruct(input.metadata));
  const logicalModelId = normalizeText(input.logicalModelId)
    || normalizeText(metadata?.effectivePublicComponentIdentity);
  const displayName = normalizeText(input.displayName);
  const sourceFileName = normalizeText(input.sourceFileName);
  const artifactRoles = textListOrUndefined(input.artifactRoles);
  const expectedVerifiedContentId = projectExpectedVerifiedContentId(input);
  return {
    localAssetId,
    assetId: normalizeText(input.assetId),
    ...(logicalModelId ? { logicalModelId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(sourceFileName ? { sourceFileName } : {}),
    kind,
    engine: normalizeText(input.engine),
    status,
    ...(family ? { family, modelFamily: family } : {}),
    ...(artifactRoles ? { artifactRoles } : {}),
    ...(expectedVerifiedContentId ? { expectedVerifiedContentId } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export async function listNimiRuntimeLocalAssetEntries(
  runtime: NimiRuntimeLocalAssetListClient,
  input: NimiRuntimeLocalAssetListInput = {},
): Promise<NimiRuntimeLocalAssetEntry[]> {
  const assets: NimiRuntimeLocalAssetEntry[] = [];
  const pageSize = normalizePageSize(input.pageSize);
  const engineFilter = normalizeText(input.engine);
  let pageToken = '';
  do {
    const response = await runtime.local.listLocalAssets({
      statusFilter: toNimiRuntimeLocalAssetStatusRequestValue(input.status),
      kindFilter: toNimiRuntimeLocalAssetKindRequestValue(input.kind),
      engineFilter,
      pageSize,
      pageToken,
    }, input.callOptions);
    for (const asset of response.assets) {
      assets.push(projectNimiRuntimeLocalAssetEntry(asset));
    }
    pageToken = normalizeText(response.nextPageToken);
  } while (pageToken);
  return assets;
}

function normalizePageSize(value: unknown): number {
  const parsed = Math.floor(Number(value ?? NIMI_RUNTIME_LOCAL_ASSET_ENTRY_DEFAULT_PAGE_SIZE));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NIMI_RUNTIME_LOCAL_ASSET_ENTRY_DEFAULT_PAGE_SIZE;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function nonEmptyRecord(value: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> | undefined {
  if (!value || Object.keys(value).length === 0) return undefined;
  return value;
}

function textListOrUndefined(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function projectExpectedVerifiedContentId(input: LocalAssetRecord): string | undefined {
  const entry = normalizeText(input.entry);
  if (!entry || !input.hashes || typeof input.hashes !== 'object') return undefined;
  const declared = normalizeText(input.hashes[entry])
    .toLowerCase()
    .replace(/^sha256:/u, '');
  return /^[a-f0-9]{64}$/u.test(declared) ? `sha256:${declared}` : undefined;
}

function localAssetProjectionError(message: string, actionHint: string): Error {
  return createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_LOCAL_ASSET_RESPONSE_INVALID',
    actionHint,
    source: 'runtime',
  });
}
