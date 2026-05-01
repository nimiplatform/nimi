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