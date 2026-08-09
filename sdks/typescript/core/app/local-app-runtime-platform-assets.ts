import {
  asRecord,
  assertExactProjectionKeys,
  localAppError,
  localAppProjectionError,
  nonNegativeInteger,
} from './local-app-runtime-platform-validation';

const MAX_PATH_BYTES = 1024;
const MAX_PATH_COMPONENTS = 32;
const MAX_COMPONENT_BYTES = 255;
const MAX_MEDIA_TYPE_BYTES = 255;
const MAX_CHUNK_BYTES = 1024 * 1024;

export type NimiLocalAppAssetRecord = {
  readonly relativePath: string;
  readonly mediaType?: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NimiLocalAppAssetBody = Uint8Array | Blob | AsyncIterable<Uint8Array>;

export type NimiLocalAppAssetReadResult = {
  readonly asset: NimiLocalAppAssetRecord;
  readonly range: { readonly offset: number; readonly length: number; readonly totalSize: number };
  readonly body: AsyncIterable<Uint8Array>;
};

export type NimiLocalAppAssetsShell = {
  readonly stat: (relativePath: string) => Promise<unknown>;
  readonly list: (input: { readonly prefix: string; readonly cursor?: string; readonly pageSize?: number }) => Promise<unknown>;
  readonly write: (input: { readonly relativePath: string; readonly body: NimiLocalAppAssetBody; readonly mediaType?: string; readonly overwrite?: boolean }) => Promise<unknown>;
  readonly read: (input: { readonly relativePath: string; readonly offset?: number; readonly length?: number }) => Promise<unknown>;
  readonly remove: (relativePath: string) => Promise<unknown>;
  readonly move: (input: { readonly from: string; readonly to: string; readonly overwrite?: boolean }) => Promise<unknown>;
  readonly adoptArtifact: (input: { readonly artifactId: string; readonly relativePath: string; readonly overwrite?: boolean }) => Promise<unknown>;
};

export type NimiLocalAppAssetsClient = {
  readonly stat: (relativePath: string) => Promise<NimiLocalAppAssetRecord>;
  readonly list: (input: { readonly prefix: string; readonly cursor?: string; readonly pageSize?: number }) => Promise<{ readonly assets: readonly NimiLocalAppAssetRecord[]; readonly nextCursor: string }>;
  readonly write: (input: { readonly relativePath: string; readonly body: NimiLocalAppAssetBody; readonly mediaType?: string; readonly overwrite?: boolean }) => Promise<NimiLocalAppAssetRecord>;
  readonly read: (input: { readonly relativePath: string; readonly offset?: number; readonly length?: number }) => Promise<NimiLocalAppAssetReadResult>;
  readonly remove: (relativePath: string) => Promise<{ readonly removed: boolean }>;
  readonly move: (input: { readonly from: string; readonly to: string; readonly overwrite?: boolean }) => Promise<NimiLocalAppAssetRecord>;
  readonly adoptArtifact: (input: { readonly artifactId: string; readonly relativePath: string; readonly overwrite?: boolean }) => Promise<NimiLocalAppAssetRecord>;
};

export function createNimiLocalAppAssetsClient(shell: NimiLocalAppAssetsShell): NimiLocalAppAssetsClient {
  return Object.freeze({
    stat: async (relativePath) => projectAssetRecord(await shell.stat(assetPath(relativePath))),
    list: async (input) => {
      allowedKeys(input, ['prefix', 'cursor', 'pageSize'], ['prefix']);
      const prefix = input.prefix === '' ? '' : assetPrefix(input.prefix);
      const cursor = input.cursor;
      if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096)) inputError('cursor');
      const pageSize = input.pageSize;
      if (pageSize !== undefined && (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500)) inputError('pageSize');
      return projectAssetList(await shell.list({ prefix, ...(cursor === undefined ? {} : { cursor }), ...(pageSize === undefined ? {} : { pageSize }) }));
    },
    write: async (input) => {
      allowedKeys(input, ['relativePath', 'body', 'mediaType', 'overwrite'], ['relativePath', 'body']);
      const relativePath = assetPath(input.relativePath);
      const body = assetBody(input.body);
      const mediaType = input.mediaType === undefined ? undefined : canonicalMediaType(input.mediaType);
      const overwrite = optionalBoolean(input.overwrite, 'overwrite');
      return projectAssetRecord(await shell.write({ relativePath, body, ...(mediaType === undefined ? {} : { mediaType }), ...(overwrite === undefined ? {} : { overwrite }) }));
    },
    read: async (input) => {
      allowedKeys(input, ['relativePath', 'offset', 'length'], ['relativePath']);
      const relativePath = assetPath(input.relativePath);
      const offset = optionalRange(input.offset, false, 'offset');
      const length = optionalRange(input.length, true, 'length');
      return projectAssetRead(await shell.read({ relativePath, ...(offset === undefined ? {} : { offset }), ...(length === undefined ? {} : { length }) }));
    },
    remove: async (relativePath) => projectRemove(await shell.remove(assetPath(relativePath))),
    move: async (input) => {
      allowedKeys(input, ['from', 'to', 'overwrite'], ['from', 'to']);
      const overwrite = optionalBoolean(input.overwrite, 'overwrite');
      return projectAssetRecord(await shell.move({ from: assetPath(input.from), to: assetPath(input.to), ...(overwrite === undefined ? {} : { overwrite }) }));
    },
    adoptArtifact: async (input) => {
      allowedKeys(input, ['artifactId', 'relativePath', 'overwrite'], ['artifactId', 'relativePath']);
      const artifactId = exactText(input.artifactId, 512, 'artifactId');
      const overwrite = optionalBoolean(input.overwrite, 'overwrite');
      return projectAssetRecord(await shell.adoptArtifact({ artifactId, relativePath: assetPath(input.relativePath), ...(overwrite === undefined ? {} : { overwrite }) }));
    },
  });
}

