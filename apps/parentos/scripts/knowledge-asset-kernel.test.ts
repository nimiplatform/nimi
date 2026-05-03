import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCrossReferenceIntegrity,
  assertKnowledgeAssetFreshness,
  assertNoDirectKnowledgeJsonReads,
  assertNoOrphanShards,
  assertProjectionFingerprint,
  listKnowledgeAssetSourceFiles,
  loadKnowledgeAsset,
  validateKnowledgeAsset,
} from './knowledge-asset-kernel.js';

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function createAssetFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'parentos-asset-kernel-'));
  const dataRoot = resolve(root, 'data/knowledge');
  const assetRoot = resolve(dataRoot, 'assets/demo-asset');
  mkdirSync(resolve(assetRoot, 'items'), { recursive: true });
  mkdirSync(resolve(assetRoot, 'links'), { recursive: true });
  writeJson(resolve(assetRoot, 'items/a.json'), { id: 'item-a', label: 'A' });
  writeJson(resolve(assetRoot, 'links/link.json'), { targetId: 'item-a' });
  writeJson(resolve(assetRoot, 'schema.json'), {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: [
      'assetId',
      'schemaVersion',
      'contentVersion',
      'schema',
      'authorityClass',
      'ownerContract',
      'review',
      'primarySection',
      'sections',
    ],
    properties: {
      assetId: { const: 'demo-asset' },
      schemaVersion: { type: 'integer', minimum: 1 },
      contentVersion: { type: 'string', minLength: 1 },
      schema: { const: 'schema.json' },
      authorityClass: { enum: ['curated_knowledge_asset', 'reference_dataset', 'design_asset'] },
      ownerContract: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      generatedModule: { type: 'string' },
      runtimeProjectionAdmission: { type: 'string' },
      review: {
        type: 'object',
        required: ['status', 'owner', 'reviewer', 'lastReviewedAt'],
        properties: {
          status: { enum: ['reviewed', 'needs_review', 'rejected'] },
          owner: { type: 'string', minLength: 1 },
          reviewer: { type: ['string', 'null'] },
          lastReviewedAt: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
        additionalProperties: false,
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'sourceId',
            'citation',
            'url',
            'retrievedAt',
            'licenseClass',
            'sourceClass',
            'reviewStatus',
          ],
          properties: {
            sourceId: { type: 'string', minLength: 1 },
            citation: { type: 'string', minLength: 1 },
            url: { type: ['string', 'null'] },
            retrievedAt: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            licenseClass: {
              enum: ['public_standard', 'open_reference', 'internal_curated', 'unknown_review_required'],
            },
            sourceClass: {
              enum: ['clinical_reference', 'educational_reference', 'curated_parentos', 'design_reference'],
            },
            reviewStatus: { enum: ['reviewed', 'needs_review', 'rejected'] },
          },
          additionalProperties: false,
        },
      },
      primarySection: { type: 'string' },
      sections: { type: 'array', minItems: 1 },
    },
    additionalProperties: false,
    'x-parentos-sectionSchemas': {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
  });
  writeJson(resolve(assetRoot, 'asset.json'), {
    assetId: 'demo-asset',
    schemaVersion: 1,
    contentVersion: '2026-05-03.1',
    schema: 'schema.json',
    authorityClass: 'curated_knowledge_asset',
    ownerContract: 'demo-contract.md#PO-DEMO-001',
    review: {
      status: 'reviewed',
      owner: 'parentos',
      reviewer: 'test',
      lastReviewedAt: '2026-05-03',
    },
    primarySection: 'items',
    sections: [
      {
        sectionId: 'items',
        kind: 'collection',
        files: ['items/a.json'],
        idField: 'id',
        ordering: 'manifest',
        orphanPolicy: 'fail_close',
      },
      {
        sectionId: 'links',
        kind: 'collection',
        files: ['links/link.json'],
        ordering: 'manifest',
        orphanPolicy: 'fail_close',
        references: [
          {
            fromSection: 'links',
            fromField: 'targetId',
            toSection: 'items',
            toField: 'id',
          },
        ],
      },
    ],
  });
  return { root, dataRoot, assetRoot, manifestPath: resolve(assetRoot, 'asset.json') };
}

