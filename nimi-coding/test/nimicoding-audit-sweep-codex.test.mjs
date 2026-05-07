import { chmod } from "node:fs/promises";

import {
  mkdir,
  readFile,
  writeFile,
  path,
  test,
  assert,
  YAML,
  withTempProject,
  captureRunCli,
} from "./nimicoding-test-utils.mjs";

import {
  extractCodexAuditorEvidenceFile,
  validateCodexAuditorEvidence,
} from "../cli/lib/audit-sweep-runtime/codex-auditor-evidence.mjs";
import {
  buildAuditorPacket,
} from "../cli/lib/audit-sweep-runtime/chunks.mjs";

function p0p1RuleChecks(ref = "src/security.ts") {
  return [
    "fail_open_or_pseudo_success",
    "partial_coverage_misrepresented_as_complete",
    "authority_boundary_or_private_import_bypass",
    "permission_or_capability_bypass",
    "ungated_destructive_action",
    "provider_or_model_hardcoding",
    "app_local_shadow_truth",
  ].map((id) => ({
    id,
    status: "checked",
    implementation_refs: [ref],
    negative_reasoning: `Rule ${id} was checked against the implementation surface without a P0/P1 trigger.`,
  }));
}

function semanticAuditor(packetRef = ".nimi/local/audit/packets/test/chunk.audit-packet.yaml") {
  return {
    id: "regression-fixture",
    mode: "codex_semantic_audit",
    methodology_ref: ".nimi/topics/ongoing/test/manager-prompts.md",
    provenance: {
      kind: "semantic_audit",
      packet_ref: packetRef,
      transcript_ref: ".nimi/topics/ongoing/test/auditor-transcript.md",
    },
  };
}

test("Codex auditor packet uses compact retrieval slice with manager-owned inventory hash", async () => {
  await withTempProject(async (projectRoot) => {
    await mkdir(path.join(projectRoot, ".nimi", "spec", "runtime", "kernel"), { recursive: true });
    await mkdir(path.join(projectRoot, "runtime", "internal", "auth"), { recursive: true });
    await mkdir(path.join(projectRoot, "runtime", "internal", "generated"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "auth-session-contract.md"),
      "JWT session token revocation must fail closed through RuntimeAccountService and auth session authority.\n",
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "runtime", "internal", "auth", "session.ts"),
      "import { tokenStore } from './token-store';\nexport const session = tokenStore;\n",
      "utf8",
    );
    await writeFile(path.join(projectRoot, "runtime", "internal", "auth", "token-store.ts"), "export const tokenStore = 'revocation';\n", "utf8");
    await writeFile(path.join(projectRoot, "runtime", "internal", "auth", "session.test.ts"), "import './session';\n", "utf8");
    for (let index = 0; index < 130; index += 1) {
      await writeFile(path.join(projectRoot, "runtime", "internal", "generated", `filler-${index}.ts`), `export const filler${index}=true;\n`, "utf8");
    }
    const evidenceInventory = [
      "runtime/internal/auth/session.ts",
      "runtime/internal/auth/token-store.ts",
      "runtime/internal/auth/session.test.ts",
      ...Array.from({ length: 130 }, (_, index) => `runtime/internal/generated/filler-${index}.ts`),
    ];
    const chunk = {
      chunk_id: "chunk-runtime-auth-session",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      owner_domain: "runtime",
      spec_surface: "kernel",
      files: [".nimi/spec/runtime/kernel/auth-session-contract.md"],
      authority_refs: [".nimi/spec/runtime/kernel/auth-session-contract.md"],
      evidence_inventory: evidenceInventory,
    };

    const packet = buildAuditorPacket("sweep-compact", chunk, "codex", "2026-05-05T00:00:00.000Z", { chunks: [chunk] }, { projectRoot });

    assert.equal(packet.audit_depth.level, "deep");
    assert.ok(packet.evidence_inventory.length < evidenceInventory.length);
    assert.deepEqual(packet.evidence_inventory, packet.selected_implementation_refs);
    assert.equal(packet.omitted_evidence_inventory.full_inventory_count, evidenceInventory.length);
    assert.equal(packet.omitted_evidence_inventory.omitted_count, evidenceInventory.length - packet.selected_implementation_refs.length);
    assert.equal(packet.omitted_evidence_inventory.sha256.length, 64);
    assert.ok(packet.selected_implementation_refs.includes("runtime/internal/auth/session.ts"));
    assert.ok(packet.selected_implementation_refs.includes("runtime/internal/auth/token-store.ts"));
    assert.ok(packet.selected_implementation_refs.includes("runtime/internal/auth/session.test.ts"));
    assert.equal(packet.output_contract.manager_owned_coverage_population.coverage_evidence_files_from_chunk_evidence_inventory, "manager_owned_chunk.evidence_inventory");
  });
});

