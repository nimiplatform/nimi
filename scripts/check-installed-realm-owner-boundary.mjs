#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const checkerRelative = 'scripts/check-installed-realm-owner-boundary.mjs';
const authBindingTable = '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml';

const ownerRules = [
  {
    ruleId: 'K-ACCSVC-001',
    contract: '.nimi/spec/runtime/kernel/account-session-contract.md',
    evidence: '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml',
    required: [
      /Runtime is the sole owner of authenticated Realm unary, realtime, and media data planes/iu,
      /account and token custody, private refresh, and authenticated Realm credential exchange/iu,
      /Apps MUST NOT own account or session truth, bearer or refresh tokens, or signed upload credentials/iu,
      /per-operation unary rows, realtime protocol or dependency posture, and media state or limits remain blocked authority conflicts/iu,
    ],
  },
  {
    ruleId: 'P-NAPP-009',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    evidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-nimi-app.yaml',
    required: [
      /Platform is the sole owner of dynamic installed-app catalog, release, capability, grant, and trust-root truth/iu,
      /app id, manifest, renderer metadata, or app-owned host self-description MUST NOT grant privilege/iu,
      /self-certifying evidence/iu,
      /detailed catalog, release, and launch rows remain blocked authority conflicts/iu,
      /app-tools owns authoring, sync, doctor, and launcher orchestration only/iu,
    ],
  },
  {
    ruleId: 'S-RUNTIME-109',
    contract: '.nimi/spec/sdks/kernel/runtime-contract.md',
    evidence: '.nimi/spec/sdks/kernel/tables/rule-evidence.rules-runtime-client.yaml',
    required: [
      /SDK owns typed Runtime APIs and trusted carriers only/iu,
      /MUST NOT own or infer account, token, unary, realtime, or media truth/iu,
    ],
  },
  {
    ruleId: 'S-REALM-040',
    contract: '.nimi/spec/sdks/kernel/realm-contract.md',
    evidence: '.nimi/spec/sdks/kernel/tables/rule-evidence.rules-domain-adapters.yaml',
    required: [
      /SDK owns typed Realm APIs and trusted carriers only/iu,
      /Runtime remains the sole owner of every authenticated Realm data plane/iu,
      /compatibility evidence must precede any replay posture/iu,
    ],
  },
  {
    ruleId: 'P-KIT-044',
    contract: '.nimi/spec/platform/kernel/kit-contract.md',
    evidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-kit.yaml',
    required: [
      /Kit owns typed shell APIs and trusted carrier implementation only/iu,
      /host or renderer MUST NOT supply or retain authenticated Realm credentials/iu,
    ],
  },
  {
    ruleId: 'D-NET-006',
    contract: '.nimi/spec/desktop/kernel/network-contract.md',
    evidence: '.nimi/spec/desktop/kernel/tables/rule-evidence.rules-shell-ui.yaml',
    required: [
      /Desktop owns account-control and lifecycle UX and verified process launch/iu,
      /Runtime remains the sole owner of authenticated Realm unary, realtime, and media transport/iu,
      /D-NET-006 and D-NET-007 detailed clauses remain blocked authority conflicts/iu,
      /compatibility evidence must precede any replay posture/iu,
    ],
  },
];

const detailedRules = [
  ...['K-ACCSVC-022', 'K-ACCSVC-023', 'K-ACCSVC-024', 'K-ACCSVC-025'].map((ruleId) => ({
    ruleId,
    contract: '.nimi/spec/runtime/kernel/account-session-contract.md',
    evidence: '.nimi/spec/runtime/kernel/tables/rule-evidence.rules-core-auth.yaml',
    checkerTestRequired: true,
  })),
  ...['P-NAPP-033', 'P-NAPP-034'].map((ruleId) => ({
    ruleId,
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    evidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-nimi-app.yaml',
    checkerTestRequired: true,
  })),
  ...['S-REALM-035', 'S-REALM-036', 'S-REALM-037'].map((ruleId) => ({
    ruleId,
    contract: '.nimi/spec/sdks/kernel/realm-contract.md',
    evidence: '.nimi/spec/sdks/kernel/tables/rule-evidence.rules-domain-adapters.yaml',
    checkerTestRequired: false,
  })),
  {
    ruleId: 'D-NET-007',
    contract: '.nimi/spec/desktop/kernel/network-contract.md',
    evidence: '.nimi/spec/desktop/kernel/tables/rule-evidence.rules-shell-ui.yaml',
    checkerTestRequired: true,
  },
];

