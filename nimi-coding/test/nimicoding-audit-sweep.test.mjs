import {
  mkdir,
  readFile,
  rm,
  writeFile,
  path,
  test,
  assert,
  YAML,
  repoRoot,
  runNativeCodexSdkPrompt,
  createBootstrapSeedFileMap,
  applyFixtureScenario,
  withTempProject,
  writeGovernanceConfig,
  captureRunCli,
  runCliSubprocess,
  runCutoverReadinessCheck,
  updateSpecGenerationInputs,
  writeBlueprintReference,
  seedReconstructedTargetTruth,
  seedTargetTruthFilesOnly,
  seedHighRiskCandidateArtifacts,
  readYamlFile,
  markCanonicalTreeReady,
  writeLocalCloseoutArtifact,
  materializeFixtureScenario,
  runSpecReconstructionFixtureLoop,
  seedFrozenAuditSweep,
  clusteredAuditFinding,
  writeAuditEvidence,
} from "./nimicoding-test-utils.mjs";

test("audit-sweep plan creates deterministic local chunk artifacts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await writeFile(
      path.join(projectRoot, ".nimi", "config", "audit-sweep.yaml"),
      YAML.stringify({
        version: 1,
        audit_sweep: {
          exclude_patterns: [
            "src/domain/gen/**",
            "src/domain/generated/**",
          ],
        },
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "src", "domain"), { recursive: true });
    await mkdir(path.join(projectRoot, "src", "domain", "gen"), { recursive: true });
    await mkdir(path.join(projectRoot, "src", "domain", "generated"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "domain", "alpha.ts"), "export const alpha = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "domain", "beta.ts"), "export const beta = 2;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "domain", "gen", "ignored.ts"), "export const ignored = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "domain", "generated", "ignored.ts"), "export const ignored = 2;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--criteria",
      "quality,security",
      "--max-files",
      "1",
      "--sweep-id",
      "audit-sweep-test-plan",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0);
    const payload = JSON.parse(planResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.sweepId, "audit-sweep-test-plan");
    assert.equal(payload.totalFiles, 2);
    assert.equal(payload.includedFiles, 2);
    assert.equal(payload.chunkCount, 2);
    assert.equal(payload.planRef, ".nimi/local/audit/plans/audit-sweep-test-plan.yaml");
    assert.deepEqual(payload.criteria, ["quality", "security"]);
    assert.match(payload.inventoryHash, /^[a-f0-9]{64}$/);

    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-plan.yaml"), "utf8"));
    assert.equal(plan.kind, "audit-plan");
    assert.equal(plan.audit_sweep_config_ref, ".nimi/config/audit-sweep.yaml");
    assert.deepEqual(plan.inventory.map((entry) => entry.file_ref), [
      "src/domain/alpha.ts",
      "src/domain/beta.ts",
    ]);
    assert.equal(plan.inventory[0].included, true);
    assert.equal(plan.chunks[0].state, "planned");

    const chunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", "audit-sweep-test-plan", "chunk-001.yaml"), "utf8"));
    assert.equal(chunk.kind, "audit-chunk");
    assert.equal(chunk.file_count, 1);
    assert.equal(chunk.state, "planned");
    assert.ok(chunk.file_hashes["src/domain/alpha.ts"] || chunk.file_hashes["src/domain/beta.ts"]);
    const runLedger = await readFile(path.join(projectRoot, ".nimi", "local", "audit", "runs", "audit-sweep-test-plan.jsonl"), "utf8");
    assert.match(runLedger, /"event_type":"plan_created"/);
  });
});

