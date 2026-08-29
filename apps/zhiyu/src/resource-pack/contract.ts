export const ZHIYU_RESOURCE_PACK_SCHEMA_VERSION = 1 as const;
export const ZHIYU_RESOURCE_PACK_TARGET_ID = 'zhiyu-experience-surface' as const;
export const ZHIYU_RESOURCE_PACK_TARGET_VERSION = 1 as const;
export const ZHIYU_RESOURCE_PACK_MANIFEST_PATH = 'manifest.json' as const;

export const ZHIYU_RESOURCE_PACK_ZONES = [
  'surface',
] as const;

export type ZhiyuResourcePackZone = typeof ZHIYU_RESOURCE_PACK_ZONES[number];

export type ZhiyuResourcePackManifest = Readonly<{
  schemaVersion: typeof ZHIYU_RESOURCE_PACK_SCHEMA_VERSION;
  target: Readonly<{
    id: typeof ZHIYU_RESOURCE_PACK_TARGET_ID;
    version: typeof ZHIYU_RESOURCE_PACK_TARGET_VERSION;
  }>;
  styleEntry: string;
  resources: readonly string[];
}>;

export type ZhiyuResourcePackResource = Readonly<{
  path: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}>;

export type ParsedZhiyuResourcePack = Readonly<{
  manifest: ZhiyuResourcePackManifest;
  archiveBytes: Uint8Array;
  cssText: string;
  scopedCssText: string;
  resources: ReadonlyMap<string, ZhiyuResourcePackResource>;
  referencedResources: readonly string[];
}>;

export const ZHIYU_RESOURCE_PACK_LIMITS = Object.freeze({
  archiveBytes: 2 * 1024 * 1024,
  expandedBytes: 8 * 1024 * 1024,
  entryCount: 32,
  manifestBytes: 32 * 1024,
  styleBytes: 128 * 1024,
  resourceCount: 24,
  resourceBytes: 4 * 1024 * 1024,
});

export type ZhiyuResourcePackFailureCategory =
  | 'archive'
  | 'manifest'
  | 'resource'
  | 'style';

export class ZhiyuResourcePackError extends Error {
  readonly category: ZhiyuResourcePackFailureCategory;
  readonly source: string;
  readonly reason: string;
  readonly repair: string;

  constructor(input: {
    readonly category: ZhiyuResourcePackFailureCategory;
    readonly source: string;
    readonly reason: string;
    readonly repair: string;
  }) {
    super(`${input.source}: ${input.reason} ${input.repair}`);
    this.name = 'ZhiyuResourcePackError';
    this.category = input.category;
    this.source = input.source;
    this.reason = input.reason;
    this.repair = input.repair;
  }
}
