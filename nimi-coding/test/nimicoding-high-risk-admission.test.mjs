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

test("ingest-high-risk-execution validates referenced candidate artifacts and writes a local payload", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--write-local",
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 0);
    const payload = JSON.parse(ingestResult.stdout);
    assert.equal(payload.contractVersion, "nimicoding.high-risk-ingest.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.validations.executionPacket.ok, true);
    assert.equal(payload.validations.workerOutput.ok, true);
    assert.equal(payload.validations.workerOutput.signal.status, "complete");
    assert.equal(payload.validations.evidence[0].ok, true);

    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.skill.id, "high_risk_execution");
    assert.equal(stored.validations.prompt.ok, true);
  });
});

test("ingest-high-risk-execution refuses non-completed high risk closeout artifacts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-blocked-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "blocked",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "blocked",
          summary: "Blocked waiting for review.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 2);
    assert.match(ingestResult.stderr, /requires a completed high_risk_execution closeout artifact/);
  });
});

test("ingest-high-risk-execution fails closed when referenced artifacts are mechanically invalid", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot, {
      workerOutputFixture: "worker-output.invalid.md",
    });

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 1);
    const payload = JSON.parse(ingestResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.validations.workerOutput.ok, false);
    assert.equal(payload.validations.workerOutput.refusal.code, "RUNNER_SIGNAL_MISSING");
  });
});

test("review-high-risk-execution projects a manager-ready local payload from valid ingest", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--write-local",
      "--json",
    ]);
    assert.equal(ingestResult.exitCode, 0);
    const ingestPayload = JSON.parse(ingestResult.stdout);

    const reviewResult = await captureRunCli([
      "review-high-risk-execution",
      "--from",
      ingestPayload.artifactPath,
      "--write-local",
      "--json",
    ]);

    assert.equal(reviewResult.exitCode, 0);
    const payload = JSON.parse(reviewResult.stdout);
    assert.equal(payload.contractVersion, "nimicoding.high-risk-review.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.reviewStatus, "ready_for_manager_review");
    assert.equal(payload.managerReviewOwner, "nimicoding_manager");
    assert.equal(payload.attachmentRefs.worker_output_ref, ".nimi/local/outputs/topic-1.worker-output.md");

    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.skill.id, "high_risk_execution");
    assert.equal(stored.reviewStatus, "ready_for_manager_review");
  });
});

test("review-high-risk-execution rejects non-ready ingest payloads", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const ingestPath = path.join(projectRoot, "bad-ingest.json");
    await writeFile(
      ingestPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-ingest.v1",
        ok: false,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        validations: {
          executionPacket: { ok: false },
          orchestrationState: { ok: true },
          prompt: { ok: true },
          workerOutput: { ok: true },
          evidence: [{ ok: true }],
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const reviewResult = await captureRunCli([
      "review-high-risk-execution",
      "--from",
      ingestPath,
      "--json",
    ]);

    assert.equal(reviewResult.exitCode, 2);
    assert.match(reviewResult.stderr, /requires an ingest payload with ok true/);
  });
});

test("decide-high-risk-execution records a manager-owned local decision from review-ready payload", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--write-local",
      "--json",
    ]);
    assert.equal(ingestResult.exitCode, 0);
    const ingestPayload = JSON.parse(ingestResult.stdout);

    const reviewResult = await captureRunCli([
      "review-high-risk-execution",
      "--from",
      ingestPayload.artifactPath,
      "--write-local",
      "--json",
    ]);
    assert.equal(reviewResult.exitCode, 0);
    const reviewPayload = JSON.parse(reviewResult.stdout);

    const acceptancePath = path.join(projectRoot, ".nimi", "local", "reviews", "topic-1.acceptance.md");
    await mkdir(path.dirname(acceptancePath), { recursive: true });
    await writeFile(
      acceptancePath,
      await readFile(path.join(repoRoot, "test", "fixtures", "validators", "acceptance.valid.md"), "utf8"),
      "utf8",
    );

    const decisionResult = await captureRunCli([
      "decide-high-risk-execution",
      "--from",
      reviewPayload.artifactPath,
      "--acceptance",
      acceptancePath,
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--write-local",
      "--json",
    ]);

    assert.equal(decisionResult.exitCode, 0);
    const payload = JSON.parse(decisionResult.stdout);
    assert.equal(payload.contractVersion, "nimicoding.high-risk-decision.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.decisionStatus, "manager_decision_recorded");
    assert.equal(payload.acceptanceDisposition, "complete");
    assert.equal(payload.acceptanceValidation.ok, true);
    assert.equal(payload.managerReviewOwner, "nimicoding_manager");

    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.skill.id, "high_risk_execution");
    assert.equal(stored.decisionStatus, "manager_decision_recorded");
  });
});

test("decide-high-risk-execution ignores disposition outside validated acceptance block", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const reviewPath = path.join(projectRoot, "review.json");
    await writeFile(
      reviewPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-review.v1",
        ok: true,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        reviewStatus: "ready_for_manager_review",
        managerReviewOwner: "nimicoding_manager",
        attachmentRefs: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [".nimi/local/evidence/topic-1.patch"],
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const acceptancePath = path.join(projectRoot, ".nimi", "local", "reviews", "topic-1.acceptance.md");
    await mkdir(path.dirname(acceptancePath), { recursive: true });
    await writeFile(
      acceptancePath,
      [
        "Disposition: complete",
        "",
        "## Findings",
        "No unresolved findings.",
        "",
        "## Current Phase Disposition",
        "Manager note: the validated disposition block intentionally has no disposition line.",
        "",
        "## Next Step or Reopen Condition",
        "No reopen required.",
        "",
      ].join("\n"),
      "utf8",
    );

    const decisionResult = await captureRunCli([
      "decide-high-risk-execution",
      "--from",
      reviewPath,
      "--acceptance",
      acceptancePath,
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(decisionResult.exitCode, 2);
    assert.match(decisionResult.stderr, /Disposition|acceptance 产物/);
  });
});

