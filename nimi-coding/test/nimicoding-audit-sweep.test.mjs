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
      "# Runtime Domain\n\n## Module Map\n\n- `internal/` — runtime service implementation\n",
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

test("audit-sweep validate emits complete JSON for large spec sweeps", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    for (let index = 0; index < 80; index += 1) {
      const domainRoot = path.join(projectRoot, ".nimi", "spec", `domain-${String(index).padStart(2, "0")}`, "kernel");
      await mkdir(domainRoot, { recursive: true });
      await writeFile(path.join(domainRoot, `surface-${String(index).padStart(2, "0")}.md`), `# Surface ${index}\n`, "utf8");
    }

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      ".",
      "--chunk-basis",
      "spec",
      "--sweep-id",
      "audit-sweep-test-large-json",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0);

    const validateResult = await runCliSubprocess([
      "audit-sweep",
      "validate",
      "--sweep-id",
      "audit-sweep-test-large-json",
      "--scope",
      "chunks",
      "--json",
    ], { cwd: projectRoot });
    assert.equal(validateResult.exitCode, 2, validateResult.stderr);
    assert.ok(validateResult.stdout.length > 65536);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, false);
    assert.ok(validatePayload.checks.some((check) => (
      check.id === "plan_spec_unmapped_evidence_fail_closed"
      && check.ok === false
      && check.reason === "spec-authority plans have no unmapped evidence files"
    )));
    assert.ok(validatePayload.checks.some((check) => (
      check.id.startsWith("run_replay_chunk-001-")
      && check.id.endsWith("_dispatch")
      && check.ok === true
      && check.reason.startsWith("run ledger dispatch not required for planned chunk ")
    )));
    assert.ok(validatePayload.checks.some((check) => (
      check.id.startsWith("run_replay_chunk-001-")
      && check.id.endsWith("_ingest")
      && check.ok === true
      && check.reason.startsWith("run ledger ingest not required for planned chunk ")
    )));
    assert.ok(validatePayload.checks.some((check) => (
      check.id.startsWith("run_replay_chunk-001-")
      && check.id.endsWith("_terminal")
      && check.ok === true
      && check.reason.startsWith("run ledger terminal event not required for planned chunk ")
    )));

    const ledgerResult = await runCliSubprocess([
      "audit-sweep",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-large-json",
      "--verified-at",
      "2026-04-24T00:00:00.000Z",
      "--json",
    ], { cwd: projectRoot });
    assert.equal(ledgerResult.exitCode, 0, ledgerResult.stderr);
    const ledgerPayload = JSON.parse(ledgerResult.stdout);
    assert.equal(ledgerPayload.status, "partial");
    assert.equal(ledgerPayload.coverage.audited_files, 0);
    assert.ok(ledgerPayload.coverage.evidence_coverage.unmapped_files > 0);
  });
});

