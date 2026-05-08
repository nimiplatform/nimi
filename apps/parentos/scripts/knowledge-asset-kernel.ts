import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type {
  AssembledKnowledgeAsset,
  JsonObject,
  KnowledgeAssetLoadOptions,
  KnowledgeAssetManifest,
  KnowledgeAssetSectionManifest,
  KnowledgeAssetValidationResult,
} from './knowledge-asset-kernel-types.js';
export type {
  AssembledKnowledgeAsset,
  KnowledgeAssetAuthorityClass,
  KnowledgeAssetLoadOptions,
  KnowledgeAssetManifest,
  KnowledgeAssetOrdering,
  KnowledgeAssetRegistryEntry,
  KnowledgeAssetSectionKind,
  KnowledgeAssetSectionManifest,
  KnowledgeAssetSectionReference,
  KnowledgeAssetValidationResult,
} from './knowledge-asset-kernel-types.js';
export { assertNoDirectKnowledgeJsonReads } from './knowledge-asset-direct-read.js';

interface SchemaWithSectionSchemas extends JsonObject {
  'x-parentos-sectionSchemas'?: Record<string, unknown>;
}

const JSON_EXTENSIONS = new Set(['.json']);

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function assertInsideRoot(root: string, candidate: string, label: string) {
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    throw new Error(`${label} escaped root ${root}: ${candidate}`);
  }
}

function resolveRelativeFile(root: string, ref: string, label: string): string {
  if (ref.startsWith('/') || ref.split(/[\\/]/).includes('..')) {
    throw new Error(`${label} must stay inside its asset root: ${ref}`);
  }
  const resolved = resolve(root, ref);
  assertInsideRoot(root, resolved, label);
  return resolved;
}

function ensureStringArray(value: string | string[] | Record<string, string>, label: string): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(`${label} contains an empty file list`);
    }
    return value;
  }
  if (typeof value === 'string') {
    return [value];
  }
  const entries = Object.values(value);
  if (entries.length === 0) {
    throw new Error(`${label} contains an empty file map`);
  }
  return entries;
}

function inferManifestPath(options: KnowledgeAssetLoadOptions): string {
  if (options.manifestPath) {
    return resolve(options.manifestPath);
  }
  if (options.registryEntry?.path) {
    return resolve(options.registryEntry.path);
  }
  return resolve(options.dataKnowledgeRoot, 'assets', options.assetId, 'asset.json');
}

function normalizeSections(manifest: KnowledgeAssetManifest): KnowledgeAssetSectionManifest[] {
  const sections = manifest.sections ?? [];
  if (sections.length === 0) {
    throw new Error(`knowledge asset ${manifest.assetId} must declare sections`);
  }
  const seen = new Set<string>();
  for (const section of sections) {
    if (!section.sectionId) {
      throw new Error(`knowledge asset ${manifest.assetId} contains a section without sectionId`);
    }
    if (seen.has(section.sectionId)) {
      throw new Error(`knowledge asset ${manifest.assetId} contains duplicate sectionId ${section.sectionId}`);
    }
    seen.add(section.sectionId);
  }
  return sections;
}

function readSectionData(baseRoot: string, section: KnowledgeAssetSectionManifest): unknown {
  const refs = ensureStringArray(section.files, `section ${section.sectionId}`);
  const read = (ref: string) => readJsonFile(resolveRelativeFile(baseRoot, ref, `section ${section.sectionId}`));
  if (section.kind === 'collection') {
    return refs.map(read);
  }
  if (section.kind === 'map') {
    if (Array.isArray(section.files) || typeof section.files === 'string') {
      throw new Error(`section ${section.sectionId} kind=map requires a file map`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, ref] of Object.entries(section.files)) {
      out[key] = read(ref);
    }
    return out;
  }
  if (refs.length !== 1) {
    throw new Error(`section ${section.sectionId} kind=singleton requires exactly one file`);
  }
  const firstRef = refs[0];
  if (!firstRef) {
    throw new Error(`section ${section.sectionId} kind=singleton has no file ref`);
  }
  return read(firstRef);
}