const authorityPostures = new Map([
  ['K-ACCSVC-022', {
    admitted: /`K-PLOCAL-001\.\.007` admit only the prerequisite that protected authority must\s+come from a mutually verified live-process connection/iu,
    blocked: /A\.0 admits no installed\s+caller enum[\s\S]*independent A\.1 Runtime\/Platform\/Desktop\/Kit\/SDK authority batch[\s\S]*every installed-app account method is deny-all/iu,
  }],
  ['K-ACCSVC-023', {
    blocked: /Exact per-operation Realm unary authority remains blocked pending a separate\s+Runtime admission[\s\S]*no public grant,\s+portable envelope, renderer\/app token provider, or direct Realm path is a\s+fallback/iu,
  }],
  ['K-ACCSVC-024', {
    admitted: /\*\*A\.0 authority disposition:\*\*[\s\S]*\badmitted only through\b[\s\S]*This admits no Realm\s+operation row, payload policy, installed carrier, or raw-token projection/iu,
    blocked: /\*\*Remaining authority disposition:\*\* Blocked detailed authority conflict\./iu,
  }],
  ['K-ACCSVC-025', {
    admitted: /A\.0 establishes only that[\s\S]*are\s+non-authorizing/iu,
    blocked: /installed-host carrier\/envelope schema is deliberately\s+absent and requires A\.1 authority[\s\S]*deny-all for installed account access/iu,
  }],
  ['P-NAPP-034', {
    admitted: /\*\*A\.0 authority disposition:\*\* Admitted per OS platform:[\s\S]*protected-local-executable-trust-sets\.yaml[\s\S]*unadmitted platform remains fail-closed/iu,
    blocked: /\*\*Remaining authority disposition:\*\* blocked pending A\.1\.[\s\S]*A\.0 defines no\s+launch-resolution fields[\s\S]*`OpenApp` cannot report launched\/create a child/iu,
  }],
]);

const ownerImplementationEvidence = new Map([
  ['P-KIT-044', [
    'nimi_kit_gate',
    'kit/shell/electron/test/electron-shell-capabilities.test.ts',
    'apps/desktop/test/desktop-installed-app-launcher.test.ts',
  ]],
  ['D-NET-006', ['desktop_lint_gate', 'desktop_test_gate']],
]);

const detailedImplementationEvidence = new Map([
  ['K-ACCSVC-024', [
    'runtime_go_test',
    'runtime/internal/services/account/service_test.go',
    'runtime/internal/services/account/realm_unary_test.go',
  ]],
  ['D-NET-007', ['desktop_lint_gate', 'desktop_test_gate']],
]);

