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
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

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

test("validate-ai-governance context budget fails closed on dense source shape", async () => {
  await withTempProject(async (projectRoot) => {
    await execFile("git", ["init"], { cwd: projectRoot });
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "src", "dense-source.mjs"),
      `export const dense = "${"x".repeat(4096)}";\n`,
      "utf8",
    );
    await execFile("git", ["add", "src/dense-source.mjs"], { cwd: projectRoot });
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {},
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
          profiles: {
            production: {
              error_max_line_bytes: 1024,
              error_average_line_bytes: 1024,
            },
          },
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
      "nimi",
      "--scope",
      "context-budget",
    ]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ERROR: src\/dense-source\.mjs/);
    assert.match(result.stderr, /max-line=/);
    assert.match(result.stderr, /avg-line=/);

    const jsonResult = await captureRunCli([
      "validate-ai-governance",
      "--profile",
      "nimi",
      "--scope",
      "context-budget",
      "--json",
    ]);
    assert.equal(jsonResult.exitCode, 1);
    assert.equal(jsonResult.stderr, "");
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.command, "validate-ai-governance");
    assert.equal(payload.scope, "context-budget");
    assert.equal(payload.scopes.length, 1);
    assert.equal(payload.scopes[0].scope, "context-budget");
    assert.equal(payload.scopes[0].ok, false);
    assert.equal(payload.scopes[0].report.errors[0].file, "src/dense-source.mjs");
    assert.equal(payload.scopes[0].report.errors[0].maxLineBytes > 1024, true);
  });
});

test("validate-ai-governance emits machine-readable JSON for all scopes", async () => {
  await withTempProject(async (projectRoot) => {
    await execFile("git", ["init"], { cwd: projectRoot });
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-ai-governance-json", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "AGENTS.md"),
      [
        "# AGENTS.md",
        "## Scope",
        "Temp fixture.",
        "## Hard Boundaries",
        "None.",
        "## Retrieval Defaults",
        "None.",
        "## Verification Commands",
        "None.",
        "",
      ].join("\n"),
      "utf8",
    );
    await execFile("git", ["add", "package.json", "AGENTS.md"], { cwd: projectRoot });
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {},
        generate_commands: {},
      },
      ai_governance: {
        agents_freshness: {
          targets: [{ rel: "AGENTS.md", max_lines: 20 }],
          required_sections: [
            "## Scope",
            "## Hard Boundaries",
            "## Retrieval Defaults",
            "## Verification Commands",
          ],
          stale_tokens: [],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: { error_lines: 1000 } },
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
      "nimi",
      "--scope",
      "all",
      "--json",
    ]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.profile, "nimi");
    assert.deepEqual(payload.scopes.map((entry) => entry.scope), [
      "agents-freshness",
      "context-budget",
      "structure-budget",
      "high-risk-doc-metadata",
    ]);
    assert.equal(payload.scopes.every((entry) => entry.ok), true);
    assert.equal(payload.scopes.find((entry) => entry.scope === "agents-freshness").report.failures.length, 0);
  });
});
