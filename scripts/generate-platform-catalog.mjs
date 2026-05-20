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

const profileTablePath = path.join(repoRoot, '.nimi/spec/platform/kernel/tables/ai-profile-factory-catalog.yaml');
const appRegistryTablePath = path.join(repoRoot, '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml');
const appReleaseDescriptorTablePath = path.join(repoRoot, '.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml');
const outputPath = path.join(repoRoot, 'apps/desktop/src/runtime/platform-catalog/generated.ts');
const rustOutputPath = path.join(repoRoot, 'apps/desktop/src-tauri/src/platform_ai_profile_factory_catalog.rs');

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

function optionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function asBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
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

function normalizeNimiAppRegistryRows(doc) {
  return asArray(doc?.apps, 'nimi app registry apps').map((row, index) => {
    const appId = asString(row?.app_id, `apps[${index}].app_id`);
    return {
      appId,
      appKind: asString(row?.package_kind, `${appId}.package_kind`),
      displayName: asString(row?.display_label, `${appId}.display_label`),
      publisher: asString(row?.publisher, `${appId}.publisher`),
      trustTier: asString(row?.trust_tier_ref, `${appId}.trust_tier_ref`),
      ordinaryVisibility: asString(row?.ordinary_visibility, `${appId}.ordinary_visibility`),
      releaseDescriptorRef: asString(row?.release_descriptor_ref, `${appId}.release_descriptor_ref`),
      installStoragePolicyRef: asString(row?.install_storage_policy_ref, `${appId}.install_storage_policy_ref`),
      sourceRule: asString(row?.source_rule, `${appId}.source_rule`),
      admissionStatus: asString(row?.admission_status, `${appId}.admission_status`),
      availableVersion: optionalString(row?.available_version),
      installedVersion: optionalString(row?.installed_version),
      detail: optionalString(row?.detail),
    };
  });
}

function normalizeNimiAppReleaseDescriptorRows(doc) {
  return asArray(doc?.descriptors, 'nimi app release descriptors').map((row, index) => {
    const descriptorId = asString(row?.descriptor_id, `descriptors[${index}].descriptor_id`);
    const artifact = row?.artifact ?? {};
    const runtime = row?.runtime ?? {};
    const source = row?.source ?? {};
    const review = row?.review ?? {};
    return {
      descriptorId,
      appId: asString(row?.app_id, `${descriptorId}.app_id`),
      version: asString(row?.version, `${descriptorId}.version`),
      descriptorClass: asString(row?.descriptor_class, `${descriptorId}.descriptor_class`),
      sourceKind: asString(source?.kind, `${descriptorId}.source.kind`),
      sourceRef: asString(source?.ref, `${descriptorId}.source.ref`),
      artifactLocator: asString(artifact?.locator, `${descriptorId}.artifact.locator`),
      digestAlgorithm: asString(artifact?.digest_algorithm, `${descriptorId}.artifact.digest_algorithm`),
      sha256: asString(artifact?.sha256, `${descriptorId}.artifact.sha256`),
      size: asString(artifact?.size, `${descriptorId}.artifact.size`),
      provenanceRef: asString(artifact?.signature_or_provenance_ref, `${descriptorId}.artifact.signature_or_provenance_ref`),
      packageKind: asString(runtime?.package_kind, `${descriptorId}.runtime.package_kind`),
      entryRef: asString(runtime?.entry_ref, `${descriptorId}.runtime.entry_ref`),
      sandboxRef: asString(runtime?.sandbox_ref, `${descriptorId}.runtime.sandbox_ref`),
      permissionsRef: asString(row?.permissions_ref, `${descriptorId}.permissions_ref`),
      storagePolicyRef: asString(row?.storage_policy_ref, `${descriptorId}.storage_policy_ref`),
      admissionPath: asString(review?.admission_path, `${descriptorId}.review.admission_path`),
      mutableSourceAllowed: asBoolean(review?.mutable_source_allowed, `${descriptorId}.review.mutable_source_allowed`),
      installDigestVerificationRequired: asString(
        review?.install_digest_verification_required,
        `${descriptorId}.review.install_digest_verification_required`,
      ),
      sourceRule: asString(row?.source_rule, `${descriptorId}.source_rule`),
    };
  });
}

function assertAppRegistryRefsResolve(appRows, releaseDescriptorRows) {
  const descriptorIds = new Set(releaseDescriptorRows.map((row) => row.descriptorId));
  for (const row of appRows) {
    if (!descriptorIds.has(row.releaseDescriptorRef)) {
      throw new Error(`${row.appId}.release_descriptor_ref does not resolve: ${row.releaseDescriptorRef}`);
    }
    const descriptor = releaseDescriptorRows.find((candidate) => candidate.descriptorId === row.releaseDescriptorRef);
    if (descriptor?.appId !== row.appId) {
      throw new Error(`${row.appId}.release_descriptor_ref resolves to descriptor for ${descriptor?.appId || 'unknown app'}`);
    }
    if (descriptor.storagePolicyRef !== row.installStoragePolicyRef) {
      throw new Error(`${row.appId}.install_storage_policy_ref does not match release descriptor storage policy`);
    }
  }
}

