#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = new Set(process.argv.slice(2));
const checkMode = args.has('--check');

const profileTablePath = path.join(repoRoot, 'config/platform-ai-profile-factory-catalog.yaml');
const canonicalCapabilityTablePath = path.join(repoRoot, 'config/platform-canonical-capability-catalog.yaml');
const localComputePacksTablePath = path.join(repoRoot, 'config/runtime-local-compute-packs.yaml');
const localEnvironmentDependenciesTablePath = path.join(
  repoRoot,
  'config/runtime-local-environment-dependencies.yaml',
);
const vNextAppOutputPath = path.join(repoRoot, 'sdks/typescript/core/app/ai-profile-factory.generated.ts');
const rustOutputPath = path.join(repoRoot, 'kit/shell/tauri/src/platform_catalog/ai_profile_factory.rs');

function asArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function asString(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized;
}

function stringArray(value, label) {
  return asArray(value ?? [], label).map((item, index) => asString(item, `${label}[${index}]`));
}

function titleFromAlias(alias) {
  return alias
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

async function readYaml(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw);
}

function normalizeAIProfileFactoryRows(doc) {
  return asArray(doc?.profiles, 'ai-profile factory rows').map((row, index) => {
    const alias = asString(row?.alias, `profiles[${index}].alias`);
    return {
      alias,
      privacyPosture: asString(row?.privacy_posture, `${alias}.privacy_posture`),
      computePosture: asString(row?.compute_posture, `${alias}.compute_posture`),
      capabilitySet: stringArray(row?.capability_set, `${alias}.capability_set`),
      routingPolicy: asString(row?.routing_policy, `${alias}.routing_policy`),
      hostCapabilityProfileRefs: stringArray(row?.host_capability_profile_refs, `${alias}.host_capability_profile_refs`),
      localComputePackRefs: stringArray(row?.local_compute_pack_refs, `${alias}.local_compute_pack_refs`),
      dependencyFamilyRefs: stringArray(row?.dependency_family_refs, `${alias}.dependency_family_refs`),
      materializationConfirmationRequired: Boolean(row?.materialization_confirmation_required),
      applicableScopes: stringArray(row?.applicable_scopes, `${alias}.applicable_scopes`),
      firstRunInstallLevels: stringArray(row?.first_run_install_levels, `${alias}.first_run_install_levels`),
      sourceRule: asString(row?.source_rule, `${alias}.source_rule`),
    };
  });
}

function idSetFromRows(rows, idField, label) {
  return new Set(
    asArray(rows, label).map((row, index) => asString(row?.[idField], `${label}[${index}].${idField}`)),
  );
}

function assertRefsResolve(refs, admittedIds, rowAlias, fieldName) {
  for (const ref of refs) {
    if (!admittedIds.has(ref)) {
      throw new Error(`factory AIProfile ${rowAlias}.${fieldName} does not resolve: ${ref}`);
    }
  }
}

function assertFactoryCatalogRefsResolve(factoryRows, referenceDocs) {
  const capabilityIds = idSetFromRows(
    referenceDocs.canonicalCapabilities?.capabilities,
    'capabilityId',
    'canonical capability rows',
  );
  const localComputePackIds = idSetFromRows(
    referenceDocs.localComputePacks?.packs,
    'pack_id',
    'local compute pack rows',
  );
  const dependencyFamilyIds = idSetFromRows(
    referenceDocs.localEnvironmentDependencies?.dependency_families,
    'family_id',
    'local environment dependency rows',
  );

  for (const row of factoryRows) {
    assertRefsResolve(row.capabilitySet, capabilityIds, row.alias, 'capability_set');
    assertRefsResolve(row.localComputePackRefs, localComputePackIds, row.alias, 'local_compute_pack_refs');
    assertRefsResolve(row.dependencyFamilyRefs, dependencyFamilyIds, row.alias, 'dependency_family_refs');
  }
}

function deriveAiProfiles(factoryRows) {
  return factoryRows.map((profile) => ({
    profileId: profile.alias,
    title: titleFromAlias(profile.alias),
    description: `Factory AIProfile selection hint: ${profile.alias}`,
    tags: [
      'factory-ai-profile',
      'factory-ai-profile-selection-hint',
      'setup-required',
      profile.privacyPosture,
      profile.computePosture,
      profile.routingPolicy,
    ],
    capabilities: Object.fromEntries(
      profile.capabilitySet.map((capability) => [
        capability,
        {
          readinessPolicy: 'required',
          contractState: 'proposed',
        },
      ]),
    ),
    projectionWarnings: [
      'factory_ai_profile_selection_hint',
      'runtime_prepare_required_before_live_config',
    ],
  }));
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2);
}

