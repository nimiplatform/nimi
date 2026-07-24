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
const hostCapabilityProfilesTablePath = path.join(repoRoot, '.nimi/spec/runtime/kernel/tables/host-capability-profiles.yaml');
const localComputePacksTablePath = path.join(repoRoot, 'config/runtime-local-compute-packs.yaml');
const localEnvironmentDependenciesTablePath = path.join(
  repoRoot,
  'config/runtime-local-environment-dependencies.yaml',
);
const appRegistryTablePath = path.join(repoRoot, 'config/platform-nimi-app-registry.yaml');
const appReleaseDescriptorTablePath = path.join(repoRoot, 'config/platform-nimi-app-release-descriptors.yaml');
const vNextAppOutputPath = path.join(repoRoot, 'sdks/typescript/core/app/platform-catalog.generated.ts');
const rustOutputPath = path.join(repoRoot, 'kit/shell/tauri/src/platform_catalog/ai_profile_factory.rs');
const rustAppRegistryOutputPath = path.join(repoRoot, 'kit/shell/tauri/src/platform_catalog/nimi_app_registry.rs');
const kitPlatformProjectionOutputPath = path.join(repoRoot, 'kit/shell/capabilities/src/platform-projection.ts');

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

function storagePolicyRefId(value, label) {
  if (typeof value === 'string') {
    return asString(value, label);
  }
  if (value && typeof value === 'object') {
    return asString(value.id, `${label}.id`);
  }
  return asString(value, label);
}