test("audit-sweep state machine builds immutable ledger, remediation map, rerun closure, and closeout summary", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);

    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "service.ts"), "export function service() { return 1; }\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0);

    const dispatchResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--auditor",
      "test-auditor",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);
    const dispatchPayload = JSON.parse(dispatchResult.stdout);
    assert.equal(dispatchPayload.state, "dispatched");
    assert.equal(dispatchPayload.packetRef, ".nimi/local/audit/packets/audit-sweep-test-ledger/chunk-001.auditor-packet.yaml");
    const auditorPacket = YAML.parse(await readFile(path.join(projectRoot, ...dispatchPayload.packetRef.split("/")), "utf8"));
    assert.equal(auditorPacket.kind, "audit-auditor-packet");
    assert.deepEqual(auditorPacket.output_contract.coverage_files_must_exactly_match, ["src/service.ts"]);

    const evidencePath = path.join(projectRoot, "audit-output.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify({
        chunk_id: "chunk-001",
        auditor: { id: "test-auditor", model: "fixture" },
        coverage: { files: ["src/service.ts"] },
        findings: [
          {
            severity: "high",
            actionability: "needs-decision",
            confidence: "high",
            category: "security",
            impact: "The service can ship behavior that has not passed a security decision.",
            location: {
              file: "src/service.ts",
              line: 1,
              symbol: "service",
            },
            title: "Service exposes unchecked behavior",
            description: "The service path needs a concrete security review before remediation.",
            evidence: {
              summary: "service() returns without any guard or decision point.",
              auditor_reasoning: "The exported service is in the audited chunk and lacks a security decision boundary.",
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
      "audit-sweep-test-ledger",
      "--chunk-id",
      "chunk-001",
      "--from",
      "audit-output.json",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 0);
    const ingestPayload = JSON.parse(ingestResult.stdout);
    assert.equal(ingestPayload.state, "ingested");
    assert.equal(ingestPayload.addedCount, 1);
    assert.equal(ingestPayload.evidenceRef, ".nimi/local/audit/evidence/audit-sweep-test-ledger/chunk-001.audit-evidence.json");

    const reviewResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "review",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--chunk-id",
      "chunk-001",
      "--verdict",
      "pass",
      "--reviewed-at",
      "2026-04-10T01:00:00.000Z",
      "--summary",
      "manager accepted auditor evidence",
      "--json",
    ]);
    assert.equal(reviewResult.exitCode, 0);
    assert.equal(JSON.parse(reviewResult.stdout).state, "frozen");

    const ledgerResult = await captureRunCli([
      "audit-sweep",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(ledgerResult.exitCode, 0);
    const ledgerPayload = JSON.parse(ledgerResult.stdout);
    assert.equal(ledgerPayload.status, "candidate_ready");
    assert.match(ledgerPayload.snapshotId, /^ledger-[a-f0-9]{16}$/);
    assert.equal(ledgerPayload.findingCount, 1);
    assert.equal(ledgerPayload.unresolvedFindingCount, 1);
    assert.equal(ledgerPayload.coverage.audited_files, 1);
    assert.match(ledgerPayload.ledgerRef, /^\.nimi\/local\/audit\/ledgers\/audit-sweep-test-ledger\/ledger-[a-f0-9]{16}\.yaml$/);
    assert.match(ledgerPayload.reportRef, /^\.nimi\/local\/audit\/reports\/audit-sweep-test-ledger\/ledger-[a-f0-9]{16}\.md$/);

    const ledger = YAML.parse(await readFile(path.join(projectRoot, ...ledgerPayload.ledgerRef.split("/")), "utf8"));
    assert.equal(ledger.kind, "audit-ledger");
    assert.equal(ledger.immutable, true);
    assert.equal(ledger.finding_count, 1);
    assert.equal(ledger.unresolved_finding_count, 1);
    assert.deepEqual(ledger.evidence_refs, [
      ".nimi/local/audit/evidence/audit-sweep-test-ledger/findings.yaml",
      ".nimi/local/audit/evidence/audit-sweep-test-ledger/chunk-001.audit-evidence.json",
    ]);
    const latestPointer = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "ledgers", "audit-sweep-test-ledger", "latest.yaml"), "utf8"));
    assert.equal(latestPointer.ledger_ref, ledgerPayload.ledgerRef);

    const remediationMapResult = await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--max-findings",
      "1",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(remediationMapResult.exitCode, 0);
    const remediationMapPayload = JSON.parse(remediationMapResult.stdout);
    assert.equal(remediationMapPayload.waveCount, 1);
    assert.equal(remediationMapPayload.mappedFindingCount, 1);
    assert.match(remediationMapPayload.remediationMapRef, /^\.nimi\/local\/audit\/remediation-maps\/audit-sweep-test-ledger\/ledger-[a-f0-9]{16}\.yaml$/);

    const remediationMap = YAML.parse(await readFile(path.join(projectRoot, ...remediationMapPayload.remediationMapRef.split("/")), "utf8"));
    assert.equal(remediationMap.kind, "audit-remediation-map");
    assert.equal(remediationMap.source_ledger_ref, ledgerPayload.ledgerRef);
    assert.equal(remediationMap.waves[0].wave_id, "remediation-wave-001");
    assert.equal(remediationMap.waves[0].owner_domain, "src");
    assert.deepEqual(remediationMap.waves[0].finding_ids, ["finding-0001"]);
    assert.equal(remediationMap.waves[0].admission_checklist.re_audit_required, true);

    const findingsStore = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "evidence", "audit-sweep-test-ledger", "findings.yaml"), "utf8"));
    const sourceFingerprint = findingsStore.findings[0].fingerprint;

    await writeFile(
      path.join(projectRoot, "resolution-output.json"),
      `${JSON.stringify({
        finding_id: "finding-0001",
        source_fingerprint: sourceFingerprint,
        disposition: "remediated",
        rerun: {
          chunk_id: "chunk-001",
          covered_files: ["src/service.ts"],
          verdict: "not_reproduced",
          auditor: { id: "test-auditor", model: "fixture" },
        },
        evidence_summary: "Re-audit evidence confirms the finding has been remediated.",
      }, null, 2)}\n`,
      "utf8",
    );

    const resolveResult = await captureRunCli([
      "audit-sweep",
      "finding",
      "resolve",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--finding-id",
      "finding-0001",
      "--disposition",
      "remediated",
      "--from",
      "resolution-output.json",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(resolveResult.exitCode, 0);
    const resolvePayload = JSON.parse(resolveResult.stdout);
    assert.equal(resolvePayload.disposition, "remediated");
    assert.equal(resolvePayload.evidenceRef, ".nimi/local/audit/evidence/audit-sweep-test-ledger/resolution-finding-0001.json");

    const rebuiltLedgerResult = await captureRunCli([
      "audit-sweep",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(rebuiltLedgerResult.exitCode, 0);
    const rebuiltLedgerPayload = JSON.parse(rebuiltLedgerResult.stdout);
    assert.equal(rebuiltLedgerPayload.unresolvedFindingCount, 0);
    assert.ok(rebuiltLedgerPayload.evidenceRefs.includes(".nimi/local/audit/evidence/audit-sweep-test-ledger/resolution-finding-0001.json"));
    assert.notEqual(rebuiltLedgerPayload.ledgerRef, ledgerPayload.ledgerRef);

    const emptyRemediationMapResult = await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(emptyRemediationMapResult.exitCode, 0);
    assert.equal(JSON.parse(emptyRemediationMapResult.stdout).waveCount, 0);

    const closeoutSummaryResult = await captureRunCli([
      "audit-sweep",
      "closeout",
      "summary",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(closeoutSummaryResult.exitCode, 0);
    const closeoutImport = JSON.parse(closeoutSummaryResult.stdout);
    assert.equal(closeoutImport.skill.id, "audit_sweep");
    assert.equal(closeoutImport.outcome, "completed");
    assert.equal(closeoutImport.summary.status, "candidate_ready");
    assert.equal(closeoutImport.summary.unresolved_finding_count, 0);
    assert.equal(closeoutImport.auditCloseout.closeout_posture, "audit_complete_all_findings_postured");
    assert.equal(closeoutImport.summary.audit_closeout_ref, closeoutImport.auditCloseoutRef);
    assert.equal("audit_closeout" in closeoutImport.summary, false);

    const closeoutImportPath = path.join(projectRoot, "audit-sweep-closeout.json");
    await writeFile(closeoutImportPath, `${JSON.stringify(closeoutImport, null, 2)}\n`, "utf8");
    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      closeoutImportPath,
      "--json",
    ]);
    assert.equal(closeoutResult.exitCode, 0);
    const closeoutPayload = JSON.parse(closeoutResult.stdout);
    assert.equal(closeoutPayload.ok, true);
    assert.equal(closeoutPayload.skill.id, "audit_sweep");

    const statusResult = await captureRunCli([
      "audit-sweep",
      "status",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--json",
    ]);
    assert.equal(statusResult.exitCode, 0);
    const statusPayload = JSON.parse(statusResult.stdout);
    assert.equal(statusPayload.coverage.frozenChunks, 1);
    assert.equal(statusPayload.findingCount, 1);

    const validateResult = await captureRunCli([
      "audit-sweep",
      "validate",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--scope",
      "all",
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, true);
    assert.ok(validatePayload.checks.length > 0);
  });
});

test("audit-sweep clusters duplicate symptoms, preserves unique high severity findings, and pauses on risk budget", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "a.ts"), "export function service() { return 1; }\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "b.ts"), "export function service() { return 2; }\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "c.ts"), "export function service() { return 3; }\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--max-files",
      "1",
      "--max-domain-findings",
      "2",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);

    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ])).exitCode, 0);
    await writeAuditEvidence(projectRoot, "cluster-budget-1.json", "chunk-001", ["src/a.ts"], [
      clusteredAuditFinding({
        file: "src/a.ts",
        title: "Shared service contract drift",
        rootCauseKey: "shared-service-contract-drift",
      }),
    ]);
    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--chunk-id",
      "chunk-001",
      "--from",
      "cluster-budget-1.json",
      "--verified-at",
      "2026-04-10T00:10:00.000Z",
      "--json",
    ])).exitCode, 0);

    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--chunk-id",
      "chunk-002",
      "--dispatched-at",
      "2026-04-10T00:20:00.000Z",
      "--json",
    ])).exitCode, 0);
    await writeAuditEvidence(projectRoot, "cluster-budget-2.json", "chunk-002", ["src/b.ts"], [
      clusteredAuditFinding({
        file: "src/b.ts",
        title: "Shared service contract drift",
        rootCauseKey: "shared-service-contract-drift",
      }),
      clusteredAuditFinding({
        file: "src/b.ts",
        line: 2,
        title: "Unique high risk service bypass",
        rootCauseKey: "unique-high-risk-service-bypass",
      }),
    ]);
    const secondIngest = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--chunk-id",
      "chunk-002",
      "--from",
      "cluster-budget-2.json",
      "--verified-at",
      "2026-04-10T00:30:00.000Z",
      "--json",
    ]);
    assert.equal(secondIngest.exitCode, 0, secondIngest.stderr);
    const secondPayload = JSON.parse(secondIngest.stdout);
    assert.equal(secondPayload.addedCount, 1);
    assert.equal(secondPayload.clusteredCount, 1);
    assert.equal(secondPayload.riskBudgetStatus.state, "paused");

    const blockedDispatch = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--chunk-id",
      "chunk-003",
      "--dispatched-at",
      "2026-04-10T00:40:00.000Z",
      "--json",
    ]);
    assert.equal(blockedDispatch.exitCode, 2);
    assert.match(blockedDispatch.stderr, /risk budget paused/);

    const findingsStore = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "evidence", "audit-sweep-test-clustering-budget", "findings.yaml"), "utf8"));
    assert.equal(findingsStore.findings.length, 2);
    assert.equal(findingsStore.remediation_obligation_count, 2);
    assert.equal(findingsStore.clustered_symptom_count, 1);
    assert.equal(findingsStore.clusters.length, 2);
    assert.ok(findingsStore.clusters.some((cluster) => cluster.duplicate_symptom_count === 1));

    assert.equal((await captureRunCli([
      "audit-sweep",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--verified-at",
      "2026-04-10T00:50:00.000Z",
      "--json",
    ])).exitCode, 0);
    const remediationMapResult = await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--verified-at",
      "2026-04-10T01:00:00.000Z",
      "--json",
    ]);
    assert.equal(remediationMapResult.exitCode, 0, remediationMapResult.stderr);
    const remediationMapPayload = JSON.parse(remediationMapResult.stdout);
    assert.equal(remediationMapPayload.waveCount, 1);
    assert.equal(remediationMapPayload.remediationBundleCount, 1);
    assert.equal(remediationMapPayload.clusteredSymptomCount, 1);
    assert.equal(remediationMapPayload.waves[0].cluster_ids.length, 2);
    assert.equal(remediationMapPayload.waves[0].remediation_bundle.duplicate_symptom_count, 1);
  });
});