function renderVNextApp(factoryRows, aiProfiles) {
  return [
    '/*',
    ' * @generated by scripts/generate-platform-catalog.mjs',
    ' * Source: config/platform-ai-profile-factory-catalog.yaml',
    ' *',
    ' * This file is the packaged Platform AIProfile factory projection.',
    ' * It is not a canonical row source.',
    ' */',
    '',
    "import type { NimiAIProfile } from '../ai/index';",
    '',
    'export interface NimiAppAIProfileFactoryRow {',
    '  readonly alias: string;',
    '  readonly privacyPosture: string;',
    '  readonly computePosture: string;',
    '  readonly capabilitySet: readonly string[];',
    '  readonly routingPolicy: string;',
    '  readonly hostCapabilityProfileRefs: readonly string[];',
    '  readonly localComputePackRefs: readonly string[];',
    '  readonly dependencyFamilyRefs: readonly string[];',
    '  readonly materializationConfirmationRequired: boolean;',
    '  readonly applicableScopes: readonly string[];',
    '  readonly firstRunInstallLevels: readonly string[];',
    '  readonly sourceRule: string;',
    '}',
    '',
    `export const NIMI_APP_AI_PROFILE_FACTORY_ROWS = ${stableStringify(factoryRows)} as const satisfies readonly NimiAppAIProfileFactoryRow[];`,
    '',
    `export const NIMI_APP_AI_PROFILE_FACTORY_CATALOG = ${stableStringify(aiProfiles)} as const satisfies readonly NimiAIProfile[];`,
    '',
    'export function loadNimiAppAIProfileFactoryRows(): readonly NimiAppAIProfileFactoryRow[] {',
    '  return NIMI_APP_AI_PROFILE_FACTORY_ROWS;',
    '}',
    '',
    'export function loadNimiAppAIProfileFactoryCatalog(): readonly NimiAIProfile[] {',
    '  return NIMI_APP_AI_PROFILE_FACTORY_CATALOG;',
    '}',
    '',
  ].join('\n');
}

function rustString(value) {
  return JSON.stringify(String(value));
}

function rustStringSlice(values) {
  if (values.length === 0) return '&[]';
  return `&[${values.map(rustString).join(', ')}]`;
}

function renderRust(profileDoc, factoryRows) {
  const catalogVersion = Number(profileDoc?.version ?? 0);
  if (!Number.isInteger(catalogVersion) || catalogVersion <= 0) {
    throw new Error('ai-profile factory catalog version must be a positive integer for Rust projection');
  }
  const catalogId = asString(profileDoc?.catalog_id, 'ai-profile factory catalog_id');
  const rows = factoryRows.map((row) => [
    '    PlatformAIProfileFactoryRow {',
    `        alias: ${rustString(row.alias)},`,
    `        privacy_posture: ${rustString(row.privacyPosture)},`,
    `        compute_posture: ${rustString(row.computePosture)},`,
    `        capability_set: ${rustStringSlice(row.capabilitySet)},`,
    `        routing_policy: ${rustString(row.routingPolicy)},`,
    `        host_capability_profile_refs: ${rustStringSlice(row.hostCapabilityProfileRefs)},`,
    `        local_compute_pack_refs: ${rustStringSlice(row.localComputePackRefs)},`,
    `        dependency_family_refs: ${rustStringSlice(row.dependencyFamilyRefs)},`,
    `        materialization_confirmation_required: ${row.materializationConfirmationRequired ? 'true' : 'false'},`,
    `        applicable_scopes: ${rustStringSlice(row.applicableScopes)},`,
    `        first_run_install_levels: ${rustStringSlice(row.firstRunInstallLevels)},`,
    `        source_rule: ${rustString(row.sourceRule)},`,
    '    },',
  ].join('\n')).join('\n');
  return [
    '/*',
    ' * @generated by scripts/generate-platform-catalog.mjs',
    ' * Source: config/platform-ai-profile-factory-catalog.yaml',
    ' *',
    ' * This file is a packaged Platform catalog projection for Rust host consumers.',
    ' * It is not a canonical row source.',
    ' */',
    '',
    '#[derive(Debug, Clone, Copy, PartialEq, Eq)]',
    'pub struct PlatformAIProfileFactoryRow {',
    "    pub alias: &'static str,",
    "    pub privacy_posture: &'static str,",
    "    pub compute_posture: &'static str,",
    "    pub capability_set: &'static [&'static str],",
    "    pub routing_policy: &'static str,",
    "    pub host_capability_profile_refs: &'static [&'static str],",
    "    pub local_compute_pack_refs: &'static [&'static str],",
    "    pub dependency_family_refs: &'static [&'static str],",
    '    pub materialization_confirmation_required: bool,',
    "    pub applicable_scopes: &'static [&'static str],",
    "    pub first_run_install_levels: &'static [&'static str],",
    "    pub source_rule: &'static str,",
    '}',
    '',
    `pub const PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID: &str = ${rustString(catalogId)};`,
    `pub const PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION: u32 = ${catalogVersion};`,
    'pub const PLATFORM_AI_PROFILE_SELECTION_POLICY_REF: &str = "P-AIPS-004";',
    '',
    'pub const PLATFORM_AI_PROFILE_FACTORY_ROWS: &[PlatformAIProfileFactoryRow] = &[',
    rows,
    '];',
    '',
    'pub fn resolve_factory_ai_profile_alias(alias: &str) -> Option<&\'static PlatformAIProfileFactoryRow> {',
    '    let normalized = alias.trim();',
    '    if normalized.is_empty() {',
    '        return None;',
    '    }',
    '    PLATFORM_AI_PROFILE_FACTORY_ROWS',
    '        .iter()',
    '        .find(|row| row.alias == normalized)',
    '}',
    '',
    'pub fn verify_first_run_factory_ai_profile(',
    '    alias: &str,',
    '    install_level: &str,',
    ') -> Result<&\'static PlatformAIProfileFactoryRow, String> {',
    '    let normalized_level = install_level.trim();',
    '    let Some(row) = resolve_factory_ai_profile_alias(alias) else {',
    '        return Err(format!("selected aiProfileAlias is not admitted in Platform factory catalog: {}", alias.trim()));',
    '    };',
    '    if !row.applicable_scopes.contains(&"first-run") {',
    '        return Err(format!("aiProfileAlias is not admitted for first-run: {}", row.alias));',
    '    }',
    '    if !row.first_run_install_levels.contains(&normalized_level) {',
    '        return Err(format!("aiProfileAlias {} is not admitted for first-run install level {}", row.alias, normalized_level));',
    '    }',
    '    if row.compute_posture == "cloud-only"',
    '        || row.routing_policy == "cloud-first"',
    '        || row.routing_policy == "hybrid-explicit"',
    '        || row.capability_set.contains(&"video.generate")',
    '    {',
    '        return Err(format!("aiProfileAlias {} is not an admitted local first-run baseline", row.alias));',
    '    }',
    '    Ok(row)',
    '}',
    '',
  ].join('\n');
}

