#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SPEC_SCAN_PATTERN = /\b(model_id|target_model_id|connector_id|LOCAL_MODEL|targetId|profileId|localModelId|goRuntimeLocalModelId)\b/g;
const VALID_CLASSIFICATIONS = new Set([
  'must_migrate',
  'allowed_non_identity_fact',
  'retired_history',
  'unrelated_domain',
]);
const TEXT_EXTENSIONS = new Set([
  '.go',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.rs',
  '.proto',
  '.md',
  '.yaml',
  '.yml',
  '.json',
]);
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.tmp',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

const violations = [];

function fail(message) {
  violations.push(message);
}

function toRepoRel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

async function read(relPath) {
  return fs.readFile(path.join(repoRoot, relPath), 'utf8');
}

async function collectFiles(rootRel) {
  const root = path.join(repoRoot, rootRel);
  const files = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'generated' || entry.name === 'gen') continue;
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) continue;
      files.push(fullPath);
    }
  }
  await visit(root);
  return files;
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((part) => part.trim());
}

function stripBackticks(value) {
  return value.replace(/^`|`$/g, '').trim();
}

function parseClassificationInventory(contract) {
  const rows = new Map();
  for (const line of contract.split(/\r?\n/u)) {
    if (!line.startsWith('| `')) continue;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 4) continue;
    const surface = stripBackticks(cells[0]);
    const matchedTerms = stripBackticks(cells[1]);
    const classification = stripBackticks(cells[2]);
    const action = cells.slice(3).join(' | ').trim();
    if (!surface) continue;
    rows.set(surface, {
      surface,
      matchedTerms,
      classification,
      action,
    });
  }
  return rows;
}

async function collectSpecScanHits() {
  const hits = new Map();
  const files = await collectFiles('.nimi/spec');
  for (const file of files) {
    const rel = toRepoRel(file);
    const source = await fs.readFile(file, 'utf8');
    const terms = new Set();
    let match = SPEC_SCAN_PATTERN.exec(source);
    while (match) {
      terms.add(match[1]);
      match = SPEC_SCAN_PATTERN.exec(source);
    }
    if (terms.size > 0) {
      hits.set(rel, [...terms].sort());
    }
  }
  return hits;
}

async function checkClassificationInventory() {
  const contractRel = '.nimi/spec/runtime/kernel/runtime-target-identity-contract.md';
  const contract = await read(contractRel);
  const inventory = parseClassificationInventory(contract);
  const hits = await collectSpecScanHits();

  for (const [surface, terms] of hits.entries()) {
    const row = inventory.get(surface);
    if (!row) {
      fail(`${surface}: missing K-RTARGET-011 classification row for scan terms ${terms.join(', ')}`);
      continue;
    }
    if (!VALID_CLASSIFICATIONS.has(row.classification)) {
      fail(`${surface}: invalid K-RTARGET-011 classification ${row.classification}`);
    }
    for (const term of terms) {
      if (!row.matchedTerms.includes(term)) {
        fail(`${surface}: classification row missing scan term ${term}`);
      }
    }
    if (row.classification === 'allowed_non_identity_fact' && !/\b(G\d+|guard|reject|parses|require|only)\b/i.test(row.action)) {
      fail(`${surface}: allowed_non_identity_fact row must name its guard`);
    }
    if (row.classification === 'must_migrate' && !/\b(Patch|Retire|route|v2|resolved|remote catalog)\b/i.test(row.action)) {
      fail(`${surface}: must_migrate row must name its patch action`);
    }
  }

  for (const surface of inventory.keys()) {
    if (!hits.has(surface)) {
      fail(`${surface}: K-RTARGET-011 classification row has no current spec scan hit`);
    }
  }
}

async function checkSpecDoesNotAdmitRetiredCloudBinding() {
  const files = await collectFiles('.nimi/spec');
  const admissionPattern = /(?:\b(?:admitted|admission|required|requires?|must)\b|至少|必须).*connector_id\s*\+\s*model_id/iu;
  const retirementPattern = /(?:\b(?:retired|forbidden|reject|rejects|not admitted|must not|classification|scan)\b|禁止|不得|不构成)/iu;
  for (const file of files) {
    const rel = toRepoRel(file);
    const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/u);
    lines.forEach((line, index) => {
      const normalized = line.trim().replace(/\s+/gu, ' ');
      if (!normalized) return;
      if (!admissionPattern.test(normalized)) return;
      if (retirementPattern.test(normalized)) return;
      fail(`${rel}:${index + 1}: active spec text appears to admit retired connector_id + model_id cloud binding`);
    });
  }
}