test("audit-sweep accepted clusters resume-skip unchanged roots and reopen when authority context changes", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "a.ts"), "export function service() { return 1; }\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "b.ts"), "export function service() { return 2; }\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "c.ts"), "export function service() { return 3; }\n", "utf8");

    assert.equal((await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--max-files",
      "1",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--json",
    ])).exitCode, 0);
    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ])).exitCode, 0);
    await writeAuditEvidence(projectRoot, "accepted-cluster-1.json", "chunk-001", ["src/a.ts"], [
      clusteredAuditFinding({
        file: "src/a.ts",
        title: "Accepted service cluster",
        rootCauseKey: "accepted-service-cluster",
      }),
    ]);
    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--chunk-id",
      "chunk-001",
      "--from",
      "accepted-cluster-1.json",
      "--verified-at",
      "2026-04-10T00:10:00.000Z",
      "--json",
    ])).exitCode, 0);
    assert.equal((await captureRunCli([
      "audit-sweep",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--verified-at",
      "2026-04-10T00:20:00.000Z",
      "--json",
    ])).exitCode, 0);
    assert.equal((await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--verified-at",
      "2026-04-10T00:30:00.000Z",
      "--json",
    ])).exitCode, 0);

    const createTopic = await captureRunCli([
      "topic",
      "create",
      "accepted-cluster-demo",
      "--title",
      "Accepted Cluster Demo",
      "--justification",
      "audit-sweep accepted cluster resume behavior needs a repair owner",
      "--applicability",
      "authority-bearing",
      "--json",
    ]);
    assert.equal(createTopic.exitCode, 0, createTopic.stderr);
    const topic = JSON.parse(createTopic.stdout);
    assert.equal((await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "admit",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--topic-id",
      topic.topicId,
      "--json",
    ])).exitCode, 0);

    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--chunk-id",
      "chunk-002",
      "--dispatched-at",
      "2026-04-10T00:40:00.000Z",
      "--json",
    ])).exitCode, 0);
    await writeAuditEvidence(projectRoot, "accepted-cluster-2.json", "chunk-002", ["src/b.ts"], [
      clusteredAuditFinding({
        file: "src/b.ts",
        title: "Accepted service cluster",
        rootCauseKey: "accepted-service-cluster",
      }),
    ]);
    const unchangedResume = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--chunk-id",
      "chunk-002",
      "--from",
      "accepted-cluster-2.json",
      "--verified-at",
      "2026-04-10T00:50:00.000Z",
      "--json",
    ]);
    assert.equal(unchangedResume.exitCode, 0, unchangedResume.stderr);
    const unchangedPayload = JSON.parse(unchangedResume.stdout);
    assert.equal(unchangedPayload.addedCount, 0);
    assert.equal(unchangedPayload.acceptedClusterSkipCount, 1);

    const findingsPath = path.join(projectRoot, ".nimi", "local", "audit", "evidence", "audit-sweep-test-accepted-cluster", "findings.yaml");
    const findingsStore = YAML.parse(await readFile(findingsPath, "utf8"));
    findingsStore.clusters[0].acceptance.source_inventory_hash = "changed-authority-context";
    await writeFile(findingsPath, YAML.stringify(findingsStore), "utf8");

    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--chunk-id",
      "chunk-003",
      "--dispatched-at",
      "2026-04-10T01:00:00.000Z",
      "--json",
    ])).exitCode, 0);
    await writeAuditEvidence(projectRoot, "accepted-cluster-3.json", "chunk-003", ["src/c.ts"], [
      clusteredAuditFinding({
        file: "src/c.ts",
        title: "Accepted service cluster",
        rootCauseKey: "accepted-service-cluster",
      }),
    ]);
    const changedRoot = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--chunk-id",
      "chunk-003",
      "--from",
      "accepted-cluster-3.json",
      "--verified-at",
      "2026-04-10T01:10:00.000Z",
      "--json",
    ]);
    assert.equal(changedRoot.exitCode, 0, changedRoot.stderr);
    assert.equal(JSON.parse(changedRoot.stdout).addedCount, 1);
  });
});

