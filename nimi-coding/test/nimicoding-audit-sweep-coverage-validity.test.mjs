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
  buildAuditValidityForEvidence,
  combineAuditValidity,
} from "../cli/lib/audit-sweep-runtime/audit-validity.mjs";
import {
  buildCoverageQuality,
  deriveCoverageCloseoutPosture,
  deriveCoverageStatus,
} from "../cli/lib/audit-sweep-runtime/coverage-quality.mjs";
import {
  deriveFindingCluster,
} from "../cli/lib/audit-sweep-runtime/risk-budget.mjs";

function specPlan(chunks, coverage = {}) {
  const evidenceInventory = chunks.flatMap((chunk) => chunk.evidence_inventory ?? []);
  return {
    planning_basis: { mode: "spec_authority" },
    evidence_inventory: evidenceInventory.map((fileRef) => ({ file_ref: fileRef })),
    unmapped_evidence_files: [],
    coverage: {
      authority_files: chunks.reduce((total, chunk) => total + (chunk.authority_refs ?? chunk.files ?? []).length, 0),
      evidence_files: new Set(evidenceInventory).size,
      unmapped_evidence_files: 0,
      ...coverage,
    },
  };
}

function authorityOnlyNoFindingEvidence(chunk) {
  return {
    chunk_id: chunk.chunk_id,
    auditor: { id: "regression-fixture" },
    coverage: {
      authority_refs: chunk.authority_refs,
      files: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: chunk.authority_refs.map((authorityRef) => ({
        authority_ref: authorityRef,
        status: "audited",
        evidence_refs: [authorityRef],
      })),
    },
    findings: [],
  };
}

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

test("audit validity classifies the Nimi incident shape as invalid", () => {
  const chunk = {
    chunk_id: "chunk-nimi-incident",
    authority_refs: [".nimi/spec/runtime/kernel/runtime-contract.md"],
    evidence_inventory: ["runtime/internal/service.go", "runtime/internal/service_test.go"],
  };

  const validity = buildAuditValidityForEvidence(chunk, authorityOnlyNoFindingEvidence(chunk));

  assert.equal(validity.posture, "invalid");
  assert.equal(validity.no_finding_posture, "invalid");
  assert.equal(validity.zero_finding_chunk_count, 1);
  assert.equal(validity.audited_outcomes_without_implementation_evidence_refs, 1);
  assert.deepEqual(new Set(validity.blockers.map((blocker) => blocker.id)), new Set([
    "audited_outcome_authority_only_evidence_refs",
    "no_finding_evidence_invalid",
    "no_finding_negative_reasoning_missing",
  ]));
});

test("audit validity aggregates a 39 chunk zero-finding replay as invalid", () => {
  const entries = Array.from({ length: 39 }, (_, index) => {
    const chunk = {
      chunk_id: `chunk-${String(index + 1).padStart(3, "0")}`,
      authority_refs: [`.nimi/spec/domain-${index}/kernel/contract.md`],
      evidence_inventory: [`src/domain-${index}/implementation.ts`],
    };
    return buildAuditValidityForEvidence(chunk, authorityOnlyNoFindingEvidence(chunk));
  });

  const combined = combineAuditValidity(entries);

  assert.equal(combined.posture, "invalid");
  assert.equal(combined.no_finding_posture, "invalid");
  assert.equal(combined.zero_finding_chunk_count, 39);
  assert.equal(combined.audited_outcomes_without_implementation_evidence_refs, 39);
  assert.ok(combined.blockers.some((blocker) => blocker.id === "no_finding_evidence_invalid"));
});

test("empty-inventory no-finding evidence remains weak rather than invalid by default", () => {
  const chunk = {
    chunk_id: "chunk-empty-spec-only",
    authority_refs: [".nimi/spec/spec-only/kernel/contract.md"],
    evidence_inventory: [],
  };
  const evidence = {
    chunk_id: chunk.chunk_id,
    coverage: {
      authority_refs: chunk.authority_refs,
      files: chunk.authority_refs,
      evidence_files: [],
      authority_outcomes: [{
        authority_ref: chunk.authority_refs[0],
        status: "audited",
        evidence_refs: [chunk.authority_refs[0]],
        negative_reasoning: "No implementation evidence exists for this intentionally spec-only authority surface.",
      }],
    },
    findings: [],
  };

  const validity = buildAuditValidityForEvidence(chunk, evidence);

  assert.equal(validity.posture, "warning");
  assert.equal(validity.no_finding_posture, "weak");
  assert.deepEqual(validity.blockers, []);
  assert.ok(validity.warnings.some((warning) => warning.id === "empty_inventory_no_finding_weak"));
});