test("Codex auditor packet uses shallow adaptive depth for generated table/index chunks", async () => {
  await withTempProject(async (projectRoot) => {
    await mkdir(path.join(projectRoot, ".nimi", "spec", "desktop", "kernel", "generated"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "desktop", "kernel", "generated", "app-tabs.md"),
      "Generated app tabs table must preserve admitted desktop navigation authority.\n",
      "utf8",
    );
    const evidenceInventory = Array.from({ length: 40 }, (_, index) => `apps/desktop/src/generated/app-tabs-${index}.ts`);
    const chunk = {
      chunk_id: "chunk-desktop-generated-app-tabs",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      owner_domain: "desktop",
      spec_surface: "kernel-generated",
      files: [".nimi/spec/desktop/kernel/generated/app-tabs.md"],
      authority_refs: [".nimi/spec/desktop/kernel/generated/app-tabs.md"],
      evidence_inventory: evidenceInventory,
    };

    const packet = buildAuditorPacket("sweep-shallow", chunk, "codex", "2026-05-05T00:00:00.000Z", { chunks: [chunk] }, { projectRoot });

    assert.equal(packet.audit_depth.level, "shallow");
    assert.ok(packet.selected_implementation_refs.length <= 16);
    assert.equal(packet.retrieval_prepass.omitted_inventory_count, evidenceInventory.length - packet.selected_implementation_refs.length);
    assert.ok(packet.audit_instructions.required_flow.some((step) => step.includes("audit_depth=shallow")));
  });
});

test("Codex auditor envelope rejects top-level P0/P1 rule checks", () => {
  const packetRef = ".nimi/local/audit/packets/test/chunk-p0p1.auditor-packet.yaml";
  const chunk = {
    chunk_id: "chunk-p0p1",
    planning_basis: "spec_authority",
    criteria: ["p0p1"],
    files: [".nimi/spec/runtime/kernel/security.md"],
    authority_refs: [".nimi/spec/runtime/kernel/security.md"],
    evidence_inventory: ["runtime/internal/security.go"],
  };
  const evidence = {
    chunk_id: chunk.chunk_id,
    auditor: semanticAuditor(packetRef),
    coverage: {
      files: chunk.files,
      authority_refs: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: [{
        authority_ref: chunk.authority_refs[0],
        status: "audited",
        evidence_refs: [chunk.authority_refs[0], chunk.evidence_inventory[0]],
        implementation_evidence_refs: [chunk.evidence_inventory[0]],
        negative_reasoning: "Implementation was inspected for high-impact authorization failure modes.",
      }],
      p0p1_negative_reasoning: "No P0/P1 defect was found after inspecting the implementation.",
      p0p1_evidence_refs: chunk.evidence_inventory,
    },
    p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
    findings: [],
  };

  const validation = validateCodexAuditorEvidence(evidence, chunk, packetRef);

  assert.equal(validation.ok, false);
  assert.match(validation.error, /coverage/);
});

test("Codex auditor envelope rejects missing semantic auditor provenance", () => {
  const packetRef = ".nimi/local/audit/packets/test/chunk-p0p1.auditor-packet.yaml";
  const chunk = {
    chunk_id: "chunk-p0p1",
    planning_basis: "spec_authority",
    criteria: ["p0p1"],
    files: [".nimi/spec/runtime/kernel/security.md"],
    authority_refs: [".nimi/spec/runtime/kernel/security.md"],
    evidence_inventory: ["runtime/internal/security.go"],
  };
  const evidence = {
    chunk_id: chunk.chunk_id,
    auditor: {
      id: "codex-regression",
      mode: "codex_semantic_audit",
      methodology_ref: ".nimi/topics/ongoing/test/manager-prompts.md",
    },
    coverage: {
      files: chunk.files,
      authority_refs: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: [{
        authority_ref: chunk.authority_refs[0],
        status: "audited",
        evidence_refs: [chunk.authority_refs[0], chunk.evidence_inventory[0]],
        implementation_evidence_refs: [chunk.evidence_inventory[0]],
        negative_reasoning: "Implementation was inspected for high-impact authorization failure modes.",
      }],
      p0p1_negative_reasoning: "No P0/P1 defect was found after inspecting the implementation.",
      p0p1_evidence_refs: chunk.evidence_inventory,
      p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
    },
    findings: [],
  };

  const validation = validateCodexAuditorEvidence(evidence, chunk, packetRef);

  assert.equal(validation.ok, false);
  assert.match(validation.error, /auditor\.provenance/);
});

test("Codex auditor envelope rejects synthetic no-finding evidence", () => {
  const packetRef = ".nimi/local/audit/packets/test/chunk-p0p1.auditor-packet.yaml";
  const chunk = {
    chunk_id: "chunk-p0p1",
    planning_basis: "spec_authority",
    criteria: ["p0p1"],
    files: [".nimi/spec/runtime/kernel/security.md"],
    authority_refs: [".nimi/spec/runtime/kernel/security.md"],
    evidence_inventory: ["runtime/internal/security.go"],
  };
  const evidence = {
    chunk_id: chunk.chunk_id,
    auditor: {
      ...semanticAuditor(packetRef),
      generated_by_script: true,
    },
    coverage: {
      files: chunk.files,
      authority_refs: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: [{
        authority_ref: chunk.authority_refs[0],
        status: "audited",
        evidence_refs: [chunk.authority_refs[0], chunk.evidence_inventory[0]],
        implementation_evidence_refs: [chunk.evidence_inventory[0]],
        negative_reasoning: "Implementation was inspected for high-impact authorization failure modes.",
      }],
      p0p1_negative_reasoning: "No P0/P1 defect was found after inspecting the implementation.",
      p0p1_evidence_refs: chunk.evidence_inventory,
      p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
    },
    findings: [],
  };

  const validation = validateCodexAuditorEvidence(evidence, chunk, packetRef);

  assert.equal(validation.ok, false);
  assert.match(validation.error, /synthetic_no_finding_evidence/);
});

