import {
  mkdir,
  readFile,
  writeFile,
  path,
  test,
  assert,
  YAML,
  repoRoot,
  withTempProject,
  writeGovernanceConfig,
  captureRunCli,
} from "./nimicoding-test-utils.mjs";

const TOPIC_ID = "2026-05-05-topic-goal-fixture";
const REQUIRED_SHORTCUTS = [
  "mvp_subset_contract",
  "legacy_alias",
  "compat_shim",
  "dual_read",
  "dual_write",
  "placeholder_success",
  "happy_path_only_closure",
  "time_phased_layering",
  "app_local_shadow_truth",
  "silent_owner_cut_reopen",
];

async function seedGoalReadyTopic(projectRoot, overrides = {}) {
  const state = overrides.rootState ?? overrides.topicState ?? "ongoing";
  const topicId = overrides.topicId ?? TOPIC_ID;
  const topicDir = path.join(projectRoot, ".nimi", "topics", state, topicId);
  await mkdir(topicDir, { recursive: true });

  const waveOne = {
    wave_id: "wave-0-design-audit",
    slug: "design-audit",
    state: "closed",
    primary_closure_goal: "Freeze the design contract.",
    deps: [],
    owner_domain: "nimi-coding/topic-governance",
    parallelizable_after: "none",
    selected: false,
  };
  const waveTwo = {
    wave_id: "wave-1-contract-and-cli",
    slug: "contract-and-cli",
    state: overrides.selectedWaveState ?? "implementation_admitted",
    primary_closure_goal: "Implement topic goal command.",
    deps: ["wave-0-design-audit"],
    owner_domain: "nimi-coding/cli/contracts",
    parallelizable_after: "wave-0-design-audit",
    selected: overrides.selectedWaveId === "wave-2-regression" ? false : true,
  };
  const waveThree = {
    wave_id: "wave-2-regression",
    slug: "regression",
    state: "candidate",
    primary_closure_goal: "Regression coverage.",
    deps: ["wave-1-contract-and-cli"],
    owner_domain: "nimi-coding/test",
    parallelizable_after: "wave-1-contract-and-cli",
    selected: overrides.selectedWaveId === "wave-2-regression",
  };

  await writeFile(
    path.join(topicDir, "topic.yaml"),
    YAML.stringify({
      topic_id: topicId,
      state: overrides.topicState ?? state,
      created_at: "2026-05-05",
      last_transition_at: "2026-05-05",
      last_transition_reason: "fixture",
      title: "Topic Goal Fixture",
      mode: "landed",
      posture: "no_legacy_hard_cut",
      design_policy: "complete_contract_first",
      parallel_truth: "forbidden",
      layering: "ontology",
      risk: "high",
      applicability: "authority_bearing",
      entry_justification: "fixture for topic goal readiness",
      execution_mode: "manager_worker_auditor",
      selected_next_target: overrides.selectedNextTarget ?? "wave-1-contract-and-cli",
      current_true_close_status: overrides.trueCloseStatus ?? "not_started",
      forbidden_shortcuts: overrides.forbiddenShortcuts ?? REQUIRED_SHORTCUTS,
      waves: [waveOne, waveTwo, waveThree],
    }),
    "utf8",
  );

  const artifacts = {
    "design.md": "# Design\nTopic goal fixture contract.\n",
    "waves.md": "# Waves\nWave-1 is implementation admitted after wave-0 closure.\n",
    "candidate-wave-plan.md": "# Candidate Wave Plan\nwave-1-contract-and-cli is selected after design closure.\n",
    "admission-checklists.md": [
      "# Admission Checklists",
      "## Wave-1 Admission Checklist",
      "- Machine validation commands:",
      "- `pnpm exec nimicoding topic validate 2026-05-05-topic-goal-fixture`",
      "- `pnpm exec nimicoding topic validate graph 2026-05-05-topic-goal-fixture`",
      "- `node --test nimi-coding/test/nimicoding-topic-goal.test.mjs`",
      "",
    ].join("\n"),
    "preflight.md": [
      "# Preflight",
      "## Spec Status",
      "Existing .nimi/spec/** authority remains unchanged.",
      "## Authority Owner",
      "- nimi-coding/cli/contracts",
      "## Work Type",
      "Alignment.",
      "## Parallel Truth",
      "Forbidden.",
      "## Stop Line",
      "- Stop for authority or scope changes.",
      "## Human Gates",
      "- Human confirmation is required before lowering readiness gates.",
      "",
    ].join("\n"),
    "implementation-doctrine.md": "# Implementation Doctrine\nFail closed and do not mutate topic state.\n",
    "manager-session-protocol.md": "# Manager Session Protocol\nRun validators before closeout.\n",
    "manager-prompts.md": "# Manager Prompts\nUse the admitted packet only.\n",
    "closeout.md": [
      "# Closeout",
      "## Wave-1 Closeout Requirements",
      "- complete requires command, schema, renderers, refusal tests, and validation evidence.",
      "- partial is not complete.",
      "- blocked records blockers.",
      "- pending records human gates.",
      "",
    ].join("\n"),
    "packet-wave-0-design-audit-pass.md": "# Packet wave-0-design-audit\n",
    "result-wave-0-design-audit-pass.md": "# Result wave-0-design-audit\nVerdict: PASS.\n",
    "closeout-wave-0-design-audit.md": "# Closeout wave-0-design-audit\n",
    "packet-wave-1-contract-and-cli-preflight.md": "# Packet wave-1-contract-and-cli\n",
    "result-wave-1-contract-and-cli-preflight.md": "# Result wave-1-contract-and-cli\nVerdict: PASS.\n",
  };

  for (const [fileName, contents] of Object.entries({ ...artifacts, ...(overrides.artifacts ?? {}) })) {
    if (contents === null) {
      continue;
    }
    await writeFile(path.join(topicDir, fileName), contents, "utf8");
  }

  return topicDir;
}