test("calibration expected defects fail closed when known defects are missed", () => {
  const chunk = {
    chunk_id: "chunk-calibration-known-defect",
    authority_refs: ["config/audit-calibration-fixtures/service-contract.md"],
    evidence_inventory: ["config/audit-calibration-fixtures/src/service.ts"],
    calibration_expected_defects: [{
      id: "fixture-missing-boundary-check",
      root_cause_key: "missing-boundary-check",
      location_file: "config/audit-calibration-fixtures/src/service.ts",
      severity: "high",
      category: "boundary",
    }],
  };
  const evidence = {
    chunk_id: chunk.chunk_id,
    coverage: {
      authority_refs: chunk.authority_refs,
      files: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: [],
    },
    findings: [],
  };

  const validity = buildAuditValidityForEvidence(chunk, evidence);

  assert.equal(validity.posture, "invalid");
  assert.equal(validity.calibration_expected_defect_count, 1);
  assert.equal(validity.calibration_missed_defect_count, 1);
  assert.ok(validity.blockers.some((blocker) => (
    blocker.id === "calibration_known_defect_missed"
    && blocker.missed_defect_ids.includes("fixture-missing-boundary-check")
  )));
});

test("calibration expected defects require matching root cause and location evidence", () => {
  const chunk = {
    chunk_id: "chunk-calibration-match",
    authority_refs: ["config/audit-calibration-fixtures/service-contract.md"],
    evidence_inventory: ["config/audit-calibration-fixtures/src/service.ts"],
    calibration_expected_defects: [{
      id: "fixture-missing-boundary-check",
      root_cause_key: "missing-boundary-check",
      location_file: "config/audit-calibration-fixtures/src/service.ts",
      severity: "high",
      category: "boundary",
    }],
  };
  const wrongFindingEvidence = {
    chunk_id: chunk.chunk_id,
    coverage: {
      authority_refs: chunk.authority_refs,
      files: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: [],
    },
    findings: [{
      severity: "high",
      category: "boundary",
      location: { file: "config/audit-calibration-fixtures/src/service.ts" },
      root_cause: { key: "wrong-root-cause" },
    }],
  };
  const matchingFindingEvidence = {
    ...wrongFindingEvidence,
    findings: [{
      severity: "high",
      category: "boundary",
      location: { file: "config/audit-calibration-fixtures/src/service.ts" },
      root_cause: { key: "missing-boundary-check" },
    }],
  };

  const wrongValidity = buildAuditValidityForEvidence(chunk, wrongFindingEvidence);
  const matchingValidity = buildAuditValidityForEvidence(chunk, matchingFindingEvidence);

  assert.equal(wrongValidity.posture, "invalid");
  assert.ok(wrongValidity.blockers.some((blocker) => blocker.id === "calibration_known_defect_missed"));
  assert.equal(matchingValidity.posture, "trusted");
  assert.equal(matchingValidity.calibration_missed_defect_count, 0);
});