test("Codex auditor extractor accepts valid semantic evidence", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-p0p1.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-p0p1",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/runtime/kernel/security.md"],
      authority_refs: [".nimi/spec/runtime/kernel/security.md"],
      evidence_inventory: ["runtime/internal/security.go"],
    };
    const evidence = {
      chunk_id: chunk.chunk_id,
      auditor: semanticAuditor(packetRef),
      coverage: {
        files: chunk.files,
        authority_refs: chunk.authority_refs,
        evidence_files: chunk.evidence_inventory,
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          evidence_refs: [chunk.authority_refs[0], chunk.evidence_inventory[0]],
          implementation_evidence_refs: [chunk.evidence_inventory[0]],
          negative_reasoning: "Implementation was inspected for high-impact authorization failure modes.",
        }],
        p0p1_negative_reasoning: "No P0/P1 defect was found after inspecting the implementation.",
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [],
    };
    const rawOutputPath = path.join(projectRoot, "codex-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-p0p1.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-raw.json",
      auditorId: "regression-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    const stored = JSON.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "evidence", "test", "chunk-p0p1.codex-evidence.json"), "utf8"));
    assert.equal(stored.auditor.provenance.kind, "semantic_audit");
    assert.equal(stored.coverage.p0p1_rule_checks.length, 7);
  });
});

test("Codex auditor extractor tolerates unambiguous trailing closing brace drift", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-trailing-brace.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-trailing-brace",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/desktop/economy.md"],
      authority_refs: [".nimi/spec/desktop/economy.md"],
      evidence_inventory: ["apps/desktop/src/shell/renderer/features/economy/gift-message-bubble.tsx"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-trailing-brace-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The economy implementation evidence was inspected.",
        }],
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_negative_reasoning: "No P0/P1 issue was found after inspecting the economy implementation.",
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [],
    };
    const rawOutputPath = path.join(projectRoot, "codex-trailing-brace-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence)} }\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-trailing-brace.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-trailing-brace",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-trailing-brace-raw.json",
      auditorId: "codex-trailing-brace-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.equal(extracted.evidence.coverage.authority_outcomes[0].authority_ref, chunk.authority_refs[0]);
  });
});

test("Codex auditor extractor tolerates a unique extra closing brace inside the envelope", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-inner-brace.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-inner-brace",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/desktop/kernel/bootstrap-contract.md"],
      authority_refs: [".nimi/spec/desktop/kernel/bootstrap-contract.md"],
      evidence_inventory: ["apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-inner-brace-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The bootstrap implementation evidence was inspected.",
        }],
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_negative_reasoning: "No P0/P1 issue was found after inspecting the bootstrap implementation.",
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [],
    };
    const rawOutputPath = path.join(projectRoot, "codex-inner-brace-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence).replace(",\"coverage\"", "},\"coverage\"")}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-inner-brace.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-inner-brace",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-inner-brace-raw.json",
      auditorId: "codex-inner-brace-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.equal(extracted.evidence.coverage.authority_outcomes[0].authority_ref, chunk.authority_refs[0]);
  });
});

test("Codex auditor extractor tolerates trailing findings_count metadata after a valid envelope", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-trailing-count.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-trailing-count",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/desktop/kernel/tables/avatar-probes.yaml"],
      authority_refs: [".nimi/spec/desktop/kernel/tables/avatar-probes.yaml"],
      evidence_inventory: ["apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench.tsx"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-trailing-count-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The avatar workbench implementation was inspected.",
        }],
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [{
        severity: "high",
        category: "fail_open_or_pseudo_success",
        actionability: "needs-decision",
        confidence: "high",
        impact: "A probe passed state can omit linked evidence.",
        location: { file: chunk.evidence_inventory[0], line: 1 },
        title: "Avatar probe fixture finding",
        description: "The semantic finding remains inside the valid envelope.",
        evidence: {
          summary: "The finding is inside the envelope; findings_count is trailing metadata.",
          auditor_reasoning: "The parser may ignore the trailing count without changing semantic conclusions.",
        },
      }],
    };
    const rawOutputPath = path.join(projectRoot, "codex-trailing-count-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence)},\"findings_count\":1}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-trailing-count.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-trailing-count",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-trailing-count-raw.json",
      auditorId: "codex-trailing-count-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.equal(extracted.evidence.findings[0].title, "Avatar probe fixture finding");
  });
});