function formatRust(source) {
  const result = spawnSync('rustfmt', ['--edition', '2021', '--emit', 'stdout'], {
    input: source,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`rustfmt failed for Platform backend catalog projection: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function main() {
  const [
    profileDoc,
    canonicalCapabilityDoc,
    localComputePackDoc,
    localEnvironmentDependencyDoc,
  ] = await Promise.all([
    readYaml(profileTablePath),
    readYaml(canonicalCapabilityTablePath),
    readYaml(localComputePacksTablePath),
    readYaml(localEnvironmentDependenciesTablePath),
  ]);
  const factoryRows = normalizeAIProfileFactoryRows(profileDoc);
  assertFactoryCatalogRefsResolve(factoryRows, {
    canonicalCapabilities: canonicalCapabilityDoc,
    localComputePacks: localComputePackDoc,
    localEnvironmentDependencies: localEnvironmentDependencyDoc,
  });
  const aiProfiles = deriveAiProfiles(factoryRows);
  const renderedVNextApp = renderVNextApp(factoryRows, aiProfiles);
  const renderedRust = formatRust(renderRust(profileDoc, factoryRows));

  if (checkMode) {
    let currentVNextApp = '';
    let currentRust = '';
    try {
      currentVNextApp = await fs.readFile(vNextAppOutputPath, 'utf8');
    } catch {
      throw new Error(`SDK vNext App platform catalog projection missing: ${path.relative(repoRoot, vNextAppOutputPath)}`);
    }
    try {
      currentRust = await fs.readFile(rustOutputPath, 'utf8');
    } catch {
      throw new Error(`Platform backend catalog projection missing: ${path.relative(repoRoot, rustOutputPath)}`);
    }
    if (currentVNextApp !== renderedVNextApp) {
      throw new Error(`SDK vNext App platform catalog projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    if (currentRust !== renderedRust) {
      throw new Error(`Platform backend catalog projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    process.stdout.write('generate-platform-catalog --check passed\n');
    return;
  }

  await fs.mkdir(path.dirname(vNextAppOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(rustOutputPath), { recursive: true });
  await fs.writeFile(vNextAppOutputPath, renderedVNextApp, 'utf8');
  await fs.writeFile(rustOutputPath, renderedRust, 'utf8');
  process.stdout.write(`generated ${path.relative(repoRoot, vNextAppOutputPath)}\n`);
  process.stdout.write(`generated ${path.relative(repoRoot, rustOutputPath)}\n`);
}

main().catch((error) => {
  process.stderr.write(`generate-platform-catalog failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
