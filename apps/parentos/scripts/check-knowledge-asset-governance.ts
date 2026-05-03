import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  assertCrossReferenceIntegrity,
  assertNoDirectKnowledgeJsonReads,
  assertNoOrphanShards,
  assertProjectionFingerprint,
  assertValidKnowledgeAsset,
  loadKnowledgeAsset,
} from './knowledge-asset-kernel.js';
import { KNOWLEDGE_ASSET_PROJECTION_FINGERPRINTS } from '../src/shell/renderer/knowledge-base/gen/knowledge-asset-fingerprints.gen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(ROOT, '../..');
const DATA_KNOWLEDGE = resolve(ROOT, 'data/knowledge');
const REGISTRY = resolve(ROOT, 'spec/kernel/tables/reference-data-assets.yaml');
const ASSET_IDS = [
  'growth-standards',
  'milestone-catalog',
  'sensitive-periods',
  'observation-framework',
  'ability-model',
] as const;

interface ReferenceAssetRow {
  assetId: string;
  path: string;
  storageModel: string;
  format: string;
  authorityClass: string;
  generatedModule?: string;
  runtimeProjectionAdmission?: string;
}

function readRegistry(): ReferenceAssetRow[] {
  const data = parseYaml(readFileSync(REGISTRY, 'utf-8')) as { assets?: ReferenceAssetRow[] };
  return data.assets ?? [];
}

function collectError(errors: string[], label: string, operation: () => void) {
  try {
    operation();
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expectedManifestPath(assetId: string) {
  return `apps/parentos/data/knowledge/assets/${assetId}/asset.json`;
}

function assertAbsent(path: string, label: string) {
  if (existsSync(path)) {
    const kind = lstatSync(path).isDirectory() ? 'directory' : 'file';
    throw new Error(`${label} still exists as ${kind}: ${path}`);
  }
}

export function collectKnowledgeAssetGovernanceErrors(): string[] {
  const errors: string[] = [];
  const rows = readRegistry();
  const rowsById = new Map(rows.map((row) => [row.assetId, row]));

  for (const assetId of ASSET_IDS) {
    collectError(errors, `${assetId} old flat file`, () => {
      assertAbsent(resolve(DATA_KNOWLEDGE, `${assetId}.json`), 'old flat knowledge asset file');
    });
    collectError(errors, `${assetId} old sibling shard directory`, () => {
      assertAbsent(resolve(DATA_KNOWLEDGE, assetId), 'old sibling knowledge asset directory');
    });

    const row = rowsById.get(assetId);
    if (!row) {
      errors.push(`${assetId}: missing reference-data-assets.yaml row`);
      continue;
    }

    if (row.path !== expectedManifestPath(assetId)) {
      errors.push(`${assetId}: registry path must be ${expectedManifestPath(assetId)}`);
    }
    if (row.storageModel !== 'directory_backed_asset') {
      errors.push(`${assetId}: registry storageModel must be directory_backed_asset`);
    }
    if (row.format !== 'json') {
      errors.push(`${assetId}: registry format must be json`);
    }
    if (row.authorityClass === 'design_asset' && row.generatedModule && !row.runtimeProjectionAdmission) {
      errors.push(`${assetId}: design_asset registry row cannot declare generatedModule without runtimeProjectionAdmission`);
    }

    const manifestPath = resolve(REPO_ROOT, row.path);
    collectError(errors, `${assetId} asset kernel governance`, () => {
      const asset = loadKnowledgeAsset({
        dataKnowledgeRoot: DATA_KNOWLEDGE,
        assetId,
        manifestPath,
        registryEntry: row,
      });
      assertValidKnowledgeAsset(asset, { requireContractManifest: true });
      assertNoOrphanShards(asset);
      assertCrossReferenceIntegrity(asset);
      const fingerprint = KNOWLEDGE_ASSET_PROJECTION_FINGERPRINTS[assetId];
      if (!fingerprint) {
        throw new Error('missing generated projection fingerprint');
      }
      if (fingerprint.schemaVersion !== asset.manifest.schemaVersion) {
        throw new Error(`schemaVersion projection mismatch, expected ${asset.manifest.schemaVersion}, got ${fingerprint.schemaVersion}`);
      }
      if (fingerprint.contentVersion !== asset.manifest.contentVersion) {
        throw new Error(`contentVersion projection mismatch, expected ${asset.manifest.contentVersion}, got ${fingerprint.contentVersion}`);
      }
      assertProjectionFingerprint(asset, fingerprint.projectionFingerprint);
    });
  }

  collectError(errors, 'direct old knowledge JSON read scan', () => {
    assertNoDirectKnowledgeJsonReads({
      rootDir: ROOT,
      assetIds: [...ASSET_IDS],
      allowedFiles: [resolve(ROOT, 'scripts/knowledge-asset-kernel.test.ts')],
    });
  });

  return errors;
}

export function runKnowledgeAssetGovernanceCheck() {
  const errors = collectKnowledgeAssetGovernanceErrors();
  if (errors.length === 0) {
    console.log('Knowledge asset governance check passed.');
    return;
  }
  for (const error of errors) {
    console.error(`FAIL: ${error}`);
  }
  throw new Error(`${errors.length} knowledge asset governance violation(s) found`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKnowledgeAssetGovernanceCheck();
}