async function withGoalProject(fn) {
  await withTempProject(async (projectRoot) => {
    await captureRunCli(["start"]);
    await writeGovernanceConfig(projectRoot, {
      profile_id: "fixture-profile",
      spec_governance: {},
      ai_governance: {},
    });
    await fn(projectRoot);
  });
}

test("topic goal emits deterministic slash and JSON for a goal-ready admitted wave", async () => {
  await withGoalProject(async (projectRoot) => {
    const topicDir = await seedGoalReadyTopic(projectRoot);
    const beforeTopicYaml = await readFile(path.join(topicDir, "topic.yaml"), "utf8");

    const slash = await captureRunCli(["topic", "goal", TOPIC_ID]);
    assert.equal(slash.exitCode, 0);
    assert.equal(slash.stderr, "");
    assert.match(slash.stdout, /^\/goal Execute topic 2026-05-05-topic-goal-fixture from selected execution-stage wave wave-1-contract-and-cli\./);
    assert.match(slash.stdout, /topic\.yaml, design\.md/);
    assert.ok(slash.stdout.length <= 1501);

    const json = await captureRunCli(["topic", "goal", TOPIC_ID, "--format", "json"]);
    const aliasJson = await captureRunCli(["topic", "goal", TOPIC_ID, "--json"]);
    assert.equal(json.exitCode, 0);
    assert.equal(aliasJson.exitCode, 0);
    assert.deepEqual(JSON.parse(aliasJson.stdout), JSON.parse(json.stdout));
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.profile, "fixture-profile");
    assert.equal(payload.selected_wave_id, "wave-1-contract-and-cli");
    assert.equal(payload.goal_command, slash.stdout.trimEnd());
    assert.equal(payload.refusal_reasons.length, 0);
    assert.ok(payload.validation_commands.some((entry) => entry.command.includes("topic validate graph")));
    assert.ok(payload.human_gates.length > 0);

    const afterTopicYaml = await readFile(path.join(topicDir, "topic.yaml"), "utf8");
    assert.equal(afterTopicYaml, beforeTopicYaml);
  });
});

