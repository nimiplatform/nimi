import {
  writeFile,
  path,
  test,
  assert,
  YAML,
  captureRunCli,
  withTempProject,
} from "./nimicoding-test-utils.mjs";

async function createAdmittedWave(topicSlug, waveId = "wave-1-spec") {
  const startResult = await captureRunCli(["start"]);
  assert.equal(startResult.exitCode, 0, startResult.stderr);

  const createResult = await captureRunCli([
    "topic",
    "create",
    topicSlug,
    "--justification",
    "spec update mechanical review gate demo",
    "--json",
  ]);
  assert.equal(createResult.exitCode, 0, createResult.stderr);
  const createPayload = JSON.parse(createResult.stdout);

  await captureRunCli([
    "topic", "wave", "add", createPayload.topicId, waveId, "spec",
    "--goal", "mechanically prove post update review", "--owner-domain", "nimi-coding/spec", "--json",
  ]);
  await captureRunCli(["topic", "wave", "select", createPayload.topicId, waveId, "--json"]);
  await captureRunCli(["topic", "wave", "admit", createPayload.topicId, waveId, "--json"]);

  return {
    topicId: createPayload.topicId,
    topicRef: `.nimi/topics/ongoing/${createPayload.topicId}`,
    waveId,
  };
}

async function freezePacket(projectRoot, topicId, waveId, packetId, authorityOwner, options = {}) {
  const packetPath = path.join(projectRoot, `${packetId}.yaml`);
  await writeFile(
    packetPath,
    YAML.stringify({
      packet_id: packetId,
      topic_id: topicId,
      wave_id: waveId,
      packet_kind: options.packetKind ?? "implementation",
      status: "draft",
      authority_owner: authorityOwner,
      canonical_seams: options.canonicalSeams ?? authorityOwner,
      forbidden_shortcuts: ["parallel_truth", "compat_shim", "dual_read", "dual_write"],
      acceptance_invariants: ["validation evidence proves post update review"],
      negative_tests: ["human judgement is required when evidence is missing"],
      reopen_conditions: ["spec authority drift"],
    }),
    "utf8",
  );
  const freezeResult = await captureRunCli(["topic", "packet", "freeze", topicId, "--from", packetPath, "--json"]);
  assert.equal(freezeResult.exitCode, 0, freezeResult.stderr);
}

async function writeTopicSource(projectRoot, topicRef, fileName, text) {
  const sourceRef = `${topicRef}/${fileName}`;
  await writeFile(path.join(projectRoot, sourceRef), text, "utf8");
  return sourceRef;
}