function projectAssetRecord(value: unknown): NimiLocalAppAssetRecord {
  const record = asRecord(value);
  if (!record) return localAppProjectionError('asset metadata');
  const keys = Object.keys(record);
  if (keys.some((key) => !['relativePath', 'mediaType', 'sizeBytes', 'sha256', 'createdAt', 'updatedAt'].includes(key))
    || ['relativePath', 'sizeBytes', 'sha256', 'createdAt', 'updatedAt'].some((key) => !Object.hasOwn(record, key))) {
    return localAppProjectionError('asset metadata');
  }
  const relativePath = projectionAssetPath(record.relativePath);
  const mediaType = record.mediaType === undefined ? undefined : projectionMediaType(record.mediaType);
  const sizeBytes = nonNegativeInteger(record.sizeBytes, 'asset sizeBytes');
  if (sizeBytes > Number.MAX_SAFE_INTEGER || typeof record.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.sha256)) {
    return localAppProjectionError('asset integrity metadata');
  }
  const createdAt = projectionTimestamp(record.createdAt, 'createdAt');
  const updatedAt = projectionTimestamp(record.updatedAt, 'updatedAt');
  return Object.freeze({ relativePath, ...(mediaType === undefined ? {} : { mediaType }), sizeBytes,
    sha256: record.sha256, createdAt, updatedAt });
}

function projectAssetList(value: unknown): { readonly assets: readonly NimiLocalAppAssetRecord[]; readonly nextCursor: string } {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['assets', 'nextCursor'], 'asset list');
  if (!Array.isArray(record.assets) || record.assets.length > 500 || typeof record.nextCursor !== 'string' || record.nextCursor.length > 4096) {
    return localAppProjectionError('asset list');
  }
  const assets = Object.freeze(record.assets.map(projectAssetRecord));
  if (assets.some((asset, index) => index > 0 && assets[index - 1]!.relativePath >= asset.relativePath)) {
    return localAppProjectionError('asset list ordering');
  }
  return Object.freeze({ assets, nextCursor: record.nextCursor });
}