test("audit-sweep plan supports explicit per-run ignore policy without claiming ignored chunks as audited", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "included.ts"), "export const included = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "ignored.ts"), "export const ignored = 1;\n", "utf8");

    const missingReason = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--max-files",
      "1",
      "--ignore",
      "src/ignored.ts",
      "--sweep-id",
      "audit-sweep-test-ignore-missing-reason",
      "--json",
    ]);
    assert.equal(missingReason.exitCode, 2);
    assert.match(missingReason.stderr, /requires --ignore-reason/);

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--max-files",
      "1",
      "--ignore",
      "src/ignored.ts",
      "--ignore-reason",
      "out-of-scope generated fixture for this sweep",
      "--sweep-id",
      "audit-sweep-test-ignore-policy",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const payload = JSON.parse(planResult.stdout);
    assert.equal(payload.auditIgnorePolicy.ignored_chunk_count, 1);

    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-ignore-policy.yaml"), "utf8"));
    assert.equal(plan.audit_ignore_policy.reason, "out-of-scope generated fixture for this sweep");
    assert.equal(plan.audit_ignore_policy.ignored_chunk_count, 1);
    const ignoredChunkSummary = plan.chunks.find((chunk) => chunk.files.includes("src/ignored.ts"));
    assert.equal(ignoredChunkSummary.state, "skipped");
    assert.equal(plan.coverage.ignored_chunks, 1);

    const ignoredChunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", "audit-sweep-test-ignore-policy", ignoredChunkSummary.chunk_id + ".yaml"), "utf8"));
    assert.equal(ignoredChunk.state, "skipped");
    assert.equal(ignoredChunk.skip.ignored_by_policy, true);

    const dispatchIgnored = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-ignore-policy",
      "--chunk-id",
      ignoredChunkSummary.chunk_id,
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(dispatchIgnored.exitCode, 2);
    assert.match(dispatchIgnored.stderr, /requires planned state/);

    const validateChunks = await captureRunCli([
      "audit-sweep",
      "validate",
      "--sweep-id",
      "audit-sweep-test-ignore-policy",
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(validateChunks.exitCode, 0, validateChunks.stderr);
  });
});