const forbiddenAllocations = [
  {
    code: 'APP_ID_AUTHORIZATION_FORBIDDEN',
    reason: 'An app id cannot grant installed-app privilege.',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    ruleId: 'P-NAPP-009',
    pattern: /An app id grants installed-app privilege\./iu,
  },
  {
    code: 'MANIFEST_AUTHORIZATION_FORBIDDEN',
    reason: 'An app manifest cannot grant installed-app privilege.',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    ruleId: 'P-NAPP-009',
    pattern: /An app manifest grants installed-app privilege\./iu,
  },
  {
    code: 'RENDERER_METADATA_AUTHORIZATION_FORBIDDEN',
    reason: 'Renderer metadata cannot grant installed-app privilege.',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    ruleId: 'P-NAPP-009',
    pattern: /Renderer metadata grants installed-app privilege\./iu,
  },
  {
    code: 'APP_HOST_SELF_DESCRIPTION_AUTHORIZATION_FORBIDDEN',
    reason: 'App-owned host self-description cannot grant installed-app privilege.',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    ruleId: 'P-NAPP-009',
    pattern: /App-owned host self-description grants installed-app privilege\./iu,
  },
  {
    code: 'HOST_REALM_CREDENTIAL_CUSTODY_FORBIDDEN',
    reason: 'A shell host is a carrier and cannot own authenticated Realm credential custody.',
    contract: '.nimi/spec/platform/kernel/kit-contract.md',
    ruleId: 'P-KIT-044',
    pattern: /The host owns authenticated Realm credential custody\./iu,
  },
  {
    code: 'RENDERER_REALM_CREDENTIAL_CUSTODY_FORBIDDEN',
    reason: 'A renderer cannot own authenticated Realm credential custody.',
    contract: '.nimi/spec/desktop/kernel/network-contract.md',
    ruleId: 'D-NET-006',
    pattern: /The renderer owns authenticated Realm credential custody\./iu,
  },
  {
    code: 'STATIC_PER_APP_AUTHORITY_FORBIDDEN',
    reason: 'A static per-app row cannot become canonical product authority.',
    contract: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md',
    ruleId: 'P-NAPP-009',
    pattern: /A static per-app row is canonical product authority\./iu,
  },
  {
    code: 'APP_SIGNED_UPLOAD_OWNERSHIP_FORBIDDEN',
    reason: 'Apps cannot own signed-upload credentials.',
    contract: '.nimi/spec/runtime/kernel/account-session-contract.md',
    ruleId: 'K-ACCSVC-001',
    pattern: /Apps own signed-upload credentials\./iu,
  },
  {
    code: 'DESKTOP_REALM_DATA_PLANE_OWNER_FORBIDDEN',
    reason: 'Desktop cannot own authenticated Realm data planes.',
    contract: '.nimi/spec/desktop/kernel/network-contract.md',
    ruleId: 'D-NET-006',
    pattern: /Desktop owns authenticated Realm unary, realtime, and media data planes\./iu,
  },
];