function projectAssetRead(value: unknown): NimiLocalAppAssetReadResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['asset', 'range', 'body'], 'asset read');
  const asset = projectAssetRecord(record.asset);
  const rangeValue = asRecord(record.range);
  assertExactProjectionKeys(rangeValue, ['offset', 'length', 'totalSize'], 'asset range');
  const offset = nonNegativeInteger(rangeValue.offset, 'asset range offset');
  const length = nonNegativeInteger(rangeValue.length, 'asset range length');
  const totalSize = nonNegativeInteger(rangeValue.totalSize, 'asset range totalSize');
  if (totalSize !== asset.sizeBytes || offset > totalSize || length > totalSize - offset) return localAppProjectionError('asset range');
  const source = record.body as AsyncIterable<Uint8Array>;
  if (!source || typeof source !== 'object' || typeof source[Symbol.asyncIterator] !== 'function') return localAppProjectionError('asset read body');
  const body = Object.freeze({
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      let observed = 0;
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0 || chunk.byteLength > MAX_CHUNK_BYTES) return localAppProjectionError('asset read chunk');
        observed += chunk.byteLength;
        if (!Number.isSafeInteger(observed) || observed > length) return localAppProjectionError('asset read length');
        yield new Uint8Array(chunk);
      }
      if (observed !== length) return localAppProjectionError('asset read length');
    },
  });
  return Object.freeze({ asset, range: Object.freeze({ offset, length, totalSize }), body });
}

function projectRemove(value: unknown): { readonly removed: boolean } {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['removed'], 'asset remove');
  if (typeof record.removed !== 'boolean') return localAppProjectionError('asset remove');
  return Object.freeze({ removed: record.removed });
}

function assetBody(value: unknown): NimiLocalAppAssetBody {
  if (value instanceof Uint8Array || (typeof Blob !== 'undefined' && value instanceof Blob)) return value;
  if (!value || typeof value !== 'object' || typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function') inputError('body');
  return value as AsyncIterable<Uint8Array>;
}

function assetPath(value: unknown): string {
  const path = exactText(value, MAX_PATH_BYTES, 'relativePath');
  const components = path.split('/');
  if (!isWellFormedUnicode(path) || path.normalize('NFC') !== path || path.startsWith('/') || path.endsWith('/')
    || /[\\\0<>:"|?*]/u.test(path) || components.length > MAX_PATH_COMPONENTS
    || components.some((component) => !validAssetComponent(component))) inputError('relativePath');
  return path;
}

function assetPrefix(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) inputError('prefix');
  const prefix = value;
  const trailing = prefix.endsWith('/');
  const canonical = assetPath(trailing ? prefix.slice(0, -1) : prefix);
  return `${canonical}${trailing ? '/' : ''}`;
}

function projectionAssetPath(value: unknown): string {
  try { return assetPath(value); } catch { return localAppProjectionError('asset relativePath'); }
}

function canonicalMediaType(value: unknown): string {
  const mediaType = exactText(value, MAX_MEDIA_TYPE_BYTES, 'mediaType');
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(mediaType)) inputError('mediaType');
  return mediaType.toLowerCase();
}

function projectionMediaType(value: unknown): string {
  try { return canonicalMediaType(value); } catch { return localAppProjectionError('asset mediaType'); }
}

function projectionTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) return localAppProjectionError(`asset ${field}`);
  return value;
}

function optionalRange(value: unknown, positive: boolean, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) inputError(field);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') inputError(field);
  return value;
}

function allowedKeys(value: unknown, allowed: readonly string[], required: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) inputError('input');
  const keys = Object.keys(value as object);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value as object, key))) inputError('input');
}

function exactText(value: unknown, maximum: number, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > maximum || /[\u0000-\u001f\u007f]/u.test(value)) inputError(field);
  return value;
}

function validAssetComponent(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..'
    || new TextEncoder().encode(segment).byteLength > MAX_COMPONENT_BYTES
    || segment.endsWith('.') || segment.endsWith(' ') || /[\u0000-\u001f\u007f]/u.test(segment)) return false;
  const base = segment.split('.')[0]?.toUpperCase() ?? '';
  return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit > 0xdbff || index + 1 >= value.length) return false;
    const next = value.charCodeAt(index + 1);
    if (next < 0xdc00 || next > 0xdfff) return false;
    index += 1;
  }
  return true;
}

function inputError(field: string): never {
  return localAppError('Local-app asset input is invalid.', 'SDK_LOCAL_APP_ASSET_INPUT_INVALID', `correct_${field}`);
}