function sectionSourceFiles(baseRoot: string, section: KnowledgeAssetSectionManifest): string[] {
  return ensureStringArray(section.files, `section ${section.sectionId}`).map((ref) =>
    resolveRelativeFile(baseRoot, ref, `section ${section.sectionId}`),
  );
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableNormalize(child)]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function computeFingerprintPayload(asset: Omit<AssembledKnowledgeAsset, 'projectionFingerprint'>): JsonObject {
  return {
    assetId: asset.assetId,
    layout: asset.layout,
    schemaVersion: asset.manifest.schemaVersion ?? null,
    contentVersion: asset.manifest.contentVersion ?? null,
    authorityClass: asset.manifest.authorityClass ?? asset.registryEntry?.authorityClass ?? null,
    ownerContract: asset.manifest.ownerContract ?? asset.registryEntry?.ownerContract ?? null,
    review: asset.manifest.review ?? null,
    sources: asset.manifest.sources ?? [],
    primarySection: asset.manifest.primarySection ?? null,
    sections: asset.sections.map((section) => ({
      sectionId: section.sectionId,
      kind: section.kind,
      idField: section.idField ?? null,
      ordering: section.ordering ?? 'manifest',
      files: section.files,
      references: section.references ?? [],
    })),
    data: asset.data,
  };
}

export function computeKnowledgeAssetFingerprint(asset: Omit<AssembledKnowledgeAsset, 'projectionFingerprint'>): string {
  return createHash('sha256')
    .update(stableStringify(computeFingerprintPayload(asset)))
    .digest('hex');
}

export function loadKnowledgeAsset(options: KnowledgeAssetLoadOptions): AssembledKnowledgeAsset {
  const manifestPath = inferManifestPath(options);
  const manifest = readJsonFile(manifestPath) as KnowledgeAssetManifest;
  if (manifest.assetId !== options.assetId) {
    throw new Error(`knowledge asset manifest ${manifestPath} declares assetId=${manifest.assetId}, expected ${options.assetId}`);
  }
  if (!manifestPath.endsWith(`${sep}asset.json`)) {
    throw new Error(`knowledge asset ${options.assetId} must load from directory-backed asset.json: ${manifestPath}`);
  }
  const layout = 'directory_backed_asset';
  const baseRoot = dirname(manifestPath);
  const scanRoots = [baseRoot];
  const sections = normalizeSections(manifest);
  const data: Record<string, unknown> = {};
  for (const section of sections) {
    data[section.sectionId] = readSectionData(baseRoot, section);
  }
  const sourceFiles = [
    manifestPath,
    ...(manifest.schema ? [resolveRelativeFile(baseRoot, manifest.schema, `schema for ${options.assetId}`)] : []),
    ...sections.flatMap((section) => sectionSourceFiles(baseRoot, section)),
  ];
  const withoutFingerprint: Omit<AssembledKnowledgeAsset, 'projectionFingerprint'> = {
    assetId: options.assetId,
    manifestPath,
    manifest,
    layout,
    baseRoot,
    scanRoots,
    sections,
    data,
    sourceFiles,
    schemaPath: manifest.schema ? resolveRelativeFile(baseRoot, manifest.schema, `schema for ${options.assetId}`) : undefined,
    registryEntry: options.registryEntry,
  };
  return {
    ...withoutFingerprint,
    projectionFingerprint: computeKnowledgeAssetFingerprint(withoutFingerprint),
  };
}

export function listKnowledgeAssetSourceFiles(asset: AssembledKnowledgeAsset): string[] {
  return [...new Set(asset.sourceFiles)].sort();
}

function pushIfMissing(errors: string[], condition: unknown, message: string) {
  if (!condition) {
    errors.push(message);
  }
}

