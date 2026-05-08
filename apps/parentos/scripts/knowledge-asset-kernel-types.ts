export type JsonObject = Record<string, unknown>;
export type KnowledgeAssetAuthorityClass =
  | 'reference_dataset'
  | 'curated_knowledge_asset'
  | 'design_asset';

export type KnowledgeAssetSectionKind = 'collection' | 'map' | 'singleton';
export type KnowledgeAssetOrdering = 'manifest' | 'idField-asc' | 'idField-desc' | 'key-asc';

export interface KnowledgeAssetRegistryEntry {
  assetId: string;
  path: string;
  storageModel?: 'directory_backed_asset';
  authorityClass: KnowledgeAssetAuthorityClass;
  ownerContract: string;
  assetContract?: string;
  generatedModule?: string;
  runtimeProjectionAdmission?: string;
}

export interface KnowledgeAssetSectionReference {
  fromSection: string;
  fromField: string;
  toAsset?: string;
  toSection: string;
  toField: string;
  ownerContract?: string;
}

export interface KnowledgeAssetSectionManifest {
  sectionId: string;
  kind: KnowledgeAssetSectionKind;
  files: string | string[] | Record<string, string>;
  idField?: string;
  ordering?: KnowledgeAssetOrdering;
  orphanPolicy?: 'fail_close';
  references?: KnowledgeAssetSectionReference[];
}

export interface KnowledgeAssetManifest {
  assetId: string;
  schemaVersion?: number;
  contentVersion?: string;
  schema?: string;
  authorityClass?: KnowledgeAssetAuthorityClass;
  ownerContract?: string;
  generatedModule?: string;
  runtimeProjectionAdmission?: string;
  review?: JsonObject;
  sources?: unknown[];
  primarySection?: string;
  sections?: KnowledgeAssetSectionManifest[];
}

export interface KnowledgeAssetLoadOptions {
  dataKnowledgeRoot: string;
  assetId: string;
  manifestPath?: string;
  registryEntry?: KnowledgeAssetRegistryEntry;
}

export interface AssembledKnowledgeAsset {
  assetId: string;
  manifestPath: string;
  manifest: KnowledgeAssetManifest;
  layout: 'directory_backed_asset';
  baseRoot: string;
  scanRoots: string[];
  sections: KnowledgeAssetSectionManifest[];
  data: Record<string, unknown>;
  sourceFiles: string[];
  schemaPath?: string;
  projectionFingerprint: string;
  registryEntry?: KnowledgeAssetRegistryEntry;
}

export interface KnowledgeAssetValidationResult {
  ok: boolean;
  errors: string[];
}