test("audit-sweep dispatch adds opt-in P0/P1 recall strategy without changing ordinary packets", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src", "p0p1"), { recursive: true });
    await mkdir(path.join(projectRoot, "src", "ordinary"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "p0p1", "security.ts"), "export const allow = true;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "ordinary", "ordinary.ts"), "export const value = 1;\n", "utf8");

    const p0p1PlanResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src/p0p1",
      "--criteria",
      "quality,p0p1",
      "--max-files",
      "1",
      "--sweep-id",
      "audit-sweep-test-p0p1-profile",
      "--json",
    ]);
    assert.equal(p0p1PlanResult.exitCode, 0, p0p1PlanResult.stderr);
    const p0p1Plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-p0p1-profile.yaml"), "utf8"));
    const p0p1Chunk = p0p1Plan.chunks[0];

    const p0p1DispatchResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-p0p1-profile",
      "--chunk-id",
      p0p1Chunk.chunk_id,
      "--dispatched-at",
      "2026-05-04T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(p0p1DispatchResult.exitCode, 0, p0p1DispatchResult.stderr);
    const p0p1Packet = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "packets", "audit-sweep-test-p0p1-profile", `${p0p1Chunk.chunk_id}.auditor-packet.yaml`), "utf8"));
    assert.equal(p0p1Packet.audit_strategy.mode, "p0_p1_triage_then_deep");
    assert.equal(p0p1Packet.audit_strategy.profile.profile_id, "p0_p1_recall");
    assert.equal(p0p1Packet.audit_strategy.profile.severity_mapping.p0, "critical");
    assert.equal(p0p1Packet.audit_strategy.profile.severity_mapping.p1, "high");
    assert.ok(p0p1Packet.audit_strategy.profile.priority_defect_classes.some((defectClass) => defectClass.id === "fail_open_or_pseudo_success"));
    assert.ok(p0p1Packet.audit_strategy.profile.priority_defect_classes.some((defectClass) => defectClass.id === "partial_coverage_misrepresented_as_complete"));
    assert.deepEqual(
      p0p1Packet.audit_strategy.profile.priority_defect_classes.map((defectClass) => defectClass.id).sort(),
      [...p0p1Packet.output_contract.p0p1_rule_check_required_ids].sort(),
    );
    assert.equal(p0p1Packet.output_contract.p0p1_rule_check_id_policy.aliases_rejected_fail_closed, true);
    assert.equal(p0p1Packet.audit_strategy.profile.token_budget_policy.triage_first, true);
    assert.equal(p0p1Packet.audit_strategy.profile.token_budget_policy.deep_audit_only_on_trigger, true);
    assert.equal(p0p1Packet.audit_strategy.profile.token_budget_policy.cluster_duplicate_symptoms, true);
    assert.equal(p0p1Packet.audit_strategy.profile.no_p0p1_finding_requirement.required, true);
    assert.equal(p0p1Packet.audit_strategy.profile.no_p0p1_finding_requirement.evidence_refs_must_include_implementation, true);

    await writeFile(
      path.join(projectRoot, "p0p1-out-of-scope-evidence.json"),
      `${JSON.stringify({
        chunk_id: p0p1Chunk.chunk_id,
        auditor: { id: "p0p1-regression-auditor" },
        coverage: {
          files: p0p1Chunk.files,
          p0p1_negative_reasoning: "Reviewed P0/P1 defect classes against the implementation file.",
          p0p1_evidence_refs: [p0p1Chunk.files[0], "src/outside.ts"],
        },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const outOfScopeIngestResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-p0p1-profile",
      "--chunk-id",
      p0p1Chunk.chunk_id,
      "--from",
      "p0p1-out-of-scope-evidence.json",
      "--verified-at",
      "2026-05-04T00:00:30.000Z",
      "--json",
    ]);
    assert.equal(outOfScopeIngestResult.exitCode, 2);
    assert.match(outOfScopeIngestResult.stderr, /coverage\.p0p1_evidence_refs\[1\] must belong to the chunk implementation surface/);

    const ordinaryPlanResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src/ordinary",
      "--criteria",
      "quality",
      "--max-files",
      "1",
      "--sweep-id",
      "audit-sweep-test-ordinary-profile",
      "--json",
    ]);
    assert.equal(ordinaryPlanResult.exitCode, 0, ordinaryPlanResult.stderr);
    const ordinaryPlan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-ordinary-profile.yaml"), "utf8"));
    const ordinaryChunk = ordinaryPlan.chunks[0];

    const ordinaryDispatchResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-ordinary-profile",
      "--chunk-id",
      ordinaryChunk.chunk_id,
      "--dispatched-at",
      "2026-05-04T00:01:00.000Z",
      "--json",
    ]);
    assert.equal(ordinaryDispatchResult.exitCode, 0, ordinaryDispatchResult.stderr);
    const ordinaryPacket = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "packets", "audit-sweep-test-ordinary-profile", `${ordinaryChunk.chunk_id}.auditor-packet.yaml`), "utf8"));
    assert.equal(ordinaryPacket.audit_strategy.mode, "file_inventory_audit");
    assert.equal(ordinaryPacket.audit_strategy.profile, undefined);
  });
});

test("audit-sweep plan uses spec authority chunks for whole-project sweeps", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "spec", "runtime", "kernel"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "runtime-audit-surface.md"),
      "# Runtime Audit Surface\n",
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "runtime-secondary-surface.md"),
      "# Runtime Secondary Surface\n",
      "utf8",
    );
    await mkdir(path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "generated"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "generated", "runtime-audit-surface.md"),
      "# Generated Runtime Audit Surface\n",
      "utf8",
    );
    await mkdir(path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "tables"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "tables", "runtime-audit-surface.yaml"),
      "surfaces:\n  - runtime-audit-surface\n",
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "index.md"),
      "# Runtime Domain\n\n## Module Map\n\n- `internal/` 鈥?runtime service implementation\n",
      "utf8",
    );
    await mkdir(path.join(projectRoot, "runtime", "internal"), { recursive: true });
    await writeFile(path.join(projectRoot, "runtime", "README.md"), "# Runtime\n", "utf8");
    await writeFile(path.join(projectRoot, "runtime", "internal", "service.go"), "package internal\n", "utf8");
    await writeFile(path.join(projectRoot, "runtime", "internal", "service_test.go"), "package internal\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      ".",
      "--criteria",
      "quality,boundary",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0);
    const payload = JSON.parse(planResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.chunkBasis, "spec_authority");

    const planText = await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-spec-basis.yaml"), "utf8");
    assert.doesNotMatch(planText, /^\s+\w+: &a\d+/m);
    const plan = YAML.parse(planText);
    assert.equal(plan.planning_basis.mode, "spec_authority");
    assert.equal(plan.planning_basis.authority_root, ".nimi/spec");
    assert.equal(plan.planning_basis.files_are_evidence_only, true);
    assert.ok(plan.inventory.every((entry) => entry.file_ref.startsWith(".nimi/spec/")));
    assert.ok(!plan.inventory.some((entry) => entry.file_ref === "runtime/internal/service.go"));
    assert.ok(plan.evidence_inventory.some((entry) => entry.file_ref === "runtime/internal/service.go"));
    assert.equal(plan.coverage.authority_files, plan.coverage.included_files);
    assert.ok(plan.coverage.evidence_files > 0);
    assert.ok(plan.coverage.unmapped_evidence_files > 0);
    assert.equal(plan.unmapped_evidence_files.length, plan.coverage.unmapped_evidence_files);

    const runtimeChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "kernel-contracts");
    assert.ok(runtimeChunk);
    assert.ok(runtimeChunk.authority_refs.includes(".nimi/spec/runtime/kernel/runtime-audit-surface.md"));
    assert.ok(runtimeChunk.evidence_roots.includes("runtime"));
    assert.ok(runtimeChunk.evidence_roots.includes("config"));
    assert.equal(runtimeChunk.coverage_contract.evidence_files_must_cover_inventory, true);
    assert.ok(runtimeChunk.evidence_inventory.includes("runtime/internal/service.go"));
    assert.ok(runtimeChunk.evidence_inventory.includes("runtime/internal/service_test.go"));
    const runtimeSecondaryChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes(".nimi/spec/runtime/kernel/runtime-secondary-surface.md"));
    assert.ok(runtimeSecondaryChunk);
    assert.ok(runtimeSecondaryChunk.evidence_inventory.includes("runtime/internal/service.go"));
    assert.ok(runtimeSecondaryChunk.evidence_inventory.includes("runtime/internal/service_test.go"));
    const runtimeGeneratedChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "kernel-generated");
    assert.ok(runtimeGeneratedChunk);
    assert.ok(!runtimeGeneratedChunk.evidence_inventory.includes("runtime/internal/service.go"));
    const runtimeTablesChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "kernel-tables");
    assert.ok(runtimeTablesChunk);
    assert.ok(runtimeTablesChunk.evidence_inventory.includes("runtime/internal/service.go"));
    assert.ok(runtimeTablesChunk.evidence_inventory.includes("runtime/internal/service_test.go"));
    const runtimeDomainChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "domain-guides");
    assert.ok(runtimeDomainChunk);
    assert.ok(runtimeDomainChunk.evidence_inventory.includes("runtime/README.md"));
    assert.ok(runtimeDomainChunk.evidence_inventory.includes("runtime/internal/service.go"));
    assert.ok(runtimeDomainChunk.evidence_inventory.includes("runtime/internal/service_test.go"));
    const serviceEvidenceChunk = runtimeChunk;
    assert.ok(serviceEvidenceChunk);
    const specRootChunk = plan.chunks.find((chunk) => chunk.owner_domain === "spec-root");
    assert.ok(specRootChunk);
    assert.ok(specRootChunk.evidence_roots.includes("apps"));
    assert.ok(specRootChunk.evidence_roots.includes("config"));

    const dispatchResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--dispatched-at",
      "2026-04-24T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);

    const incompleteEvidencePath = path.join(projectRoot, "runtime-audit-evidence-incomplete.json");
    await writeFile(
      incompleteEvidencePath,
      `${JSON.stringify({
        chunk_id: serviceEvidenceChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          authority_refs: serviceEvidenceChunk.authority_refs,
          files: serviceEvidenceChunk.authority_refs,
        },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const incompleteIngestResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--from",
      "runtime-audit-evidence-incomplete.json",
      "--verified-at",
      "2026-04-24T00:00:30.000Z",
      "--json",
    ]);
    assert.equal(incompleteIngestResult.exitCode, 2);
    assert.match(incompleteIngestResult.stderr, /coverage\.evidence_files is required/);

    const missingAuthorityRefsEvidencePath = path.join(projectRoot, "runtime-audit-evidence-missing-authority-refs.json");
    await writeFile(
      missingAuthorityRefsEvidencePath,
      `${JSON.stringify({
        chunk_id: serviceEvidenceChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          files: serviceEvidenceChunk.authority_refs,
          evidence_files: serviceEvidenceChunk.evidence_inventory,
          authority_outcomes: serviceEvidenceChunk.authority_refs.map((authorityRef) => ({
            authority_ref: authorityRef,
            status: "not_applicable",
            evidence_refs: [],
            reason: "No implementation surface examined in this negative fixture.",
          })),
        },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const missingAuthorityRefsIngestResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--from",
      "runtime-audit-evidence-missing-authority-refs.json",
      "--verified-at",
      "2026-04-24T00:00:45.000Z",
      "--json",
    ]);
    assert.equal(missingAuthorityRefsIngestResult.exitCode, 2);
    assert.match(missingAuthorityRefsIngestResult.stderr, /coverage\.authority_refs is required/);

    const partialEvidencePath = path.join(projectRoot, "runtime-audit-evidence-partial.json");
    await writeFile(
      partialEvidencePath,
      `${JSON.stringify({
        chunk_id: serviceEvidenceChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          authority_refs: serviceEvidenceChunk.authority_refs,
          files: serviceEvidenceChunk.authority_refs,
          evidence_files: [],
          authority_outcomes: serviceEvidenceChunk.authority_refs.map((authorityRef) => ({
            authority_ref: authorityRef,
            status: "not_applicable",
            evidence_refs: [],
            reason: "Negative fixture intentionally omits implementation evidence inventory coverage.",
          })),
        },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const partialIngestResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--from",
      "runtime-audit-evidence-partial.json",
      "--verified-at",
      "2026-04-24T00:00:50.000Z",
      "--json",
    ]);
    assert.equal(partialIngestResult.exitCode, 2);
    assert.match(partialIngestResult.stderr, /coverage\.evidence_files must exactly match chunk evidence inventory/);

    const evidencePath = path.join(projectRoot, "runtime-audit-evidence.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify({
        chunk_id: serviceEvidenceChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          authority_refs: serviceEvidenceChunk.authority_refs,
          files: serviceEvidenceChunk.authority_refs,
          evidence_files: serviceEvidenceChunk.evidence_inventory,
          authority_outcomes: serviceEvidenceChunk.authority_refs.map((authorityRef) => ({
            authority_ref: authorityRef,
            status: "audited",
            evidence_refs: ["runtime/internal/service.go"],
          })),
        },
        findings: [
          {
            severity: "medium",
            category: "boundary",
            actionability: "auto-fix",
            confidence: "high",
            impact: "Spec-owned runtime chunk can report implementation evidence without making file inventory the planning basis.",
            location: { file: "runtime/internal/service.go", line: 1 },
            title: "Runtime evidence allowed by spec chunk",
            description: "The finding location is under a declared evidence root for the runtime spec authority chunk.",
            evidence: {
              summary: "runtime/internal/service.go is evidence for the runtime authority chunk.",
              auditor_reasoning: "Spec authority selected the chunk; implementation files are evidence.",
            },
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--from",
      "runtime-audit-evidence.json",
      "--verified-at",
      "2026-04-24T00:01:00.000Z",
      "--json",
    ]);
    assert.equal(ingestResult.exitCode, 0, ingestResult.stderr);
    const ingestPayload = JSON.parse(ingestResult.stdout);
    assert.equal(ingestPayload.addedCount, 1);

    const tamperedEvidencePath = path.join(projectRoot, ...ingestPayload.evidenceRef.split("/"));
    const tamperedEvidence = JSON.parse(await readFile(tamperedEvidencePath, "utf8"));
    delete tamperedEvidence.coverage.authority_refs;
    await writeFile(tamperedEvidencePath, `${JSON.stringify(tamperedEvidence, null, 2)}\n`, "utf8");
    const tamperedValidateResult = await captureRunCli([
      "audit-sweep",
      "validate",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(tamperedValidateResult.exitCode, 2);
    const tamperedValidatePayload = JSON.parse(tamperedValidateResult.stdout);
    assert.equal(tamperedValidatePayload.ok, false);
    assert.ok(tamperedValidatePayload.checks.some((check) => (
      check.id === `chunk_${serviceEvidenceChunk.chunk_id}_spec_authority_evidence_coverage`
      && check.ok === false
      && check.reason === "spec-authority evidence declares authority_refs"
    )));
  });
});