function artifactSizeProjection(value, label) {
  if (typeof value === 'string' || typeof value === 'number') {
    return asString(value, label);
  }
  if (value && typeof value === 'object') {
    return asString(value.download, `${label}.download`);
  }
  return asString(value, label);
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
      aiProfileSelectionRef: asString(row?.ai_profile_selection_ref, `${appId}.ai_profile_selection_ref`),
      capabilitySet: stringArray(row?.capability_set_refs, `${appId}.capability_set_refs`),
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
      size: artifactSizeProjection(artifact?.size, `${descriptorId}.artifact.size`),
      provenanceRef: asString(artifact?.signature_or_provenance_ref, `${descriptorId}.artifact.signature_or_provenance_ref`),
      packageKind: asString(runtime?.package_kind, `${descriptorId}.runtime.package_kind`),
      entryRef: asString(runtime?.entry_ref, `${descriptorId}.runtime.entry_ref`),
      sandboxRef: asString(runtime?.sandbox_ref, `${descriptorId}.runtime.sandbox_ref`),
      permissionsRef: asString(row?.permissions_ref, `${descriptorId}.permissions_ref`),
      storagePolicyRef: storagePolicyRefId(row?.storage_policy_ref, `${descriptorId}.storage_policy_ref`),
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

function assertAppRegistryRefsResolve(appRows, releaseDescriptorRows, referenceDocs) {
  const descriptorIds = new Set(releaseDescriptorRows.map((row) => row.descriptorId));
  const factoryAliases = new Set(referenceDocs.factoryRows.map((row) => row.alias));
  const capabilityIds = idSetFromRows(
    referenceDocs.canonicalCapabilities?.capabilities,
    'capabilityId',
    'canonical capability rows',
  );
  for (const row of appRows) {
    if (!factoryAliases.has(row.aiProfileSelectionRef)) {
      throw new Error(`${row.appId}.ai_profile_selection_ref does not resolve: ${row.aiProfileSelectionRef}`);
    }
    assertRefsResolve(row.capabilitySet, capabilityIds, row.appId, 'capability_set_refs');
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
  const hostProfileIds = idSetFromRows(
    referenceDocs.hostCapabilityProfiles?.profiles,
    'profile_id',
    'host capability profile rows',
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
    assertRefsResolve(row.hostCapabilityProfileRefs, hostProfileIds, row.alias, 'host_capability_profile_refs');
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

function renderVNextApp(factoryRows, appRows, releaseDescriptorRows, aiProfiles) {
  return [
    '/*',
    ' * @generated by scripts/generate-platform-catalog.mjs',
    ' * Source: config/platform-ai-profile-factory-catalog.yaml',
    ' * Source: config/platform-nimi-app-registry.yaml',
    ' * Source: config/platform-nimi-app-release-descriptors.yaml',
    ' *',
    ' * This file is a packaged Platform catalog projection for SDK vNext App consumers.',
    ' * It is not a canonical row source.',
    ' */',
    '',
    "import type { NimiAppRegistrySourceRow, NimiAppReleaseDescriptorRow } from './index.js';",
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
    `export const NIMI_APP_REGISTRY_ROWS = ${stableStringify(appRows)} as const satisfies readonly NimiAppRegistrySourceRow[];`,
    '',
    `export const NIMI_APP_RELEASE_DESCRIPTOR_ROWS = ${stableStringify(releaseDescriptorRows)} as const satisfies readonly NimiAppReleaseDescriptorRow[];`,
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
    'export function loadNimiAppRegistryRows(): readonly NimiAppRegistrySourceRow[] {',
    '  return NIMI_APP_REGISTRY_ROWS;',
    '}',
    '',
    'export function loadNimiAppReleaseDescriptorRows(): readonly NimiAppReleaseDescriptorRow[] {',
    '  return NIMI_APP_RELEASE_DESCRIPTOR_ROWS;',
    '}',
    '',
  ].join('\n');
}

function renderKitPlatformProjectionSource(currentSource, appRegistryDoc, appRows, releaseDescriptorRows) {
  const registryVersion = Number(appRegistryDoc?.version ?? 0);
  if (!Number.isInteger(registryVersion) || registryVersion <= 0) {
    throw new Error('nimi app registry catalog version must be a positive integer for Kit platform projection');
  }
  const kitAppRows = appRows.map((row) => ({
    appId: row.appId,
    appKind: row.appKind,
    displayName: row.displayName,
    publisher: row.publisher,
    trustTier: row.trustTier,
    ordinaryVisibility: row.ordinaryVisibility,
    aiProfileSelectionRef: row.aiProfileSelectionRef,
    capabilitySetRefs: row.capabilitySet,
    releaseDescriptorRef: row.releaseDescriptorRef,
    installStoragePolicyRef: row.installStoragePolicyRef,
    admissionStatus: row.admissionStatus,
    sourceRule: row.sourceRule,
  }));
  const kitReleaseDescriptorRows = releaseDescriptorRows.map((row) => ({
    descriptorId: row.descriptorId,
    appId: row.appId,
    version: row.version,
    descriptorClass: row.descriptorClass,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    artifactLocator: row.artifactLocator,
    sha256: row.sha256,
    packageKind: row.packageKind,
    storagePolicyRef: row.storagePolicyRef,
    digestAlgorithm: row.digestAlgorithm,
    mutableSourceAllowed: row.mutableSourceAllowed,
    admissionPath: row.admissionPath,
    installDigestVerificationRequired: row.installDigestVerificationRequired,
    sourceRule: row.sourceRule,
    size: row.size,
    provenanceRef: row.provenanceRef,
    entryRef: row.entryRef,
    sandboxRef: row.sandboxRef,
    permissionsRef: row.permissionsRef,
  }));
  let rendered = currentSource.replace(
    /export const NIMI_PLATFORM_NIMI_APP_REGISTRY_CATALOG_VERSION = \d+;/u,
    `export const NIMI_PLATFORM_NIMI_APP_REGISTRY_CATALOG_VERSION = ${registryVersion};`,
  );
  rendered = replaceConstRows(
    rendered,
    'NIMI_PLATFORM_NIMI_APP_REGISTRY_ROWS',
    'NimiPlatformNimiAppRegistryRow',
    kitAppRows,
  );
  rendered = replaceConstRows(
    rendered,
    'NIMI_PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS',
    'NimiPlatformNimiAppReleaseDescriptorRow',
    kitReleaseDescriptorRows,
  );
  return rendered;
}

function replaceConstRows(source, constName, typeName, rows) {
  const pattern = new RegExp(
    `export const ${constName} = [\\s\\S]*? as const satisfies readonly ${typeName}\\[\\];`,
    'u',
  );
  const renderedRows = `export const ${constName} = ${stableStringify(rows)} as const satisfies readonly ${typeName}[];`;
  if (!pattern.test(source)) {
    throw new Error(`Kit platform projection row block not found: ${constName}`);
  }
  return source.replace(pattern, renderedRows);
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

function renderRustAppRegistry(appRegistryDoc, releaseDescriptorDoc, appRows, releaseDescriptorRows) {
  const registryCatalogId = asString(appRegistryDoc?.catalog_id, 'nimi app registry catalog_id');
  const registryVersion = Number(appRegistryDoc?.version ?? 0);
  if (!Number.isInteger(registryVersion) || registryVersion <= 0) {
    throw new Error('nimi app registry catalog version must be a positive integer for Rust projection');
  }
  // The release descriptor catalog identity is validated here but is not
  // emitted as a standalone constant: the registry projection resolves
  // descriptors by id, and the registry catalog id/version are the single
  // identity the Apps registry projection records.
  asString(releaseDescriptorDoc?.catalog_id, 'nimi app release descriptors catalog_id');
  if (
    !Number.isInteger(Number(releaseDescriptorDoc?.version ?? 0))
    || Number(releaseDescriptorDoc?.version ?? 0) <= 0
  ) {
    throw new Error('nimi app release descriptors catalog version must be a positive integer for Rust projection');
  }
  const appRowsRust = appRows.map((row) => [
    '    PlatformNimiAppRegistryRow {',
    `        app_id: ${rustString(row.appId)},`,
    `        app_kind: ${rustString(row.appKind)},`,
    `        display_name: ${rustString(row.displayName)},`,
    `        publisher: ${rustString(row.publisher)},`,
    `        trust_tier: ${rustString(row.trustTier)},`,
    `        ordinary_visibility: ${rustString(row.ordinaryVisibility)},`,
    `        ai_profile_selection_ref: ${rustString(row.aiProfileSelectionRef)},`,
    `        capability_set_refs: ${rustStringSlice(row.capabilitySet)},`,
    `        release_descriptor_ref: ${rustString(row.releaseDescriptorRef)},`,
    `        install_storage_policy_ref: ${rustString(row.installStoragePolicyRef)},`,
    `        admission_status: ${rustString(row.admissionStatus)},`,
    `        source_rule: ${rustString(row.sourceRule)},`,
    '    },',
  ].join('\n')).join('\n');
  const descriptorRowsRust = releaseDescriptorRows.map((row) => [
    '    PlatformNimiAppReleaseDescriptorRow {',
    `        descriptor_id: ${rustString(row.descriptorId)},`,
    `        app_id: ${rustString(row.appId)},`,
    `        version: ${rustString(row.version)},`,
    `        descriptor_class: ${rustString(row.descriptorClass)},`,
    `        source_kind: ${rustString(row.sourceKind)},`,
    `        source_ref: ${rustString(row.sourceRef)},`,
    `        artifact_locator: ${rustString(row.artifactLocator)},`,
    `        sha256: ${rustString(row.sha256)},`,
    `        size: ${rustString(row.size)},`,
    `        provenance_ref: ${rustString(row.provenanceRef)},`,
    `        package_kind: ${rustString(row.packageKind)},`,
    `        entry_ref: ${rustString(row.entryRef)},`,
    `        sandbox_ref: ${rustString(row.sandboxRef)},`,
    `        permissions_ref: ${rustString(row.permissionsRef)},`,
    `        storage_policy_ref: ${rustString(row.storagePolicyRef)},`,
    `        digest_algorithm: ${rustString(row.digestAlgorithm)},`,
    `        mutable_source_allowed: ${row.mutableSourceAllowed ? 'true' : 'false'},`,
    `        admission_path: ${rustString(row.admissionPath)},`,
    `        install_digest_verification_required: ${rustString(row.installDigestVerificationRequired)},`,
    `        source_rule: ${rustString(row.sourceRule)},`,
    '    },',
  ].join('\n')).join('\n');
  return [
    '/*',
    ' * @generated by scripts/generate-platform-catalog.mjs',
    ' * Source: config/platform-nimi-app-registry.yaml',
    ' * Source: config/platform-nimi-app-release-descriptors.yaml',
    ' *',
    ' * This file is a packaged Platform Nimi App registry + release descriptor',
    ' * catalog projection for Rust host registry.json projection writers.',
    ' * It is not a canonical row source.',
    ' */',
    '',
    '#[derive(Debug, Clone, Copy, PartialEq, Eq)]',
    'pub struct PlatformNimiAppRegistryRow {',
    "    pub app_id: &'static str,",
    "    pub app_kind: &'static str,",
    "    pub display_name: &'static str,",
    "    pub publisher: &'static str,",
    "    pub trust_tier: &'static str,",
    "    pub ordinary_visibility: &'static str,",
    "    pub ai_profile_selection_ref: &'static str,",
    "    pub capability_set_refs: &'static [&'static str],",
    "    pub release_descriptor_ref: &'static str,",
    "    pub install_storage_policy_ref: &'static str,",
    "    pub admission_status: &'static str,",
    "    pub source_rule: &'static str,",
    '}',
    '',
    '#[derive(Debug, Clone, Copy, PartialEq, Eq)]',
    'pub struct PlatformNimiAppReleaseDescriptorRow {',
    "    pub descriptor_id: &'static str,",
    "    pub app_id: &'static str,",
    "    pub version: &'static str,",
    "    pub descriptor_class: &'static str,",
    "    pub source_kind: &'static str,",
    "    pub source_ref: &'static str,",
    "    pub artifact_locator: &'static str,",
    "    pub sha256: &'static str,",
    "    pub size: &'static str,",
    "    pub provenance_ref: &'static str,",
    "    pub package_kind: &'static str,",
    "    pub entry_ref: &'static str,",
    "    pub sandbox_ref: &'static str,",
    "    pub permissions_ref: &'static str,",
    "    pub storage_policy_ref: &'static str,",
    "    pub digest_algorithm: &'static str,",
    '    pub mutable_source_allowed: bool,',
    "    pub admission_path: &'static str,",
    "    pub install_digest_verification_required: &'static str,",
    "    pub source_rule: &'static str,",
    '}',
    '',
    `pub const PLATFORM_NIMI_APP_REGISTRY_CATALOG_ID: &str = ${rustString(registryCatalogId)};`,
    `pub const PLATFORM_NIMI_APP_REGISTRY_CATALOG_VERSION: u32 = ${registryVersion};`,
    '',
    'pub const PLATFORM_NIMI_APP_REGISTRY_ROWS: &[PlatformNimiAppRegistryRow] = &[',
    appRowsRust,
    '];',
    '',
    'pub const PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS: &[PlatformNimiAppReleaseDescriptorRow] = &[',
    descriptorRowsRust,
    '];',
    '',
    "pub fn resolve_release_descriptor(descriptor_id: &str) -> Option<&'static PlatformNimiAppReleaseDescriptorRow> {",
    '    let normalized = descriptor_id.trim();',
    '    if normalized.is_empty() {',
    '        return None;',
    '    }',
    '    PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS',
    '        .iter()',
    '        .find(|row| row.descriptor_id == normalized)',
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
    hostCapabilityProfileDoc,
    localComputePackDoc,
    localEnvironmentDependencyDoc,
    appRegistryDoc,
    releaseDescriptorDoc,
  ] = await Promise.all([
    readYaml(profileTablePath),
    readYaml(canonicalCapabilityTablePath),
    readYaml(hostCapabilityProfilesTablePath),
    readYaml(localComputePacksTablePath),
    readYaml(localEnvironmentDependenciesTablePath),
    readYaml(appRegistryTablePath),
    readYaml(appReleaseDescriptorTablePath),
  ]);
  const factoryRows = normalizeAIProfileFactoryRows(profileDoc);
  assertFactoryCatalogRefsResolve(factoryRows, {
    canonicalCapabilities: canonicalCapabilityDoc,
    hostCapabilityProfiles: hostCapabilityProfileDoc,
    localComputePacks: localComputePackDoc,
    localEnvironmentDependencies: localEnvironmentDependencyDoc,
  });
  const appRows = normalizeNimiAppRegistryRows(appRegistryDoc);
  const releaseDescriptorRows = normalizeNimiAppReleaseDescriptorRows(releaseDescriptorDoc);
  assertAppRegistryRefsResolve(appRows, releaseDescriptorRows, {
    factoryRows,
    canonicalCapabilities: canonicalCapabilityDoc,
  });
  const aiProfiles = deriveAiProfiles(factoryRows);
  const renderedVNextApp = renderVNextApp(factoryRows, appRows, releaseDescriptorRows, aiProfiles);
  const renderedRust = formatRust(renderRust(profileDoc, factoryRows));
  const renderedRustAppRegistry = formatRust(
    renderRustAppRegistry(appRegistryDoc, releaseDescriptorDoc, appRows, releaseDescriptorRows),
  );
  let currentKitPlatformProjection = '';
  try {
    currentKitPlatformProjection = await fs.readFile(kitPlatformProjectionOutputPath, 'utf8');
  } catch {
    throw new Error(
      `Kit platform projection missing: ${path.relative(repoRoot, kitPlatformProjectionOutputPath)}`,
    );
  }
  const renderedKitPlatformProjection = renderKitPlatformProjectionSource(
    currentKitPlatformProjection,
    appRegistryDoc,
    appRows,
    releaseDescriptorRows,
  );

  if (checkMode) {
    let currentVNextApp = '';
    let currentRust = '';
    let currentRustAppRegistry = '';
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
    try {
      currentRustAppRegistry = await fs.readFile(rustAppRegistryOutputPath, 'utf8');
    } catch {
      throw new Error(
        `Platform Nimi App registry projection missing: ${path.relative(repoRoot, rustAppRegistryOutputPath)}`,
      );
    }
    if (currentVNextApp !== renderedVNextApp) {
      throw new Error(`SDK vNext App platform catalog projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    if (currentRust !== renderedRust) {
      throw new Error(`Platform backend catalog projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    if (currentRustAppRegistry !== renderedRustAppRegistry) {
      throw new Error(`Platform Nimi App registry projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    if (currentKitPlatformProjection !== renderedKitPlatformProjection) {
      throw new Error(`Kit platform projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    process.stdout.write('generate-platform-catalog --check passed\n');
    return;
  }

  await fs.mkdir(path.dirname(vNextAppOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(rustOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(rustAppRegistryOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(kitPlatformProjectionOutputPath), { recursive: true });
  await fs.writeFile(vNextAppOutputPath, renderedVNextApp, 'utf8');
  await fs.writeFile(rustOutputPath, renderedRust, 'utf8');
  await fs.writeFile(rustAppRegistryOutputPath, renderedRustAppRegistry, 'utf8');
  await fs.writeFile(kitPlatformProjectionOutputPath, renderedKitPlatformProjection, 'utf8');
  process.stdout.write(`generated ${path.relative(repoRoot, vNextAppOutputPath)}\n`);
  process.stdout.write(`generated ${path.relative(repoRoot, rustOutputPath)}\n`);
  process.stdout.write(`generated ${path.relative(repoRoot, rustAppRegistryOutputPath)}\n`);
  process.stdout.write(`generated ${path.relative(repoRoot, kitPlatformProjectionOutputPath)}\n`);
}

main().catch((error) => {
  process.stderr.write(`generate-platform-catalog failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