test("Codex auditor extractor rejects incomplete P0/P1 rule check objects before ingest", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-incomplete-rules.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-incomplete-rules",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/runtime/kernel/delegated-approval-contract.md"],
      authority_refs: [".nimi/spec/runtime/kernel/delegated-approval-contract.md"],
      evidence_inventory: ["runtime/internal/delegation/approval.go"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-incomplete-rule-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: ["runtime/internal/delegation/approval.go"],
          negative_reasoning: "The delegated approval implementation was inspected.",
        }],
        p0p1_evidence_refs: ["runtime/internal/delegation/approval.go"],
        p0p1_rule_checks: [
          { id: "fail_open_or_pseudo_success" },
          { id: "partial_coverage_misrepresented_as_complete" },
          { id: "authority_boundary_or_private_import_bypass" },
          { id: "permission_or_capability_bypass" },
          { id: "ungated_destructive_action" },
          { id: "provider_or_model_hardcoding" },
          { id: "app_local_shadow_truth" },
        ],
      },
      findings: [],
    };
    const rawOutputPath = path.join(projectRoot, "codex-incomplete-rules-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-incomplete-rules.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-incomplete-rules",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-incomplete-rules-raw.json",
      auditorId: "codex-incomplete-rule-fixture",
    });

    assert.equal(extracted.ok, false);
    assert.match(extracted.error, /coverage\.p0p1_rule_checks\[0\]\.status must be checked or not_applicable/);
  });
});

test("Codex auditor extractor derives aggregate P0/P1 negative reasoning from rule-level reasoning", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-rule-derived-reasoning.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-rule-derived-reasoning",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/platform/kernel/app-slice-admission-contract.md"],
      authority_refs: [".nimi/spec/platform/kernel/app-slice-admission-contract.md"],
      evidence_inventory: ["kit/features/chat/src/realm/service.ts"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-rule-derived-reasoning-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The app-slice admission implementation surface was inspected.",
        }],
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [],
    };
    const rawOutputPath = path.join(projectRoot, "codex-rule-derived-reasoning-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-rule-derived-reasoning.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-rule-derived-reasoning",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-rule-derived-reasoning-raw.json",
      auditorId: "codex-rule-derived-reasoning-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.match(
      extracted.evidence.coverage.p0p1_negative_reasoning,
      /Rule fail_open_or_pseudo_success was checked against the implementation surface without a P0\/P1 trigger/,
    );
    assert.match(
      extracted.evidence.coverage.p0p1_negative_reasoning,
      /Rule app_local_shadow_truth was checked against the implementation surface without a P0\/P1 trigger/,
    );
  });
});

test("Codex auditor extractor fills canonical evidence inventory for large chunks", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-large.auditor-packet.yaml";
    const evidenceInventory = Array.from({ length: 1200 }, (_, index) => `runtime/internal/generated/file-${String(index).padStart(4, "0")}.go`);
    evidenceInventory[42] = "runtime/internal/authn/validator.go";
    const chunk = {
      chunk_id: "chunk-large",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/runtime/kernel/authn-token-validation.md"],
      authority_refs: [".nimi/spec/runtime/kernel/authn-token-validation.md"],
      evidence_inventory: evidenceInventory,
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-large-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: ["runtime/internal/authn/validator.go"],
          negative_reasoning: "The auditor inspected the token validator for high-impact authn fail-open behavior.",
        }],
        p0p1_evidence_refs: ["runtime/internal/authn/validator.go"],
        p0p1_rule_checks: p0p1RuleChecks("runtime/internal/authn/validator.go"),
      },
      findings: [{
        severity: "high",
        category: "security",
        actionability: "needs-decision",
        confidence: "high",
        impact: "A token revocation bypass remains reachable.",
        location: { file: "runtime/internal/authn/validator.go", line: 1 },
        title: "JWT revocation bypass canary",
        description: "The semantic auditor found the known revocation bypass canary.",
        evidence: {
          summary: "The validator accepts a token path that bypasses revocation.",
          auditor_reasoning: "The inspected validator implementation does not fail closed for the canary path.",
        },
      }],
    };
    const rawOutputPath = path.join(projectRoot, "codex-large-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-large.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-large",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-large-raw.json",
      auditorId: "codex-large-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.equal(extracted.evidence.coverage.evidence_files.length, 1200);
    assert.deepEqual(extracted.evidence.coverage.p0p1_evidence_refs, ["runtime/internal/authn/validator.go"]);
    assert.equal(extracted.evidence.findings[0].title, "JWT revocation bypass canary");
  });
});

