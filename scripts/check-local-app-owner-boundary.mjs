#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const authBindingTable = 'config/platform-standard-shell-capabilities.yaml';

const authorityRules = [
  {
    ruleId: 'rule.nimi.runtime.protected-session.r063',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['RUNTIME_REALM_OWNER_MISSING', /Runtime is the sole owner of authenticated Realm unary, realtime, and media data planes/iu],
      ['RUNTIME_LOCAL_APP_COORDINATOR_OWNER_MISSING', /Runtime alone owns[\s\S]*Runtime-owned portion of public permission enforcement[\s\S]*per-operation local-app decision coordinator/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r064',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['APP_CREDENTIAL_NON_OWNER_MISSING', /Apps own account or session truth, bearer or refresh tokens, or signed upload credentials/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r065',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['NO_BLANKET_LOCAL_APP_AUTHORITY_MISSING', /local-app origin or permission posture never creates blanket authorization/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r104',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['ATOMIC_LOCAL_APP_SESSION_MISSING', /local-app session only from an atomically consumed launch lease on the verified child channel/iu],
      ['RUNTIME_DERIVED_LOCAL_APP_IDENTITY_MISSING', /LOCAL_APP caller class and local_app_principal_id are Runtime-derived/iu],
      ['ZERO_PERMISSION_BOUNDARY_MISSING', /zero-permission session is valid origin proof[\s\S]*base entitlements[\s\S]*cannot list protected Agent, account, or resource inventory[\s\S]*every user-permission operation remains unavailable/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r105',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['PRIVATE_COORDINATOR_MISSING', /private provenance-agnostic per-operation coordinator/iu],
      ['IMMUTABLE_PROVENANCE_UNAVAILABLE_MISSING', /immutable provenance remains an opaque input seam returning typed unavailable until 0P\/P admits a producer/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r106',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['REALM_EXACT_SOURCE_READINESS_AUTHORITY_MISSING', /InvokeRealmUnary admits only the exact Desktop source-readiness operations[\s\S]*an unlisted operation or any non-Desktop caller fails[\s\S]*generic proxy behavior is forbidden/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r107',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['REALM_FALLBACK_DENIAL_MISSING', /no public grant, portable envelope, renderer or app token provider, caller-selected Realm base, direct Realm path, or fallback is admitted/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r108',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['PRODUCT_PERMISSION_ROWS_MISSING', /local-app public permission status and request, selected local-app operations[\s\S]*admitted only through their exact protected-transport and owner rows[\s\S]*no public permission decision or revoke RPC/iu],
      ['PORTABLE_BLANKET_AUTHORITY_DENIAL_MISSING', /no portable envelope, blanket local-app authority, or raw-token projection is admitted/iu],
      ['UNLISTED_OPERATION_DENIAL_MISSING', /unlisted broker, realtime, and media operation rows remain denied/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r109',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['SELF_ASSERTED_AUTHORITY_DENIAL_MISSING', /App id, source host, caller enum, manifest, renderer metadata, host self-description, launch id, and portable bearer remain non-authorizing/iu],
      ['NATIVE_CHANNEL_AUTHORITY_MISSING', /local app authority comes only from the inherited native channel and its verified live peer/iu],
      ['DIRECT_GRPC_RENDERER_DENIAL_MISSING', /direct local gRPC and Electron or Tauri renderer envelopes remain deny-all/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-napp-009a',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['PLATFORM_VOCABULARY_OWNER_MISSING', /Platform owns catalog, release, publisher and review posture, permission vocabulary, and provenance taxonomy/iu],
      ['RUNTIME_KERNEL_OWNER_SPLIT_MISSING', /Runtime and canonical domain owners retain principals, records, grants, launch, sessions, credentials, and operations/iu],
      ['APP_TOOLS_NON_OWNER_MISSING', /app-tools owns only authoring and build orchestration/iu],
      ['DESKTOP_LAUNCHER_NON_OWNER_MISSING', /Desktop is only the current protected launcher implementation/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-napp-009b',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['APP_SELF_AUTHORIZATION_DENIAL_MISSING', /App id, catalog row, tier, manifest, renderer metadata, host description, Desktop, or app-tools grants privilege or runnable identity/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-napp-033',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['LOCAL_DEVELOPMENT_NOT_CATALOG_TRACK_MISSING', /local_development is not a catalog track/iu],
      ['IMMUTABLE_PACKAGE_UNAVAILABLE_MISSING', /positive immutable behavior remains unavailable until admitted/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-napp-034a',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['FIXED_SERVICE_LAUNCH_BOUNDARY_MISSING', /positive third-party session requires same-OS fixed Runtime[\s\S]*PrepareLocalAppLaunch[\s\S]*native peer, process, and executable proof/iu],
      ['LEASE_RENDERER_CUSTODY_DENIAL_MISSING', /lease is non-durable and absent from renderer and app state/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-napp-034b',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['DIRECT_RUNTIME_LAUNCH_DENIAL_MISSING', /ordinary gRPC, endpoint or environment selection[\s\S]*direct Runtime process launch never substitute/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.ui-design-system.p-kit-044',
    contract: '.nimi/spec/platform/ui-design-system.authority.yaml',
    clauses: [
      ['KIT_TRUTH_NON_OWNER_MISSING', /Kit never creates or accepts account, principal, provenance, record, permission decision, launch, process, session, owner-operation, endpoint, proof, or security truth/iu],
      ['ELECTRON_TAURI_SHARED_CARRIER_MISSING', /Electron and Tauri share one verified Runtime-bound client/iu],
      ['GENERIC_PROXY_DENIAL_MISSING', /no generic proxy/iu],
      ['KIT_ZERO_PERMISSION_BOUNDARY_MISSING', /no public permission is currently admitted[\s\S]*no generic proxy[\s\S]*artifact, Agent, conversation, or voice surface exists[\s\S]*app-native data and commands remain app-owned/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r017',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['REQUEST_EMPTY_LOCAL_APP_CARRIER_MISSING', /OpenLocalAppSession has an empty request/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.runtime.protected-session.r021',
    contract: '.nimi/spec/runtime/protected-session.authority.yaml',
    clauses: [
      ['FIXED_SERVICE_POSITIVE_PATH_MISSING', /Windows row is admitted independently and carries the current fixed-service/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.ui-design-system.p-kit-044-recovery',
    contract: '.nimi/spec/platform/ui-design-system.authority.yaml',
    clauses: [
      ['DIRECT_DAEMON_RENDERER_FALLBACK_DENIAL_MISSING', /no ordinary RPC, external daemon, manually started host[\s\S]*pseudo-success fallback/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-perm-011a',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['APP_PRIVATE_STORAGE_BASE_ENTITLEMENT_MISSING', /An app needs no Nimi permission for its own SQLite, JSON, media, settings, cache, or product routes/iu],
      ['NATIVE_APP_STORAGE_AUTHORITY_MISSING', /native app storage is app_owned_authority under actual OS rights/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-perm-011b',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['EXTERNAL_RESOURCE_SEPARATION_MISSING', /Reserved files.open and files.save use one-shot native picker handles[\s\S]*none creates generic filesystem permission/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-perm-015a',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['FIVE_AUTHORITY_CLASSES_MISSING', /base_entitlement, user_permission, one_shot_consent, app_owned_authority, or os_right/iu],
      ['AUTHORITY_CLASS_EXCLUSIVITY_MISSING', /resolves to exactly one of/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-perm-015b',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['APP_OWNED_PROXY_DENIAL_MISSING', /An app-owned command proxies a protected Nimi operation/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-perm-017a',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['ATOMIC_PERMISSION_ADMISSION_MISSING', /Public permission admission atomically includes catalog row, one decision owner[\s\S]*enforcement at every endpoint, SDK and Kit surface, just-in-time approval UI, and audit/iu],
      ['DURABLE_PERMISSION_CONTROL_MISSING', /durable permissions also include settings and revoke UI/iu],
      ['ONE_SHOT_LIFECYCLE_MISSING', /one-shot consent includes exact preview, selection, expiry, single consumption, cancellation, and replay rejection and creates no durable settings row/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.platform.app-ecosystem.p-perm-017b',
    contract: '.nimi/spec/platform/app-ecosystem.authority.yaml',
    clauses: [
      ['HUMAN_INTENT_UX_BUDGET_MISSING', /one decision per recognizable intent and selected resource set/iu],
      ['INSTALL_METHOD_PERMISSION_WALL_DENIAL_MISSING', /forbids install-time permission walls, method-level prompts/iu],
      ['ZERO_PROMPT_APP_OWNED_PATH_MISSING', /normal app using only its own data zero Nimi permission prompts/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.desktop.shell-runtime.r078',
    contract: '.nimi/spec/desktop/shell-runtime.authority.yaml',
    clauses: [
      ['DESKTOP_LIFECYCLE_ONLY_OWNER_MISSING', /Desktop owns account-control and lifecycle UX and verified process launch/iu],
      ['RUNTIME_REALM_TRANSPORT_OWNER_MISSING', /Runtime remains the sole owner of authenticated Realm unary, realtime, and media transport/iu],
      ['DESKTOP_CREDENTIAL_CUSTODY_DENIAL_MISSING', /Desktop, Electron\/Tauri main, preload, renderer, and app code cannot mint, request, inject, cache, or refresh Realm bearer or signed-upload credentials/iu],
    ],
  },
];

const retiredAuthorityPatterns = [
  /Windows installed session/iu,
  /runtime_owned_installed_session_host_carried/iu,
  /desktop-launched-nimi-app/iu,
  /\*\*A\.[01] authority disposition/iu,
];

function issue(code, location, reason) {
  return { code, location, reason };
}

function extractRule(source, ruleId) {
  const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const markdownMatch = new RegExp(`^## ${escaped}\\b`, 'mu').exec(source);
  if (markdownMatch) {
    const nextHeading = source.indexOf('\n## ', markdownMatch.index + markdownMatch[0].length);
    return source.slice(markdownMatch.index, nextHeading === -1 ? source.length : nextHeading);
  }
  const yamlMatch = new RegExp(`^  - id: ${escaped}\\s*$`, 'mu').exec(source);
  if (!yamlMatch) return '';
  const nextUnit = source.indexOf('\n  - id:', yamlMatch.index + yamlMatch[0].length);
  return source.slice(yamlMatch.index, nextUnit === -1 ? source.length : nextUnit);
}

function validateBundle(files) {
  const issues = [];
  for (const authority of authorityRules) {
    const location = `${authority.contract}#${authority.ruleId}`;
    const section = extractRule(files.get(authority.contract) ?? '', authority.ruleId);
    if (!section) {
      issues.push(issue('AUTHORITY_RULE_MISSING', location, `Missing authority rule ${authority.ruleId}.`));
      continue;
    }
    for (const [code, pattern] of authority.clauses) {
      if (!pattern.test(section)) issues.push(issue(code, location, `Missing final local-app authority clause ${code}.`));
    }
    for (const pattern of retiredAuthorityPatterns) {
      if (pattern.test(section)) {
        issues.push(issue('RETIRED_INSTALLED_AUTHORITY_PRESENT', location, `Retired installed-app authority remains in ${authority.ruleId}.`));
        break;
      }
    }
  }

  const binding = files.get(authBindingTable) ?? '';
  if (!/^\s+auth_binding:\s+runtime_owned_request_empty_local_app_session\s*$/mu.test(binding)) {
    issues.push(issue('AUTH_BINDING_OWNER_INVALID', authBindingTable, 'auth_binding must be Runtime-owned, request-empty, and host-carried.'));
  }
  return issues;
}

function findAuthority(ruleId) {
  const authority = authorityRules.find((candidate) => candidate.ruleId === ruleId);
  if (!authority) throw new Error(`unknown fixture authority ${ruleId}`);
  return authority;
}

function removeClause(files, ruleId, code) {
  const authority = findAuthority(ruleId);
  const clause = authority.clauses.find(([candidate]) => candidate === code);
  if (!clause) throw new Error(`unknown fixture clause ${ruleId}/${code}`);
  const source = files.get(authority.contract) ?? '';
  const section = extractRule(source, ruleId);
  const changed = section.replace(clause[1], 'Fixture removed this authority clause.');
  if (changed === section) throw new Error(`fixture clause did not match ${ruleId}/${code}`);
  files.set(authority.contract, source.replace(section, changed));
}

const negativeFixtures = [
  ['runtime-owner-removed', 'rule.nimi.runtime.protected-session.r063', 'RUNTIME_REALM_OWNER_MISSING'],
  ['zero-permission-boundary-removed', 'rule.nimi.runtime.protected-session.r104', 'ZERO_PERMISSION_BOUNDARY_MISSING'],
  ['immutable-provenance-fallback', 'rule.nimi.runtime.protected-session.r105', 'IMMUTABLE_PROVENANCE_UNAVAILABLE_MISSING'],
  ['realm-exact-source-readiness-authority-removed', 'rule.nimi.runtime.protected-session.r106', 'REALM_EXACT_SOURCE_READINESS_AUTHORITY_MISSING'],
  ['realm-direct-fallback', 'rule.nimi.runtime.protected-session.r107', 'REALM_FALLBACK_DENIAL_MISSING'],
  ['blanket-local-app-authority', 'rule.nimi.runtime.protected-session.r108', 'PORTABLE_BLANKET_AUTHORITY_DENIAL_MISSING'],
  ['portable-caller-envelope', 'rule.nimi.runtime.protected-session.r109', 'NATIVE_CHANNEL_AUTHORITY_MISSING'],
  ['app-self-authorizes', 'rule.nimi.platform.app-ecosystem.p-napp-009b', 'APP_SELF_AUTHORIZATION_DENIAL_MISSING'],
  ['immutable-package-positive-before-0p', 'rule.nimi.platform.app-ecosystem.p-napp-033', 'IMMUTABLE_PACKAGE_UNAVAILABLE_MISSING'],
  ['direct-runtime-launch', 'rule.nimi.platform.app-ecosystem.p-napp-034b', 'DIRECT_RUNTIME_LAUNCH_DENIAL_MISSING'],
  ['kit-nonempty-session', 'rule.nimi.runtime.protected-session.r017', 'REQUEST_EMPTY_LOCAL_APP_CARRIER_MISSING'],
  ['app-private-storage-requires-nimi-permission', 'rule.nimi.platform.app-ecosystem.p-perm-011a', 'APP_PRIVATE_STORAGE_BASE_ENTITLEMENT_MISSING'],
  ['authority-classes-collapsed', 'rule.nimi.platform.app-ecosystem.p-perm-015a', 'AUTHORITY_CLASS_EXCLUSIVITY_MISSING'],
  ['permission-admission-partial', 'rule.nimi.platform.app-ecosystem.p-perm-017a', 'ATOMIC_PERMISSION_ADMISSION_MISSING'],
  ['desktop-credential-custody', 'rule.nimi.desktop.shell-runtime.r078', 'DESKTOP_CREDENTIAL_CUSTODY_DENIAL_MISSING'],
].map(([fixtureId, ruleId, expectedCode]) => ({
  fixtureId,
  expectedCode,
  mutate(files) { removeClause(files, ruleId, expectedCode); },
}));

negativeFixtures.push({
  fixtureId: 'host-owned-session-binding',
  expectedCode: 'AUTH_BINDING_OWNER_INVALID',
  mutate(files) {
    const source = files.get(authBindingTable) ?? '';
    const changed = source.replace('runtime_owned_request_empty_local_app_session', 'host_owned_local_app_session');
    if (changed === source) throw new Error('fixture auth binding did not match');
    files.set(authBindingTable, changed);
  },
});

async function loadBundle() {
  const paths = new Set([
    ...authorityRules.map((authority) => authority.contract),
    authBindingTable,
  ]);
  const files = new Map();
  for (const relative of paths) files.set(relative, await fs.readFile(path.join(repoRoot, relative), 'utf8'));
  return files;
}

function runNegativeFixtures(baseline) {
  return negativeFixtures.map((fixture) => {
    const files = new Map(baseline);
    fixture.mutate(files);
    const issues = validateBundle(files);
    if (issues.length !== 1 || issues[0].code !== fixture.expectedCode) {
      throw new Error(`negative fixture ${fixture.fixtureId} produced unexpected rejection: ${JSON.stringify(issues)}`);
    }
    return { fixtureId: fixture.fixtureId, code: issues[0].code, reason: issues[0].reason };
  });
}

async function main() {
  const baseline = await loadBundle();
  const issues = validateBundle(baseline);
  if (issues.length > 0) {
    process.stderr.write('local-app owner boundary failed:\n');
    for (const item of issues) process.stderr.write(`- ${item.code}: ${item.reason} (${item.location})\n`);
    process.exitCode = 1;
    return;
  }
  const fixtures = runNegativeFixtures(baseline);
  if (process.argv.includes('--fixture-report-json')) {
    process.stdout.write(`${JSON.stringify({ fixtures }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`local-app owner boundary: OK (${authorityRules.length} authority rules, ${fixtures.length} negative fixtures)\n`);
}

main().catch((error) => {
  process.stderr.write(`local-app owner boundary failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

