import {
  assert,
  mkdir,
  path,
  readFile,
  runCliSubprocess,
  test,
  withTempProject,
  writeFile,
  YAML,
} from "./nimicoding-test-utils.mjs";

async function writeProjectFile(projectRoot, relativePath, contents) {
  const absolutePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

async function seedValidRuntimeTableProject(projectRoot) {
  await writeProjectFile(projectRoot, ".nimi/spec/INDEX.md", "# Spec Index\n\nRuntime authority index.\n");
  await writeProjectFile(projectRoot, ".nimi/spec/runtime/kernel/index.md", "# Runtime Kernel\n\nRuntime product authority.\n");
  await writeProjectFile(
    projectRoot,
    ".nimi/spec/runtime/kernel/tables/job-states.yaml",
    YAML.stringify({
      table_family: "state_machine",
      owner: "runtime",
      machine_id: "job_states",
      states: [{ state: "queued" }, { state: "running" }],
      transitions: [{ from: "queued", to: "running" }],
    }),
  );
}

test("validate-table-family accepts an admitted product authority state machine table", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);

    const result = await runCliSubprocess(["validate-table-family", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-table-family");
    assert.equal(payload.ok, true);
  });
});

test("classify-spec-tree treats support_registry table family as support registry", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(
      projectRoot,
      ".nimi/spec/runtime/kernel/tables/evidence-command-registry.yaml",
      YAML.stringify({
        table_family: "support_registry",
        registry_id: "evidence_command_registry",
        owner: "runtime",
        schema_ref: "nimi-coding/contracts/table-family.schema.yaml",
        allowed_fields: ["authority_refs", "command_refs", "evidence_class"],
        forbidden_state_fields: ["status", "coverage_status", "audit_date"],
        entries: [{ id: "runtime-evidence-command", command_refs: ["pnpm test"] }],
      }),
    );

    const result = await runCliSubprocess(["classify-spec-tree", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    const entry = payload.inventory.inventory.find((item) => item.source_path === ".nimi/spec/runtime/kernel/tables/evidence-command-registry.yaml");
    assert.equal(entry.current_inferred_class, "support_registry");
    assert.equal(entry.target_class, "support_registry");
    assert.equal(entry.disposition, "keep");
  });
});

test("validate-table-family fails when a kernel table has no table_family", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(
      projectRoot,
      ".nimi/spec/runtime/kernel/tables/missing-family.yaml",
      YAML.stringify({ owner: "runtime", states: [{ state: "queued" }] }),
    );

    const result = await runCliSubprocess(["validate-table-family", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-table-family");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /missing_table_family/);
  });
});

test("validate-table-family fails when rule evidence stores coverage status under kernel tables", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(
      projectRoot,
      ".nimi/spec/runtime/kernel/tables/rule-evidence.yaml",
      YAML.stringify({
        owner: "runtime",
        entries: [{ rule_id: "RUNTIME-RULE-001", coverage_status: "covered" }],
      }),
    );

    const result = await runCliSubprocess(["validate-table-family", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-table-family");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /table_contains_forbidden_state_or_audit_field/);
  });
});

test("validate-placement fails on generated view under product authority", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/spec/runtime/kernel/generated/job-states.md", "# Generated\n");

    const result = await runCliSubprocess(["validate-placement", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-placement");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /derived_view_under_product_authority_root/);
  });
});

test("validate-placement fails on spec generation state under spec meta", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/spec/_meta/spec-generation-audit.yaml", "files: []\n");

    const result = await runCliSubprocess(["validate-placement", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-placement");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /spec_generation_state_under_spec/);
  });
});

test("validate-placement fails on host package mirror without overlay admission", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/contracts/topic.schema.yaml", "version: 1\n");

    const result = await runCliSubprocess(["validate-placement", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-placement");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /host_package_mirror_without_minimal_overlay_admission/);
  });
});

test("validate-placement fails on config host package mirror without overlay admission", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/config/spec-generation-inputs.yaml", "version: 1\n");

    const result = await runCliSubprocess(["validate-placement", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-placement");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /host_package_mirror_without_minimal_overlay_admission/);
  });
});