const negativeFixtures = [
  {
    fixtureId: 'app-id-authorizes',
    code: 'APP_ID_AUTHORIZATION_FORBIDDEN',
    reason: 'An app id cannot grant installed-app privilege.',
    target: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md#P-NAPP-009',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/platform/kernel/nimi-app-admission-contract.md', 'P-NAPP-009', 'An app id grants installed-app privilege.');
    },
  },
  {
    fixtureId: 'manifest-authorizes',
    code: 'MANIFEST_AUTHORIZATION_FORBIDDEN',
    reason: 'An app manifest cannot grant installed-app privilege.',
    target: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md#P-NAPP-009',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/platform/kernel/nimi-app-admission-contract.md', 'P-NAPP-009', 'An app manifest grants installed-app privilege.');
    },
  },
  {
    fixtureId: 'renderer-metadata-authorizes',
    code: 'RENDERER_METADATA_AUTHORIZATION_FORBIDDEN',
    reason: 'Renderer metadata cannot grant installed-app privilege.',
    target: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md#P-NAPP-009',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/platform/kernel/nimi-app-admission-contract.md', 'P-NAPP-009', 'Renderer metadata grants installed-app privilege.');
    },
  },
  {
    fixtureId: 'app-host-self-description-authorizes',
    code: 'APP_HOST_SELF_DESCRIPTION_AUTHORIZATION_FORBIDDEN',
    reason: 'App-owned host self-description cannot grant installed-app privilege.',
    target: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md#P-NAPP-009',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/platform/kernel/nimi-app-admission-contract.md', 'P-NAPP-009', 'App-owned host self-description grants installed-app privilege.');
    },
  },
  {
    fixtureId: 'host-owns-realm-credential-custody',
    code: 'HOST_REALM_CREDENTIAL_CUSTODY_FORBIDDEN',
    reason: 'A shell host is a carrier and cannot own authenticated Realm credential custody.',
    target: '.nimi/spec/platform/kernel/kit-contract.md#P-KIT-044',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/platform/kernel/kit-contract.md', 'P-KIT-044', 'The host owns authenticated Realm credential custody.');
    },
  },
  {
    fixtureId: 'renderer-owns-realm-credential-custody',
    code: 'RENDERER_REALM_CREDENTIAL_CUSTODY_FORBIDDEN',
    reason: 'A renderer cannot own authenticated Realm credential custody.',
    target: '.nimi/spec/desktop/kernel/network-contract.md#D-NET-006',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/desktop/kernel/network-contract.md', 'D-NET-006', 'The renderer owns authenticated Realm credential custody.');
    },
  },
  {
    fixtureId: 'static-per-app-row-is-product-authority',
    code: 'STATIC_PER_APP_AUTHORITY_FORBIDDEN',
    reason: 'A static per-app row cannot become canonical product authority.',
    target: '.nimi/spec/platform/kernel/nimi-app-admission-contract.md#P-NAPP-009',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/platform/kernel/nimi-app-admission-contract.md', 'P-NAPP-009', 'A static per-app row is canonical product authority.');
    },
  },
  {
    fixtureId: 'app-owns-signed-upload-credentials',
    code: 'APP_SIGNED_UPLOAD_OWNERSHIP_FORBIDDEN',
    reason: 'Apps cannot own signed-upload credentials.',
    target: '.nimi/spec/runtime/kernel/account-session-contract.md#K-ACCSVC-001',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/runtime/kernel/account-session-contract.md', 'K-ACCSVC-001', 'Apps own signed-upload credentials.');
    },
  },
  {
    fixtureId: 'desktop-owns-realm-data-planes',
    code: 'DESKTOP_REALM_DATA_PLANE_OWNER_FORBIDDEN',
    reason: 'Desktop cannot own authenticated Realm data planes.',
    target: '.nimi/spec/desktop/kernel/network-contract.md#D-NET-006',
    mutate(files) {
      appendRuleStatement(files, '.nimi/spec/desktop/kernel/network-contract.md', 'D-NET-006', 'Desktop owns authenticated Realm unary, realtime, and media data planes.');
    },
  },
  {
    fixtureId: 'host-owns-runtime-session',
    code: 'HOST_OWNED_RUNTIME_SESSION_FORBIDDEN',
    reason: 'The Runtime app session remains Runtime-owned and host-carried.',
    target: '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml',
    mutate(files) {
      const source = files.get(authBindingTable) ?? '';
      files.set(
        authBindingTable,
        source.replace('auth_binding: binding_only_no_protected_session', 'auth_binding: host-owned-runtime-app-session'),
      );
    },
  },
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

function replaceRule(source, ruleId, transform) {
  const section = extractRule(source, ruleId);
  if (!section) throw new Error(`fixture target rule missing: ${ruleId}`);
  return source.replace(section, transform(section));
}

function appendRuleStatement(files, contract, ruleId, statement) {
  const source = files.get(contract) ?? '';
  files.set(contract, replaceRule(source, ruleId, (section) => `${section.trimEnd()}\n\n${statement}\n`));
}