test("Codex auditor extractor maps finding envelope aliases to ingest shape", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-p1-severity.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-p1-severity",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/runtime/kernel/authz-ownership.md"],
      authority_refs: [".nimi/spec/runtime/kernel/authz-ownership.md"],
      evidence_inventory: ["runtime/internal/services/connector/service_crud.go"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-p1-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The connector service was inspected for high-impact authorization failures.",
        }],
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [{
        impact: "high",
        rule_id: "permission_or_capability_bypass",
        actionability: "manual-review",
        implementation_refs: [chunk.evidence_inventory[0]],
        locations: [{ ref: chunk.evidence_inventory[0], line: 7 }],
        title: "P1 severity fixture",
        description: "P1 severity fixture",
        summary: "P1 severity fixture",
        recommendation: "Reject the unauthorized connector mutation before persistence.",
      }],
    };
    const rawOutputPath = path.join(projectRoot, "codex-p1-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-p1-severity.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-p1",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-p1-raw.json",
      auditorId: "codex-p1-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.equal(extracted.evidence.findings[0].severity, "high");
    assert.equal(extracted.evidence.findings[0].category, "permission_or_capability_bypass");
    assert.equal(extracted.evidence.findings[0].title, "P1 severity fixture");
    assert.equal(extracted.evidence.findings[0].description, "P1 severity fixture");
    assert.equal(extracted.evidence.findings[0].actionability, "needs-decision");
    assert.equal(extracted.evidence.findings[0].confidence, "high");
    assert.deepEqual(extracted.evidence.findings[0].location, { file: chunk.evidence_inventory[0], line: 7 });
    assert.equal(extracted.evidence.findings[0].evidence.summary, "P1 severity fixture");
    assert.equal(extracted.evidence.findings[0].evidence.auditor_reasoning, "Reject the unauthorized connector mutation before persistence.");
  });
});

test("Codex auditor extractor drops authority refs from rule-check implementation refs", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-rule-authority-ref.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-rule-authority-ref",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/runtime/kernel/auth-service.md"],
      authority_refs: [".nimi/spec/runtime/kernel/auth-service.md"],
      evidence_inventory: ["runtime/internal/services/auth/service.go"],
    };
    const checks = p0p1RuleChecks(chunk.evidence_inventory[0]);
    checks[6] = {
      ...checks[6],
      implementation_refs: [chunk.authority_refs[0], chunk.evidence_inventory[0]],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-rule-authority-ref-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The auth service was inspected for app-local shadow truth.",
        }],
        p0p1_negative_reasoning: "The rule-check fixture found no high-impact defect after inspecting the auth service implementation.",
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_rule_checks: checks,
      },
      findings: [],
    };
    const rawOutputPath = path.join(projectRoot, "codex-rule-authority-ref-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-rule-authority-ref.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-rule-authority-ref",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-rule-authority-ref-raw.json",
      auditorId: "codex-rule-authority-ref-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.deepEqual(
      extracted.evidence.coverage.p0p1_rule_checks[6].implementation_refs,
      [chunk.evidence_inventory[0]],
    );
  });
});

test("Codex auditor extractor drops non-implementation governance refs from rule-check implementation refs", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-rule-governance-ref.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-rule-governance-ref",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/desktop/kernel/knowledge-ui-contract.md"],
      authority_refs: [".nimi/spec/desktop/kernel/knowledge-ui-contract.md"],
      evidence_inventory: ["apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-knowledge-sdk-service.ts"],
    };
    const checks = p0p1RuleChecks(chunk.evidence_inventory[0]);
    checks[2] = {
      ...checks[2],
      implementation_refs: ["apps/desktop/AGENTS.md", chunk.evidence_inventory[0]],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-rule-governance-ref-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The knowledge UI service was inspected for boundary violations; AGENTS.md was governance context only.",
        }],
        p0p1_negative_reasoning: "The rule-check fixture found no high-impact defect after inspecting the selected implementation.",
        p0p1_evidence_refs: ["apps/desktop/AGENTS.md", chunk.evidence_inventory[0]],
        p0p1_rule_checks: checks,
      },
      findings: [{
        severity: "high",
        category: "partial_coverage_misrepresented_as_complete",
        actionability: "needs-decision",
        confidence: "high",
        impact: "The knowledge UI omits a required runtime detail method.",
        location: { file: chunk.evidence_inventory[0], line: 1 },
        title: "Knowledge UI fixture finding",
        description: "The semantic finding is preserved while governance context refs are stripped from implementation refs.",
        evidence: {
          summary: "A real semantic finding remains present.",
          auditor_reasoning: "The governance ref is context, not implementation evidence.",
        },
      }],
    };
    const rawOutputPath = path.join(projectRoot, "codex-rule-governance-ref-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-rule-governance-ref.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-rule-governance-ref",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-rule-governance-ref-raw.json",
      auditorId: "codex-rule-governance-ref-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.deepEqual(
      extracted.evidence.coverage.p0p1_rule_checks[2].implementation_refs,
      [chunk.evidence_inventory[0]],
    );
    assert.deepEqual(extracted.evidence.coverage.p0p1_evidence_refs, [chunk.evidence_inventory[0]]);
    assert.equal(extracted.evidence.findings[0].title, "Knowledge UI fixture finding");
  });
});