test("validate-placement fails on methodology host package mirror without overlay admission", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/methodology/spec-reconstruction.yaml", "version: 1\n");

    const result = await runCliSubprocess(["validate-placement", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-placement");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /host_package_mirror_without_minimal_overlay_admission/);
  });
});

for (const rejectedDocsRoot of [".", ".nimi/local", "README.md"]) {
  test(`doctor rejects v2 docs authority root ${rejectedDocsRoot}`, async () => {
    await withTempProject(async (projectRoot) => {
      const startResult = await runCliSubprocess(["start", "--yes"], { cwd: projectRoot });
      assert.equal(startResult.exitCode, 0);

      const configPath = path.join(projectRoot, ".nimi", "config", "spec-generation-inputs.yaml");
      const config = YAML.parse(await readFile(configPath, "utf8"));
      config.spec_generation_inputs.docs_inputs[0].root = rejectedDocsRoot;
      await writeFile(configPath, YAML.stringify(config), "utf8");

      const result = await runCliSubprocess(["doctor", "--json"], { cwd: projectRoot });
      assert.equal(result.exitCode, 1);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.specGenerationInputs.ok, false);
    });
  });
}

test("doctor rejects v2 legacy docs_roots even when docs_inputs are valid", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await runCliSubprocess(["start", "--yes"], { cwd: projectRoot });
    assert.equal(startResult.exitCode, 0);

    const configPath = path.join(projectRoot, ".nimi", "config", "spec-generation-inputs.yaml");
    const config = YAML.parse(await readFile(configPath, "utf8"));
    config.spec_generation_inputs.docs_roots = ["."];
    await writeFile(configPath, YAML.stringify(config), "utf8");

    const result = await runCliSubprocess(["doctor", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.specGenerationInputs.ok, false);
  });
});

test("validate-placement fails on lifecycle cutover state under spec meta", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/spec/_meta/spec-authority-cutover-readiness.yaml", "phase: phase2_in_progress\nstatus: current\n");

    const result = await runCliSubprocess(["validate-placement", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-placement");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /lifecycle_progress_state_under_spec/);
  });
});

test("validate-domain-admission fails when future remains under spec", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/spec/future/kernel/index.md", "# Future Backlog\n");

    const result = await runCliSubprocess(["validate-domain-admission", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-domain-admission");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /excluded_domain_retained_under_spec/);
  });
});

test("validate-projection-edges fails when package methodology is copied into spec", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/spec/product-scope.yaml", "package_name: \"@nimiplatform/nimi-coding\"\n");

    const result = await runCliSubprocess(["validate-projection-edges", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-projection-edges");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /package_body_promoted_to_product_authority/);
  });
});

test("validate-projection-edges fails when product authority references generated output as authority", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(
      projectRoot,
      ".nimi/spec/runtime/kernel/core-rules.md",
      "# Core Rules\n\nAuthority ref: .nimi/spec/runtime/kernel/generated/job-states.md\n",
    );

    const result = await runCliSubprocess(["validate-projection-edges", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-projection-edges");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /derived_view_referenced_as_authority/);
  });
});

test("validate-projection-edges accepts a minimal package admission anchor", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(
      projectRoot,
      ".nimi/spec/_meta/nimi-coding-admission-anchor.yaml",
      YAML.stringify({
        package_id: "@nimiplatform/nimi-coding",
        package_version: "0.1.0",
        package_truth_root: "nimi-coding/spec",
        projection_edges: ["nimi_coding_package_to_host_anchor"],
        must_not_override: [".nimi/spec/runtime/**"],
      }),
    );

    const result = await runCliSubprocess(["validate-projection-edges", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-projection-edges");
    assert.equal(payload.ok, true);
  });
});

test("validate-guidance-bodies fails when a thin guide defines rule body", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/spec/runtime/guide.md", "# Guide\n\nThis guide MUST define behavior.\n");

    const result = await runCliSubprocess(["validate-guidance-bodies", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-guidance-bodies");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /guidance_defines_rule_body/);
  });
});