function evidenceContainsRule(source, ruleId) {
  const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^\\s*-\\s+${escaped}\\s*$`, 'mu').test(source)
    && new RegExp(`^\\s*-\\s+rule_id:\\s*${escaped}\\s*$`, 'mu').test(source);
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
  for (const rule of ownerRules) {
    const section = extractRule(files.get(rule.contract) ?? '', rule.ruleId);
    if (!section) {
      issues.push(issue('OWNER_RULE_MISSING', `${rule.contract}#${rule.ruleId}`, `Missing normative owner rule ${rule.ruleId}.`));
      continue;
    }
    for (const pattern of rule.required) {
      if (!pattern.test(section)) {
        issues.push(issue('OWNER_CLAUSE_MISSING', `${rule.contract}#${rule.ruleId}`, `Missing owner-boundary clause ${pattern}.`));
      }
    }
    const evidence = files.get(rule.evidence) ?? '';
    const evidenceRow = extractEvidenceRow(evidence, rule.ruleId);
    if (!evidenceContainsRule(evidence, rule.ruleId) || !evidenceRow) {
      issues.push(issue('OWNER_EVIDENCE_ROW_MISSING', rule.evidence, `Missing entries/rules row for ${rule.ruleId}.`));
      continue;
    }
    const implementationTokens = ownerImplementationEvidence.get(rule.ruleId) ?? [];
    for (const token of implementationTokens) {
      if (!evidenceRow.includes(token)) {
        issues.push(issue('OWNER_IMPLEMENTATION_EVIDENCE_MISSING', `${rule.evidence}#${rule.ruleId}`, `${rule.ruleId} must retain implementation evidence token ${token}.`));
      }
    }
    if (implementationTokens.length > 0 && !/compatibility evidence only/iu.test(evidenceRow)) {
      issues.push(issue('OWNER_EVIDENCE_SCOPE_UNCLEAR', `${rule.evidence}#${rule.ruleId}`, `${rule.ruleId} must distinguish implementation compatibility evidence from authority admission.`));
    }
  }

  for (const rule of detailedRules) {
    const location = `${rule.contract}#${rule.ruleId}`;
    const section = extractRule(files.get(rule.contract) ?? '', rule.ruleId);
    if (!section) {
      issues.push(issue('BLOCKED_DETAIL_RULE_MISSING', location, `Missing detailed rule ${rule.ruleId}.`));
      continue;
    }
    const posture = authorityPostures.get(rule.ruleId);
    if (posture) {
      if (posture.admitted && !posture.admitted.test(section)) {
        issues.push(issue('A0_ADMITTED_SLICE_MISSING', location, `${rule.ruleId} must retain its admitted A.0 protected-origin slice.`));
      }
      if (!posture.blocked.test(section)) {
        issues.push(issue('BLOCKED_DETAIL_CLAUSE_MISSING', location, `${rule.ruleId} must keep its unadmitted detailed authority fail-closed.`));
      }
    } else if (!/\*\*Authority disposition:\*\* Blocked detailed authority conflict\./iu.test(section)) {
      issues.push(issue('BLOCKED_DETAIL_CLAUSE_MISSING', location, `${rule.ruleId} must declare its blocked detailed authority disposition.`));
    }
    if (/\*\*Authority disposition:\*\* This detailed rule is independently admitted for implementation\./iu.test(section)) {
      issues.push(issue('BLOCKED_DETAIL_CONFLICT', location, `${rule.ruleId} cannot claim independent implementation admission.`));
    }
    const evidence = files.get(rule.evidence) ?? '';
    const evidenceRow = extractEvidenceRow(evidence, rule.ruleId);
    if (!evidenceContainsRule(evidence, rule.ruleId) || !evidenceRow) {
      issues.push(issue('BLOCKED_DETAIL_EVIDENCE_ROW_MISSING', rule.evidence, `Missing blocked-detail evidence row for ${rule.ruleId}.`));
      continue;
    }
    if (!/\bblocked\b/iu.test(evidenceRow)) {
      issues.push(issue('BLOCKED_DETAIL_EVIDENCE_DISPOSITION_MISSING', `${rule.evidence}#${rule.ruleId}`, `${rule.ruleId} evidence must state the blocked disposition.`));
    }
    if (rule.checkerTestRequired && !evidenceRow.includes(checkerRelative)) {
      issues.push(issue('BLOCKED_DETAIL_CHECKER_REF_MISSING', `${rule.evidence}#${rule.ruleId}`, `${rule.ruleId} must reference the checker that validates its blocked clause.`));
    }
    const implementationTokens = detailedImplementationEvidence.get(rule.ruleId) ?? [];
    for (const token of implementationTokens) {
      if (!evidenceRow.includes(token)) {
        issues.push(issue('BLOCKED_DETAIL_IMPLEMENTATION_EVIDENCE_MISSING', `${rule.evidence}#${rule.ruleId}`, `${rule.ruleId} must retain implementation evidence token ${token}.`));
      }
    }
    if (implementationTokens.length > 0 && !/compatibility evidence only/iu.test(evidenceRow)) {
      issues.push(issue('BLOCKED_DETAIL_EVIDENCE_SCOPE_UNCLEAR', `${rule.evidence}#${rule.ruleId}`, `${rule.ruleId} must distinguish implementation compatibility evidence from authority admission.`));
    }
  }

  for (const allocation of forbiddenAllocations) {
    const section = extractRule(files.get(allocation.contract) ?? '', allocation.ruleId);
    if (allocation.pattern.test(section)) {
      issues.push(issue(allocation.code, `${allocation.contract}#${allocation.ruleId}`, allocation.reason));
    }
  }

  const bindingSource = files.get(authBindingTable) ?? '';
  if (/^\s+auth_binding:\s+host-owned-runtime-app-session\s*$/mu.test(bindingSource)) {
    issues.push(issue('HOST_OWNED_RUNTIME_SESSION_FORBIDDEN', authBindingTable, 'The Runtime app session remains Runtime-owned and host-carried.'));
  } else if (!/^\s+auth_binding:\s+binding_only_no_protected_session\s*$/mu.test(bindingSource)) {
    issues.push(issue('AUTH_BINDING_OWNER_INVALID', authBindingTable, 'auth_binding must remain binding-only with no protected installed-app session before A.1 admission.'));
  }
  return issues;
}

