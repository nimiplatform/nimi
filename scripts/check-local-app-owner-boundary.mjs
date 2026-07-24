#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const authBindingTable = 'config/platform-standard-shell-capabilities.yaml';

const authorityRules = [
  {
    ruleId: 'K-ACCSVC-001',
    contract: 'docs/authority/runtime-protected-session-rationale.md',
    clauses: [
      ['RUNTIME_REALM_OWNER_MISSING', /Runtime is the sole owner of authenticated Realm unary, realtime, and media data planes/iu],
      ['RUNTIME_LOCAL_APP_COORDINATOR_OWNER_MISSING', /Runtime alone owns[\s\S]*Runtime-owned portion of public permission enforcement[\s\S]*per-operation local-app decision coordinator/iu],
      ['APP_CREDENTIAL_NON_OWNER_MISSING', /Apps MUST NOT own account or session truth, bearer or refresh tokens, or signed upload credentials/iu],
      ['NO_BLANKET_LOCAL_APP_AUTHORITY_MISSING', /local-app origin or permission posture never creates blanket authorization/iu],
    ],
  },
  {
    ruleId: 'K-ACCSVC-022',
    contract: 'docs/authority/runtime-protected-session-rationale.md',
    clauses: [
      ['ATOMIC_LOCAL_APP_SESSION_MISSING', /local-app session only from an atomically consumed[\s\S]*launch lease on the verified child channel/iu],
      ['RUNTIME_DERIVED_LOCAL_APP_IDENTITY_MISSING', /`LOCAL_APP` caller class and[\s\S]*`local_app_principal_id` are Runtime-derived/iu],
      ['ZERO_PERMISSION_BOUNDARY_MISSING', /zero-permission[\s\S]*session is valid origin proof[\s\S]*base entitlements[\s\S]*cannot list protected Agent\/account\/resource[\s\S]*Every user-permission operation remains unavailable/iu],
      ['PRIVATE_COORDINATOR_MISSING', /private provenance-agnostic per-operation[\s\S]*coordinator/iu],
      ['IMMUTABLE_PROVENANCE_UNAVAILABLE_MISSING', /Immutable provenance remains an opaque input seam and[\s\S]*returns typed unavailable until 0P\/P admits a producer/iu],
    ],
  },
  {
    ruleId: 'K-ACCSVC-023',
    contract: 'docs/authority/runtime-protected-session-rationale.md',
    clauses: [
      ['REALM_EXACT_SOURCE_READINESS_AUTHORITY_MISSING', /InvokeRealmUnary` admits only[\s\S]*source-readiness operations enumerated by[\s\S]*An unlisted operation or any[\s\S]*non-Desktop caller fails[\s\S]*generic proxy[\s\S]*behavior is forbidden/iu],
      ['REALM_FALLBACK_DENIAL_MISSING', /No public grant, portable envelope, renderer\/app token[\s\S]*provider, caller-selected Realm base, direct Realm path, or fallback is[\s\S]*admitted/iu],
    ],
  },
  {
    ruleId: 'K-ACCSVC-024',
    contract: 'docs/authority/runtime-protected-session-rationale.md',
    clauses: [
      ['PRODUCT_PERMISSION_ROWS_MISSING', /public[\s\S]*permission status\/request, selected local-app operations[\s\S]*admitted only through their exact protected-[\s\S]*transport and owner rows[\s\S]*no public permission decision or revoke RPC/iu],
      ['PORTABLE_BLANKET_AUTHORITY_DENIAL_MISSING', /admits no portable envelope, blanket local-app authority or raw-token[\s\S]*projection/iu],
      ['UNLISTED_OPERATION_DENIAL_MISSING', /Unlisted broker\/realtime\/media operation rows remain denied/iu],
    ],
  },
  {
    ruleId: 'K-ACCSVC-025',
    contract: 'docs/authority/runtime-protected-session-rationale.md',
    clauses: [
      ['SELF_ASSERTED_AUTHORITY_DENIAL_MISSING', /App id, source host, caller enum, manifest, renderer metadata, host[\s\S]*self-description, launch id and portable bearer remain non-authorizing/iu],
      ['NATIVE_CHANNEL_AUTHORITY_MISSING', /Local[\s\S]*app authority comes only from the inherited native channel and its verified live[\s\S]*peer/iu],
      ['DIRECT_GRPC_RENDERER_DENIAL_MISSING', /Direct local gRPC and Electron\/Tauri renderer envelopes remain deny-all/iu],
    ],
  },
  {
    ruleId: 'P-NAPP-009',
    contract: 'docs/authority/platform-app-ecosystem-rationale.md',
    clauses: [
      ['PLATFORM_VOCABULARY_OWNER_MISSING', /Platform owns verified catalog\/release,[\s\S]*publisher\/review posture, the permission vocabulary, and the closed local[\s\S]*provenance taxonomy/iu],
      ['RUNTIME_KERNEL_OWNER_SPLIT_MISSING', /Runtime K-APP owns PC-local principals and records;[\s\S]*canonical domain owners own admitted permission decisions and K-GRANT defines[\s\S]*Runtime-owned lifecycle boundary; K-PLOCAL owns launch\/process\/session/iu],
      ['APP_SELF_AUTHORIZATION_DENIAL_MISSING', /An app id, catalog row, trust class\/tier, manifest, renderer metadata, or[\s\S]*app-owned host description MUST NOT grant privilege or establish runnable[\s\S]*identity/iu],
      ['APP_TOOLS_NON_OWNER_MISSING', /app-tools owns authoring\/build orchestration only/iu],
      ['DESKTOP_LAUNCHER_NON_OWNER_MISSING', /Desktop is the[\s\S]*current protected `local_app_control` UX\/launcher implementation and is not a[\s\S]*principal, permission-decision, or session owner/iu],
    ],
  },
  {
    ruleId: 'P-NAPP-033',
    contract: 'docs/authority/platform-app-ecosystem-rationale.md',
    clauses: [
      ['LOCAL_DEVELOPMENT_NOT_CATALOG_TRACK_MISSING', /`local_development` is not[\s\S]*a catalog track/iu],
      ['IMMUTABLE_PACKAGE_UNAVAILABLE_MISSING', /Immutable positive package behavior remains unavailable until 0P/iu],
    ],
  },
  {
    ruleId: 'P-NAPP-034',
    contract: 'docs/authority/platform-app-ecosystem-rationale.md',
    clauses: [
      ['FIXED_SERVICE_LAUNCH_BOUNDARY_MISSING', /Positive third-party sessions[\s\S]*require the[\s\S]*same-OS fixed Runtime service[\s\S]*`PrepareLocalAppLaunch`[\s\S]*native peer\/process\/executable[\s\S]*proof/iu],
      ['LEASE_RENDERER_CUSTODY_DENIAL_MISSING', /launch lease is necessary but not durable identity and never enters[\s\S]*renderer\/app state/iu],
      ['DIRECT_RUNTIME_LAUNCH_DENIAL_MISSING', /Ordinary gRPC, endpoint\/env[\s\S]*and direct Runtime process launch are forbidden/iu],
    ],
  },
  {
    ruleId: 'P-KIT-044',
    contract: 'docs/authority/platform-ui-design-system-rationale.md',
    clauses: [
      ['KIT_TRUTH_NON_OWNER_MISSING', /Kit owns typed shell APIs and trusted carrier implementation only[\s\S]*cannot[\s\S]*create account, principal, provenance, record, permission decision, launch,[\s\S]*process, session, or owner-operation truth/iu],
      ['REQUEST_EMPTY_LOCAL_APP_CARRIER_MISSING', /host-private carrier opens one common[\s\S]*request-empty local-app session/iu],
      ['ELECTRON_TAURI_SHARED_CARRIER_MISSING', /Electron and Tauri host adapters consume the same local-app client and[\s\S]*typed failure model/iu],
      ['GENERIC_PROXY_DENIAL_MISSING', /no\s+method-id\/bytes proxy or generic protected Runtime forwarding is\s+admitted/iu],
      ['KIT_ZERO_PERMISSION_BOUNDARY_MISSING', /No public permission is[\s\S]*currently admitted[\s\S]*Artifact, Agent, conversation and voice methods are absent[\s\S]*valid session may use app-private storage without any permission/iu],
      ['FIXED_SERVICE_POSITIVE_PATH_MISSING', /Windows fixed-service carrier is the positive path/iu],
      ['DIRECT_DAEMON_RENDERER_FALLBACK_DENIAL_MISSING', /Ordinary gRPC,[\s\S]*external-daemon mode, renderer auth, manually started host, and pseudo-success[\s\S]*fallback are forbidden/iu],
    ],
  },
  {
    ruleId: 'P-PERM-011',
    contract: 'docs/authority/platform-app-ecosystem-rationale.md',
    clauses: [
      ['APP_PRIVATE_STORAGE_BASE_ENTITLEMENT_MISSING', /An app does not ask Nimi for permission to use its own SQLite, JSON store,[\s\S]*media, settings, cache or product routes/iu],
      ['NATIVE_APP_STORAGE_AUTHORITY_MISSING', /Native app storage[\s\S]*is `app_owned_authority` under actual OS rights/iu],
      ['EXTERNAL_RESOURCE_SEPARATION_MISSING', /External files are different:[\s\S]*None creates a generic filesystem permission/iu],
    ],
  },
  {
    ruleId: 'P-PERM-015',
    contract: 'docs/authority/platform-app-ecosystem-rationale.md',
    clauses: [
      ['FIVE_AUTHORITY_CLASSES_MISSING', /`base_entitlement`[\s\S]*`user_permission`[\s\S]*`one_shot_consent`[\s\S]*`app_owned_authority`[\s\S]*`os_right`/iu],
      ['AUTHORITY_CLASS_EXCLUSIVITY_MISSING', /The classes are mutually exclusive/iu],
      ['APP_OWNED_PROXY_DENIAL_MISSING', /App-owned commands must not[\s\S]*proxy protected Nimi operations/iu],
    ],
  },
  {
    ruleId: 'P-PERM-017',
    contract: 'docs/authority/platform-app-ecosystem-rationale.md',
    clauses: [
      ['ATOMIC_PERMISSION_ADMISSION_MISSING', /permission is admitted only when all of these land atomically:[\s\S]*catalog row[\s\S]*decision owner[\s\S]*endpoint[\s\S]*SDK\/Kit[\s\S]*approval UI[\s\S]*audit/iu],
      ['DURABLE_PERMISSION_CONTROL_MISSING', /Durable permissions additionally require settings and[\s\S]*revoke UI/iu],
      ['ONE_SHOT_LIFECYCLE_MISSING', /One-shot consent instead requires exact preview\/selection display,[\s\S]*expiry,[\s\S]*single consumption,[\s\S]*cancellation and replay rejection; it must not[\s\S]*create a durable settings row/iu],
      ['HUMAN_INTENT_UX_BUDGET_MISSING', /one decision per recognizable intent and selected[\s\S]*resource set/iu],
      ['INSTALL_METHOD_PERMISSION_WALL_DENIAL_MISSING', /Install-time permission walls, method-level prompts[\s\S]*are forbidden/iu],
      ['ZERO_PROMPT_APP_OWNED_PATH_MISSING', /normal app using only its own data must launch with zero Nimi[\s\S]*permission prompts/iu],
    ],
  },
  {
    ruleId: 'rule.nimi.desktop.shell-runtime.r078',
    contract: '.nimi/spec/canonical/desktop/shell-runtime.authority.yaml',
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
  ['runtime-owner-removed', 'K-ACCSVC-001', 'RUNTIME_REALM_OWNER_MISSING'],
  ['zero-permission-boundary-removed', 'K-ACCSVC-022', 'ZERO_PERMISSION_BOUNDARY_MISSING'],
  ['immutable-provenance-fallback', 'K-ACCSVC-022', 'IMMUTABLE_PROVENANCE_UNAVAILABLE_MISSING'],
  ['realm-exact-source-readiness-authority-removed', 'K-ACCSVC-023', 'REALM_EXACT_SOURCE_READINESS_AUTHORITY_MISSING'],
  ['realm-direct-fallback', 'K-ACCSVC-023', 'REALM_FALLBACK_DENIAL_MISSING'],
  ['blanket-local-app-authority', 'K-ACCSVC-024', 'PORTABLE_BLANKET_AUTHORITY_DENIAL_MISSING'],
  ['portable-caller-envelope', 'K-ACCSVC-025', 'NATIVE_CHANNEL_AUTHORITY_MISSING'],
  ['app-self-authorizes', 'P-NAPP-009', 'APP_SELF_AUTHORIZATION_DENIAL_MISSING'],
  ['immutable-package-positive-before-0p', 'P-NAPP-033', 'IMMUTABLE_PACKAGE_UNAVAILABLE_MISSING'],
  ['direct-runtime-launch', 'P-NAPP-034', 'DIRECT_RUNTIME_LAUNCH_DENIAL_MISSING'],
  ['kit-nonempty-session', 'P-KIT-044', 'REQUEST_EMPTY_LOCAL_APP_CARRIER_MISSING'],
  ['app-private-storage-requires-nimi-permission', 'P-PERM-011', 'APP_PRIVATE_STORAGE_BASE_ENTITLEMENT_MISSING'],
  ['authority-classes-collapsed', 'P-PERM-015', 'AUTHORITY_CLASS_EXCLUSIVITY_MISSING'],
  ['permission-admission-partial', 'P-PERM-017', 'ATOMIC_PERMISSION_ADMISSION_MISSING'],
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