test("audit-sweep chunk ingest fails closed on malformed findings", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "service.ts"), "export const service = 1;\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--sweep-id",
      "audit-sweep-test-invalid",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0);

    const dispatchResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-invalid",
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);

    await writeFile(
      path.join(projectRoot, "bad-audit-output.json"),
      `${JSON.stringify({
        chunk_id: "chunk-001",
        auditor: { id: "test-auditor" },
        coverage: { files: ["src/service.ts"] },
        findings: [
          {
            severity: "high",
            category: "security",
            confidence: "high",
            impact: "Impact exists, actionability does not.",
            location: { file: "src/service.ts" },
            title: "Missing actionability",
            description: "This finding omits required actionability.",
            evidence: {
              summary: "Invalid fixture.",
              auditor_reasoning: "Invalid fixture.",
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
      "audit-sweep-test-invalid",
      "--chunk-id",
      "chunk-001",
      "--from",
      "bad-audit-output.json",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 2);
    assert.match(ingestResult.stderr, /actionability must be one of/);
  });
});

test("audit-sweep closeout and validators fail closed on missing remediation map and tampered ledger", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    const ledgerPayload = await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-test-gates",
      actionability: "auto-fix",
    });

    const closeoutWithoutMap = await captureRunCli([
      "audit-sweep",
      "closeout",
      "summary",
      "--sweep-id",
      "audit-sweep-test-gates",
      "--verified-at",
      "2026-04-10T03:00:00.000Z",
      "--json",
    ]);
    assert.equal(closeoutWithoutMap.exitCode, 2);
    assert.match(closeoutWithoutMap.stderr, /remediation map exists for the latest ledger/);

    const ledgerPath = path.join(projectRoot, ...ledgerPayload.ledgerRef.split("/"));
    const ledger = YAML.parse(await readFile(ledgerPath, "utf8"));
    ledger.coverage.audited_files = 0;
    await writeFile(ledgerPath, YAML.stringify(ledger), "utf8");

    const validateLedger = await captureRunCli([
      "audit-sweep",
      "validate",
      "--sweep-id",
      "audit-sweep-test-gates",
      "--scope",
      "ledger",
      "--json",
    ]);
    assert.equal(validateLedger.exitCode, 2);
    const validatePayload = JSON.parse(validateLedger.stdout);
    assert.equal(validatePayload.ok, false);
    assert.ok(validatePayload.checks.some((entry) => entry.id === "ledger_coverage_counts_match" && entry.ok === false));
  });
});

test("audit-sweep rejects coverage mismatch, invalid rerun, and unexpected closeout fields", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "service.ts"), "export const service = 1;\n", "utf8");
    assert.equal((await captureRunCli(["audit-sweep", "plan", "--root", "src", "--sweep-id", "audit-sweep-test-negative", "--json"])).exitCode, 0);
    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-negative",
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ])).exitCode, 0);

    await writeFile(
      path.join(projectRoot, "coverage-mismatch.json"),
      `${JSON.stringify({
        chunk_id: "chunk-001",
        auditor: { id: "test-auditor" },
        coverage: { files: [] },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const mismatch = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-negative",
      "--chunk-id",
      "chunk-001",
      "--from",
      "coverage-mismatch.json",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(mismatch.exitCode, 2);
    assert.match(mismatch.stderr, /coverage\.files must exactly match/);

    const ledgerPayload = await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-test-rerun-negative",
      actionability: "auto-fix",
    });
    const findingsStore = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "evidence", "audit-sweep-test-rerun-negative", "findings.yaml"), "utf8"));
    await writeFile(
      path.join(projectRoot, "bad-resolution.json"),
      `${JSON.stringify({
        finding_id: "finding-0001",
        source_fingerprint: findingsStore.findings[0].fingerprint,
        disposition: "remediated",
        rerun: {
          chunk_id: "chunk-001",
          covered_files: ["src/service.ts"],
          verdict: "still_reproduced",
          auditor: { id: "test-auditor" },
        },
        evidence_summary: "The finding still reproduces, so remediated is invalid.",
      }, null, 2)}\n`,
      "utf8",
    );
    const badRerun = await captureRunCli([
      "audit-sweep",
      "finding",
      "resolve",
      "--sweep-id",
      "audit-sweep-test-rerun-negative",
      "--finding-id",
      "finding-0001",
      "--disposition",
      "remediated",
      "--from",
      "bad-resolution.json",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(badRerun.exitCode, 2);
    assert.match(badRerun.stderr, /requires not_reproduced/);

    await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-rerun-negative",
      "--verified-at",
      "2026-04-10T03:00:00.000Z",
      "--json",
    ]);
    const closeout = await captureRunCli([
      "audit-sweep",
      "closeout",
      "summary",
      "--sweep-id",
      "audit-sweep-test-rerun-negative",
      "--verified-at",
      "2026-04-10T04:00:00.000Z",
      "--json",
    ]);
    assert.equal(closeout.exitCode, 0);
    const closeoutImport = JSON.parse(closeout.stdout);
    closeoutImport.summary.audit_closeout = { forbidden: true };
    await writeFile(path.join(projectRoot, "bad-audit-closeout-extra.json"), `${JSON.stringify(closeoutImport, null, 2)}\n`, "utf8");
    const imported = await captureRunCli(["closeout", "--from", "bad-audit-closeout-extra.json", "--json"]);
    assert.equal(imported.exitCode, 2);
    assert.match(imported.stderr, /unexpected fields: audit_closeout/);
    assert.match(ledgerPayload.ledgerRef, /audit-sweep-test-rerun-negative/);
  });
});