test("audit-sweep plan expands app-local specs only through app-slice admissions", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "app-slice-admissions.yaml"),
      YAML.stringify({
        version: 1,
        admissions: [
          {
            app_id: "demo",
            status: "active",
            owner_domain: "app-demo",
            authority_root: "apps/demo/spec",
            evidence_roots: ["apps/demo"],
            may_not_override: [".nimi/spec/runtime/**"],
            source_rule: "P-APP-001",
          },
        ],
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "apps", "demo", "spec", "kernel"), { recursive: true });
    await mkdir(path.join(projectRoot, "apps", "demo", "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps", "demo", "spec", "kernel", "app-shell-contract.md"), "# Demo App Shell\n", "utf8");
    await writeFile(path.join(projectRoot, "apps", "demo", "src", "app.ts"), "export const demo = true;\n", "utf8");
    await writeFile(path.join(projectRoot, "apps", "demo", "package.json"), "{\"name\":\"demo\"}\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "apps/demo",
      "--chunk-basis",
      "spec",
      "--sweep-id",
      "audit-sweep-test-app-slice-admission",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-app-slice-admission.yaml"), "utf8"));
    assert.equal(plan.app_slice_admission_ref, ".nimi/spec/platform/kernel/tables/app-slice-admissions.yaml");
    assert.deepEqual(plan.app_slice_admissions.map((entry) => entry.app_id), ["demo"]);
    const appChunk = plan.chunks.find((chunk) => chunk.app_id === "demo" && chunk.authority_refs.includes("apps/demo/spec/kernel/app-shell-contract.md"));
    assert.ok(appChunk);
    assert.equal(appChunk.authority_kind, "admitted_app_slice");
    assert.equal(appChunk.admission_ref, ".nimi/spec/platform/kernel/tables/app-slice-admissions.yaml#demo");
    assert.deepEqual(appChunk.evidence_roots, ["apps/demo"]);
    assert.ok(appChunk.evidence_inventory.includes("apps/demo/src/app.ts"));
    assert.ok(appChunk.evidence_inventory.includes("apps/demo/package.json"));
    assert.equal(plan.unmapped_evidence_files.length, 0);

    const validateResult = await captureRunCli([
      "audit-sweep",
      "validate",
      "--sweep-id",
      "audit-sweep-test-app-slice-admission",
      "--scope",
      "plan",
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0, validateResult.stdout);
  });
});