function validateContractFields(asset: AssembledKnowledgeAsset, errors: string[]) {
  const manifest = asset.manifest;
  pushIfMissing(errors, Number.isInteger(manifest.schemaVersion) && (manifest.schemaVersion ?? 0) > 0, `${asset.assetId}: schemaVersion must be a positive integer`);
  pushIfMissing(errors, typeof manifest.contentVersion === 'string' && manifest.contentVersion.length > 0, `${asset.assetId}: contentVersion is required`);
  pushIfMissing(errors, typeof manifest.schema === 'string' && manifest.schema.length > 0, `${asset.assetId}: schema is required`);
  pushIfMissing(errors, typeof manifest.authorityClass === 'string', `${asset.assetId}: authorityClass is required`);
  pushIfMissing(errors, typeof manifest.ownerContract === 'string' && manifest.ownerContract.length > 0, `${asset.assetId}: ownerContract is required`);
  validateReviewMetadata(asset, errors);
  validateSourceAttribution(asset, errors);
  pushIfMissing(errors, typeof manifest.primarySection === 'string' && manifest.primarySection.length > 0, `${asset.assetId}: primarySection is required`);
  pushIfMissing(errors, Array.isArray(manifest.sections) && manifest.sections.length > 0, `${asset.assetId}: sections are required`);
  if (manifest.authorityClass === 'design_asset' && manifest.generatedModule && !manifest.runtimeProjectionAdmission) {
    errors.push(`${asset.assetId}: design_asset cannot declare generatedModule without runtimeProjectionAdmission`);
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateReviewMetadata(asset: AssembledKnowledgeAsset, errors: string[]) {
  const review = asset.manifest.review;
  if (!isRecord(review)) {
    errors.push(`${asset.assetId}: review metadata is required`);
    return;
  }
  const validStatuses = new Set(['reviewed', 'needs_review', 'rejected']);
  pushIfMissing(errors, validStatuses.has(String(review.status)), `${asset.assetId}: review.status must be reviewed, needs_review, or rejected`);
  pushIfMissing(errors, typeof review.owner === 'string' && review.owner.length > 0, `${asset.assetId}: review.owner is required`);
  pushIfMissing(
    errors,
    typeof review.reviewer === 'string' || review.reviewer === null,
    `${asset.assetId}: review.reviewer must be a string or null`,
  );
  pushIfMissing(
    errors,
    isIsoDate(review.lastReviewedAt) || review.lastReviewedAt === null,
    `${asset.assetId}: review.lastReviewedAt must be an ISO date or null`,
  );
  if (review.status === 'reviewed') {
    pushIfMissing(errors, typeof review.reviewer === 'string' && review.reviewer.length > 0, `${asset.assetId}: reviewed assets require review.reviewer`);
    pushIfMissing(errors, isIsoDate(review.lastReviewedAt), `${asset.assetId}: reviewed assets require review.lastReviewedAt`);
  }
}

function validateSourceAttribution(asset: AssembledKnowledgeAsset, errors: string[]) {
  const sources = asset.manifest.sources;
  if (asset.manifest.authorityClass === 'reference_dataset') {
    pushIfMissing(errors, Array.isArray(sources) && sources.length > 0, `${asset.assetId}: reference_dataset requires sources[]`);
  }
  if (sources === undefined) {
    return;
  }
  if (!Array.isArray(sources)) {
    errors.push(`${asset.assetId}: sources must be an array when present`);
    return;
  }
  const validLicenseClasses = new Set(['public_standard', 'open_reference', 'internal_curated', 'unknown_review_required']);
  const validSourceClasses = new Set(['clinical_reference', 'educational_reference', 'curated_parentos', 'design_reference']);
  const validReviewStatuses = new Set(['reviewed', 'needs_review', 'rejected']);
  for (const [index, source] of sources.entries()) {
    const label = `${asset.assetId}: sources[${index}]`;
    if (!isRecord(source)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    pushIfMissing(errors, typeof source.sourceId === 'string' && source.sourceId.length > 0, `${label}.sourceId is required`);
    pushIfMissing(errors, typeof source.citation === 'string' && source.citation.length > 0, `${label}.citation is required`);
    pushIfMissing(errors, typeof source.url === 'string' || source.url === null, `${label}.url must be a string or null`);
    pushIfMissing(errors, isIsoDate(source.retrievedAt), `${label}.retrievedAt must be an ISO date`);
    pushIfMissing(errors, validLicenseClasses.has(String(source.licenseClass)), `${label}.licenseClass is invalid`);
    pushIfMissing(errors, validSourceClasses.has(String(source.sourceClass)), `${label}.sourceClass is invalid`);
    pushIfMissing(errors, validReviewStatuses.has(String(source.reviewStatus)), `${label}.reviewStatus is invalid`);
    if (source.sourceClass === 'clinical_reference') {
      pushIfMissing(errors, source.reviewStatus === 'reviewed', `${label}: clinical_reference sources must be reviewed`);
    }
  }
}

function validateStableIds(asset: AssembledKnowledgeAsset, errors: string[]) {
  for (const section of asset.sections) {
    if (!section.idField) {
      continue;
    }
    const sectionData = asset.data[section.sectionId];
    const rows = Array.isArray(sectionData) ? sectionData : isRecord(sectionData) ? Object.values(sectionData) : [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!isRecord(row)) {
        errors.push(`${asset.assetId}.${section.sectionId}: idField ${section.idField} requires object rows`);
        continue;
      }
      const id = row[section.idField];
      if (typeof id !== 'string' || id.length === 0) {
        errors.push(`${asset.assetId}.${section.sectionId}: missing idField ${section.idField}`);
        continue;
      }
      if (seen.has(id)) {
        errors.push(`${asset.assetId}.${section.sectionId}: duplicate ${section.idField} ${id}`);
      }
      seen.add(id);
    }
  }
}

function compileAjv(schema: unknown) {
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}

function validateJsonSchema(asset: AssembledKnowledgeAsset, errors: string[]) {
  if (!asset.schemaPath) {
    return;
  }
  const schema = readJsonFile(asset.schemaPath) as SchemaWithSectionSchemas;
  const validateManifest = compileAjv(schema);
  if (!validateManifest(asset.manifest)) {
    errors.push(
      `${asset.assetId}: manifest schema failed: ${(validateManifest.errors ?? [])
        .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
        .join('; ')}`,
    );
  }
  const sectionSchemas = schema['x-parentos-sectionSchemas'] ?? {};
  for (const [sectionId, sectionSchema] of Object.entries(sectionSchemas)) {
    const validateSection = compileAjv(sectionSchema);
    if (!validateSection(asset.data[sectionId])) {
      errors.push(
        `${asset.assetId}.${sectionId}: section schema failed: ${(validateSection.errors ?? [])
          .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
          .join('; ')}`,
      );
    }
  }
}

export function validateKnowledgeAsset(
  asset: AssembledKnowledgeAsset,
  options: { requireContractManifest?: boolean } = {},
): KnowledgeAssetValidationResult {
  const errors: string[] = [];
  if (options.requireContractManifest) {
    validateContractFields(asset, errors);
  }
  validateStableIds(asset, errors);
  validateJsonSchema(asset, errors);
  return { ok: errors.length === 0, errors };
}

export function assertValidKnowledgeAsset(
  asset: AssembledKnowledgeAsset,
  options: { requireContractManifest?: boolean } = {},
) {
  const result = validateKnowledgeAsset(asset, options);
  if (!result.ok) {
    throw new Error(result.errors.join('\n'));
  }
}

export function assertKnowledgeAssetFreshness(asset: AssembledKnowledgeAsset, expectedFingerprint: string) {
  if (asset.projectionFingerprint !== expectedFingerprint) {
    throw new Error(
      `${asset.assetId}: projection fingerprint mismatch, expected ${expectedFingerprint}, got ${asset.projectionFingerprint}`,
    );
  }
}

export function assertProjectionFingerprint(asset: AssembledKnowledgeAsset, projectedFingerprint: string) {
  assertKnowledgeAssetFreshness(asset, projectedFingerprint);
}

function listJsonFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsonFiles(path));
      continue;
    }
    if (entry.isFile() && JSON_EXTENSIONS.has(extname(entry.name))) {
      out.push(path);
    }
  }
  return out;
}