test("P0/P1 recall chunks require negative reasoning when no critical or high finding exists", () => {
  const chunk = {
    chunk_id: "chunk-p0p1-recall",
    criteria: ["quality", "p0p1"],
    files: ["src/security.ts"],
    evidence_inventory: [],
  };
  const mediumOnlyEvidence = {
    chunk_id: chunk.chunk_id,
    coverage: {
      files: chunk.files,
    },
    findings: [{
      severity: "medium",
      category: "code-quality",
      location: { file: "src/security.ts" },
    }],
  };
  const explainedEvidence = {
    ...mediumOnlyEvidence,
    coverage: {
      files: chunk.files,
      p0p1_negative_reasoning: "Reviewed fail-open, permission bypass, destructive action, and boundary paths; only a medium cleanup issue remains.",
      p0p1_evidence_refs: ["src/security.ts"],
    },
  };
  const highFindingEvidence = {
    ...mediumOnlyEvidence,
    findings: [{
      severity: "high",
      category: "security",
      location: { file: "src/security.ts" },
    }],
  };

  const missingReasoning = buildAuditValidityForEvidence(chunk, mediumOnlyEvidence);
  const explained = buildAuditValidityForEvidence(chunk, explainedEvidence);
  const highFinding = buildAuditValidityForEvidence(chunk, highFindingEvidence);

  assert.equal(missingReasoning.posture, "invalid");
  assert.equal(missingReasoning.p0p1_recall_posture, "invalid");
  assert.ok(missingReasoning.blockers.some((blocker) => blocker.id === "p0p1_negative_reasoning_missing"));
  assert.equal(explained.posture, "trusted");
  assert.equal(explained.p0p1_recall_posture, "explained");
  assert.equal(highFinding.posture, "trusted");
  assert.equal(highFinding.p0p1_recall_posture, "p0p1_finding_present");
});

test("P0/P1 recall refs must all belong to the implementation surface", () => {
  const fileChunk = {
    chunk_id: "chunk-p0p1-file-inventory",
    criteria: ["p0p1"],
    files: ["src/security.ts"],
    evidence_inventory: [],
  };
  const specOnlyChunk = {
    chunk_id: "chunk-p0p1-spec-only",
    planning_basis: "spec_authority",
    criteria: ["p0p1"],
    files: [".nimi/spec/runtime/kernel/security.md"],
    authority_refs: [".nimi/spec/runtime/kernel/security.md"],
    evidence_inventory: [],
  };
  const validFileEvidence = {
    chunk_id: fileChunk.chunk_id,
    coverage: {
      files: fileChunk.files,
      p0p1_negative_reasoning: "Reviewed P0/P1 defect classes against the implementation file.",
      p0p1_evidence_refs: ["src/security.ts"],
    },
    findings: [],
  };
  const mixedOutOfScopeEvidence = {
    ...validFileEvidence,
    coverage: {
      ...validFileEvidence.coverage,
      p0p1_evidence_refs: ["src/security.ts", "src/outside.ts"],
    },
  };
  const specAuthorityOnlyEvidence = {
    chunk_id: specOnlyChunk.chunk_id,
    coverage: {
      files: specOnlyChunk.files,
      p0p1_negative_reasoning: "Reviewed the authority text, but no implementation evidence exists.",
      p0p1_evidence_refs: [],
      p0p1_implementation_not_applicable_reason: "The spec-authority chunk has an empty admitted evidence inventory, so there is no implementation ref to cite.",
    },
    findings: [],
  };

  const validFile = buildAuditValidityForEvidence(fileChunk, validFileEvidence);
  const mixedOutOfScope = buildAuditValidityForEvidence(fileChunk, mixedOutOfScopeEvidence);
  const specAuthorityOnly = buildAuditValidityForEvidence(specOnlyChunk, specAuthorityOnlyEvidence);

  assert.equal(validFile.posture, "warning");
  assert.equal(validFile.p0p1_recall_posture, "explained");
  assert.equal(mixedOutOfScope.posture, "invalid");
  assert.ok(mixedOutOfScope.blockers.some((blocker) => (
    blocker.id === "p0p1_evidence_refs_out_of_scope"
    && blocker.invalid_refs.includes("src/outside.ts")
  )));
  assert.equal(specAuthorityOnly.posture, "warning");
  assert.equal(specAuthorityOnly.p0p1_recall_posture, "explained");
  assert.ok(specAuthorityOnly.warnings.some((warning) => warning.id === "empty_inventory_no_finding_weak"));
});