test("decide-high-risk-execution rejects invalid manager acceptance artifacts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const reviewPath = path.join(projectRoot, "review.json");
    await writeFile(
      reviewPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-review.v1",
        ok: true,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        reviewStatus: "ready_for_manager_review",
        managerReviewOwner: "nimicoding_manager",
        attachmentRefs: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const acceptancePath = path.join(projectRoot, "bad.acceptance.md");
    await writeFile(
      acceptancePath,
      await readFile(path.join(repoRoot, "test", "fixtures", "validators", "acceptance.invalid.md"), "utf8"),
      "utf8",
    );

    const decisionResult = await captureRunCli([
      "decide-high-risk-execution",
      "--from",
      reviewPath,
      "--acceptance",
      acceptancePath,
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(decisionResult.exitCode, 1);
    const payload = JSON.parse(decisionResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.acceptanceValidation.ok, false);
    assert.equal(payload.acceptanceValidation.refusal.code, "ACCEPTANCE_INVALID");
  });
});

test("admit-high-risk-decision updates canonical high-risk admissions truth when explicitly requested", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestPayload = JSON.parse((await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--write-local",
      "--json",
    ])).stdout);

    const reviewPayload = JSON.parse((await captureRunCli([
      "review-high-risk-execution",
      "--from",
      ingestPayload.artifactPath,
      "--write-local",
      "--json",
    ])).stdout);

    const acceptancePath = path.join(projectRoot, ".nimi", "local", "reviews", "topic-1.acceptance.md");
    await mkdir(path.dirname(acceptancePath), { recursive: true });
    await writeFile(
      acceptancePath,
      await readFile(path.join(repoRoot, "test", "fixtures", "validators", "acceptance.valid.md"), "utf8"),
      "utf8",
    );

    const decisionPayload = JSON.parse((await captureRunCli([
      "decide-high-risk-execution",
      "--from",
      reviewPayload.artifactPath,
      "--acceptance",
      acceptancePath,
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--write-local",
      "--json",
    ])).stdout);

    const admitResult = await captureRunCli([
      "admit-high-risk-decision",
      "--from",
      decisionPayload.artifactPath,
      "--admitted-at",
      "2026-04-11T00:00:00.000Z",
      "--write-spec",
      "--json",
    ]);

    assert.equal(admitResult.exitCode, 0);
    const payload = JSON.parse(admitResult.stdout);
    assert.equal(payload.contractVersion, "nimicoding.high-risk-admission.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.admissionAction, "created");
    assert.equal(payload.admissionRecord.topic_id, "topic-1");
    assert.equal(payload.admissionRecord.packet_id, "pkt-1");
    assert.equal(payload.admissionRecord.disposition, "complete");

    const admissionsText = await readFile(
      path.join(projectRoot, ".nimi", "spec", "high-risk-admissions.yaml"),
      "utf8",
    );
    assert.match(admissionsText, /topic_id: topic-1/);
    assert.match(admissionsText, /packet_id: pkt-1/);
    assert.match(admissionsText, /disposition: complete/);
  });
});

test("admit-high-risk-decision rejects imported decision outside project root", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const outsideDecisionPath = path.join(path.dirname(projectRoot), `outside-decision-${process.pid}.json`);
    await writeFile(
      outsideDecisionPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-decision.v1",
        ok: true,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        decisionStatus: "manager_decision_recorded",
        acceptanceValidation: { ok: true },
        attachmentRefs: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const admitResult = await captureRunCli([
      "admit-high-risk-decision",
      "--from",
      outsideDecisionPath,
      "--admitted-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(admitResult.exitCode, 2);
    assert.match(admitResult.stderr, /project root/);
    await rm(outsideDecisionPath, { force: true });
  });
});

test("admit-high-risk-decision rejects attached packet refs outside project root", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const outsidePacketPath = path.join(path.dirname(projectRoot), `outside-packet-${process.pid}.yaml`);
    await writeFile(outsidePacketPath, "packet_id: outside\ntopic_id: outside\n", "utf8");

    const decisionPath = path.join(projectRoot, "decision-with-outside-packet.json");
    await writeFile(
      decisionPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-decision.v1",
        ok: true,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        decisionStatus: "manager_decision_recorded",
        acceptanceValidation: { ok: true },
        acceptanceDisposition: "complete",
        managerReviewOwner: "nimicoding_manager",
        attachmentRefs: {
          packet_ref: outsidePacketPath,
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const admitResult = await captureRunCli([
      "admit-high-risk-decision",
      "--from",
      decisionPath,
      "--admitted-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(admitResult.exitCode, 1);
    const payload = JSON.parse(admitResult.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.readiness.reason, /project root/);
    await rm(outsidePacketPath, { force: true });
  });
});

test("admit-high-risk-decision rejects non-recorded decision payloads", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const decisionPath = path.join(projectRoot, "bad-decision.json");
    await writeFile(
      decisionPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-decision.v1",
        ok: false,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        decisionStatus: "blocked",
        acceptanceValidation: { ok: false },
        attachmentRefs: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const admitResult = await captureRunCli([
      "admit-high-risk-decision",
      "--from",
      decisionPath,
      "--admitted-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(admitResult.exitCode, 2);
    assert.match(admitResult.stderr, /requires a decision payload with ok true/);
  });
});
