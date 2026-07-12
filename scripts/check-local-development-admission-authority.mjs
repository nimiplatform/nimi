#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

export const authorityPaths = Object.freeze({
  policy: '.nimi/spec/platform/kernel/tables/nimi-app-local-development-admission.yaml',
  platform: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
  runtime: '.nimi/spec/runtime/kernel/protected-local-session-contract.md',
  appLifecycle: '.nimi/spec/runtime/kernel/app-lifecycle-contract.md',
  desktop: '.nimi/spec/desktop/kernel/bridge-ipc-contract.md',
  kit: '.nimi/spec/platform/kernel/kit-contract.md',
  scaffold: '.nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md',
  sdk: '.nimi/spec/sdks/kernel/transport-contract.md',
});

const requiredRules = new Map([
  ['platform', ['P-NAPP-035', /production release trust.*mutable local-development trust/isu, /AdoptLocalApp.*never.*installed/isu]],
  ['runtime', ['K-PLOCAL-009', /user\s+development authorization/iu, /technical session/iu, /account generation.*Runtime\s+boot\s+epoch/isu]],
  ['appLifecycle', [
    'K-APP-027',
    /local-development-installed-admission/iu,
    /AdoptLocalApp.*inventory/isu,
    /does not require.*AdoptLocalApp/isu,
  ]],
  ['desktop', ['D-IPC-019', /Desktop-owned dev supervisor/iu, /confirmation/iu, /never.*CLI.*renderer/isu]],
  ['kit', ['P-KIT-046', /typed.*bootstrap.*status/isu, /Electron.*Tauri/isu, /artifacts\.readRuntimeBytes/iu]],
  ['scaffold', ['P-SCAF-018', /pnpm dev/iu, /nimi-app dev/iu, /direct.*tauri dev/isu]],
  ['sdk', ['S-TRANSPORT-014', /local-development/iu, /host-injected/iu, /session.*renderer/isu]],
]);

const authorizationBindings = [
  'canonical_project_root',
  'app_id',
  'manifest_capability_fingerprint',
  'account_id',
  'trust_class',
];
const sessionBindings = [
  'development_authorization_id',
  'desktop_supervisor_process',
  'host_process_id',
  'host_process_creation_marker',
  'shell_kind',
  'account_generation',
  'runtime_boot_epoch',
  'expires_at',
];
const noReapprovalChanges = [
  'renderer_source_hmr',
  'renderer_reload',
  'electron_main_or_preload_rebuild_and_controlled_restart',
  'tauri_rust_rebuild_and_controlled_restart',
  'technical_session_rotation',
  'runtime_restart_with_valid_authorization',
  'controlled_host_restart_same_project_app_capability_account_shell',
];
const reapprovalOrRejectChanges = [
  'capability_expansion',
  'app_id_change',
  'canonical_project_root_change',
  'shell_or_trust_class_change',
  'account_change',
  'authorization_revoked',
  'host_outside_desktop_supervisor',
  'executable_or_renderer_origin_outside_controlled_project_outputs',
  'remote_or_uncontrolled_dev_server',
];
const ownerRows = Object.freeze({
  app_tools: 'command_scaffold_project_validation_build_coordination_and_user_safe_status_only',
  desktop: 'confirmation_ui_dev_supervisor_dev_server_and_host_process_ownership',
  runtime: 'authorization_admission_generation_revocation_and_session_truth',
  kit: 'electron_tauri_typed_bootstrap_status_rotation_and_operation_surface',
});
const admittedWindowsPosture = Object.freeze({
  authority_status: 'admitted',
  implementation_status: 'pending_live_e2e',
  closeout_status: 'blocked',
});
const unimplementedPlatformPosture = Object.freeze({
  authority_status: 'pending_independent_admission',
  implementation_status: 'fail_closed_not_implemented',
  closeout_status: 'blocked',
});

function issue(code, target, reason) {
  return { code, target, reason };
}

function exactArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}

function extractRule(source, ruleId) {
  const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^## ${escaped}\\b`, 'mu').exec(source);
  if (!match) return '';
  const next = source.indexOf('\n## ', match.index + match[0].length);
  return source.slice(match.index, next === -1 ? source.length : next);
}

