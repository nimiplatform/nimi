import fs from 'node:fs';
import YAML from 'yaml';

import { assertExactObject, fail } from './third-party-hardcut-evidence-core.mjs';

const TOP_LEVEL_FIELDS = [
  'version',
  'contract',
  'admission_derivation',
  'enforced_required_rows',
  'repository_policy',
  'object_schemas',
  'prohibited_material_registry',
  'privacy_scan_policy',
  'packet_resource_policy',
  'live_shell_policy',
  'wave_posture_policies',
  'required_row_registry',
  'row_adapters',
];
const OBJECT_SCHEMA_NAMES = [
  'manifest',
  'execution_baseline',
  'repository_preflight',
  'artifact_ref',
  'derived_report_ref',
  'command_record',
  'test_counts',
  'coverage_row',
  'leak_report',
  'leak_probe',
  'leak_surface',
  'live_shell_report',
  'live_executable',
  'live_launch',
  'live_caller',
  'live_runtime',
  'live_action',
  'live_failure_state',
  'live_fault',
  'live_ui',
  'viewport',
  'screenshot',
  'runtime_error',
  'wave_a_posture',
  'wave_a_persona',
  'wave_r_posture',
  'wave_r_realtime',
  'wave_b_posture',
  'wave_b_media',
];

const EXPECTED_ROW_ADAPTERS = {
  'C-02': { evidence_kind: 'command', shell_type: null },
  'A-11': { evidence_kind: 'live_shell', shell_type: 'tauri' },
  'A-12': { evidence_kind: 'live_shell', shell_type: 'electron' },
  'A-16': { evidence_kind: 'wave_posture', shell_type: null },
  'R-07': { evidence_kind: 'wave_posture', shell_type: null },
  'B-12': { evidence_kind: 'wave_posture', shell_type: null },
};

function assertJsonSafe(value, location = 'contract') {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    fail('CONTRACT_INVALID', `${location} contains a non-finite number`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonSafe(entry, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonSafe(entry, `${location}.${key}`);
    }
  }
}