test("audit-sweep remediation-map admit materializes topic waves and preserves manager decision gates", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-test-topic-admit",
      actionability: "auto-fix",
    });
    assert.equal((await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-topic-admit",
      "--verified-at",
      "2026-04-10T03:00:00.000Z",
      "--json",
    ])).exitCode, 0);

    const createTopicResult = await captureRunCli([
      "topic",
      "create",
      "audit-remediation-demo",
      "--title",
      "Audit Remediation Demo",
      "--justification",
      "audit-sweep remediation waves need topic-owned repair execution",
      "--applicability",
      "authority-bearing",
      "--json",
    ]);
    assert.equal(createTopicResult.exitCode, 0);
    const topic = JSON.parse(createTopicResult.stdout);

    const admitResult = await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "admit",
      "--sweep-id",
      "audit-sweep-test-topic-admit",
      "--topic-id",
      topic.topicId,
      "--json",
    ]);
    assert.equal(admitResult.exitCode, 0);
    const admitPayload = JSON.parse(admitResult.stdout);
    assert.deepEqual(admitPayload.materializedWaveIds, ["wave-audit-remediation-001"]);
    assert.deepEqual(admitPayload.admittedWaveIds, ["wave-audit-remediation-001"]);

    const topicYaml = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "topics", "ongoing", topic.topicId, "topic.yaml"), "utf8"));
    assert.equal(topicYaml.waves[0].wave_id, "wave-audit-remediation-001");
    assert.equal(topicYaml.waves[0].state, "preflight_admitted");
    assert.deepEqual(topicYaml.waves[0].source_audit_sweep.finding_ids, ["finding-0001"]);
  });
});