test("P0/P1 no-finding evidence with spec implementation inventory requires rule checks", () => {
  const chunk = {
    chunk_id: "chunk-p0p1-spec-implementation",
    planning_basis: "spec_authority",
    criteria: ["p0p1"],
    files: [".nimi/spec/runtime/kernel/security.md"],
    authority_refs: [".nimi/spec/runtime/kernel/security.md"],
    evidence_inventory: ["runtime/internal/security.go"],
  };
  const baseEvidence = {
    chunk_id: chunk.chunk_id,
    coverage: {
      files: chunk.files,
      authority_refs: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: [{
        authority_ref: chunk.authority_refs[0],
        status: "audited",
        evidence_refs: [chunk.authority_refs[0], chunk.evidence_inventory[0]],
        implementation_evidence_refs: [chunk.evidence_inventory[0]],
        negative_reasoning: "Reviewed the implementation evidence for P0/P1 classes.",
      }],
      p0p1_negative_reasoning: "Reviewed P0/P1 defect classes against the implementation file.",
      p0p1_evidence_refs: [chunk.evidence_inventory[0]],
    },
    findings: [],
  };
  const explainedEvidence = {
    ...baseEvidence,
    auditor: semanticAuditor(),
    coverage: {
      ...baseEvidence.coverage,
      p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
    },
  };

  const missingRuleChecks = buildAuditValidityForEvidence(chunk, baseEvidence);
  const explained = buildAuditValidityForEvidence(chunk, explainedEvidence);

  assert.equal(missingRuleChecks.posture, "invalid");
  assert.equal(missingRuleChecks.p0p1_recall_posture, "invalid");
  assert.ok(missingRuleChecks.blockers.some((blocker) => blocker.id === "p0p1_rule_checks_missing_or_invalid"));
  assert.equal(explained.posture, "trusted");
  assert.equal(explained.p0p1_recall_posture, "explained");
});

test("P0/P1 rule checks reject alias and duplicate ids", () => {
  const chunk = {
    chunk_id: "chunk-p0p1-exact-rule-ids",
    planning_basis: "spec_authority",
    criteria: ["p0p1"],
    files: [".nimi/spec/runtime/kernel/security.md"],
    authority_refs: [".nimi/spec/runtime/kernel/security.md"],
    evidence_inventory: ["runtime/internal/security.go"],
  };
  const evidence = (p0p1_rule_checks) => ({
    chunk_id: chunk.chunk_id,
    auditor: semanticAuditor(),
    coverage: {
      files: chunk.files,
      authority_refs: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: [{
        authority_ref: chunk.authority_refs[0],
        status: "audited",
        evidence_refs: [chunk.authority_refs[0], chunk.evidence_inventory[0]],
        implementation_evidence_refs: [chunk.evidence_inventory[0]],
        negative_reasoning: "Reviewed the implementation evidence for P0/P1 classes.",
      }],
      p0p1_negative_reasoning: "Reviewed exact P0/P1 rule ids against the implementation file.",
      p0p1_evidence_refs: [chunk.evidence_inventory[0]],
      p0p1_rule_checks,
    },
    findings: [],
  });
  const checksWithAlias = [
    ...p0p1RuleChecks(chunk.evidence_inventory[0]),
    {
      id: "legacy_fail_open_alias",
      status: "checked",
      implementation_refs: [chunk.evidence_inventory[0]],
      negative_reasoning: "Alias ids are not accepted as P0/P1 rule checks.",
    },
  ];
  const checksWithDuplicate = p0p1RuleChecks(chunk.evidence_inventory[0]).map((check, index) => (
    index === 1 ? { ...check, id: "fail_open_or_pseudo_success" } : check
  ));

  const aliasValidity = buildAuditValidityForEvidence(chunk, evidence(checksWithAlias));
  const duplicateValidity = buildAuditValidityForEvidence(chunk, evidence(checksWithDuplicate));

  assert.equal(aliasValidity.posture, "invalid");
  assert.ok(aliasValidity.blockers.some((blocker) => (
    blocker.id === "p0p1_rule_checks_missing_or_invalid"
    && blocker.invalid_rule_checks.some((entry) => entry.reason === "id must exactly match an admitted P0/P1 rule check id")
  )));
  assert.equal(duplicateValidity.posture, "invalid");
  assert.ok(duplicateValidity.blockers.some((blocker) => (
    blocker.id === "p0p1_rule_checks_missing_or_invalid"
    && blocker.invalid_rule_checks.some((entry) => entry.reason === "duplicate P0/P1 rule check id")
  )));
});

