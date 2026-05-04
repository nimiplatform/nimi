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
      "audit-sweep",
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
      "audit-sweep",
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
      "audit-sweep",
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