async function loadBundle() {
  const paths = new Set([
    ...ownerRules.flatMap((rule) => [rule.contract, rule.evidence]),
    ...detailedRules.flatMap((rule) => [rule.contract, rule.evidence]),
    authBindingTable,
  ]);
  const files = new Map();
  for (const relative of paths) {
    files.set(relative, await fs.readFile(path.join(repoRoot, relative), 'utf8'));
  }
  return files;
}

function runNegativeFixtures(baseline) {
  const report = [];
  for (const fixture of negativeFixtures) {
    const files = new Map(baseline);
    fixture.mutate(files);
    const issues = validateBundle(files);
    if (issues.length !== 1 || issues[0].code !== fixture.code || issues[0].reason !== fixture.reason) {
      throw new Error(
        `negative fixture ${fixture.fixtureId} produced unexpected rejection: ${JSON.stringify(issues)}`,
      );
    }
    report.push({
      fixtureId: fixture.fixtureId,
      code: issues[0].code,
      reason: issues[0].reason,
      target: fixture.target,
    });
  }
  return report;
}

function printIssues(issues) {
  process.stderr.write('installed Realm owner boundary failed:\n');
  for (const item of issues) {
    process.stderr.write(`- ${item.code}: ${item.reason} (${item.location})\n`);
  }
}

async function main() {
  const baseline = await loadBundle();
  const issues = validateBundle(baseline);
  if (issues.length > 0) {
    printIssues(issues);
    process.exitCode = 1;
    return;
  }
  const fixtureReport = runNegativeFixtures(baseline);
  if (process.argv.includes('--fixture-report-json')) {
    process.stdout.write(`${JSON.stringify({ fixtures: fixtureReport }, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `installed Realm owner boundary: OK (${ownerRules.length} owner rules, ${detailedRules.length} blocked detail rules, ${fixtureReport.length} negative fixtures)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`installed Realm owner boundary failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