function extractMessageBody(protoSource, messageName) {
  const start = protoSource.indexOf(`message ${messageName}`);
  if (start < 0) {
    return '';
  }
  const open = protoSource.indexOf('{', start);
  if (open < 0) {
    return '';
  }
  let depth = 0;
  for (let i = open; i < protoSource.length; i += 1) {
    const ch = protoSource[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return protoSource.slice(open + 1, i);
      }
    }
  }
  return '';
}

async function checkProtoHardCuts() {
  const connector = await read('proto/runtime/v1/connector.proto');
  if (!/reserved\s+1\s*;\s*reserved\s+"CONNECTOR_KIND_LOCAL_MODEL"/su.test(connector)) {
    fail('connector.proto must reserve CONNECTOR_KIND_LOCAL_MODEL enum value 1');
  }
  if (/CONNECTOR_KIND_LOCAL_MODEL\s*=/u.test(connector)) {
    fail('connector.proto must not re-declare CONNECTOR_KIND_LOCAL_MODEL');
  }
  if (/\benum\s+LocalConnectorCategory\b/u.test(connector)) {
    fail('connector.proto must not keep LocalConnectorCategory enum active');
  }
  if (!/reserved\s+9\s*;\s*reserved\s+"local_category"/su.test(connector)) {
    fail('connector.proto Connector must reserve local_category field 9');
  }

  const descriptor = extractMessageBody(connector, 'ConnectorModelDescriptor');
  if (!/remote_model_catalog_id\s*=\s*5\b/u.test(descriptor)
    || !/provider_model_id\s*=\s*6\b/u.test(descriptor)
    || !/string\s+model_id\s*=\s*1\s*\[deprecated\s*=\s*true\]/u.test(descriptor)) {
    fail('ConnectorModelDescriptor must keep model_id deprecated and expose remote_model_catalog_id/provider_model_id');
  }

  const memory = await read('proto/runtime/v1/memory.proto');
  const cloud = extractMessageBody(memory, 'MemoryEmbeddingCloudBindingRef');
  const local = extractMessageBody(memory, 'MemoryEmbeddingLocalBindingRef');
  if (!/reserved\s+2\s*;\s*reserved\s+"model_id"/su.test(cloud)) {
    fail('MemoryEmbeddingCloudBindingRef must reserve old model_id field 2');
  }
  if (/\bmodel_id\s*=\s*2\b/u.test(cloud)) {
    fail('MemoryEmbeddingCloudBindingRef must not re-use old model_id field 2');
  }
  for (const field of ['remote_model_catalog_id', 'provider_model_id', 'provider']) {
    if (!new RegExp(`\\b${field}\\s*=\\s*\\d+\\b`, 'u').test(cloud)) {
      fail(`MemoryEmbeddingCloudBindingRef missing ${field}`);
    }
  }
  if (!/reserved\s+1\s*;\s*reserved\s+"target_id"/su.test(local)) {
    fail('MemoryEmbeddingLocalBindingRef must reserve old target_id field 1');
  }
  if (/\btarget_id\s*=\s*1\b/u.test(local)) {
    fail('MemoryEmbeddingLocalBindingRef must not re-use old target_id field 1');
  }
  if (!/\boneof\s+ref\b/u.test(local) || !/\bprofile_binding_id\s*=\s*2\b/u.test(local) || !/\breadiness_ref\s*=\s*3\b/u.test(local)) {
    fail('MemoryEmbeddingLocalBindingRef must use typed profile_binding_id/readiness_ref oneof');
  }

  const identity = await read('proto/runtime/v1/runtime_target_identity.proto');
  if (!/\bmessage\s+RuntimeDurableTargetRef\b/u.test(identity)
    || !/\bmessage\s+RuntimeResolvedExecutionBinding\b/u.test(identity)
    || !/\broute_metadata_ref\s*=\s*5\b/u.test(identity)) {
    fail('runtime_target_identity.proto must define durable refs and resolved binding with route_metadata_ref');
  }

  const ai = await read('proto/runtime/v1/ai.proto');
  if (!/\bRuntimeDurableTargetRef\s+target_ref\s*=\s*8\b/u.test(ai)) {
    fail('ai.proto ExecuteScenarioHead must expose RuntimeDurableTargetRef target_ref = 8');
  }
  if (!/\bRuntimeResolvedExecutionBinding\s+resolved_execution_binding\s*=\s*8\b/u.test(ai)
    || !/\bRuntimeResolvedExecutionBinding\s+resolved_execution_binding\s*=\s*3\b/u.test(ai)) {
    fail('ai.proto execute/stream responses must expose RuntimeResolvedExecutionBinding');
  }
}