test("P0/P1 no-finding evidence with implementation inventory requires semantic auditor provenance", () => {
  const chunk = {
    chunk_id: "chunk-p0p1-provenance",
    planning_basis: "spec_authority",
    criteria: ["p0p1"],
    files: [".nimi/spec/runtime/kernel/security.md"],
    authority_refs: [".nimi/spec/runtime/kernel/security.md"],
    evidence_inventory: ["runtime/internal/security.go"],
  };
  const evidence = {
    chunk_id: chunk.chunk_id,
    auditor: { id: "regression-fixture" },
    coverage: {
      files: chunk.files,
      authority_refs: chunk.authority_refs,
      evidence_files: chunk.evidence_inventory,
      authority_outcomes: [{
        authority_ref: chunk.authority_refs[0],
        status: "audited",
        evidence_refs: [chunk.authority_refs[0], chunk.evidence_inventory[0]],
        implementation_evidence_refs: [chunk.evidence_inventory[0]],
        negative_reasoning: "Reviewed the implementation evidence for P0/P1 classes.",
      }],
      p0p1_negative_reasoning: "Reviewed P0/P1 defect classes against the implementation file.",
      p0p1_evidence_refs: [chunk.evidence_inventory[0]],
      p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
    },
    findings: [],
  };

  const validity = buildAuditValidityForEvidence(chunk, evidence);
  const explained = buildAuditValidityForEvidence(chunk, {
    ...evidence,
    auditor: semanticAuditor(),
  });

  assert.equal(validity.posture, "invalid");
  assert.equal(validity.p0p1_recall_posture, "invalid");
  assert.ok(validity.blockers.some((blocker) => blocker.id === "auditor_provenance_missing"));
  assert.equal(explained.posture, "trusted");
  assert.equal(explained.auditor_provenance_present, true);
});

test("templated script-generated P0/P1 no-finding evidence is invalid", () => {
  const chunk = {
    chunk_id: "chunk-p0p1-synthetic",
    planning_basis: "spec_authority",
    criteria: ["p0p1"],
    files: [".nimi/spec/runtime/kernel/security.md"],
    authority_refs: [".nimi/spec/runtime/kernel/security.md"],
    evidence_inventory: ["runtime/internal/security.go"],
  };
  const evidence = {
    chunk_id: chunk.chunk_id,
    auditor: {
      ...semanticAuditor(),
      mode: "codex_local_full_sweep",
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
        negative_reasoning: "Reviewed the implementation evidence for P0/P1 classes.",
      }],
      p0p1_negative_reasoning: "Codex audited this chunk against admitted implementation evidence, reading the complete chunk corpus through the local audit cache. Lower-severity cleanup was intentionally summarized so the sweep preserved P0/P1 recall focus.",
      p0p1_evidence_refs: [chunk.evidence_inventory[0]],
      p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
    },
    findings: [],
  };

  const validity = buildAuditValidityForEvidence(chunk, evidence);

  assert.equal(validity.posture, "invalid");
  assert.equal(validity.p0p1_recall_posture, "invalid");
  assert.ok(validity.blockers.some((blocker) => blocker.id === "synthetic_no_finding_evidence"));
});

test("coverage quality warns on sparse evidence and fan-in and blocks unresolved or unmapped evidence", () => {
  const chunks = [
    {
      chunk_id: "chunk-001-runtime",
      owner_domain: "runtime",
      authority_refs: [".nimi/spec/runtime/kernel/a.md"],
      evidence_inventory: ["runtime/a.ts", "runtime/b.ts", "runtime/c.ts"],
    },
    {
      chunk_id: "chunk-002-runtime",
      owner_domain: "runtime",
      authority_refs: [".nimi/spec/runtime/kernel/b.md"],
      evidence_inventory: ["runtime/d.ts"],
    },
    {
      chunk_id: "chunk-003-sdk",
      owner_domain: "sdk",
      authority_refs: [".nimi/spec/sdk/kernel/a.md"],
      evidence_inventory: [],
      declared_evidence_unresolved: ["sdk/src/missing.ts"],
    },
  ];
  const quality = buildCoverageQuality(specPlan(chunks, { evidence_files: 4, unmapped_evidence_files: 1 }), chunks);

  assert.equal(quality.posture, "blocked");
  assert.ok(quality.warnings.some((warning) => warning.id === "sparse_evidence_inventory"));
  assert.ok(quality.warnings.some((warning) => warning.id === "owner_domain_authority_only"));
  assert.ok(quality.warnings.some((warning) => warning.id === "evidence_fan_in_concentrated"));
  assert.ok(quality.blockers.some((blocker) => blocker.id === "declared_evidence_target_unresolved"));
  assert.ok(quality.blockers.some((blocker) => blocker.id === "unmapped_evidence_files"));
});