async function recordResult(topicId, kind, verdict, sourceRef, verifiedAt) {
  const result = await captureRunCli([
    "topic", "result", "record", topicId,
    "--kind", kind,
    "--verdict", verdict,
    "--from", sourceRef,
    "--verified-at", verifiedAt,
    "--json",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
}

async function writeValidationEvidence(projectRoot, topicRef, waveId, suffix, evidence = {}) {
  const evidenceRef = `${topicRef}/evidence-validation-${waveId}-${suffix}.json`;
  await writeFile(
    path.join(projectRoot, evidenceRef),
    `${JSON.stringify({
      contract: "nimicoding.topic-runner.validation-evidence.v1",
      command: "node --test post-update-proof.test.mjs",
      exit_code: evidence.exitCode ?? 0,
      status: evidence.status ?? "pass",
      stdout: evidence.stdout ?? "ok\n",
      stderr: evidence.stderr ?? "",
    }, null, 2)}\n`,
    "utf8",
  );
  return evidenceRef;
}

function implementationSourceText({ waveId, packetId, evidenceRef, remediation = false, ambiguity = false }) {
  return `# Implementation Result

verdict: PASS
wave_id: ${waveId}
packet_id: ${packetId}

${remediation ? "The selected wave was remediated under the approved multi-authority packet." : "The update stayed inside packet authority."}

${ambiguity ? "Authority ambiguity remains." : "No authority, scope, gate, product, or semantic ambiguity remains."}

Evidence: \`${evidenceRef}\`

## Negative Checks

- Source audit findings were not mutated.
- Source sweep-design artifacts were not mutated.
- No pseudo-success, fallback success, no-op pass, compatibility shim, dual-read, or dual-write route was introduced.
`;
}

async function preparePostUpdateProofCase(projectRoot, options = {}) {
  const waveId = options.waveId ?? "wave-1-spec";
  const { topicId, topicRef } = await createAdmittedWave(options.topicSlug ?? "spec-update-mechanical-review-demo", waveId);
  const packetId = options.packetId ?? `${waveId}-authority`;
  const authorityOwner = options.authorityOwner ?? [".nimi/spec/runtime/kernel/example-contract.md"];
  await freezePacket(projectRoot, topicId, waveId, packetId, authorityOwner, {
    canonicalSeams: options.canonicalSeams,
    packetKind: options.packetKind,
  });

  const auditDispatch = await captureRunCli(["topic", "audit", "dispatch", topicId, "--packet", packetId, "--json"]);
  assert.equal(auditDispatch.exitCode, 0, auditDispatch.stderr);
  const auditSourceRef = await writeTopicSource(
    projectRoot,
    topicRef,
    `source-${waveId}-audit.md`,
    "# Authority Convergence Audit\n\nverdict: PASS\n",
  );
  await recordResult(topicId, "audit", "PASS", auditSourceRef, "2026-05-04T00:00:00Z");
  await recordResult(topicId, "preflight", "PASS", auditSourceRef, "2026-05-04T00:01:00Z");

  if (options.remediationArtifact) {
    await writeTopicSource(
      projectRoot,
      topicRef,
      `packet-${waveId}-remediation-a-authority-convergence.md`,
      `---\nremediation_id: ${waveId}-remediation-a-authority-convergence\ntopic_id: ${topicId}\nwave_id: ${waveId}\nkind: a\nreason: authority-convergence\n---\n\nApproved multi-authority remediation.\n`,
    );
  }
  if (options.remediationAuditEvidence) {
    const remediationAuditSourceRef = await writeTopicSource(
      projectRoot,
      topicRef,
      `source-${waveId}-audit-remediated.md`,
      `---\ntopic_id: ${topicId}\nwave_id: ${waveId}\nkind: audit\nverdict: PASS\nsource_audit_findings_mutated: false\nsource_sweep_design_artifacts_mutated: false\nproduct_semantic_ambiguity: false\nlocal_packet_authority_scope_remediation_only: true\n---\n\nAuthority convergence audit PASS after local packet authority/scope remediation.\n`,
    );
    if (!options.unrecordedRemediationAuditEvidence) {
      await recordResult(topicId, "audit", "PASS", remediationAuditSourceRef, "2026-05-04T00:00:30Z");
    }
  }

  const workerDispatch = await captureRunCli(["topic", "worker", "dispatch", topicId, "--packet", packetId, "--json"]);
  assert.equal(workerDispatch.exitCode, 0, workerDispatch.stderr);

  const evidenceRef = options.evidenceRef
    ?? `${topicRef}/evidence-validation-${waveId}-${options.evidenceSuffix ?? "unit"}.json`;
  if (!options.missingEvidence && !options.evidenceRef) {
    await writeValidationEvidence(
      projectRoot,
      topicRef,
      waveId,
      options.evidenceSuffix ?? "unit",
      options.evidence,
    );
  }
  const implementationSourceRef = await writeTopicSource(
    projectRoot,
    topicRef,
    `source-${waveId}-implementation.md`,
    options.implementationSource ?? implementationSourceText({
      waveId,
      packetId,
      evidenceRef,
      remediation: options.remediationArtifact || options.remediationAuditEvidence,
      ambiguity: options.ambiguity,
    }),
  );
  await recordResult(topicId, "implementation", "PASS", implementationSourceRef, "2026-05-04T00:02:00Z");

  const decisionResult = await captureRunCli(["topic", "run-next-step", topicId, "--json"]);
  assert.equal(decisionResult.exitCode, 0, decisionResult.stderr);
  return JSON.parse(decisionResult.stdout).decision;
}

test("spec implementation pass records mechanical post-update judgement when evidence is complete", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "spec-update-mechanical-review-demo",
      "--justification",
      "spec update mechanical review gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-spec", "spec",
      "--goal", "mechanically prove post update review", "--owner-domain", "nimi-coding/spec", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-2-spec", "spec",
      "--goal", "prove unrelated spec packet does not block current wave", "--owner-domain", "nimi-coding/spec", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-spec", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-spec", "--json"]);

    const packetPath = path.join(projectRoot, "spec-update-mechanical-review-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-spec-authority",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-spec",
        packet_kind: "spec",
        status: "draft",
        authority_owner: [".nimi/spec/runtime/kernel/example-contract.md"],
        canonical_seams: [".nimi/spec/runtime/kernel/example-contract.md"],
        forbidden_shortcuts: ["parallel_truth"],
        acceptance_invariants: ["validation evidence proves post update review"],
        negative_tests: ["human judgement is required when evidence is missing"],
        reopen_conditions: ["spec authority drift"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);

    const unrelatedPacketPath = path.join(projectRoot, "spec-update-unrelated-packet.yaml");
    await writeFile(
      unrelatedPacketPath,
      YAML.stringify({
        packet_id: "wave-2-spec-authority",
        topic_id: createPayload.topicId,
        wave_id: "wave-2-spec",
        packet_kind: "spec",
        status: "draft",
        authority_owner: [".nimi/spec/runtime/kernel/unrelated-contract.md"],
        canonical_seams: [".nimi/spec/runtime/kernel/unrelated-contract.md"],
        forbidden_shortcuts: ["parallel_truth"],
        acceptance_invariants: ["unrelated packet remains out of current wave proof"],
        negative_tests: ["current wave proof ignores unrelated packet"],
        reopen_conditions: ["unrelated authority drift"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", unrelatedPacketPath, "--json"]);

    await captureRunCli([
      "topic", "audit", "dispatch", createPayload.topicId,
      "--packet", "wave-1-spec-authority", "--json",
    ]);

    const auditSource = path.join(projectRoot, "spec-update-mechanical-review-audit.md");
    await writeFile(auditSource, "# Authority Convergence Audit\n\nverdict: PASS\n", "utf8");
    await captureRunCli([
      "topic", "result", "record", createPayload.topicId,
      "--kind", "audit",
      "--verdict", "PASS",
      "--from", auditSource,
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);

    await captureRunCli([
      "topic-runner", "step", createPayload.topicId,
      "--run-id", "spec-update-mechanical-review-demo",
      "--adapter", "codex",
      "--verified-at", "2026-05-04T00:01:00Z",
      "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId,
      "--packet", "wave-1-spec-authority", "--json",
    ]);

    const topicRef = `.nimi/topics/ongoing/${createPayload.topicId}`;
    const evidenceRef = `${topicRef}/evidence-validation-wave-1-spec-unit.json`;
    await writeFile(
      path.join(projectRoot, evidenceRef),
      `${JSON.stringify({
        contract: "nimicoding.topic-runner.validation-evidence.v1",
        topic_id: createPayload.topicId,
        command: "node --test post-update-proof.test.mjs",
        exit_code: 0,
        status: "pass",
        stdout: "ok\n",
        stderr: "",
      }, null, 2)}\n`,
      "utf8",
    );

    const implementationSourceRef = "spec-update-mechanical-review-implementation.md";
    const implementationSource = path.join(projectRoot, implementationSourceRef);
    await writeFile(
      implementationSource,
      `# Implementation Result\n\npacket_id: wave-1-spec-authority\n\nThe update stayed inside packet authority.\n\nNo authority, scope, gate, product, or semantic ambiguity remains.\n\nEvidence: \`${evidenceRef}\`\n\n## Negative Checks\n\n- Source audit findings were not mutated.\n- Source sweep-design artifacts were not mutated.\n- No pseudo-success, fallback success, no-op pass, compatibility shim, dual-read, or dual-write route was introduced.\n`,
      "utf8",
    );
    await captureRunCli([
      "topic", "result", "record", createPayload.topicId,
      "--kind", "implementation",
      "--verdict", "PASS",
      "--from", implementationSourceRef,
      "--verified-at", "2026-05-04T00:02:00Z",
      "--json",
    ]);

    const decisionResult = await captureRunCli([
      "topic", "run-next-step", createPayload.topicId, "--json",
    ]);
    assert.equal(decisionResult.exitCode, 0, decisionResult.stderr);
    const decision = JSON.parse(decisionResult.stdout).decision;
    assert.equal(decision.stop_class, "continue");
    assert.equal(decision.recommended_action, "record_result");
    assert.equal(decision.reason_code, "mechanical_post_update_judgement_pass");
    assert.match(decision.next_command_ref, /--kind judgement --verdict PASS/);

    const stepResult = await captureRunCli([
      "topic-runner", "step", createPayload.topicId,
      "--run-id", "spec-update-mechanical-review-demo",
      "--adapter", "codex",
      "--verified-at", "2026-05-04T00:03:00Z",
      "--json",
    ]);
    assert.equal(stepResult.exitCode, 0, stepResult.stderr);
    const payload = JSON.parse(stepResult.stdout);
    assert.equal(payload.runnerStatus, "continued");
    assert.equal(payload.command.resultKind, "judgement");
    assert.equal(payload.command.verdict, "PASS");
  });
});

test("multi-authority remediated packet records mechanical post-update judgement when lineage and evidence pass", async () => {
  await withTempProject(async (projectRoot) => {
    const decision = await preparePostUpdateProofCase(projectRoot, {
      topicSlug: "multi-authority-remediated-review-demo",
      packetId: "wave-1-spec-remediated-implementation",
      authorityOwner: [
        ".nimi/spec/runtime/kernel/example-contract.md",
        ".nimi/spec/runtime/kernel/message-action-contract.md",
      ],
      remediationArtifact: true,
    });

    assert.equal(decision.stop_class, "continue");
    assert.equal(decision.recommended_action, "record_result");
    assert.equal(decision.reason_code, "mechanical_post_update_judgement_pass");
  });
});

test("multi-authority remediated packet accepts structured remediated audit evidence as lineage", async () => {
  await withTempProject(async (projectRoot) => {
    const decision = await preparePostUpdateProofCase(projectRoot, {
      topicSlug: "multi-authority-remediated-audit-review-demo",
      packetId: "wave-1-spec-remediated-implementation",
      authorityOwner: [
        ".nimi/spec/runtime/kernel/example-contract.md",
        ".nimi/spec/runtime/kernel/message-action-contract.md",
      ],
      remediationAuditEvidence: true,
    });

    assert.equal(decision.stop_class, "continue");
    assert.equal(decision.recommended_action, "record_result");
    assert.equal(decision.reason_code, "mechanical_post_update_judgement_pass");
  });
});

test("multi-authority remediated packet rejects unrecorded remediation source evidence", async () => {
  await withTempProject(async (projectRoot) => {
    const decision = await preparePostUpdateProofCase(projectRoot, {
      topicSlug: "multi-authority-unrecorded-remediated-audit-review-demo",
      packetId: "wave-1-spec-remediated-implementation",
      authorityOwner: [
        ".nimi/spec/runtime/kernel/example-contract.md",
        ".nimi/spec/runtime/kernel/message-action-contract.md",
      ],
      remediationAuditEvidence: true,
      unrecordedRemediationAuditEvidence: true,
    });

    assert.equal(decision.stop_class, "require_human_confirmation");
    assert.equal(decision.reason_code, "spec_update_review_required");
    assert.match(decision.blocking_checks?.[0]?.message ?? "", /remediation lineage/);
  });
});

test("multi-authority packet without remediation lineage still requires human confirmation", async () => {
  await withTempProject(async (projectRoot) => {
    const decision = await preparePostUpdateProofCase(projectRoot, {
      topicSlug: "multi-authority-human-review-demo",
      packetId: "wave-1-spec-implementation",
      authorityOwner: [
        ".nimi/spec/runtime/kernel/example-contract.md",
        ".nimi/spec/runtime/kernel/message-action-contract.md",
      ],
    });

    assert.equal(decision.stop_class, "require_human_confirmation");
    assert.equal(decision.reason_code, "spec_update_review_required");
    assert.match(decision.blocking_checks?.[0]?.message ?? "", /remediation lineage/);
  });
});

test("post-update proof selects lineage-backed remediated packet when an older dispatched packet exists", async () => {
  await withTempProject(async (projectRoot) => {
    const waveId = "wave-1-spec";
    const { topicId, topicRef } = await createAdmittedWave("stale-packet-lineage-review-demo", waveId);
    const oldPacketId = `${waveId}-implementation`;
    const remediatedPacketId = `${waveId}-remediated-implementation`;

    await freezePacket(projectRoot, topicId, waveId, oldPacketId, [".nimi/spec/runtime/kernel/example-contract.md"]);
    await freezePacket(projectRoot, topicId, waveId, remediatedPacketId, [
      ".nimi/spec/runtime/kernel/example-contract.md",
      ".nimi/spec/runtime/kernel/message-action-contract.md",
    ]);
    await captureRunCli(["topic", "audit", "dispatch", topicId, "--packet", remediatedPacketId, "--json"]);
    const auditSourceRef = await writeTopicSource(projectRoot, topicRef, `source-${waveId}-audit.md`, "verdict: PASS\n");
    await recordResult(topicId, "audit", "PASS", auditSourceRef, "2026-05-04T00:00:00Z");
    await recordResult(topicId, "preflight", "PASS", auditSourceRef, "2026-05-04T00:01:00Z");
    await writeTopicSource(
      projectRoot,
      topicRef,
      `packet-${waveId}-remediation-a-authority-convergence.md`,
      `---\nremediation_id: ${waveId}-remediation-a-authority-convergence\ntopic_id: ${topicId}\nwave_id: ${waveId}\nkind: a\nreason: authority-convergence\n---\n`,
    );
    await captureRunCli(["topic", "worker", "dispatch", topicId, "--packet", oldPacketId, "--json"]);
    await captureRunCli(["topic", "worker", "dispatch", topicId, "--packet", remediatedPacketId, "--json"]);

    const evidenceRef = await writeValidationEvidence(projectRoot, topicRef, waveId, "unit");
    const implementationSourceRef = await writeTopicSource(
      projectRoot,
      topicRef,
      `source-${waveId}-implementation.md`,
      implementationSourceText({
        waveId,
        packetId: remediatedPacketId,
        evidenceRef,
        remediation: true,
      }),
    );
    await recordResult(topicId, "implementation", "PASS", implementationSourceRef, "2026-05-04T00:02:00Z");

    const decisionResult = await captureRunCli(["topic", "run-next-step", topicId, "--json"]);
    assert.equal(decisionResult.exitCode, 0, decisionResult.stderr);
    const decision = JSON.parse(decisionResult.stdout).decision;
    assert.equal(decision.stop_class, "continue");
    assert.equal(decision.reason_code, "mechanical_post_update_judgement_pass");
  });
});

test("post-update proof rejects stale implementation packet when a newer remediated worker prompt exists", async () => {
  await withTempProject(async (projectRoot) => {
    const waveId = "wave-1-spec";
    const { topicId, topicRef } = await createAdmittedWave("stale-source-packet-review-demo", waveId);
    const oldPacketId = `${waveId}-implementation`;
    const remediatedPacketId = `${waveId}-remediated-implementation`;

    await freezePacket(projectRoot, topicId, waveId, oldPacketId, [".nimi/spec/runtime/kernel/example-contract.md"]);
    await freezePacket(projectRoot, topicId, waveId, remediatedPacketId, [
      ".nimi/spec/runtime/kernel/example-contract.md",
      ".nimi/spec/runtime/kernel/message-action-contract.md",
    ]);
    await captureRunCli(["topic", "audit", "dispatch", topicId, "--packet", remediatedPacketId, "--json"]);
    const auditSourceRef = await writeTopicSource(projectRoot, topicRef, `source-${waveId}-audit.md`, "verdict: PASS\n");
    await recordResult(topicId, "audit", "PASS", auditSourceRef, "2026-05-04T00:00:00Z");
    await recordResult(topicId, "preflight", "PASS", auditSourceRef, "2026-05-04T00:01:00Z");
    await writeTopicSource(
      projectRoot,
      topicRef,
      `packet-${waveId}-remediation-a-authority-convergence.md`,
      `---\nremediation_id: ${waveId}-remediation-a-authority-convergence\ntopic_id: ${topicId}\nwave_id: ${waveId}\nkind: a\nreason: authority-convergence\n---\n`,
    );
    await captureRunCli(["topic", "worker", "dispatch", topicId, "--packet", oldPacketId, "--json"]);
    await captureRunCli(["topic", "worker", "dispatch", topicId, "--packet", remediatedPacketId, "--json"]);

    const evidenceRef = await writeValidationEvidence(projectRoot, topicRef, waveId, "unit");
    const implementationSourceRef = await writeTopicSource(
      projectRoot,
      topicRef,
      `source-${waveId}-implementation.md`,
      implementationSourceText({
        waveId,
        packetId: oldPacketId,
        evidenceRef,
        remediation: true,
      }),
    );
    await recordResult(topicId, "implementation", "PASS", implementationSourceRef, "2026-05-04T00:02:00Z");

    const decisionResult = await captureRunCli(["topic", "run-next-step", topicId, "--json"]);
    assert.equal(decisionResult.exitCode, 0, decisionResult.stderr);
    const decision = JSON.parse(decisionResult.stdout).decision;
    assert.equal(decision.stop_class, "require_human_confirmation");
    assert.equal(decision.reason_code, "spec_update_review_required");
    assert.match(
      decision.blocking_checks?.[0]?.message ?? "",
      /implementation result packet_id is not the latest worker prompt lineage/,
    );
  });
});

test("post-update mechanical proof blocks invalid evidence, placeholders, and declared ambiguity", async () => {
  const cases = [
    {
      name: "outside evidence",
      options: {
        evidenceRef: ".nimi/topics/ongoing/other-topic/evidence-validation-wave-1-spec-unit.json",
      },
      expected: /outside the topic root|does not cite topic-local validation evidence/,
    },
    {
      name: "missing evidence",
      options: { missingEvidence: true },
      expected: /not a clean pass/,
    },
    {
      name: "failed evidence",
      options: { evidence: { status: "fail", exitCode: 1 } },
      expected: /not a clean pass/,
    },
    {
      name: "placeholder refs",
      options: {
        authorityOwner: [".nimi/spec/<authority>.md"],
        canonicalSeams: [".nimi/spec/<authority>.md"],
      },
      expected: /authority refs/,
    },
    {
      name: "declared ambiguity",
      options: { ambiguity: true },
      expected: /declares authority\/scope\/gate\/product\/semantic ambiguity/,
    },
  ];

  for (const entry of cases) {
    await withTempProject(async (projectRoot) => {
      const decision = await preparePostUpdateProofCase(projectRoot, {
        topicSlug: `post-update-${entry.name.replace(/\s+/gu, "-")}-demo`,
        ...entry.options,
      });
      assert.equal(decision.stop_class, "require_human_confirmation", entry.name);
      assert.match(decision.blocking_checks?.[0]?.message ?? "", entry.expected, entry.name);
    });
  }
});