export function loadAuthorityBundle(root = repoRoot) {
  return Object.fromEntries(Object.entries(authorityPaths).map(([key, relative]) => {
    const absolute = path.join(root, relative);
    return [key, fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null];
  }));
}

export function validateLocalDevelopmentAuthority(bundle) {
  const issues = [];
  for (const [key, relative] of Object.entries(authorityPaths)) {
    if (bundle[key] === null || bundle[key] === undefined) {
      issues.push(issue('LOCAL_DEVELOPMENT_AUTHORITY_FILE_MISSING', relative, 'Required local-development authority file is missing.'));
    }
  }

  for (const [key, [ruleId, ...patterns]] of requiredRules) {
    const section = extractRule(bundle[key] ?? '', ruleId);
    if (!section) {
      issues.push(issue('LOCAL_DEVELOPMENT_AUTHORITY_RULE_MISSING', `${authorityPaths[key]}#${ruleId}`, `Required rule ${ruleId} is missing.`));
      continue;
    }
    for (const pattern of patterns) {
      if (!pattern.test(section)) {
        issues.push(issue('LOCAL_DEVELOPMENT_AUTHORITY_CLAUSE_MISSING', `${authorityPaths[key]}#${ruleId}`, `Required ${ruleId} clause is missing.`));
      }
    }
  }

  let policy;
  if (typeof bundle.policy === 'string') {
    try {
      policy = YAML.parse(bundle.policy);
    } catch {
      issues.push(issue('LOCAL_DEVELOPMENT_AUTHORITY_YAML_INVALID', authorityPaths.policy, 'Local-development authority YAML is invalid.'));
    }
  }
  if (!policy) return issues;

  if (
    policy.table_family !== 'owner_matrix'
    || policy.owner !== 'platform'
    || policy.matrix_id !== 'nimi_app_local_development_admission'
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_POLICY_IDENTITY_INVALID', authorityPaths.policy, 'Policy must be the Platform-owned local-development owner matrix.'));
  }

  const trust = policy.trust_class;
  if (
    trust?.id !== 'local-development-installed-admission'
    || trust?.environment !== 'non_production_development'
    || trust?.mutable_project_allowed !== true
    || trust?.product_readiness_claim_allowed !== false
    || trust?.store_listing_allowed !== false
    || trust?.production_release_conversion !== 'forbidden_new_admission_required'
    || trust?.adoption_alone_authorizes !== false
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_TRUST_CLASS_INVALID', authorityPaths.policy, 'Development trust must stay mutable, non-product, non-listing, and distinct from adoption and production release trust.'));
  }

  const authorization = policy.user_development_authorization;
  if (
    authorization?.owner !== 'runtime_protected_state'
    || !exactArray(authorization?.bindings, authorizationBindings)
    || !exactArray(authorization?.choices, ['run_once', 'remember_project'])
    || authorization?.app_owned_storage_allowed !== false
    || authorization?.renderer_storage_allowed !== false
    || authorization?.generic_keyring_allowed !== false
    || authorization?.survives_technical_session !== true
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_USER_AUTHORIZATION_INVALID', authorityPaths.policy, 'User authorization must use the exact protected bindings, choices, persistence owner, and storage prohibitions.'));
  }

  const session = policy.technical_session;
  if (
    session?.owner !== 'runtime'
    || session?.ttl_class !== 'short_rotating'
    || !exactArray(session?.bindings, sessionBindings)
    || session?.material_visibility !== 'runtime_and_native_host_private_only'
    || session?.cli_visibility !== 'forbidden'
    || session?.renderer_visibility !== 'forbidden'
    || session?.terminal_visibility !== 'forbidden'
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_TECHNICAL_SESSION_INVALID', authorityPaths.policy, 'Technical sessions must be short, process/supervisor/account/epoch bound, and invisible outside Runtime/native host.'));
  }

  if (!exactArray(policy.reapproval_matrix?.no_reapproval, noReapprovalChanges)) {
    issues.push(issue('LOCAL_DEVELOPMENT_NO_REAPPROVAL_MATRIX_INVALID', authorityPaths.policy, 'HMR, controlled restarts, rotation, and Runtime restart must not require repeat confirmation.'));
  }
  if (!exactArray(policy.reapproval_matrix?.reapprove_or_reject, reapprovalOrRejectChanges)) {
    issues.push(issue('LOCAL_DEVELOPMENT_REAPPROVAL_MATRIX_INVALID', authorityPaths.policy, 'Identity, root, capability, account, shell, supervision, output, and server changes must reapprove or reject.'));
  }

  const rows = new Map((policy.rows ?? []).map((row) => [row.owner_id, row]));
  for (const [ownerId, responsibility] of Object.entries(ownerRows)) {
    const row = rows.get(ownerId);
    if (row?.responsibility !== responsibility || row?.may_mint_portable_authority !== false) {
      issues.push(issue('LOCAL_DEVELOPMENT_OWNER_BOUNDARY_INVALID', authorityPaths.policy, `Owner row ${ownerId} is missing or widens portable authority.`));
    }
  }

  if (
    JSON.stringify(policy.platform_posture?.windows) !== JSON.stringify(admittedWindowsPosture)
    || JSON.stringify(policy.platform_posture?.macos) !== JSON.stringify(unimplementedPlatformPosture)
    || JSON.stringify(policy.platform_posture?.linux) !== JSON.stringify(unimplementedPlatformPosture)
    || policy.platform_posture?.localhost_grpc_fallback !== 'forbidden'
    || policy.platform_posture?.same_user_daemon_fallback !== 'forbidden'
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_PLATFORM_POSTURE_INVALID', authorityPaths.policy, 'Authority admission, implementation evidence, and closeout must remain separate while unimplemented platforms and weak fallbacks fail closed.'));
  }

  const evidence = policy.implementation_evidence;
  if (
    evidence?.windows_restricted_runtime_service !== 'green'
    || evidence?.desktop_confirmation_and_supervisor !== 'pending'
    || evidence?.kit_typed_bootstrap_and_rotation !== 'pending'
    || evidence?.app_tools_one_command_launcher !== 'pending'
    || evidence?.electron_live_shell !== 'pending'
    || evidence?.tauri_live_shell !== 'pending'
    || evidence?.authority_gate_green_means_product_closeout_green !== false
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_EVIDENCE_STATUS_INVALID', authorityPaths.policy, 'Restricted-service evidence cannot promote pending Desktop, Kit, app-tools, or live-shell evidence into product closeout.'));
  }

  if (
    !exactArray(policy.command_surface?.commands, ['pnpm dev', 'pnpm dev:shell -- --shell electron', 'pnpm dev:shell -- --shell tauri'])
    || policy.command_surface?.canonical_launcher !== 'nimi-app dev'
    || policy.command_surface?.direct_tauri_dev !== 'denied'
    || policy.command_surface?.manual_electron !== 'denied'
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_COMMAND_SURFACE_INVALID', authorityPaths.policy, 'Public commands must converge on nimi-app dev while direct shell launches remain denied.'));
  }

  if (
    !exactArray(policy.operation_posture?.allowed, ['artifacts.readRuntimeBytes'])
    || !exactArray(policy.operation_posture?.denied_families, ['account', 'lifecycle', 'realm', 'ai', 'realtime', 'media', 'generic_protected_proxy'])
  ) {
    issues.push(issue('LOCAL_DEVELOPMENT_OPERATION_POSTURE_INVALID', authorityPaths.policy, 'A.5 must remain artifact-read-only and deny every unadmitted operation family.'));
  }

  return issues;
}

export function formatAuthorityIssues(issues) {
  return issues.map((entry) => `${entry.code}: ${entry.target}: ${entry.reason}`).join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = validateLocalDevelopmentAuthority(loadAuthorityBundle());
  if (issues.length > 0) {
    process.stderr.write(`${formatAuthorityIssues(issues)}\n`);
    process.exit(1);
  }
  process.stdout.write('local-development admission authority gate passed\n');
}
