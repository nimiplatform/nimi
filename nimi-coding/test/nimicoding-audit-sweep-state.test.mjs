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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      "audit-sweep-test-large-json",
      "--scope",
      "chunks",
      "--json",
    ], { cwd: projectRoot });
    assert.equal(validateResult.exitCode, 0, validateResult.stderr);
    assert.ok(validateResult.stdout.length > 65536);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, true);
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
      "sweep",
      "audit",
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
    assert.equal(ledgerPayload.coverage.evidence_coverage.unmapped_files, 0);
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
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0);

    const dispatchResult = await captureRunCli([
      "sweep",
      "audit",
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
    assert.deepEqual(
      auditorPacket.output_contract.manager_owned_coverage_population.coverage_files_from_chunk_files,
      ["src/service.ts"],
    );

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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-clustering-budget",
      "--verified-at",
      "2026-04-10T00:50:00.000Z",
      "--json",
    ])).exitCode, 0);
    const remediationMapResult = await captureRunCli([
      "sweep",
      "audit",
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

test("audit-sweep clusters same-chunk same-location retry findings as duplicates", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "a.ts"), "export function service() { return 1; }\n", "utf8");

    const sweepId = "audit-sweep-test-same-location-retry-dedupe";
    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--max-files",
      "1",
      "--sweep-id",
      sweepId,
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);

    assert.equal((await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "dispatch",
      "--sweep-id",
      sweepId,
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ])).exitCode, 0);
    await writeAuditEvidence(projectRoot, "same-location-retry-1.json", "chunk-001", ["src/a.ts"], [
      clusteredAuditFinding({
        file: "src/a.ts",
        title: "Service skips required authorization",
        rootCauseKey: "service-authz-missing",
      }),
    ]);
    const firstIngest = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "ingest",
      "--sweep-id",
      sweepId,
      "--chunk-id",
      "chunk-001",
      "--from",
      "same-location-retry-1.json",
      "--verified-at",
      "2026-04-10T00:10:00.000Z",
      "--json",
    ]);
    assert.equal(firstIngest.exitCode, 0, firstIngest.stderr);

    const planPath = path.join(projectRoot, ".nimi", "local", "audit", "plans", `${sweepId}.yaml`);
    const chunkPath = path.join(projectRoot, ".nimi", "local", "audit", "chunks", sweepId, "chunk-001.yaml");
    const plan = YAML.parse(await readFile(planPath, "utf8"));
    const chunk = YAML.parse(await readFile(chunkPath, "utf8"));
    chunk.state = "dispatched";
    chunk.lifecycle.dispatched_at = "2026-04-10T00:20:00.000Z";
    chunk.lifecycle.ingested_at = null;
    await writeFile(chunkPath, YAML.stringify(chunk), "utf8");
    plan.chunks = plan.chunks.map((entry) => entry.chunk_id === "chunk-001" ? { ...entry, state: "dispatched" } : entry);
    await writeFile(planPath, YAML.stringify(plan), "utf8");

    await writeAuditEvidence(projectRoot, "same-location-retry-2.json", "chunk-001", ["src/a.ts"], [
      clusteredAuditFinding({
        file: "src/a.ts",
        title: "Service authorization can be bypassed",
        rootCauseKey: "service-authz-missing-reworded",
      }),
    ]);
    const retryIngest = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "ingest",
      "--sweep-id",
      sweepId,
      "--chunk-id",
      "chunk-001",
      "--from",
      "same-location-retry-2.json",
      "--verified-at",
      "2026-04-10T00:30:00.000Z",
      "--json",
    ]);
    assert.equal(retryIngest.exitCode, 0, retryIngest.stderr);
    const retryPayload = JSON.parse(retryIngest.stdout);
    assert.equal(retryPayload.addedCount, 0);
    assert.equal(retryPayload.duplicateCount, 1);
    assert.equal(retryPayload.clusteredCount, 1);

    const findingsStore = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "evidence", sweepId, "findings.yaml"), "utf8"));
    assert.equal(findingsStore.findings.length, 1);
    assert.equal(findingsStore.clustered_symptom_count, 1);
    assert.equal(findingsStore.clusters[0].duplicate_symptoms[0].classification, "same_chunk_location_retry");
  });
});

test("audit-sweep chunk mutations fail closed under lock contention and preserve plan consistency", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "b.ts"), "export const b = 2;\n", "utf8");

    const sweepId = "audit-sweep-test-concurrent-review";
    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--max-files",
      "1",
      "--sweep-id",
      sweepId,
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);

    for (const [index, file] of ["a.ts", "b.ts"].entries()) {
      const chunkId = `chunk-${String(index + 1).padStart(3, "0")}`;
      assert.equal((await captureRunCli([
      "sweep",
      "audit",
        "chunk",
        "dispatch",
        "--sweep-id",
        sweepId,
        "--chunk-id",
        chunkId,
        "--dispatched-at",
        `2026-04-10T00:${String(index * 10).padStart(2, "0")}:00.000Z`,
        "--json",
      ])).exitCode, 0);
      await writeAuditEvidence(projectRoot, `${chunkId}.json`, chunkId, [`src/${file}`], []);
      assert.equal((await captureRunCli([
      "sweep",
      "audit",
        "chunk",
        "ingest",
        "--sweep-id",
        sweepId,
        "--chunk-id",
        chunkId,
        "--from",
        `${chunkId}.json`,
        "--verified-at",
        `2026-04-10T00:${String(index * 10 + 5).padStart(2, "0")}:00.000Z`,
        "--json",
      ])).exitCode, 0);
    }

    const lockDir = path.join(projectRoot, ".nimi", "local", "audit", "locks");
    await mkdir(lockDir, { recursive: true });
    const lockPath = path.join(lockDir, `${sweepId}.lock`);
    await writeFile(lockPath, "{\"test\":\"held\"}\n", "utf8");
    const blockedReview = await runCliSubprocess([
      "sweep",
      "audit",
      "chunk",
      "review",
      "--sweep-id",
      sweepId,
      "--chunk-id",
      "chunk-001",
      "--verdict",
      "pass",
      "--reviewed-at",
      "2026-04-10T00:30:00.000Z",
      "--json",
    ], { cwd: projectRoot });
    assert.equal(blockedReview.exitCode, 2);
    assert.match(blockedReview.stderr, /chunk review mutation already in progress/);
    await rm(lockPath, { force: true });

    const reviewArgs = (chunkId, reviewedAt) => [
      "sweep",
      "audit",
      "chunk",
      "review",
      "--sweep-id",
      sweepId,
      "--chunk-id",
      chunkId,
      "--verdict",
      "pass",
      "--reviewed-at",
      reviewedAt,
      "--json",
    ];
    const reviews = await Promise.all([
      runCliSubprocess(reviewArgs("chunk-001", "2026-04-10T00:40:00.000Z"), { cwd: projectRoot }),
      runCliSubprocess(reviewArgs("chunk-002", "2026-04-10T00:41:00.000Z"), { cwd: projectRoot }),
    ]);
    const successCount = reviews.filter((result) => result.exitCode === 0).length;
    assert.ok(successCount === 1 || successCount === 2, reviews.map((result) => result.stderr).join("\n"));
    for (const result of reviews.filter((entry) => entry.exitCode !== 0)) {
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr, /chunk review mutation already in progress/);
    }

    const validateResult = await runCliSubprocess([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      sweepId,
      "--scope",
      "chunks",
      "--json",
    ], { cwd: projectRoot });
    assert.equal(validateResult.exitCode, 0, validateResult.stderr);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, true);
  });
});
