import type {
  ListLocalAssetsRequest,
  ListLocalAssetsResponse,
  LocalAssetRecord,
  LocalBundleEntryDigest,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { sha256Hex } from '../types/sha256.js';
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

export interface NimiRuntimeLocalAssetBundleEntry {
  readonly ordinal: number;
  readonly relativePath: string;
  readonly sha256: string;
}

export interface NimiRuntimeLocalAssetExactContent {
  readonly kind: 'single-file' | 'sharded-bundle';
  readonly verifiedContentId: string;
  readonly entrySha256: string;
  readonly bundleEntries?: readonly NimiRuntimeLocalAssetBundleEntry[];
}

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
  readonly artifactRoles?: readonly string[];
  /** Canonical content identity for import and catalog integrity checks. */
  readonly expectedVerifiedContentId?: string;
  /** Exact single-file or canonical ordered-bundle binding facts. */
  readonly exactContent?: NimiRuntimeLocalAssetExactContent;
  readonly bundleEntries?: readonly NimiRuntimeLocalAssetBundleEntry[];
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
  const exactContent = projectExactContent(input, localAssetId);
  return {
    localAssetId,
    assetId: normalizeText(input.assetId),
    ...(logicalModelId ? { logicalModelId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(sourceFileName ? { sourceFileName } : {}),
    kind,
    engine: normalizeText(input.engine),
    status,
    ...(family ? { family } : {}),
    ...(artifactRoles ? { artifactRoles } : {}),
    ...(exactContent ? {
      expectedVerifiedContentId: exactContent.verifiedContentId,
      exactContent,
      ...(exactContent.bundleEntries ? { bundleEntries: exactContent.bundleEntries } : {}),
    } : {}),
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

function projectExactContent(
  input: LocalAssetRecord,
  localAssetId: string,
): NimiRuntimeLocalAssetExactContent | undefined {
  const bundleEntries = Array.isArray(input.bundleEntries) ? input.bundleEntries : [];
  if (bundleEntries.length > 0) {
    const projected = projectBundleEntries(input, bundleEntries, localAssetId);
    const bytes = new Uint8Array(projected.length * 32);
    projected.forEach((entry, entryIndex) => {
      for (let byteIndex = 0; byteIndex < 32; byteIndex += 1) {
        bytes[entryIndex * 32 + byteIndex] = Number.parseInt(
          entry.sha256.slice(byteIndex * 2, byteIndex * 2 + 2),
          16,
        );
      }
    });
    const digest = sha256Hex(bytes);
    return Object.freeze({
      kind: 'sharded-bundle',
      verifiedContentId: `sha256:${digest}`,
      entrySha256: digest,
      bundleEntries: Object.freeze(projected),
    });
  }
  const entry = normalizeText(input.entry);
  if (!entry || !input.hashes || typeof input.hashes !== 'object') return undefined;
  const declared = canonicalSha256(input.hashes[entry]);
  if (!declared) return undefined;
  return Object.freeze({
    kind: 'single-file',
    verifiedContentId: `sha256:${declared}`,
    entrySha256: declared,
  });
}

function projectBundleEntries(
  input: LocalAssetRecord,
  entries: readonly LocalBundleEntryDigest[],
  localAssetId: string,
): NimiRuntimeLocalAssetBundleEntry[] {
  if (entries.length < 2 || !input.hashes || typeof input.hashes !== 'object') {
    throw localAssetProjectionError(
      `Runtime local asset ${localAssetId} has an invalid ordered bundle`,
      'check_runtime_local_asset_bundle',
    );
  }
  const mainEntry = canonicalBundleRelativePath(input.entry);
  const seenPaths = new Set<string>();
  let containsMainEntry = false;
  const projected = entries.map((entry, index) => {
    const ordinal = entry?.ordinal;
    const relativePath = canonicalBundleRelativePath(entry?.relativePath);
    const sha256 = typeof entry?.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(entry.sha256)
      ? entry.sha256
      : '';
    if (
      ordinal !== index + 1
      || !relativePath
      || !sha256
      || seenPaths.has(relativePath)
      || canonicalSha256(input.hashes[relativePath]) !== sha256
    ) {
      throw localAssetProjectionError(
        `Runtime local asset ${localAssetId} has invalid ordered bundle entry ${index + 1}`,
        'check_runtime_local_asset_bundle',
      );
    }
    seenPaths.add(relativePath);
    containsMainEntry ||= relativePath === mainEntry;
    return Object.freeze({ ordinal, relativePath, sha256 });
  });
  if (!mainEntry || !containsMainEntry) {
    throw localAssetProjectionError(
      `Runtime local asset ${localAssetId} ordered bundle does not cover its main entry`,
      'check_runtime_local_asset_bundle',
    );
  }
  return projected;
}

function canonicalBundleRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) return '';
  if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) return '';
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return segments.join('/') === value ? value : '';
}

function canonicalSha256(value: unknown): string {
  const declared = normalizeText(value).toLowerCase().replace(/^sha256:/u, '');
  return /^[a-f0-9]{64}$/u.test(declared) ? declared : '';
}

function localAssetProjectionError(message: string, actionHint: string): Error {
  return createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_LOCAL_ASSET_RESPONSE_INVALID',
    actionHint,
    source: 'runtime',
  });
}
