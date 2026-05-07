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

test("audit-sweep accepted clusters resume-skip unchanged roots and reopen when authority context changes", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "a.ts"), "export function service() { return 1; }\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "b.ts"), "export function service() { return 2; }\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "c.ts"), "export function service() { return 3; }\n", "utf8");

    assert.equal((await captureRunCli([
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--verified-at",
      "2026-04-10T00:20:00.000Z",
      "--json",
    ])).exitCode, 0);
    assert.equal((await captureRunCli([
      "sweep",
      "audit",
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
      "sweep",
      "audit",
      "remediation-map",
      "admit",
      "--sweep-id",
      "audit-sweep-test-accepted-cluster",
      "--topic-id",
      topic.topicId,
      "--json",
    ])).exitCode, 0);

    assert.equal((await captureRunCli([
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--sweep-id",
      "audit-sweep-test-invalid",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0);

    const dispatchResult = await captureRunCli([
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
    assert.equal((await captureRunCli(["sweep", "audit", "plan", "--root", "src", "--sweep-id", "audit-sweep-test-negative", "--json"])).exitCode, 0);
    assert.equal((await captureRunCli([
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-rerun-negative",
      "--verified-at",
      "2026-04-10T03:00:00.000Z",
      "--json",
    ]);
    const closeout = await captureRunCli([
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
      "sweep",
      "audit",
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
