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

test("native Codex adapter dispatches through the Codex SDK boundary", async () => {
  const calls = [];
  const fakeCodex = {
    startThread() {
      calls.push(["startThread"]);
      return {
        id: "thread-started",
        async run(prompt) {
          calls.push(["run", prompt]);
          return { final_response: "started" };
        },
      };
    },
    resumeThread(threadId) {
      calls.push(["resumeThread", threadId]);
      return {
        id: threadId,
        async run(prompt) {
          calls.push(["run", prompt]);
          return { finalResponse: "resumed" };
        },
      };
    },
  };

  const started = await runNativeCodexSdkPrompt({
    codex: fakeCodex,
    prompt: "execute admitted topic step",
  });
  assert.equal(started.ok, true);
  assert.equal(started.adapterId, "codex");
  assert.equal(started.sdkPackage, "@openai/codex-sdk");
  assert.equal(started.mode, "start_thread");
  assert.equal(started.threadId, "thread-started");
  assert.equal(started.finalResponse, "started");

  const resumed = await runNativeCodexSdkPrompt({
    codex: fakeCodex,
    threadId: "thread-existing",
    prompt: "continue admitted topic step",
  });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.mode, "resume_thread");
  assert.equal(resumed.threadId, "thread-existing");
  assert.equal(resumed.finalResponse, "resumed");
  assert.deepEqual(calls, [
    ["startThread"],
    ["run", "execute admitted topic step"],
    ["resumeThread", "thread-existing"],
    ["run", "continue admitted topic step"],
  ]);

  const refused = await runNativeCodexSdkPrompt({ codex: fakeCodex, prompt: "" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /prompt must be a non-empty string/);
});

test("validate-spec-governance dispatches host-configured commands", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-governance", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi-realm",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {
          "single-source": ["node -e \"process.stdout.write('single-source-ok\\\\n')\""],
        },
        generate_commands: {},
      },
      ai_governance: {
        agents_freshness: {
          targets: [],
          required_sections: [],
          stale_tokens: [],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: {} },
          classifiers: {},
          exclude: [],
          waivers: [],
        },
        structure_budget: {
          version: 1,
          allowed_forwarding_shells: ["index.ts"],
          rules: [{ id: "noop", include: ["missing/**"], depth_base: "missing", warning_depth: 5, error_depth: 7 }],
          exclude: ["**"],
          waivers: [],
        },
        high_risk_doc_metadata: {
          doc_roots: [".local"],
          exempt_paths: [],
          name_patterns: ["design"],
          required_metadata_keys: ["Spec Status"],
        },
      },
    });

    const result = await captureRunCli([
      "validate-spec-governance",
      "--profile",
      "nimi-realm",
      "--scope",
      "single-source",
    ]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /single-source-ok/);
  });
});

test("validate-spec-governance supports host-defined scopes via --scope all", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-governance-all", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {
          "runtime-consistency": ["node -e \"process.stdout.write('runtime-ok\\\\n')\""],
          "sdk-consistency": ["node -e \"process.stdout.write('sdk-ok\\\\n')\""],
        },
        generate_commands: {
          runtime: ["node -e \"process.stdout.write('generate-runtime\\\\n')\""],
        },
      },
      ai_governance: {
        agents_freshness: {
          targets: [],
          required_sections: [],
          stale_tokens: [],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: {} },
          classifiers: {},
          exclude: [],
          waivers: [],
        },
        structure_budget: {
          version: 1,
          allowed_forwarding_shells: ["index.ts"],
          rules: [{ id: "noop", include: ["missing/**"], depth_base: "missing", warning_depth: 5, error_depth: 7 }],
          exclude: ["**"],
          waivers: [],
        },
        high_risk_doc_metadata: {
          doc_roots: [".local"],
          exempt_paths: [],
          name_patterns: ["design"],
          required_metadata_keys: ["Spec Status"],
        },
      },
    });

    const result = await captureRunCli([
      "validate-spec-governance",
      "--profile",
      "nimi",
      "--scope",
      "all",
    ]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /runtime-ok/);
    assert.match(result.stdout, /sdk-ok/);
  });
});

test("generate-spec-derived-docs supports host-defined scopes and --check", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-generate-governance", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {},
        generate_commands: {
          "spec-human-doc": ["node -e \"process.stdout.write(process.argv.includes('--check') ? 'human-check\\\\n' : 'human-generate\\\\n')\" --"],
        },
      },
      ai_governance: {
        agents_freshness: {
          targets: [],
          required_sections: [],
          stale_tokens: [],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: {} },
          classifiers: {},
          exclude: [],
          waivers: [],
        },
        structure_budget: {
          version: 1,
          allowed_forwarding_shells: ["index.ts"],
          rules: [{ id: "noop", include: ["missing/**"], depth_base: "missing", warning_depth: 5, error_depth: 7 }],
          exclude: ["**"],
          waivers: [],
        },
        high_risk_doc_metadata: {
          doc_roots: [".local"],
          exempt_paths: [],
          name_patterns: ["design"],
          required_metadata_keys: ["Spec Status"],
        },
      },
    });

    const result = await captureRunCli([
      "generate-spec-derived-docs",
      "--profile",
      "nimi",
      "--scope",
      "spec-human-doc",
      "--check",
    ]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /human-check/);
  });
});

test("validate-ai-governance uses host-configured agents freshness targets", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-ai-governance", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "AGENTS.md"),
      [
        "# Test",
        "",
        "## Scope",
        "ok",
        "",
        "## Hard Boundaries",
        "ok",
        "",
        "## Retrieval Defaults",
        "ok",
        "",
        "## Verification Commands",
        "ok",
      ].join("\n"),
      "utf8",
    );
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi-realm",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {},
        generate_commands: {},
      },
      ai_governance: {
        agents_freshness: {
          targets: [{ rel: "AGENTS.md", max_lines: 50 }],
          required_sections: [
            "## Scope",
            "## Hard Boundaries",
            "## Retrieval Defaults",
            "## Verification Commands",
          ],
          stale_tokens: ["AISC-"],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: {} },
          classifiers: {},
          exclude: [],
          waivers: [],
        },
        structure_budget: {
          version: 1,
          allowed_forwarding_shells: ["index.ts"],
          rules: [{ id: "noop", include: ["missing/**"], depth_base: "missing", warning_depth: 5, error_depth: 7 }],
          exclude: ["**"],
          waivers: [],
        },
        high_risk_doc_metadata: {
          doc_roots: [".local"],
          exempt_paths: [],
          name_patterns: ["design"],
          required_metadata_keys: ["Spec Status"],
        },
      },
    });

    const result = await captureRunCli([
      "validate-ai-governance",
      "--profile",
      "nimi-realm",
      "--scope",
      "agents-freshness",
    ]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /agents freshness check passed/);
  });
});
