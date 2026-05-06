import {
  writeFile,
  path,
  test,
  assert,
  withTempProject,
} from "./nimicoding-test-utils.mjs";

import {
  extractCodexAuditorEvidenceFile,
} from "../cli/lib/audit-sweep-runtime/codex-auditor-evidence.mjs";

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

test("Codex auditor extractor tolerates exact duplicate trailing top-level fields", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-duplicate-trailing-findings.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-duplicate-trailing-findings",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/sdk/kernel/testing-gates-contract.md"],
      authority_refs: [".nimi/spec/sdk/kernel/testing-gates-contract.md"],
      evidence_inventory: ["scripts/run-live-test-matrix.mjs"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-duplicate-trailing-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The testing gate implementation was inspected.",
        }],
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [{
        severity: "high",
        category: "app_local_shadow_truth",
        actionability: "needs-decision",
        confidence: "high",
        impact: "A testing gate can read a provider catalog from non-authority.",
        location: { file: chunk.evidence_inventory[0], line: 35 },
        title: "Testing gate fixture finding",
        description: "The semantic finding remains in the first complete envelope; the duplicate tail is byte-equivalent JSON content.",
        evidence: {
          summary: "The duplicate tail repeats the same top-level findings field.",
          auditor_reasoning: "Ignoring an exact duplicate field does not add, remove, or rewrite semantic conclusions.",
        },
      }],
    };
    const rawOutputPath = path.join(projectRoot, "codex-duplicate-trailing-findings-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence)},"findings":${JSON.stringify(rawEvidence.findings)}}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-duplicate-trailing-findings.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-duplicate-trailing-findings",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-duplicate-trailing-findings-raw.json",
      auditorId: "codex-duplicate-trailing-fixture",
    });

    assert.equal(extracted.ok, true, extracted.error);
    assert.equal(extracted.evidence.findings.length, 1);
    assert.equal(extracted.evidence.findings[0].title, "Testing gate fixture finding");
  });
});

test("Codex auditor extractor rejects conflicting duplicate trailing top-level fields", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-conflicting-trailing-findings.auditor-packet.yaml";
    const chunk = {
      chunk_id: "chunk-conflicting-trailing-findings",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [".nimi/spec/sdk/kernel/testing-gates-contract.md"],
      authority_refs: [".nimi/spec/sdk/kernel/testing-gates-contract.md"],
      evidence_inventory: ["scripts/run-live-test-matrix.mjs"],
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-conflicting-trailing-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: chunk.authority_refs[0],
          status: "audited",
          inspected_implementation_refs: chunk.evidence_inventory,
          negative_reasoning: "The testing gate implementation was inspected.",
        }],
        p0p1_evidence_refs: chunk.evidence_inventory,
        p0p1_rule_checks: p0p1RuleChecks(chunk.evidence_inventory[0]),
      },
      findings: [],
    };
    const conflictingFinding = [{
      severity: "high",
      category: "app_local_shadow_truth",
      title: "Conflicting trailing finding",
      description: "This trailing-only finding must not be accepted.",
      impact: "The extractor must not merge new semantic content from trailing drift.",
      location: { file: chunk.evidence_inventory[0], line: 35 },
    }];
    const rawOutputPath = path.join(projectRoot, "codex-conflicting-trailing-findings-raw.json");
    await writeFile(rawOutputPath, `${JSON.stringify(rawEvidence)},"findings":${JSON.stringify(conflictingFinding)}}\n`, "utf8");

    const extracted = await extractCodexAuditorEvidenceFile(projectRoot, {
      rawOutputPath,
      evidenceRef: ".nimi/local/audit/evidence/test/chunk-conflicting-trailing-findings.codex-evidence.json",
      chunk,
      packetRef,
      sessionRef: "codex-exec:test-conflicting-trailing-findings",
      transcriptRef: ".nimi/local/audit/evidence/test/codex-conflicting-trailing-findings-raw.json",
      auditorId: "codex-conflicting-trailing-fixture",
    });

    assert.equal(extracted.ok, false);
    assert.match(extracted.error, /exact JSON/);
  });
});

test("Codex auditor extractor anchors authority-only findings to in-scope authority refs", async () => {
  await withTempProject(async (projectRoot) => {
    const packetRef = ".nimi/local/audit/packets/test/chunk-authority-only.auditor-packet.yaml";
    const authorityRef = ".nimi/spec/runtime/kernel/generated/capability-vocabulary-mapping.md";
    const chunk = {
      chunk_id: "chunk-authority-only",
      planning_basis: "spec_authority",
      criteria: ["p0p1"],
      files: [authorityRef],
      authority_refs: [authorityRef],
      evidence_inventory: [],
      evidence_inventory_status: "empty",
      evidence_inventory_empty_reason: "generated_projection_authority_no_direct_implementation_evidence",
    };
    const rawEvidence = {
      chunk_id: chunk.chunk_id,
      auditor: { id: "codex-authority-only-fixture" },
      coverage: {
        authority_outcomes: [{
          authority_ref: authorityRef,
          status: "audited",
          inspected_implementation_refs: [],
          implementation_not_applicable_reason: "The generated authority projection has no direct implementation inventory.",
          negative_reasoning: "The authority document itself was inspected and contains the defect.",
        }],
        p0p1_evidence_refs: [],
        p0p1_rule_checks: p0p1RuleChecks().map((check) => ({
          ...check,
          status: "not_applicable",
          implementation_refs: [],
          negative_reasoning: `Rule ${check.id} has no implementation surface in this authority-only generated projection chunk.`,
        })),
      },
      findings: [{
        severity: "high",
        category: "fail_open_or_pseudo_success",
        actionability: "needs-decision",
        confidence: "high",
        impact: "Unknown capability vocabulary values are mapped to a successful fallback.",
        title: "Unknown capability fallback succeeds",
        description: "The defect is in the generated authority mapping itself, with no direct implementation inventory for this chunk.",
        authority_refs: [authorityRef],
        implementation_refs: [],
        evidence: {
          summary: "The generated authority mapping contains the fallback.",
          auditor_reasoning: "This is a real authority-only semantic finding and must be anchored to the authority ref.",
        },
      }],
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
    assert.deepEqual(extracted.evidence.findings[0].location, { file: authorityRef });
    assert.equal(extracted.evidence.coverage.evidence_files.length, 0);
  });
});