test("audit-sweep plan maps authority-specific evidence roots from spec tables", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables"), { recursive: true });
    await writeFile(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "web-release-contract.md"), "# Web Release\n", "utf8");
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "audit-evidence-roots.yaml"),
      YAML.stringify({
        version: 1,
        roots: [
          {
            id: "platform-web-release",
            owner_domain: "platform",
            authority_refs: [".nimi/spec/platform/kernel/web-release-contract.md"],
            evidence_roots: ["apps/web"],
            source_rule: "P-WEB-005",
          },
        ],
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "apps", "web", "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps", "web", "src", "app.ts"), "export const web = true;\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      ".",
      "--chunk-basis",
      "spec",
      "--sweep-id",
      "audit-sweep-test-evidence-root-admission",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-evidence-root-admission.yaml"), "utf8"));
    assert.deepEqual(plan.audit_evidence_root_refs, [".nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml"]);
    const webChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes(".nimi/spec/platform/kernel/web-release-contract.md"));
    assert.ok(webChunk);
    assert.deepEqual(webChunk.evidence_root_admission_refs, [".nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml#platform-web-release"]);
    assert.ok(webChunk.evidence_roots.includes("apps/web"));
    assert.ok(webChunk.evidence_inventory.includes("apps/web/src/app.ts"));
  });
});

