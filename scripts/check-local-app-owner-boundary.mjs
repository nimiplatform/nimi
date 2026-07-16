#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const checkerRelative = 'scripts/check-local-app-owner-boundary.mjs';
const authBindingTable = '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml';

const authorityRules = [
  {
    ruleId: 'K-ACCSVC-001',
    contract: '.nimi/spec/runtime/kernel/account-session-contract.md',
    evidence: '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml',
    clauses: [
      ['RUNTIME_REALM_OWNER_MISSING', /Runtime is the sole owner of authenticated Realm unary, realtime, and media data planes/iu],
      ['RUNTIME_LOCAL_APP_COORDINATOR_OWNER_MISSING', /Runtime alone owns[\s\S]*local-app grant mutation[\s\S]*per-operation local-app decision coordinator/iu],
      ['APP_CREDENTIAL_NON_OWNER_MISSING', /Apps MUST NOT own account or session truth, bearer or refresh tokens, or signed upload credentials/iu],
      ['NO_BLANKET_LOCAL_APP_AUTHORITY_MISSING', /local-app origin or grant never creates blanket authorization/iu],
    ],
  },
  {
    ruleId: 'K-ACCSVC-022',
    contract: '.nimi/spec/runtime/kernel/account-session-contract.md',
    evidence: '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml',
    clauses: [
      ['ATOMIC_LOCAL_APP_SESSION_MISSING', /local-app session only from an atomically consumed[\s\S]*launch lease on the verified child channel/iu],
      ['RUNTIME_DERIVED_LOCAL_APP_IDENTITY_MISSING', /`LOCAL_APP` caller class and[\s\S]*`local_app_principal_id` are Runtime-derived/iu],
      ['ZERO_GRANT_DENIAL_MISSING', /zero-grant[\s\S]*session is valid origin proof and must still be denied[\s\S]*until an exact grant and owner policy allow the operation/iu],
      ['PRIVATE_COORDINATOR_MISSING', /private provenance-agnostic per-operation[\s\S]*coordinator/iu],
      ['IMMUTABLE_PROVENANCE_UNAVAILABLE_MISSING', /Immutable provenance remains an opaque input seam and[\s\S]*returns typed unavailable until 0P\/P admits a producer/iu],
    ],
  },
  {
    ruleId: 'K-ACCSVC-023',
    contract: '.nimi/spec/runtime/kernel/account-session-contract.md',
    evidence: '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml',
    clauses: [
      ['REALM_EXACT_SOURCE_READINESS_AUTHORITY_MISSING', /admits only the exact Desktop[\s\S]*source-readiness operations[\s\S]*An unlisted operation or any non-Desktop caller fails[\s\S]*generic proxy behavior is forbidden/iu],
      ['REALM_FALLBACK_DENIAL_MISSING', /No public grant, portable envelope, renderer\/app token[\s\S]*provider, caller-selected Realm base, direct Realm path, or fallback is[\s\S]*admitted/iu],
    ],
  },
  {
    ruleId: 'K-ACCSVC-024',
    contract: '.nimi/spec/runtime/kernel/account-session-contract.md',
    evidence: '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml',
    clauses: [
      ['EXACT_PERMISSION_ROWS_MISSING', /local-app grant[\s\S]*selected local-app operations[\s\S]*admitted only through their exact protected-transport and owner rows/iu],
      ['PORTABLE_BLANKET_AUTHORITY_DENIAL_MISSING', /admits no portable envelope, blanket local-app authority or raw-token[\s\S]*projection/iu],
      ['UNLISTED_OPERATION_DENIAL_MISSING', /Unlisted broker\/realtime\/media operation rows remain denied/iu],
    ],
  },
  {
    ruleId: 'K-ACCSVC-025',
    contract: '.nimi/spec/runtime/kernel/account-session-contract.md',
    evidence: '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml',
    clauses: [
      ['SELF_ASSERTED_AUTHORITY_DENIAL_MISSING', /App id, source host, caller enum, manifest, renderer metadata, host[\s\S]*self-description, launch id and portable bearer remain non-authorizing/iu],
      ['NATIVE_CHANNEL_AUTHORITY_MISSING', /Local[\s\S]*app authority comes only from the inherited native channel and its verified live[\s\S]*peer/iu],
      ['DIRECT_GRPC_RENDERER_DENIAL_MISSING', /Direct local gRPC and Electron\/Tauri renderer envelopes remain deny-all/iu],
    ],
  },
  {
    ruleId: 'P-NAPP-009',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    evidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-nimi-app.yaml',
    clauses: [
      ['PLATFORM_VOCABULARY_OWNER_MISSING', /Platform owns verified catalog\/release,[\s\S]*publisher\/review posture, the permission vocabulary, and the closed local[\s\S]*provenance taxonomy/iu],
      ['RUNTIME_KERNEL_OWNER_SPLIT_MISSING', /Runtime K-APP owns PC-local principals and records;[\s\S]*K-GRANT owns account-and-principal grants; K-PLOCAL owns launch\/process\/session/iu],
      ['APP_SELF_AUTHORIZATION_DENIAL_MISSING', /An app id, catalog row, trust class\/tier, manifest, renderer metadata, or[\s\S]*app-owned host description MUST NOT grant privilege or establish runnable[\s\S]*identity/iu],
      ['APP_TOOLS_NON_OWNER_MISSING', /app-tools owns authoring\/build orchestration only/iu],
      ['DESKTOP_LAUNCHER_NON_OWNER_MISSING', /Desktop is the[\s\S]*current protected `local_app_control` UX\/launcher implementation and is not a[\s\S]*principal, grant, or session owner/iu],
    ],
  },
  {
    ruleId: 'P-NAPP-033',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    evidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-nimi-app.yaml',
    clauses: [
      ['LOCAL_DEVELOPMENT_NOT_CATALOG_TRACK_MISSING', /`local_development` is not[\s\S]*a catalog track/iu],
      ['IMMUTABLE_PACKAGE_UNAVAILABLE_MISSING', /Immutable positive package behavior remains unavailable until 0P/iu],
    ],
  },
  {
    ruleId: 'P-NAPP-034',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    evidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-nimi-app.yaml',
    clauses: [
      ['FIXED_SERVICE_LAUNCH_BOUNDARY_MISSING', /Windows positive third-party sessions require the fixed Runtime service,[\s\S]*`PrepareLocalAppLaunch`[\s\S]*native[\s\S]*peer\/process\/executable proof/iu],
      ['LEASE_RENDERER_CUSTODY_DENIAL_MISSING', /launch lease is necessary but[\s\S]*not durable identity and never enters renderer\/app state/iu],
      ['DIRECT_RUNTIME_LAUNCH_DENIAL_MISSING', /Ordinary gRPC, endpoint\/env[\s\S]*and direct Runtime process launch are forbidden/iu],
    ],
  },
  {
    ruleId: 'P-KIT-044',
    contract: '.nimi/spec/platform/kernel/kit-contract.md',
    evidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-kit.yaml',
    clauses: [
      ['KIT_TRUTH_NON_OWNER_MISSING', /Kit owns typed shell APIs and trusted carrier implementation only[\s\S]*cannot[\s\S]*create account, principal, provenance, record, grant, launch, process, session,[\s\S]*or owner-operation truth/iu],
      ['REQUEST_EMPTY_LOCAL_APP_CARRIER_MISSING', /host-private carrier opens one common[\s\S]*request-empty local-app session/iu],
      ['ELECTRON_TAURI_SHARED_CARRIER_MISSING', /Electron and Tauri host adapters consume the same local-app client and[\s\S]*typed failure model/iu],
      ['GENERIC_PROXY_DENIAL_MISSING', /no\s+method-id\/bytes proxy or generic protected Runtime forwarding is\s+admitted/iu],
      ['KIT_ZERO_GRANT_DENIAL_MISSING', /zero-grant session may project permission posture[\s\S]*but the inventory result authorizes no protected operation/iu],
      ['FIXED_SERVICE_POSITIVE_PATH_MISSING', /Windows fixed-service carrier is the positive path/iu],
      ['DIRECT_DAEMON_RENDERER_FALLBACK_DENIAL_MISSING', /Ordinary gRPC,[\s\S]*external-daemon mode, renderer auth, manually started host, and pseudo-success[\s\S]*fallback are forbidden/iu],
    ],
  },
  {
    ruleId: 'D-NET-006',
    contract: '.nimi/spec/desktop/kernel/network-contract.md',
    evidence: '.nimi/spec/desktop/kernel/tables/rule-evidence.rules-shell-ui.yaml',
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
  const match = new RegExp(`^## ${escaped}\\b`, 'mu').exec(source);
  if (!match) return '';
  const nextHeading = source.indexOf('\n## ', match.index + match[0].length);
  return source.slice(match.index, nextHeading === -1 ? source.length : nextHeading);
}

function extractEvidenceRow(source, ruleId) {
  const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^\\s*-\\s+rule_id:\\s*${escaped}\\s*$`, 'mu').exec(source);
  if (!match) return '';
  const tail = source.slice(match.index + match[0].length);
  const next = /\n\s*-\s+rule_id:/u.exec(tail);
  const end = next ? match.index + match[0].length + next.index : source.length;
  return source.slice(match.index, end);
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
    const evidenceRow = extractEvidenceRow(files.get(authority.evidence) ?? '', authority.ruleId);
    if (!evidenceRow) {
      issues.push(issue('AUTHORITY_EVIDENCE_ROW_MISSING', `${authority.evidence}#${authority.ruleId}`, `Missing evidence row for ${authority.ruleId}.`));
    } else if (!evidenceRow.includes(checkerRelative)) {
      issues.push(issue('EVIDENCE_CHECKER_LINK_MISSING', `${authority.evidence}#${authority.ruleId}`, `${authority.ruleId} must reference ${checkerRelative}.`));
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

function removeEvidenceLink(files, ruleId) {
  const authority = findAuthority(ruleId);
  const source = files.get(authority.evidence) ?? '';
  const row = extractEvidenceRow(source, ruleId);
  const changed = row.replace(new RegExp(`^\\s*-\\s+${checkerRelative.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*$`, 'mu'), '');
  if (changed === row) throw new Error(`fixture evidence link did not match ${ruleId}`);
  files.set(authority.evidence, source.replace(row, changed));
}

const negativeFixtures = [
  ['runtime-owner-removed', 'K-ACCSVC-001', 'RUNTIME_REALM_OWNER_MISSING'],
  ['zero-grant-denial-removed', 'K-ACCSVC-022', 'ZERO_GRANT_DENIAL_MISSING'],
  ['immutable-provenance-fallback', 'K-ACCSVC-022', 'IMMUTABLE_PROVENANCE_UNAVAILABLE_MISSING'],
  ['realm-exact-source-readiness-authority-removed', 'K-ACCSVC-023', 'REALM_EXACT_SOURCE_READINESS_AUTHORITY_MISSING'],
  ['realm-direct-fallback', 'K-ACCSVC-023', 'REALM_FALLBACK_DENIAL_MISSING'],
  ['blanket-local-app-authority', 'K-ACCSVC-024', 'PORTABLE_BLANKET_AUTHORITY_DENIAL_MISSING'],
  ['portable-caller-envelope', 'K-ACCSVC-025', 'NATIVE_CHANNEL_AUTHORITY_MISSING'],
  ['app-self-authorizes', 'P-NAPP-009', 'APP_SELF_AUTHORIZATION_DENIAL_MISSING'],
  ['immutable-package-positive-before-0p', 'P-NAPP-033', 'IMMUTABLE_PACKAGE_UNAVAILABLE_MISSING'],
  ['direct-runtime-launch', 'P-NAPP-034', 'DIRECT_RUNTIME_LAUNCH_DENIAL_MISSING'],
  ['kit-nonempty-session', 'P-KIT-044', 'REQUEST_EMPTY_LOCAL_APP_CARRIER_MISSING'],
  ['desktop-credential-custody', 'D-NET-006', 'DESKTOP_CREDENTIAL_CUSTODY_DENIAL_MISSING'],
].map(([fixtureId, ruleId, expectedCode]) => ({
  fixtureId,
  expectedCode,
  mutate(files) { removeClause(files, ruleId, expectedCode); },
}));

negativeFixtures.push({
  fixtureId: 'authority-evidence-unlinked',
  expectedCode: 'EVIDENCE_CHECKER_LINK_MISSING',
  mutate(files) { removeEvidenceLink(files, 'K-ACCSVC-022'); },
});
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
    ...authorityRules.flatMap((authority) => [authority.contract, authority.evidence]),
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