test("topic goal treats preflight admission as execution-stage goal ownership", async () => {
  await withGoalProject(async (projectRoot) => {
    await seedGoalReadyTopic(projectRoot, {
      topicId: "2026-05-05-topic-goal-preflight-execution",
      selectedWaveState: "preflight_admitted",
    });

    const result = await captureRunCli(["topic", "goal", "2026-05-05-topic-goal-preflight-execution", "--json"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.selected_wave_id, "wave-1-contract-and-cli");
    assert.match(payload.goal_command, /Continue through wave preflight, implementation, validation, result recording, and closeout/);
    assert.equal(payload.refusal_reasons.length, 0);
  });
});

test("topic goal refuses lifecycle, selected-wave, profile, placeholder, validation, and projection blockers without fallback goals", async () => {
  await withGoalProject(async (projectRoot) => {
    const cases = [
      ["proposal", { topicId: "2026-05-05-topic-goal-proposal", rootState: "proposal" }, "topic_not_ongoing"],
      ["pending", { topicId: "2026-05-05-topic-goal-pending", rootState: "pending" }, "topic_not_ongoing"],
      ["closed", { topicId: "2026-05-05-topic-goal-closed", rootState: "closed" }, "topic_not_ongoing"],
      ["true-close-pending", { topicId: "2026-05-05-topic-goal-true-close-pending", trueCloseStatus: "pending" }, "true_close_not_started_required"],
      ["true-close-inactive", { topicId: "2026-05-05-topic-goal-true-close-inactive", trueCloseStatus: "true_closed" }, "true_close_not_started_required"],
      ["candidate-only", { topicId: "2026-05-05-topic-goal-candidate-only", selectedWaveState: "candidate" }, "selected_wave_not_executable"],
      ["selected-mismatch", { topicId: "2026-05-05-topic-goal-selected-mismatch", selectedWaveId: "wave-2-regression" }, "selected_wave_mismatch"],
      ["placeholder", { topicId: "2026-05-05-topic-goal-placeholder", artifacts: { "design.md": "# Design\nTODO\n" } }, "unresolved_placeholder"],
      ["missing-validation", { topicId: "2026-05-05-topic-goal-missing-validation", artifacts: { "admission-checklists.md": "# Admission Checklists\nNo machine commands.\n" } }, "validation_commands_missing"],
      ["missing-closeout", { topicId: "2026-05-05-topic-goal-missing-closeout", artifacts: { "closeout.md": null } }, "required_artifact_missing"],
    ];

    for (const [, options, reason] of cases) {
      await seedGoalReadyTopic(projectRoot, options);
      const result = await captureRunCli(["topic", "goal", options.topicId, "--json"]);
      assert.equal(result.exitCode, 2);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.goal_command, null);
      assert.ok(payload.refusal_reasons.includes(reason), `${options.topicId} should include ${reason}`);
      assert.doesNotMatch(result.stdout, /\/goal Execute/);
    }

    await seedGoalReadyTopic(projectRoot, { topicId: "2026-05-05-topic-goal-wave-override" });
    const waveOverride = await captureRunCli([
      "topic",
      "goal",
      "2026-05-05-topic-goal-wave-override",
      "--wave",
      "wave-2-regression",
      "--json",
    ]);
    assert.equal(waveOverride.exitCode, 2);
    assert.ok(JSON.parse(waveOverride.stdout).refusal_reasons.includes("wave_override_forbidden"));

    const unknownProfile = await captureRunCli([
      "topic",
      "goal",
      "2026-05-05-topic-goal-wave-override",
      "--profile",
      "other-profile",
      "--json",
    ]);
    assert.equal(unknownProfile.exitCode, 2);
    assert.ok(JSON.parse(unknownProfile.stdout).refusal_reasons.includes("unknown_profile"));

    await writeFile(path.join(projectRoot, ".nimi", "contracts", "topic-goal.schema.yaml"), "drift: true\n", "utf8");
    const projectionDrift = await captureRunCli(["topic", "goal", "2026-05-05-topic-goal-wave-override", "--json"]);
    assert.equal(projectionDrift.exitCode, 2);
    assert.ok(JSON.parse(projectionDrift.stdout).refusal_reasons.includes("host_projection_drift"));
  });
});

test("topic goal returns input-resolution status for missing topics", async () => {
  await withGoalProject(async () => {
    const result = await captureRunCli(["topic", "goal", "2026-05-05-does-not-exist"]);
    assert.equal(result.exitCode, 3);
    assert.match(result.stderr, /Topic not found/);
    assert.equal(result.stdout, "");
  });
});

test("repository topic-goal host projection stays byte-aligned with the package contract", async () => {
  const canonical = await readFile(path.join(repoRoot, "contracts", "topic-goal.schema.yaml"), "utf8");
  const hostProjection = await readFile(path.join(repoRoot, "..", ".nimi", "contracts", "topic-goal.schema.yaml"), "utf8");
  assert.equal(hostProjection, canonical);
});
