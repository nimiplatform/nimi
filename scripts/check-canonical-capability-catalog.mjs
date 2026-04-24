#!/usr/bin/env node
// Drift gate for the spec-resident canonical capability catalog.
// Predicates (P-CAPCAT-001..003):
//   1. field legality: every active row has legal capabilityId, section, editorKind,
//      sourceRef, i18nKeys, runtimeEvidenceClass; every deferred entry has reason +
//      source_rule.
//   2. consistency: each active row's sourceRef resolves via the table-specific
//      resolver against runtime kernel tables.
//   3. completeness: the union of capability tokens admitted by
//      provider-capabilities.yaml and local-adapter-routing.yaml equals the union of
//      active rows' sourceRef.capability values and deferred entries' capability
//      values (constrained to each row's declared table).
//   4. codegen idempotency: re-rendering the TS module from the YAML matches the
//      committed generated file byte-for-byte.
// Fails closed on any violation.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  validateCanonicalCapabilityCatalog,
  flattenProviderCapabilityTokens,
  flattenLocalAdapterRoutingTokens,
  renderCanonicalCapabilityCatalogModule,
} from './lib/canonical-capability-catalog-codegen.mjs';

const cwd = process.cwd();
const catalogRel = '.nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml';
const providerCapsRel = '.nimi/spec/runtime/kernel/tables/provider-capabilities.yaml';
const localAdapterRel = '.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml';
const generatedRel = 'kit/core/src/runtime-capabilities/generated/canonical-capability-catalog.ts';

const violations = [];

function fail(message) {
  violations.push(message);
}

function readYaml(rel) {
  return YAML.parse(fs.readFileSync(path.join(cwd, rel), 'utf8'));
}

const catalogDoc = readYaml(catalogRel);
const providerCapsDoc = readYaml(providerCapsRel);
const localAdapterDoc = readYaml(localAdapterRel);

// ---- Predicate 1: field legality ----
const { capabilities, deferred, errors } = validateCanonicalCapabilityCatalog(catalogDoc);
for (const error of errors) {
  fail(`${catalogRel}: ${error}`);
}

// ---- Build runtime token sets per table ----
const providerTokens = flattenProviderCapabilityTokens(providerCapsDoc);
const localAdapterTokens = flattenLocalAdapterRoutingTokens(localAdapterDoc);

function resolverTokensFor(table) {
  if (table === 'provider-capabilities') return providerTokens;
  if (table === 'local-adapter-routing') return localAdapterTokens;
  return new Set();
}

// ---- Predicate 2: consistency — each sourceRef must resolve ----
for (const row of capabilities) {
  const sourceRef = row?.sourceRef;
  if (!sourceRef || typeof sourceRef !== 'object') continue;
  const table = typeof sourceRef.table === 'string' ? sourceRef.table.trim() : '';
  const capability = typeof sourceRef.capability === 'string' ? sourceRef.capability.trim() : '';
  if (!table || !capability) continue;
  const tokens = resolverTokensFor(table);
  if (!tokens.has(capability)) {
    fail(`${catalogRel}: capabilityId ${row.capabilityId} sourceRef.capability ${capability} not admitted by runtime table ${table}.yaml`);
  }
  const additional = Array.isArray(row?.additionalRuntimeTables) ? row.additionalRuntimeTables : [];
  for (const addEntry of additional) {
    const addTable = typeof addEntry?.table === 'string' ? addEntry.table.trim() : '';
    const addCap = typeof addEntry?.capability === 'string' ? addEntry.capability.trim() : '';
    if (!addTable || !addCap) continue;
    const addTokens = resolverTokensFor(addTable);
    if (!addTokens.has(addCap)) {
      fail(`${catalogRel}: capabilityId ${row.capabilityId} additionalRuntimeTables entry ${addCap} not admitted by runtime table ${addTable}.yaml`);
    }
  }
}

// ---- Predicate 3: completeness — runtime union == catalog union ∪ deferred (per table) ----
const catalogTokensByTable = {
  'provider-capabilities': new Set(),
  'local-adapter-routing': new Set(),
};
for (const row of capabilities) {
  const sourceRef = row?.sourceRef;
  if (sourceRef && typeof sourceRef === 'object') {
    const table = typeof sourceRef.table === 'string' ? sourceRef.table.trim() : '';
    const capability = typeof sourceRef.capability === 'string' ? sourceRef.capability.trim() : '';
    if (catalogTokensByTable[table] && capability) {
      catalogTokensByTable[table].add(capability);
    }
  }
  const additional = Array.isArray(row?.additionalRuntimeTables) ? row.additionalRuntimeTables : [];
  for (const addEntry of additional) {
    const addTable = typeof addEntry?.table === 'string' ? addEntry.table.trim() : '';
    const addCap = typeof addEntry?.capability === 'string' ? addEntry.capability.trim() : '';
    if (catalogTokensByTable[addTable] && addCap) {
      catalogTokensByTable[addTable].add(addCap);
    }
  }
}
const deferredTokensByTable = {
  'provider-capabilities': new Set(),
  'local-adapter-routing': new Set(),
};
for (const entry of deferred) {
  const table = typeof entry?.table === 'string' ? entry.table.trim() : '';
  const capability = typeof entry?.capability === 'string' ? entry.capability.trim() : '';
  if (deferredTokensByTable[table] && capability) {
    deferredTokensByTable[table].add(capability);
  }
}

function checkCompleteness(table, runtimeTokens) {
  const admittedUnion = new Set([
    ...catalogTokensByTable[table],
    ...deferredTokensByTable[table],
  ]);
  for (const token of runtimeTokens) {
    if (!admittedUnion.has(token)) {
      fail(`${catalogRel}: runtime table ${table}.yaml admits capability ${token} but catalog has no active row or deferred entry for it`);
    }
  }
  for (const token of admittedUnion) {
    if (!runtimeTokens.has(token)) {
      fail(`${catalogRel}: catalog admits capability ${token} under table ${table} but runtime table ${table}.yaml does not emit it`);
    }
  }
}

checkCompleteness('provider-capabilities', providerTokens);
checkCompleteness('local-adapter-routing', localAdapterTokens);

// ---- Predicate 4: codegen idempotency ----
if (violations.length === 0) {
  let rendered;
  try {
    rendered = renderCanonicalCapabilityCatalogModule(catalogDoc);
  } catch (error) {
    fail(`${catalogRel}: codegen render failed: ${error?.message || error}`);
  }
  if (rendered !== undefined) {
    const generatedPath = path.join(cwd, generatedRel);
    if (!fs.existsSync(generatedPath)) {
      fail(`${generatedRel}: missing generated file; run pnpm gen:canonical-capability-catalog`);
    } else {
      const committed = fs.readFileSync(generatedPath, 'utf8');
      if (committed !== rendered) {
        fail(`${generatedRel}: drift detected; regenerate with pnpm gen:canonical-capability-catalog`);
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`canonical capability catalog check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('canonical capability catalog check passed\n');