test("Codex auditor extractor derives not-applicable authority reason from semantic aliases", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-authority-only.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-authority-only",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/avatar/index.md"],
      authority_refs: [".nimi/spec/avatar/index.md"],
      evidence_inventory: [],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-authority-only-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "not_applicable",
          inspected_implementation_refs: [],
          implementation_not_applicable_reason: "The inspected authority ref is an index-only domain guide with no direct implementation evidence in the packet.",
          negative_reasoning: "No P0/P1 implementation claim can be made for this authority-only chunk.",
        }],
        p0p1_evidence_refs: [],
        p0p1_negative_reasoning: "The auditor inspected the authority-only guide and found no in-scope implementation surface to check.",
        p0p1_rule_checks: p0p1RuleChecks().map((check) => ({
          ...check,
          status: "not_applicable",
          implementation_refs: [],
        })),
      },
      findings: [],
    };
    const rawOutputPath = path.join(projectRoot, "codex-authority-only-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-authority-only.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-authority-only",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-authority-only-raw.json",
      auditorId: "codex-authority-only-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.equal(
      extracted.evidence.coverage.authority_outcomes[0].reason,
      "The inspected authority ref is an index-only domain guide with no direct implementation evidence in the packet.",
    );
    assert.equal(
      extracted.evidence.coverage.p0p1_implementation_not_applicable_reason,
      "The inspected authority ref is an index-only domain guide with no direct implementation evidence in the packet.",
    );
  });
});

test("Codex auditor extractor maps authority outcome reasoning alias to negative reasoning", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-outcome-reasoning.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-outcome-reasoning",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/cognition/kernel/cognition-contract.md"],
      authority_refs: [".nimi/spec/cognition/kernel/cognition-contract.md"],
      evidence_inventory: ["nimi-cognition/cognition/cognition.go"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-outcome-reasoning-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          reasoning: "The cognition implementation was inspected and no P0/P1 issue was found.",
        }],
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_negative_reasoning: "No critical/high cognition issue was found after inspecting the implementation.",
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [],
    };
    const rawOutputPath = path.join(projectRoot, "codex-outcome-reasoning-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence, null, 2)}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-outcome-reasoning.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-outcome-reasoning",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-outcome-reasoning-raw.json",
      auditorId: "codex-outcome-reasoning-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.equal(
      extracted.evidence.coverage.authority_outcomes[0].negative_reasoning,
      "The cognition implementation was inspected and no P0/P1 issue was found.",
    );
  });
});

test("audit-codex command freezes valid evidence and validates chunk replay", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "security.ts"), "export const allow = true;\n", "utf8");
    const sweepId = "audit-sweep-test-codex-state-machine";
    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--criteria",
      "p0p1",
      "--max-files",
      "1",
      "--sweep-id",
      sweepId,
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", `${sweepId}.yaml`), "utf8"));
    const chunk = plan.chunks[0];
    const packetRef = `.nimi/local/audit/packets/${sweepId}/${chunk.chunk_id}.auditor-packet.yaml`;
    const fakeCodexPath = path.join(projectRoot, "fake-codex.mjs");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env node",
        "import { writeFile } from 'node:fs/promises';",
        "const outIndex = process.argv.indexOf('--output-last-message');",
        "if (outIndex < 0) process.exit(3);",
        "await writeFile(process.argv[outIndex + 1], `${process.env.FAKE_CODEX_OUTPUT_JSON}\\n`, 'utf8');",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCodexPath, 0o755);
    const previousFakeOutput = process.env.FAKE_CODEX_OUTPUT_JSON;
    process.env.FAKE_CODEX_OUTPUT_JSON = JSON.stringify({
      chunk_id: chunk.chunk_id,
      auditor: semanticAuditor(packetRef),
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.files[0],
          status: "audited",
          inspected_implementation_refs: chunk.files,
          negative_reasoning: "The implementation file was inspected for high-impact fixture behavior.",
        }],
        p0p1_evidence_refs: chunk.files,
      },
      findings: [{
        severity: "high",
        category: "security",
        actionability: "needs-decision",
        confidence: "high",
        impact: "Fixture high finding proves audit-codex can carry semantic evidence through ingest.",
        location: { file: chunk.files[0], line: 1 },
        title: "Fixture high finding",
        description: "The fake Codex auditor emits valid semantic evidence for the state-machine regression.",
        evidence: {
          summary: "The implementation file was inspected by the fake auditor fixture.",
          auditor_reasoning: "This is test-authored semantic evidence for the audit-codex state-machine path.",
        },
      }],
    });
    try {
      const auditResult = await captureRunCli([
      "sweep",
      "audit",
        "chunk",
        "audit-codex",
        "--sweep-id",
        sweepId,
        "--chunk-id",
        chunk.chunk_id,
        "--dispatched-at",
        "2026-05-05T00:00:00.000Z",
        "--verified-at",
        "2026-05-05T00:01:00.000Z",
        "--reviewed-at",
        "2026-05-05T00:02:00.000Z",
        "--codex-bin",
        fakeCodexPath,
        "--json",
      ]);
      assert.equal(auditResult.exitCode, 0, auditResult.stderr);
    } finally {
      if (previousFakeOutput === undefined) {
        delete process.env.FAKE_CODEX_OUTPUT_JSON;
      } else {
        process.env.FAKE_CODEX_OUTPUT_JSON = previousFakeOutput;
      }
    }

    const validated = await captureRunCli([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      sweepId,
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(validated.exitCode, 0, validated.stdout);
    const auditedChunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", sweepId, `${chunk.chunk_id}.yaml`), "utf8"));
    assert.equal(auditedChunk.state, "frozen");
    assert.equal(auditedChunk.lifecycle.frozen_at, "2026-05-05T00:02:00.000Z");
    assert.equal(auditedChunk.lifecycle.failed_at, null);
    assert.equal(auditedChunk.audit_validity.posture, "trusted");
    assert.equal(auditedChunk.finding_count, 1);
  });
});

