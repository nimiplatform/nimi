#!/usr/bin/env node

import { promises as fs } from 'node:fs';
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

  if (checkMode) {
    let current = '';
    try {
      current = await fs.readFile(outputPath, 'utf8');
    } catch {
      throw new Error(`Platform catalog projection missing: ${path.relative(repoRoot, outputPath)}`);
    }
    if (current !== rendered) {
      throw new Error(`Platform catalog projection drift detected. Run pnpm generate:platform-catalog.`);
    }
    process.stdout.write('generate-platform-catalog --check passed\n');
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rendered, 'utf8');
  process.stdout.write(`generated ${path.relative(repoRoot, outputPath)}\n`);
}

main().catch((error) => {
  process.stderr.write(`generate-platform-catalog failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