async function checkSourceHardCuts() {
  const sourceRoots = [
    'runtime/internal',
    'sdks/typescript/core/ai',
    'sdks/typescript/runtime',
    'apps/desktop/src',
    'apps/tester/src',
    'kit',
  ];
  const forbiddenSymbolPatterns = [
    /\bruntimev1\.ConnectorKind_CONNECTOR_KIND_LOCAL_MODEL\b/u,
    /\bConnectorKind_CONNECTOR_KIND_LOCAL_MODEL\b/u,
    /\bruntimev1\.LocalConnectorCategory\b/u,
    /\bLocalConnectorCategory_\w+\b/u,
    /\bGetLocalCategory\s*\(/u,
  ];
  for (const root of sourceRoots) {
    const files = await collectFiles(root);
    for (const file of files) {
      const rel = toRepoRel(file);
      const source = await fs.readFile(file, 'utf8');
      for (const pattern of forbiddenSymbolPatterns) {
        if (pattern.test(source)) {
          fail(`${rel}: references retired local connector generated symbol ${pattern}`);
        }
      }
    }
  }

  const aiConfigTypes = await read('sdks/typescript/core/ai/config-types.ts');
  const targetRefMatch = aiConfigTypes.match(/export type NimiAIConfigTargetRef =([\s\S]*?);\n\nexport interface NimiAIProfileCapabilityIntent/u);
  if (!targetRefMatch) {
    fail('config-types.ts: failed to locate NimiAIConfigTargetRef');
  } else {
    const targetRef = targetRefMatch[1];
    if (/\btargetId\b|\bprofileId\b|\blocalModelId\b|\bgoRuntimeLocalModelId\b/u.test(targetRef)) {
      fail('NimiAIConfigTargetRef must not contain retired local target identity fields');
    }
    if (!/\bremoteModelCatalogId:\s*string\b/u.test(targetRef) || !/\bproviderModelId:\s*string\b/u.test(targetRef)) {
      fail('NimiAIConfigTargetRef cloud ref must require remoteModelCatalogId and providerModelId');
    }
  }

  const routeOptions = await read('sdks/typescript/runtime/route-options.ts');
  const snapshotMatch = routeOptions.match(/export interface NimiRuntimeRouteOptionsSnapshot \{([\s\S]*?)\n\}/u);
  if (!snapshotMatch) {
    fail('route-options.ts: failed to locate NimiRuntimeRouteOptionsSnapshot');
  } else if (/\bselected\b|readonly\s+local\b|readonly\s+connectors\b|selectedBinding/u.test(snapshotMatch[1])) {
    fail('NimiRuntimeRouteOptionsSnapshot must expose selectedTargetRef + inventory only');
  }
  const targetRefMatchRoute = routeOptions.match(/export type NimiRuntimeRouteTargetRef =([\s\S]*?);\n\nexport type NimiRuntimeRouteLocalTargetRef/u);
  if (!targetRefMatchRoute) {
    fail('route-options.ts: failed to locate NimiRuntimeRouteTargetRef');
  }
  if (!/\bselectedBinding['"]?\s+in\s+record/u.test(routeOptions)) {
    fail('route-options.ts must explicitly reject selectedBinding input');
  }

  const memoryTypes = await read('sdks/typescript/runtime/memory-embedding-types.ts');
  const memoryCloud = memoryTypes.match(/export interface NimiMemoryEmbeddingCloudConfigBindingRef \{([\s\S]*?)\n\}/u);
  if (!memoryCloud) {
    fail('memory-embedding-types.ts: failed to locate cloud binding ref');
  } else if (/\bmodelId\b/u.test(memoryCloud[1]) || !/\bremoteModelCatalogId:\s*string\b/u.test(memoryCloud[1])) {
    fail('NimiMemoryEmbeddingCloudConfigBindingRef must require remoteModelCatalogId and not expose modelId');
  }
}

async function main() {
  await checkClassificationInventory();
  await checkSpecDoesNotAdmitRetiredCloudBinding();
  await checkProtoHardCuts();
  await checkSourceHardCuts();

  if (violations.length > 0) {
    process.stderr.write('Runtime target identity v2 violations found:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Runtime target identity v2 hard-cut check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-runtime-target-identity-v2 failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