function assertStringArray(value, label, { allowEmpty = false } = {}) {
  if (
    !Array.isArray(value)
    || (!allowEmpty && value.length === 0)
    || value.some((item) => typeof item !== 'string' || item.length === 0)
    || value.length !== new Set(value).size
  ) {
    fail('CONTRACT_INVALID', `${label} must be a unique string array`);
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateDeepContractShape(contract) {
  assertExactObject(
    contract.admission_derivation,
    ['implementation_incomplete', 'admitted_and_observed'],
    'admission derivation',
  );
  assertExactObject(
    contract.admission_derivation.implementation_incomplete,
    ['supported'],
    'implementation-incomplete derivation',
  );
  assertExactObject(
    contract.admission_derivation.admitted_and_observed,
    ['supported', 'reason'],
    'admitted-and-observed derivation',
  );
  if (
    contract.admission_derivation.implementation_incomplete.supported !== true
    || contract.admission_derivation.admitted_and_observed.supported !== false
    || !isNonEmptyString(contract.admission_derivation.admitted_and_observed.reason)
  ) {
    fail('CONTRACT_INVALID', 'admission derivation types are invalid');
  }
  assertExactObject(
    contract.enforced_required_rows,
    ['phase0', 'A', 'U', 'R', 'B'],
    'enforced required rows',
  );
  for (const wave of ['phase0', 'A', 'U', 'R', 'B']) {
    assertStringArray(contract.enforced_required_rows[wave], `enforced rows ${wave}`, {
      allowEmpty: true,
    });
  }
  assertExactObject(contract.object_schemas, OBJECT_SCHEMA_NAMES, 'object schemas');
  for (const schemaName of OBJECT_SCHEMA_NAMES) {
    const schema = contract.object_schemas[schemaName];
    assertExactObject(schema, ['required_fields', 'exact'], `object schema ${schemaName}`);
    assertStringArray(schema.required_fields, `object schema ${schemaName} required fields`);
    if (schema.exact !== true) fail('CONTRACT_INVALID', `object schema ${schemaName} must be exact`);
  }
  assertExactObject(
    contract.prohibited_material_registry,
    ['version', 'classes'],
    'prohibited material registry',
  );
  assertStringArray(contract.prohibited_material_registry.classes, 'prohibited material classes');
  assertExactObject(
    contract.privacy_scan_policy,
    ['version', 'text_extensions', 'png_text_chunks', 'synthetic_canary_literals'],
    'privacy scan policy',
  );
  assertStringArray(contract.privacy_scan_policy.text_extensions, 'privacy text extensions');
  assertStringArray(contract.privacy_scan_policy.png_text_chunks, 'PNG text chunks');
  assertStringArray(
    contract.privacy_scan_policy.synthetic_canary_literals,
    'synthetic binary canary literals',
  );
  if (
    contract.privacy_scan_policy.version !== 1
    || contract.privacy_scan_policy.text_extensions
      .some((extension) => !/^\.[a-z0-9]+$/u.test(extension))
    || contract.privacy_scan_policy.png_text_chunks
      .some((chunk) => !/^[A-Za-z]{4}$/u.test(chunk))
  ) {
    fail('CONTRACT_INVALID', 'privacy scan policy is invalid');
  }
  assertExactObject(
    contract.packet_resource_policy,
    [
      'version',
      'path_key_collision_posture',
      'max_file_count',
      'max_entry_count',
      'max_directory_depth',
      'max_single_file_bytes',
      'max_packet_total_bytes',
      'max_text_scan_bytes',
      'max_screenshot_compressed_bytes',
      'stream_chunk_bytes',
    ],
    'packet resource policy',
  );
  const resourcePolicy = contract.packet_resource_policy;
  if (
    resourcePolicy.version !== 1
    || resourcePolicy.path_key_collision_posture !== 'reject'
    || [
      resourcePolicy.max_file_count,
      resourcePolicy.max_entry_count,
      resourcePolicy.max_directory_depth,
      resourcePolicy.max_single_file_bytes,
      resourcePolicy.max_packet_total_bytes,
      resourcePolicy.max_text_scan_bytes,
      resourcePolicy.max_screenshot_compressed_bytes,
      resourcePolicy.stream_chunk_bytes,
    ].some((value) => !Number.isSafeInteger(value) || value <= 0)
    || resourcePolicy.max_file_count > resourcePolicy.max_entry_count
    || resourcePolicy.max_text_scan_bytes > resourcePolicy.max_single_file_bytes
    || resourcePolicy.max_screenshot_compressed_bytes > resourcePolicy.max_single_file_bytes
    || resourcePolicy.max_single_file_bytes > resourcePolicy.max_packet_total_bytes
    || resourcePolicy.stream_chunk_bytes > resourcePolicy.max_text_scan_bytes
  ) {
    fail('CONTRACT_INVALID', 'packet resource policy is invalid');
  }
  assertExactObject(
    contract.live_shell_policy,
    ['caller_mode', 'caller_observer', 'launch_postures'],
    'live shell policy',
  );
  assertExactObject(
    contract.live_shell_policy.launch_postures,
    ['desktop-installed', 'runtime-authorized-developer-installed'],
    'live shell launch postures',
  );
  if (
    !isNonEmptyString(contract.live_shell_policy.caller_mode)
    || !isNonEmptyString(contract.live_shell_policy.caller_observer)
    || Object.values(contract.live_shell_policy.launch_postures)
      .some((value) => !isNonEmptyString(value))
  ) {
    fail('CONTRACT_INVALID', 'live shell policy types are invalid');
  }
  assertExactObject(contract.wave_posture_policies, ['A', 'R', 'B'], 'wave posture policies');
  assertExactObject(
    contract.wave_posture_policies.A,
    ['row_id', 'persona_direct_media_enabled'],
    'Wave A posture policy',
  );
  assertExactObject(
    contract.wave_posture_policies.R,
    ['row_id', 'polling_posture', 'upstream_connection_observed'],
    'Wave R posture policy',
  );
  assertExactObject(
    contract.wave_posture_policies.B,
    ['row_id', 'finalize_status', 'cleanup_status', 'signed_upload_credential_surface'],
    'Wave B posture policy',
  );
  if (
    !isNonEmptyString(contract.wave_posture_policies.A.row_id)
    || typeof contract.wave_posture_policies.A.persona_direct_media_enabled !== 'boolean'
    || !isNonEmptyString(contract.wave_posture_policies.R.row_id)
    || !isNonEmptyString(contract.wave_posture_policies.R.polling_posture)
    || typeof contract.wave_posture_policies.R.upstream_connection_observed !== 'boolean'
    || !isNonEmptyString(contract.wave_posture_policies.B.row_id)
    || !isNonEmptyString(contract.wave_posture_policies.B.finalize_status)
    || !isNonEmptyString(contract.wave_posture_policies.B.cleanup_status)
    || !isNonEmptyString(contract.wave_posture_policies.B.signed_upload_credential_surface)
  ) {
    fail('CONTRACT_INVALID', 'wave posture policy types are invalid');
  }
  assertExactObject(
    contract.required_row_registry,
    ['version', 'semantic_posture', 'authority_refs', 'waves'],
    'required row registry',
  );
  assertStringArray(contract.required_row_registry.authority_refs, 'required row authority refs');
  if (
    !isNonEmptyString(contract.required_row_registry.semantic_posture)
    || contract.required_row_registry.authority_refs
      .some((reference) => !reference.startsWith('.nimi/spec/'))
  ) {
    fail('CONTRACT_INVALID', 'required row registry metadata is invalid');
  }
  assertExactObject(
    contract.required_row_registry.waves,
    ['global', 'A', 'U', 'R', 'B', 'closeout'],
    'required row waves',
  );
  for (const [wave, rows] of Object.entries(contract.required_row_registry.waves)) {
    assertStringArray(rows, `required row wave ${wave}`);
  }
  assertExactObject(contract.row_adapters, Object.keys(EXPECTED_ROW_ADAPTERS), 'row adapters');
  for (const [rowId, expected] of Object.entries(EXPECTED_ROW_ADAPTERS)) {
    const adapter = contract.row_adapters[rowId];
    assertExactObject(adapter, ['evidence_kind', 'shell_type'], `row adapter ${rowId}`);
    if (
      adapter.evidence_kind !== expected.evidence_kind
      || adapter.shell_type !== expected.shell_type
    ) {
      fail('CONTRACT_INVALID', `row adapter ${rowId} is not supported by validator v1`);
    }
  }
}

export function loadEvidenceContract(contractPath) {
  let contract;
  try {
    contract = YAML.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch {
    fail('CONTRACT_PARSE_ERROR', 'evidence contract is not valid YAML');
  }
  if (contract?.version !== 1) {
    fail('CONTRACT_VERSION_MISMATCH', 'evidence contract version must be 1');
  }
  assertJsonSafe(contract);
  assertExactObject(contract, TOP_LEVEL_FIELDS, 'evidence contract');
  assertExactObject(contract.contract, ['id', 'owner', 'kind'], 'evidence contract identity');
  assertExactObject(
    contract.repository_policy,
    ['primary_repository_id', 'primary_branch'],
    'repository policy',
  );
  validateDeepContractShape(contract);
  if (
    contract.contract.id !== 'nimi.third-party-hardcut-evidence.v1'
    || !isNonEmptyString(contract.contract.owner)
    || contract.contract.kind !== 'machine-consumed-yaml-descriptor'
    || contract.repository_policy.primary_repository_id !== 'nimi'
    || contract.repository_policy.primary_branch !== 'develop'
    || contract.admission_derivation?.implementation_incomplete?.supported !== true
    || contract.admission_derivation?.admitted_and_observed?.supported !== false
  ) {
    fail('CONTRACT_INVALID', 'evidence contract identity or non-success derivation boundary is invalid');
  }
  const rows = Object.values(contract.required_row_registry?.waves ?? {}).flat();
  if (
    contract.required_row_registry?.version !== 1
    || rows.length !== new Set(rows).size
    || rows.some((row) => !/^(?:G|A|U|R|B|C)-\d{2}[a-z]?$/u.test(row))
    || Object.keys(contract.row_adapters ?? {}).some((row) => !rows.includes(row))
  ) {
    fail('CONTRACT_INVALID', 'required-row registry is invalid');
  }
  const materials = contract.prohibited_material_registry?.classes ?? [];
  if (
    contract.prohibited_material_registry?.version !== 1
    || materials.length === 0
    || materials.length !== new Set(materials).size
  ) {
    fail('CONTRACT_INVALID', 'prohibited-material registry is invalid');
  }
  if (
    ['phase0', 'A', 'U', 'R', 'B']
      .some((wave) => contract.enforced_required_rows?.[wave]?.length !== 0)
  ) {
    fail('CONTRACT_INVALID', 'v1 cannot enforce any row without an admitted trusted adapter');
  }
  return contract;
}