test("partial coverage closeout posture never reports audit_complete", () => {
  const partialStatus = deriveCoverageStatus("partial_authority_only");
  const partialPosture = deriveCoverageCloseoutPosture({
    coverageStatus: partialStatus,
    openFindingCount: 0,
  });

  assert.equal(partialStatus, "partial");
  assert.equal(partialPosture, "partial_coverage_all_findings_postured");
  assert.ok(!partialPosture.startsWith("audit_complete_"));
});

test("finding cluster derives chunk root for packet evidence inventory sentinel", () => {
  const chunk = {
    chunk_id: "chunk-packet-inventory-sentinel",
    planning_basis: "spec_authority",
    owner_domain: "avatar",
    files: [".nimi/spec/avatar/kernel/live2d-render-contract.md"],
    authority_refs: [".nimi/spec/avatar/kernel/live2d-render-contract.md"],
    evidence_roots: [".nimi/spec/avatar", "avatar"],
    evidence_inventory: [],
  };
  const finding = {
    sweep_id: "audit-sweep-test",
    owner_domain: "avatar",
    severity: "high",
    category: "contract",
    actionability: "needs-decision",
    location: { file: ".nimi/spec/avatar/kernel/live2d-render-contract.md", line: 76 },
    title: "Concrete Live2D implementation authority has no admitted implementation evidence",
    description: "The packet evidence_inventory is empty for implementation-bearing authority.",
  };
  const rawFinding = {
    ...finding,
    root_cause: {
      key: "empty_evidence_inventory_for_implementation_bearing_authority",
      authority_ref: chunk.authority_refs[0],
      evidence_root: "packet:evidence_inventory",
      contract_seam: "avatar Live2D render authority to implementation evidence admission",
      repair_target: "Regenerate or amend the chunk packet so implementation evidence is admitted.",
    },
  };

  const cluster = deriveFindingCluster(rawFinding, finding, chunk, {
    inventory_hash: "inventory",
    evidence_inventory_hash: "evidence",
  });

  assert.equal(cluster.ok, true, cluster.error);
  assert.equal(cluster.cluster.evidence_root, ".nimi/spec/avatar");
  assert.equal(cluster.cluster.root_cause_key, "empty_evidence_inventory_for_implementation_bearing_authority");
});