function deriveAiProfiles(factoryRows) {
  return factoryRows.map((profile) => ({
    profileId: profile.alias,
    title: titleFromAlias(profile.alias),
    description: `Factory AIProfile: ${profile.alias}`,
    tags: [
      'factory-ai-profile',
      profile.privacyPosture,
      profile.computePosture,
      profile.routingPolicy,
    ],
    capabilities: Object.fromEntries(
      profile.capabilitySet.map((capability) => [
        capability,
        { binding: null },
      ]),
    ),
  }));
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2);
}

function render(factoryRows, appRows, releaseDescriptorRows, aiProfiles) {
  return [
    '/*',
    ' * @generated by scripts/generate-platform-catalog.mjs',
    ' * Source: .nimi/spec/platform/kernel/tables/ai-profile-factory-catalog.yaml',
    ' * Source: .nimi/spec/platform/kernel/tables/nimi-app-registry.yaml',
    ' * Source: .nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml',
    ' *',
    ' * This file is a packaged Platform catalog projection for Desktop Home.',
    ' * It is not a canonical row source.',
    ' */',
    '',
    "import type { NimiAppRegistrySourceRow, NimiAppReleaseDescriptorRow } from '@nimiplatform/sdk/app';",
    "import type { AIProfile } from '@nimiplatform/sdk/mod';",
    '',
    'export interface PlatformAIProfileFactoryRow {',
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
    'export type PlatformNimiAppReleaseDescriptorRow = NimiAppReleaseDescriptorRow;',
    '',
    `export const PLATFORM_AI_PROFILE_FACTORY_ROWS = ${stableStringify(factoryRows)} as const satisfies readonly PlatformAIProfileFactoryRow[];`,
    '',
    `export const PLATFORM_NIMI_APP_REGISTRY_ROWS = ${stableStringify(appRows)} as const satisfies readonly NimiAppRegistrySourceRow[];`,
    '',
    `export const PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS = ${stableStringify(releaseDescriptorRows)} as const satisfies readonly PlatformNimiAppReleaseDescriptorRow[];`,
    '',
    `export const PLATFORM_AI_PROFILE_FACTORY_CATALOG = ${stableStringify(aiProfiles)} as const satisfies readonly AIProfile[];`,
    '',
    'export function loadPlatformAIProfileFactoryRows(): readonly PlatformAIProfileFactoryRow[] {',
    '  return PLATFORM_AI_PROFILE_FACTORY_ROWS;',
    '}',
    '',
    'export function loadPlatformNimiAppRegistryRows(): readonly NimiAppRegistrySourceRow[] {',
    '  return PLATFORM_NIMI_APP_REGISTRY_ROWS;',
    '}',
    '',
    'export function loadPlatformNimiAppReleaseDescriptorRows(): readonly PlatformNimiAppReleaseDescriptorRow[] {',
    '  return PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS;',
    '}',
    '',
    'export function loadPlatformAIProfileFactoryCatalog(): readonly AIProfile[] {',
    '  return PLATFORM_AI_PROFILE_FACTORY_CATALOG;',
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
    ' * Source: .nimi/spec/platform/kernel/tables/ai-profile-factory-catalog.yaml',
    ' *',
    ' * This file is a packaged Platform catalog projection for Desktop backend verification.',
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
  const [profileDoc, appRegistryDoc, releaseDescriptorDoc] = await Promise.all([
    readYaml(profileTablePath),
    readYaml(appRegistryTablePath),
    readYaml(appReleaseDescriptorTablePath),
  ]);
  const factoryRows = normalizeAIProfileFactoryRows(profileDoc);
  const appRows = normalizeNimiAppRegistryRows(appRegistryDoc);
  const releaseDescriptorRows = normalizeNimiAppReleaseDescriptorRows(releaseDescriptorDoc);
  assertAppRegistryRefsResolve(appRows, releaseDescriptorRows);
  const aiProfiles = deriveAiProfiles(factoryRows);
  const rendered = render(factoryRows, appRows, releaseDescriptorRows, aiProfiles);
  const renderedRust = formatRust(renderRust(profileDoc, factoryRows));

  if (checkMode) {
    let current = '';
    let currentRust = '';
    try {
      current = await fs.readFile(outputPath, 'utf8');
    } catch {
      throw new Error(`Platform catalog projection missing: ${path.relative(repoRoot, outputPath)}`);
    }
    try {
      currentRust = await fs.readFile(rustOutputPath, 'utf8');
    } catch {
      throw new Error(`Platform backend catalog projection missing: ${path.relative(repoRoot, rustOutputPath)}`);
    }
    if (current !== rendered) {
      throw new Error(`Platform catalog projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    if (currentRust !== renderedRust) {
      throw new Error(`Platform backend catalog projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    process.stdout.write('generate-platform-catalog --check passed\n');
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(rustOutputPath), { recursive: true });
  await fs.writeFile(outputPath, rendered, 'utf8');
  await fs.writeFile(rustOutputPath, renderedRust, 'utf8');
  process.stdout.write(`generated ${path.relative(repoRoot, outputPath)}\n`);
  process.stdout.write(`generated ${path.relative(repoRoot, rustOutputPath)}\n`);
}

main().catch((error) => {
  process.stderr.write(`generate-platform-catalog failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