test("audit-codex command can replay an existing raw Codex transcript through the owned state machine", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "security.ts"), "export const allow = true;\n", "utf8");
    const sweepId = "audit-sweep-test-codex-raw-replay";
    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--criteria",
      "p0p1",
      "--max-files",
      "1",
      "--sweep-id",
      sweepId,
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", `${sweepId}.yaml`), "utf8"));
    const chunk = plan.chunks[0];
    const rawRef = ".nimi/local/audit/evidence/test/replayed-codex-raw.json";
    await mkdir(path.join(projectRoot, ".nimi", "local", "audit", "evidence", "test"), { recursive: true });
    await writeFile(path.join(projectRoot, rawRef), `${JSON.stringify({
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-raw-replay-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.files[0],
          status: "audited",
          inspected_implementation_refs: chunk.files,
          negative_reasoning: "The existing raw transcript inspected the implementation file for high-impact fixture behavior.",
        }],
        p0p1_evidence_refs: chunk.files,
      },
      findings: [{
        severity: "high",
        category: "security",
        actionability: "needs-decision",
        confidence: "high",
        impact: "Fixture high finding proves raw transcript replay preserves semantic findings.",
        location: { file: chunk.files[0], line: 1 },
        title: "Raw transcript replay finding",
        description: "The audit-codex replay path ingests an existing raw Codex semantic finding without running Codex again.",
        evidence: {
          summary: "The raw transcript already contains valid semantic evidence.",
          auditor_reasoning: "This regression covers method-repair replay after envelope normalization changes.",
        },
      }],
    }, null, 2)}\n`, "utf8");

    const auditResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "audit-codex",
      "--sweep-id",
      sweepId,
      "--chunk-id",
      chunk.chunk_id,
      "--dispatched-at",
      "2026-05-05T00:10:00.000Z",
      "--verified-at",
      "2026-05-05T00:11:00.000Z",
      "--reviewed-at",
      "2026-05-05T00:12:00.000Z",
      "--from-raw-output",
      rawRef,
      "--json",
    ]);
    assert.equal(auditResult.exitCode, 0, auditResult.stderr);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.transcriptRef, rawRef);

    const validated = await captureRunCli([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      sweepId,
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(validated.exitCode, 0, validated.stdout);
    const auditedChunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", sweepId, `${chunk.chunk_id}.yaml`), "utf8"));
    assert.equal(auditedChunk.state, "frozen");
    assert.equal(auditedChunk.finding_count, 1);
  });
});

test("audit-codex ingest rejection fails closed with replayable failed chunk state", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "security.ts"), "export const allow = true;\n", "utf8");
    const sweepId = "audit-sweep-test-codex-ingest-failure";
    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--criteria",
      "p0p1",
      "--max-files",
      "1",
      "--sweep-id",
      sweepId,
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", `${sweepId}.yaml`), "utf8"));
    const chunk = plan.chunks[0];
    const packetRef = `.nimi/local/audit/packets/${sweepId}/${chunk.chunk_id}.auditor-packet.yaml`;
    const fakeCodexPath = path.join(projectRoot, "fake-codex-ingest-failure.mjs");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env node",
        "import { writeFile } from 'node:fs/promises';",
        "const outIndex = process.argv.indexOf('--output-last-message');",
        "if (outIndex < 0) process.exit(3);",
        "await writeFile(process.argv[outIndex + 1], `${process.env.FAKE_CODEX_OUTPUT_JSON}\\n`, 'utf8');",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCodexPath, 0o755);
    const previousFakeOutput = process.env.FAKE_CODEX_OUTPUT_JSON;
    process.env.FAKE_CODEX_OUTPUT_JSON = JSON.stringify({
      chunk_id: chunk.chunk_id,
      auditor: semanticAuditor(packetRef),
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.files[0],
          status: "audited",
          inspected_implementation_refs: chunk.files,
          negative_reasoning: "The implementation file was inspected for high-impact fixture behavior.",
        }],
        p0p1_evidence_refs: chunk.files,
      },
      findings: [{
        severity: "high",
        category: "security",
        actionability: "needs-decision",
        confidence: "high",
        impact: "Fixture high finding intentionally points outside the chunk.",
        location: { file: "src/outside.ts", line: 1 },
        title: "Out of scope fixture finding",
        description: "The fake Codex auditor emits a finding location outside the chunk to force ingest rejection.",
        evidence: {
          summary: "The location is not in the chunk.",
          auditor_reasoning: "This is test-authored invalid evidence for the audit-codex failure path.",
        },
      }],
    });
    try {
      const auditResult = await captureRunCli([
      "sweep",
      "audit",
        "chunk",
        "audit-codex",
        "--sweep-id",
        sweepId,
        "--chunk-id",
        chunk.chunk_id,
        "--dispatched-at",
        "2026-05-05T00:00:00.000Z",
        "--verified-at",
        "2026-05-05T00:01:00.000Z",
        "--reviewed-at",
        "2026-05-05T00:02:00.000Z",
        "--codex-bin",
        fakeCodexPath,
        "--json",
      ]);
      assert.equal(auditResult.exitCode, 2);
      assert.match(auditResult.stderr, /evidence ingest rejected/);
    } finally {
      if (previousFakeOutput === undefined) {
        delete process.env.FAKE_CODEX_OUTPUT_JSON;
      } else {
        process.env.FAKE_CODEX_OUTPUT_JSON = previousFakeOutput;
      }
    }

    const validateResult = await captureRunCli([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      sweepId,
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0, validateResult.stdout);
    const failedChunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", sweepId, `${chunk.chunk_id}.yaml`), "utf8"));
    assert.equal(failedChunk.state, "failed");
    assert.equal(failedChunk.lifecycle.failed_at, "2026-05-05T00:01:00.000Z");
    assert.equal(failedChunk.lifecycle.ingested_at, null);
    assert.equal(failedChunk.failure.phase, "chunk_ingest");
  });
});