export function assertNoOrphanShards(asset: AssembledKnowledgeAsset) {
  const admitted = new Set(listKnowledgeAssetSourceFiles(asset));
  const orphans = asset.scanRoots.flatMap(listJsonFiles).filter((file) => !admitted.has(file));
  if (orphans.length > 0) {
    throw new Error(`${asset.assetId}: orphan knowledge asset files: ${orphans.sort().join(', ')}`);
  }
}

function getSectionData(asset: AssembledKnowledgeAsset, sectionId: string) {
  if (sectionId === 'sources') {
    return asset.manifest.sources ?? [];
  }
  if (!(sectionId in asset.data)) {
    throw new Error(`${asset.assetId}: reference declares unknown section ${sectionId}`);
  }
  return asset.data[sectionId];
}

function valuesFromField(value: unknown, field: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => valuesFromField(entry, field));
  }
  if (!isRecord(value)) {
    return [];
  }
  const direct = value[field];
  if (Array.isArray(direct)) {
    return direct.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof direct === 'string' ? [direct] : [];
}

function assertConcreteOwnerContract(asset: AssembledKnowledgeAsset, ref: KnowledgeAssetSectionReference) {
  if (ref.toAsset && ref.toAsset !== asset.assetId && !ref.ownerContract) {
    throw new Error(
      `${asset.assetId}: cross-asset reference ${ref.fromSection}.${ref.fromField} -> ${ref.toAsset}.${ref.toSection}.${ref.toField} requires ownerContract`,
    );
  }
}

export function assertCrossReferenceIntegrity(
  asset: AssembledKnowledgeAsset,
  assetsById: Map<string, AssembledKnowledgeAsset> = new Map([[asset.assetId, asset]]),
) {
  for (const section of asset.sections) {
    for (const ref of section.references ?? []) {
      assertConcreteOwnerContract(asset, ref);
      const targetAssetId = ref.toAsset ?? asset.assetId;
      const targetAsset = assetsById.get(targetAssetId);
      if (!targetAsset) {
        throw new Error(`${asset.assetId}: reference target asset ${targetAssetId} is not loaded`);
      }
      const sourceValues = valuesFromField(getSectionData(asset, ref.fromSection), ref.fromField);
      const targetValues = new Set(valuesFromField(getSectionData(targetAsset, ref.toSection), ref.toField));
      for (const value of sourceValues) {
        if (!targetValues.has(value)) {
          throw new Error(
            `${asset.assetId}: ${ref.fromSection}.${ref.fromField} references missing ${targetAssetId}.${ref.toSection}.${ref.toField} value ${value}`,
          );
        }
      }
    }
  }
}