describe('knowledge-asset-kernel', () => {
  it('loads and validates a directory-backed asset deterministically', () => {
    const fixture = createAssetFixture();
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
      manifestPath: fixture.manifestPath,
    });

    expect(asset.layout).toBe('directory_backed_asset');
    expect(validateKnowledgeAsset(asset, { requireContractManifest: true })).toEqual({
      ok: true,
      errors: [],
    });
    expect(listKnowledgeAssetSourceFiles(asset)).toEqual([
      resolve(fixture.assetRoot, 'asset.json'),
      resolve(fixture.assetRoot, 'items/a.json'),
      resolve(fixture.assetRoot, 'links/link.json'),
      resolve(fixture.assetRoot, 'schema.json'),
    ]);
    expect(() => assertNoOrphanShards(asset)).not.toThrow();
    expect(() => assertCrossReferenceIntegrity(asset)).not.toThrow();
    expect(() => assertProjectionFingerprint(asset, asset.projectionFingerprint)).not.toThrow();
  });

  it('infers directory-backed manifest paths by default', () => {
    const fixture = createAssetFixture();
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
    });

    expect(asset.manifestPath).toBe(fixture.manifestPath);
  });

  it('fails closed on stale projection fingerprints', () => {
    const fixture = createAssetFixture();
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
      manifestPath: fixture.manifestPath,
    });

    expect(() => assertKnowledgeAssetFreshness(asset, 'not-the-current-fingerprint')).toThrow(
      /projection fingerprint mismatch/,
    );
  });

  it('fails closed on schema violations', () => {
    const fixture = createAssetFixture();
    writeJson(resolve(fixture.assetRoot, 'items/a.json'), { label: 'A' });
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
      manifestPath: fixture.manifestPath,
    });

    expect(validateKnowledgeAsset(asset, { requireContractManifest: true }).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('section schema failed')]),
    );
  });

  it('fails closed on unknown manifest fields', () => {
    const fixture = createAssetFixture();
    writeJson(resolve(fixture.assetRoot, 'asset.json'), {
      assetId: 'demo-asset',
      schemaVersion: 1,
      contentVersion: '2026-05-03.1',
      schema: 'schema.json',
      authorityClass: 'curated_knowledge_asset',
      ownerContract: 'demo-contract.md#PO-DEMO-001',
      review: {
        status: 'reviewed',
        owner: 'parentos',
        reviewer: 'test',
        lastReviewedAt: '2026-05-03',
      },
      primarySection: 'items',
      sections: [
        {
          sectionId: 'items',
          kind: 'collection',
          files: ['items/a.json'],
          idField: 'id',
        },
      ],
      unexpectedAuthority: true,
    });
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
      manifestPath: fixture.manifestPath,
    });

    expect(validateKnowledgeAsset(asset, { requireContractManifest: true }).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('manifest schema failed')]),
    );
  });

  it('fails closed on malformed reference source attribution', () => {
    const fixture = createAssetFixture();
    writeJson(resolve(fixture.assetRoot, 'asset.json'), {
      assetId: 'demo-asset',
      schemaVersion: 1,
      contentVersion: '2026-05-03.1',
      schema: 'schema.json',
      authorityClass: 'reference_dataset',
      ownerContract: 'demo-contract.md#PO-DEMO-001',
      review: {
        status: 'reviewed',
        owner: 'parentos',
        reviewer: 'test',
        lastReviewedAt: '2026-05-03',
      },
      sources: [
        {
          sourceId: 'clinical-source',
          citation: 'Clinical source',
          url: null,
          retrievedAt: '2026-05-03',
          licenseClass: 'public_standard',
          sourceClass: 'clinical_reference',
          reviewStatus: 'needs_review',
        },
      ],
      primarySection: 'items',
      sections: [
        {
          sectionId: 'items',
          kind: 'collection',
          files: ['items/a.json'],
          idField: 'id',
        },
      ],
    });
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
      manifestPath: fixture.manifestPath,
    });

    expect(validateKnowledgeAsset(asset, { requireContractManifest: true }).errors).toEqual(
      expect.arrayContaining(['demo-asset: sources[0]: clinical_reference sources must be reviewed']),
    );
  });

  it('rejects escaped shard paths before reading them', () => {
    const fixture = createAssetFixture();
    writeJson(resolve(fixture.assetRoot, 'asset.json'), {
      assetId: 'demo-asset',
      sections: [
        {
          sectionId: 'items',
          kind: 'collection',
          files: ['../escaped.json'],
        },
      ],
    });

    expect(() =>
      loadKnowledgeAsset({
        dataKnowledgeRoot: fixture.dataRoot,
        assetId: 'demo-asset',
        manifestPath: fixture.manifestPath,
      }),
    ).toThrow(/must stay inside its asset root/);
  });

  it('fails closed on orphan shard files', () => {
    const fixture = createAssetFixture();
    writeJson(resolve(fixture.assetRoot, 'items/orphan.json'), { id: 'orphan' });
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
      manifestPath: fixture.manifestPath,
    });

    expect(() => assertNoOrphanShards(asset)).toThrow(/orphan knowledge asset files/);
  });

  it('fails closed on broken cross-section references', () => {
    const fixture = createAssetFixture();
    writeJson(resolve(fixture.assetRoot, 'links/link.json'), { targetId: 'missing-item' });
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
      manifestPath: fixture.manifestPath,
    });

    expect(() => assertCrossReferenceIntegrity(asset)).toThrow(/references missing/);
  });

  it('rejects design_asset runtime exposure without admission', () => {
    const fixture = createAssetFixture();
    writeJson(resolve(fixture.assetRoot, 'asset.json'), {
      assetId: 'demo-asset',
      schemaVersion: 1,
      contentVersion: '2026-05-03.1',
      schema: 'schema.json',
      authorityClass: 'design_asset',
      ownerContract: 'demo-contract.md#PO-DEMO-001',
      generatedModule: 'demo.gen.ts',
      review: { status: 'reviewed' },
      primarySection: 'items',
      sections: [
        {
          sectionId: 'items',
          kind: 'collection',
          files: ['items/a.json'],
          idField: 'id',
        },
      ],
    });
    const asset = loadKnowledgeAsset({
      dataKnowledgeRoot: fixture.dataRoot,
      assetId: 'demo-asset',
      manifestPath: fixture.manifestPath,
    });

    expect(validateKnowledgeAsset(asset, { requireContractManifest: true }).errors).toEqual(
      expect.arrayContaining([
        'demo-asset: design_asset cannot declare generatedModule without runtimeProjectionAdmission',
      ]),
    );
  });

  it('detects direct knowledge JSON reads outside allowed files', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'parentos-direct-read-'));
    mkdirSync(resolve(root, 'src-tauri/src/sqlite'), { recursive: true });
    const unsafeFile = resolve(root, 'src-tauri/src/sqlite/mod.rs');
    writeFileSync(
      unsafeFile,
      'const DATA: &str = include_str!("../../../../data/knowledge/growth-standards.json");\n',
      'utf-8',
    );

    expect(() =>
      assertNoDirectKnowledgeJsonReads({
        rootDir: root,
        assetIds: ['growth-standards'],
      }),
    ).toThrow(/direct knowledge JSON reads detected/);
    expect(() =>
      assertNoDirectKnowledgeJsonReads({
        rootDir: root,
        assetIds: ['growth-standards'],
        allowedFiles: [unsafeFile],
      }),
    ).not.toThrow();
  });
});