test("audit-codex timeout fails closed with replayable failed chunk state", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "security.ts"), "export const allow = true;\n", "utf8");
    const sweepId = "audit-sweep-test-codex-timeout";
    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--criteria",
      "p0p1",
      "--max-files",
      "1",
      "--sweep-id",
      sweepId,
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", `${sweepId}.yaml`), "utf8"));
    const chunk = plan.chunks[0];
    const fakeCodexPath = path.join(projectRoot, "fake-codex-hang.mjs");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env node",
        "setInterval(() => {}, 1000);",
        "await new Promise(() => {});",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCodexPath, 0o755);

    const auditResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "audit-codex",
      "--sweep-id",
      sweepId,
      "--chunk-id",
      chunk.chunk_id,
      "--dispatched-at",
      "2026-05-05T00:00:00.000Z",
      "--verified-at",
      "2026-05-05T00:01:00.000Z",
      "--reviewed-at",
      "2026-05-05T00:02:00.000Z",
      "--codex-bin",
      fakeCodexPath,
      "--timeout-ms",
      "50",
      "--json",
    ]);
    assert.equal(auditResult.exitCode, 2);
    assert.match(auditResult.stderr, /timed out/);

    const validateResult = await captureRunCli([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      sweepId,
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0, validateResult.stdout);
    const failedChunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", sweepId, `${chunk.chunk_id}.yaml`), "utf8"));
    assert.equal(failedChunk.state, "failed");
    assert.equal(failedChunk.lifecycle.failed_at, "2026-05-05T00:01:00.000Z");
    assert.equal(failedChunk.lifecycle.ingested_at, null);
    assert.equal(failedChunk.failure.phase, "codex_execution");
    const runLedger = await readFile(path.join(projectRoot, ".nimi", "local", "audit", "runs", `${sweepId}.jsonl`), "utf8");
    assert.match(runLedger, /"event_type":"chunk_failed"/);
    assert.match(runLedger, /"event_type":"chunk_codex_audit_failed"/);
  });
});

test("audit-codex missing raw output fails closed with valid chunk replay", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "security.ts"), "export const allow = true;\n", "utf8");
    const sweepId = "audit-sweep-test-codex-missing-raw";
    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--criteria",
      "p0p1",
      "--max-files",
      "1",
      "--sweep-id",
      sweepId,
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", `${sweepId}.yaml`), "utf8"));
    const chunk = plan.chunks[0];
    const fakeCodexPath = path.join(projectRoot, "fake-codex-no-output.mjs");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env node",
        "process.exit(0);",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCodexPath, 0o755);

    const auditResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "audit-codex",
      "--sweep-id",
      sweepId,
      "--chunk-id",
      chunk.chunk_id,
      "--dispatched-at",
      "2026-05-05T00:00:00.000Z",
      "--verified-at",
      "2026-05-05T00:01:00.000Z",
      "--reviewed-at",
      "2026-05-05T00:02:00.000Z",
      "--codex-bin",
      fakeCodexPath,
      "--timeout-ms",
      "5000",
      "--json",
    ]);
    assert.equal(auditResult.exitCode, 2);
    assert.match(auditResult.stderr, /raw output file is missing/);

    const validateResult = await captureRunCli([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      sweepId,
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0, validateResult.stdout);
    const failedChunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", sweepId, `${chunk.chunk_id}.yaml`), "utf8"));
    assert.equal(failedChunk.state, "failed");
    assert.equal(failedChunk.failure.phase, "auditor_output_validation");
    assert.equal(failedChunk.evidence_ref, null);
  });
});