test("validate-tracked-output-admission fails on tracked non-product artifact without admission", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/audit/example.yaml", "findings: []\n");

    const result = await runCliSubprocess(["validate-tracked-output-admission", "--profile", "nimi", "--root", ".nimi/spec", "--json"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-tracked-output-admission");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /tracked_non_product_without_admission/);
  });
});

test("classify-spec-tree emits migration inventory and exits non-zero when violations exist", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/spec/runtime/kernel/generated/job-states.md", "# Generated\n");

    const result = await runCliSubprocess([
      "classify-spec-tree",
      "--profile",
      "nimi",
      "--root",
      ".nimi/spec",
      "--emit",
      ".nimi/local/state/spec-surface/inventory.json",
      "--json",
    ], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "classify-spec-tree");
    assert.equal(payload.ok, false);
    assert.match(JSON.stringify(payload.errors), /derived_view_under_product_authority_root/);

    const inventory = JSON.parse(await readFile(path.join(projectRoot, ".nimi/local/state/spec-surface/inventory.json"), "utf8"));
    assert.equal(inventory.version, 1);
    assert.ok(inventory.inventory.some((entry) => entry.source_path === ".nimi/spec/runtime/kernel/generated/job-states.md"));
  });
});

test("generate-spec-migration-plan emits local-only plan preserving confirmation blockers", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);
    await writeProjectFile(projectRoot, ".nimi/spec/avatar/kernel/index.md", "# Avatar Candidate\n");
    await writeProjectFile(projectRoot, ".nimi/spec/runtime/kernel/generated/job-states.md", "# Generated Jobs\n");
    await writeProjectFile(projectRoot, ".nimi/methodology/core.yaml", "version: 1\n");

    const emitRef = ".nimi/local/state/spec-surface/migration-plan.json";
    const result = await runCliSubprocess([
      "generate-spec-migration-plan",
      "--profile",
      "nimi",
      "--root",
      ".nimi/spec",
      "--emit",
      emitRef,
      "--json",
    ], { cwd: projectRoot });
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.contract, "nimicoding.spec-migration-plan.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.mutation_policy.mutates_source_tree, false);
    assert.ok(payload.groups.move_local.includes(".nimi/spec/runtime/kernel/generated/job-states.md"));
    assert.ok(payload.groups.move_package.includes(".nimi/methodology/core.yaml"));
    assert.ok(payload.required_confirmations.some((entry) => (
      entry.source_path === ".nimi/spec/avatar/kernel/index.md"
      && entry.required_confirmation === "product_semantic_fork"
    )));
    assert.equal(payload.enum_validation.unknown_target_classes.length, 0);
    assert.equal(payload.enum_validation.unknown_dispositions.length, 0);

    const written = JSON.parse(await readFile(path.join(projectRoot, emitRef), "utf8"));
    assert.equal(written.contract, "nimicoding.spec-migration-plan.v1");
  });
});

test("generate-spec-migration-plan refuses tracked authority emit paths", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);

    const result = await runCliSubprocess([
      "generate-spec-migration-plan",
      "--profile",
      "nimi",
      "--root",
      ".nimi/spec",
      "--emit",
      ".nimi/spec/migration-plan.json",
      "--json",
    ], { cwd: projectRoot });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /\.nimi\/local\/state\/spec-surface/);
  });
});

test("generate-spec-migration-plan refuses traversal outside local state emit root", async () => {
  await withTempProject(async (projectRoot) => {
    await seedValidRuntimeTableProject(projectRoot);

    const result = await runCliSubprocess([
      "generate-spec-migration-plan",
      "--profile",
      "nimi",
      "--root",
      ".nimi/spec",
      "--emit",
      ".nimi/local/state/spec-surface/../../outside.json",
      "--json",
    ], { cwd: projectRoot });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /\.nimi\/local\/state\/spec-surface/);
  });
});