test("audit-sweep plan expands admitted package authority and host-local projection evidence", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "package-authority-admission-contract.md"),
      "# Package Authority Admission\n",
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "package-authority-admissions.yaml"),
      YAML.stringify({
        version: 1,
        admissions: [
          {
            id: "tooling",
            status: "active",
            owner_domain: "tooling",
            authority_root: "tools/tooling/spec",
            evidence_roots: ["tools/tooling"],
            may_not_override: [".nimi/spec/platform/**"],
            projection_boundary: {
              host_project_admission_owner: ".nimi/spec/platform/kernel/package-authority-admission-contract.md",
              package_truth_root: "tools/tooling/spec",
              host_local_projection_roots: [".nimi/contracts", ".nimi/methodology"],
              host_authority_projection_refs: [
                {
                  host_ref: ".nimi/spec/product-scope.yaml",
                  package_ref: "tools/tooling/spec/product-scope.yaml",
                },
              ],
            },
            source_rule: "P-PKG-001",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "audit-evidence-roots.yaml"),
      YAML.stringify({
        version: 1,
        roots: [
          {
            id: "host-local-tooling-projection",
            owner_domain: "platform",
            authority_refs: [".nimi/spec/platform/kernel/package-authority-admission-contract.md"],
            evidence_roots: [".nimi/contracts", ".nimi/methodology"],
            source_rule: "P-PKG-006",
          },
          {
            id: "host-generated-audit-tooling-implementation",
            owner_domain: "spec-meta",
            authority_refs: [".nimi/spec/_meta/spec-generation-audit.yaml"],
            evidence_roots: ["tools/tooling/cli/index.mjs"],
            source_rule: "P-PKG-008",
          },
        ],
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "tools", "tooling", "spec"), { recursive: true });
    await mkdir(path.join(projectRoot, "tools", "tooling", "cli"), { recursive: true });
    await mkdir(path.join(projectRoot, "tools", "tooling", "contracts"), { recursive: true });
    await mkdir(path.join(projectRoot, ".nimi", "spec", "_meta"), { recursive: true });
    await writeFile(path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml"), "version: 1\nspec_generation_audit:\n  files: []\n", "utf8");
    await writeFile(path.join(projectRoot, "tools", "tooling", "spec", "product-scope.yaml"), "version: 1\nproduct: tooling\n", "utf8");
    await writeFile(path.join(projectRoot, "tools", "tooling", "cli", "index.mjs"), "export const run = () => true;\n", "utf8");
    await writeFile(path.join(projectRoot, "tools", "tooling", "contracts", "tool.schema.yaml"), "version: 1\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "contracts", "host-local-tool.schema.yaml"), "version: 1\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "methodology", "host-local-tool.yaml"), "version: 1\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      ".",
      "--chunk-basis",
      "spec",
      "--sweep-id",
      "audit-sweep-test-package-authority-admission",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-package-authority-admission.yaml"), "utf8"));
    assert.deepEqual(plan.package_authority_admission_refs, [".nimi/spec/platform/kernel/tables/package-authority-admissions.yaml"]);
    assert.deepEqual(plan.package_authority_admissions.map((entry) => entry.id), ["tooling"]);

    const packageChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes("tools/tooling/spec/product-scope.yaml"));
    assert.ok(packageChunk);
    assert.equal(packageChunk.authority_kind, "admitted_package_authority");
    assert.equal(packageChunk.package_authority_id, "tooling");
    assert.equal(packageChunk.admission_ref, ".nimi/spec/platform/kernel/tables/package-authority-admissions.yaml#tooling");
    assert.deepEqual(packageChunk.authority_refs, ["tools/tooling/spec/product-scope.yaml", ".nimi/spec/product-scope.yaml"]);
    assert.deepEqual(packageChunk.files, ["tools/tooling/spec/product-scope.yaml", ".nimi/spec/product-scope.yaml"]);
    assert.deepEqual(packageChunk.host_authority_projection_refs, [
      {
        host_ref: ".nimi/spec/product-scope.yaml",
        package_ref: "tools/tooling/spec/product-scope.yaml",
        package_authority_id: "tooling",
        admission_ref: ".nimi/spec/platform/kernel/tables/package-authority-admissions.yaml#tooling",
      },
    ]);
    assert.deepEqual(packageChunk.evidence_roots, ["tools/tooling"]);
    assert.ok(packageChunk.evidence_inventory.includes("tools/tooling/contracts/tool.schema.yaml"));
    assert.ok(!packageChunk.evidence_inventory.includes("tools/tooling/spec/product-scope.yaml"));
    assert.equal(plan.chunks.filter((chunk) => chunk.authority_refs.includes(".nimi/spec/product-scope.yaml")).length, 1);

    const specAuditChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes(".nimi/spec/_meta/spec-generation-audit.yaml"));
    assert.ok(specAuditChunk);
    assert.deepEqual(specAuditChunk.evidence_root_admission_refs, [".nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml#host-generated-audit-tooling-implementation"]);
    assert.deepEqual(specAuditChunk.admitted_evidence_roots, ["tools/tooling/cli/index.mjs"]);
    assert.ok(specAuditChunk.evidence_inventory.includes("tools/tooling/cli/index.mjs"));
    assert.ok(!packageChunk.evidence_inventory.includes("tools/tooling/cli/index.mjs"));

    const hostProjectionChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes(".nimi/spec/platform/kernel/package-authority-admission-contract.md"));
    assert.ok(hostProjectionChunk);
    assert.ok(hostProjectionChunk.evidence_root_admission_refs.includes(".nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml#host-local-tooling-projection"));
    assert.ok(hostProjectionChunk.admitted_evidence_roots.includes(".nimi/contracts"));
    assert.ok(hostProjectionChunk.admitted_evidence_roots.includes(".nimi/methodology"));
    assert.ok(hostProjectionChunk.evidence_inventory.includes(".nimi/contracts/host-local-tool.schema.yaml"));
    assert.ok(hostProjectionChunk.evidence_inventory.includes(".nimi/methodology/host-local-tool.yaml"));
  });
});