test("synthetic Nimi incident replay validates as partial coverage plus invalid audit validity", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "app-slice-admissions.yaml"),
      YAML.stringify({
        version: 1,
        admissions: [{
          app_id: "demo",
          status: "active",
          owner_domain: "app-demo",
          authority_root: "apps/demo/spec",
          evidence_roots: ["apps/demo"],
          may_not_override: [".nimi/spec/runtime/**"],
          source_rule: "P-APP-001",
        }],
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "apps", "demo", "spec", "kernel"), { recursive: true });
    await mkdir(path.join(projectRoot, "apps", "demo", "src"), { recursive: true });
    for (const name of ["app-shell", "routing", "storage", "settings"]) {
      await writeFile(path.join(projectRoot, "apps", "demo", "spec", "kernel", `${name}-contract.md`), `# ${name}\n`, "utf8");
    }
    await writeFile(path.join(projectRoot, "apps", "demo", "src", "app.ts"), "export const demo = true;\n", "utf8");
    await writeFile(path.join(projectRoot, "apps", "demo", "package.json"), "{\"name\":\"demo\"}\n", "utf8");

    const sweepId = "audit-sweep-test-nimi-incident-replay";
    assert.equal((await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "apps/demo",
      "--chunk-basis",
      "spec",
      "--sweep-id",
      sweepId,
      "--json",
    ])).exitCode, 0);

    const planPath = path.join(projectRoot, ".nimi", "local", "audit", "plans", `${sweepId}.yaml`);
    const plan = YAML.parse(await readFile(planPath, "utf8"));
    assert.ok(plan.chunks.length > 1);
    const frozenSummary = plan.chunks.find((chunk) => (chunk.evidence_inventory ?? []).length > 0);
    assert.ok(frozenSummary);
    const evidenceRef = `.nimi/local/audit/evidence/${sweepId}/${frozenSummary.chunk_id}.audit-evidence.json`;
    await mkdir(path.join(projectRoot, ".nimi", "local", "audit", "evidence", sweepId), { recursive: true });
    await writeFile(
      path.join(projectRoot, ...evidenceRef.split("/")),
      `${JSON.stringify(authorityOnlyNoFindingEvidence(frozenSummary), null, 2)}\n`,
      "utf8",
    );

    for (const chunkSummary of plan.chunks) {
      const chunkPath = path.join(projectRoot, ".nimi", "local", "audit", "chunks", sweepId, `${chunkSummary.chunk_id}.yaml`);
      const chunk = YAML.parse(await readFile(chunkPath, "utf8"));
      if (chunk.chunk_id === frozenSummary.chunk_id) {
        chunk.state = "frozen";
        chunk.evidence_ref = evidenceRef;
        chunk.finding_count = 0;
        chunk.review = { verdict: "pass", summary: "historical manager pass before validity gates" };
        chunk.lifecycle.ingested_at = "2026-05-04T00:00:00.000Z";
        chunk.lifecycle.reviewed_at = "2026-05-04T00:01:00.000Z";
        chunk.lifecycle.frozen_at = "2026-05-04T00:01:00.000Z";
      } else {
        chunk.state = "skipped";
        chunk.skip = { reason: "synthetic replay of skipped chunks from the Nimi incident" };
        chunk.lifecycle.skipped_at = "2026-05-04T00:02:00.000Z";
        chunk.declared_evidence_unresolved = ["apps/demo/src/unresolved-fixture.ts"];
      }
      chunk.updated_at = "2026-05-04T00:02:00.000Z";
      await writeFile(chunkPath, YAML.stringify(chunk), "utf8");
    }

    plan.chunks = plan.chunks.map((chunkSummary) => chunkSummary.chunk_id === frozenSummary.chunk_id
      ? { ...chunkSummary, state: "frozen", evidence_ref: evidenceRef, finding_count: 0 }
      : {
          ...chunkSummary,
          state: "skipped",
          skip: { reason: "synthetic replay of skipped chunks from the Nimi incident" },
          declared_evidence_unresolved: ["apps/demo/src/unresolved-fixture.ts"],
        });
    plan.updated_at = "2026-05-04T00:02:00.000Z";
    await writeFile(planPath, YAML.stringify(plan), "utf8");

    const ledgerResult = await captureRunCli([
      "sweep",
      "audit",
      "ledger",
      "build",
      "--sweep-id",
      sweepId,
      "--verified-at",
      "2026-05-04T00:03:00.000Z",
      "--json",
    ]);
    assert.equal(ledgerResult.exitCode, 0, ledgerResult.stderr);
    const ledgerPayload = JSON.parse(ledgerResult.stdout);
    assert.equal(ledgerPayload.status, "partial");
    assert.equal(ledgerPayload.coverage.skipped_chunks, plan.chunks.length - 1);
    assert.equal(ledgerPayload.coverageQuality.posture, "blocked");
    assert.equal(ledgerPayload.auditValidity.posture, "invalid");
    assert.equal(ledgerPayload.auditValidity.no_finding_posture, "invalid");

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
    assert.equal(validateResult.exitCode, 2);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.ok(validatePayload.checks.some((check) => (
      check.id === `chunk_${frozenSummary.chunk_id}_spec_authority_evidence_coverage`
      && check.ok === false
      && check.reason.includes("audit_validity is invalid")
    )));
  });
});
