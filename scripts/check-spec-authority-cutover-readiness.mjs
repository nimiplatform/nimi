#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const projectRoot = process.cwd();
const nimicodingBinPath = path.join(repoRoot, 'nimi-coding', 'bin', 'nimicoding.mjs');

const READINESS_ARTIFACT_REL = '.nimi/spec/_meta/spec-authority-cutover-readiness.yaml';
const DRIFT_CHECKLIST_REL = '.nimi/spec/_meta/generate-drift-migration-checklist.yaml';
const GOVERNANCE_CHECKLIST_REL = '.nimi/spec/_meta/governance-routing-cutover-checklist.yaml';
const BLUEPRINT_REFERENCE_REL = '.nimi/spec/_meta/blueprint-reference.yaml';
const DIRECT_COPY_CHECKLIST_REL = '.nimi/spec/_meta/direct-copy-validation-checklist.yaml';
const RECONSTRUCTION_CLOSEOUT_REL = '.nimi/local/handoff-results/spec_reconstruction.json';
const DOC_AUDIT_CLOSEOUT_REL = '.nimi/local/handoff-results/doc_spec_audit.json';
const ADMISSION_DOC_REL = 'spec/canonical-authority-cutover-admission.md';

const REQUIRED_DRIFT_COMMANDS = [
  'pnpm check:spec-human-doc-drift',
  'pnpm check:spec-semantic-completeness',
  'pnpm check:runtime-proto-spec-linkage',
  'pnpm check:runtime-spec-kernel-consistency',
  'pnpm check:sdk-spec-kernel-consistency',
  'pnpm check:desktop-spec-kernel-consistency',
  'pnpm check:platform-spec-kernel-consistency',
  'pnpm check:realm-spec-kernel-consistency',
  'pnpm check:future-spec-kernel-consistency',
  'pnpm check:runtime-spec-kernel-docs-drift',
  'pnpm check:sdk-spec-kernel-docs-drift',
  'pnpm check:desktop-spec-kernel-docs-drift',
  'pnpm check:platform-spec-kernel-docs-drift',
  'pnpm check:realm-spec-kernel-docs-drift',
  'pnpm check:future-spec-kernel-docs-drift',
];

const REQUIRED_GOVERNANCE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'spec/AGENTS.md',
  'nimi-coding/README.md',
  'nimi-coding/adapters/oh-my-codex/README.md',
  'nimi-coding/cli/lib/entrypoints.mjs',
];

const REQUIRED_ADMISSION_KEYS = [
  'spec_status',
  'authority_owner',
  'work_type',
  'parallel_truth',
  'current_authority_root',
  'future_candidate_authority_root',
  'generated_canonical_root_today',
  'benchmark_oracle_root_today',
  'long_lived_parallel_truth_allowed',
];

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function readYaml(absPath) {
  return YAML.parse(readText(absPath)) ?? {};
}

function exists(absPath) {
  return fs.existsSync(absPath);
}

function relativeFromProject(relPath) {
  return path.join(projectRoot, relPath);
}

function relativeFromRepo(relPath) {
  return path.join(repoRoot, relPath);
}

function runNimicodingJson(args) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [nimicodingBinPath, ...args],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return {
      exitCode: 0,
      stdout,
      payload: JSON.parse(stdout),
    };
  } catch (error) {
    const stdout = String(error.stdout ?? '');
    let payload = null;
    try {
      payload = stdout ? JSON.parse(stdout) : null;
    } catch {
      payload = null;
    }
    return {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      stdout,
      stderr: String(error.stderr ?? error.message ?? ''),
      payload,
    };
  }
}

function parseJsonFile(absPath) {
  return JSON.parse(readText(absPath));
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) {
    return {};
  }
  return YAML.parse(match[1]) ?? {};
}

function buildGate(id) {
  return { id, ok: false, reasons: [] };
}

function pushReason(gate, reason) {
  gate.reasons.push(reason);
}

function finalizeGate(gate) {
  gate.ok = gate.reasons.length === 0;
  return gate;
}

function validateReadinessArtifacts() {
  const packageArtifactPath = relativeFromRepo(`nimi-coding/spec/_meta/${path.basename(READINESS_ARTIFACT_REL)}`);
  const localArtifactPath = relativeFromProject(READINESS_ARTIFACT_REL);
  if (!exists(packageArtifactPath)) {
    throw new Error(`missing package readiness artifact: ${path.relative(projectRoot, packageArtifactPath)}`);
  }
  if (!exists(localArtifactPath)) {
    throw new Error(`missing local readiness artifact: ${READINESS_ARTIFACT_REL}`);
  }

  const packageArtifact = readYaml(packageArtifactPath).spec_authority_cutover_readiness;
  const localArtifact = readYaml(localArtifactPath).spec_authority_cutover_readiness;
  if (!packageArtifact || !localArtifact) {
    throw new Error('spec_authority_cutover_readiness artifact is missing its top-level key');
  }

  const packageGateIds = packageArtifact.gate_families.map((entry) => entry.id);
  const localGateIds = localArtifact.gate_families.map((entry) => entry.id);
  if (JSON.stringify(packageGateIds) !== JSON.stringify(localGateIds)) {
    throw new Error('package and local readiness artifacts disagree on gate family order');
  }
  if (JSON.stringify(packageArtifact.overall_status_enum) !== JSON.stringify(localArtifact.overall_status_enum)) {
    throw new Error('package and local readiness artifacts disagree on overall status enum');
  }

  return {
    packageArtifact,
    localArtifact,
    gateIds: localGateIds,
  };
}

function evaluateCanonicalGenerationGate() {
  const gate = buildGate('canonical_generation_gate');
  const treeResult = runNimicodingJson(['validate-spec-tree']);
  if (treeResult.exitCode !== 0 || treeResult.payload?.ok !== true) {
    pushReason(gate, 'validate-spec-tree does not pass');
  }

  const auditResult = runNimicodingJson(['validate-spec-audit']);
  if (auditResult.exitCode !== 0 || auditResult.payload?.ok !== true) {
    pushReason(gate, 'validate-spec-audit does not pass');
  }

  const reconstructionPath = relativeFromProject(RECONSTRUCTION_CLOSEOUT_REL);
  if (!exists(reconstructionPath)) {
    pushReason(gate, 'spec_reconstruction closeout artifact is missing');
  } else {
    const payload = parseJsonFile(reconstructionPath);
    if (payload.outcome !== 'completed') {
      pushReason(gate, 'spec_reconstruction closeout outcome is not completed');
    }
    if (payload.summary?.status !== 'reconstructed') {
      pushReason(gate, 'spec_reconstruction closeout summary.status is not reconstructed');
    }
  }

  const docAuditPath = relativeFromProject(DOC_AUDIT_CLOSEOUT_REL);
  if (!exists(docAuditPath)) {
    pushReason(gate, 'doc_spec_audit closeout artifact is missing');
  } else {
    const payload = parseJsonFile(docAuditPath);
    if (payload.outcome !== 'completed') {
      pushReason(gate, 'doc_spec_audit closeout outcome is not completed');
    }
    if (payload.summary?.status !== 'aligned') {
      pushReason(gate, 'doc_spec_audit closeout summary.status is not aligned');
    }
  }

  return finalizeGate(gate);
}

function evaluateBenchmarkParityGate() {
  const gate = buildGate('benchmark_parity_gate');
  const blueprintReferencePath = relativeFromProject(BLUEPRINT_REFERENCE_REL);
  if (!exists(blueprintReferencePath)) {
    pushReason(gate, 'blueprint-reference.yaml is missing');
    return finalizeGate(gate);
  }

  const blueprintReference = readYaml(blueprintReferencePath).blueprint_reference;
  if (!blueprintReference || blueprintReference.root !== 'spec') {
    pushReason(gate, 'blueprint-reference.yaml does not keep spec as the benchmark oracle root');
  }

  const directCopyPath = relativeFromRepo(DIRECT_COPY_CHECKLIST_REL);
  if (!exists(directCopyPath)) {
    pushReason(gate, 'direct-copy validation checklist is missing');
  } else {
    const directCopy = readYaml(directCopyPath).direct_copy_validation_checklist;
    const intent = Array.isArray(directCopy?.intent) ? directCopy.intent : [];
    if (!intent.includes('direct_copy_is_an_acceptance_shortcut_not_an_authority_cutover')) {
      pushReason(gate, 'direct-copy checklist no longer states that direct copy is not an authority cutover');
    }
    if (!intent.includes('direct_copy_is_not_a_cutover_readiness_substitute')) {
      pushReason(gate, 'direct-copy checklist no longer states that direct copy is not a readiness substitute');
    }
  }

  const auditResult = runNimicodingJson(['blueprint-audit', '--json']);
  if (auditResult.exitCode !== 0 || auditResult.payload?.ok !== true) {
    pushReason(gate, 'blueprint-audit does not pass');
  }

  return finalizeGate(gate);
}

function evaluateDriftPipelineGate(readinessArtifact) {
  const gate = buildGate('drift_pipeline_gate');
  const packageJson = JSON.parse(readText(relativeFromRepo('package.json')));
  const scripts = packageJson.scripts ?? {};
  const checklistPath = relativeFromProject(DRIFT_CHECKLIST_REL);
  if (!exists(checklistPath)) {
    pushReason(gate, 'generate-drift-migration-checklist.yaml is missing');
    return finalizeGate(gate);
  }

  const checklist = readYaml(checklistPath).generate_drift_migration_checklist;
  if (checklist?.posture !== 'subordinate_evidence_table_for_drift_pipeline_gate') {
    pushReason(gate, 'generate-drift-migration-checklist.yaml does not declare the drift gate subordinate posture');
  }
  const entries = Array.isArray(checklist?.entries) ? checklist.entries : [];
  const mappedCommands = new Set(entries.map((entry) => entry.command));
  const requiredCommands = new Set(
    readinessArtifact.gate_families
      .find((entry) => entry.id === 'drift_pipeline_gate')
      ?.required_evidence?.commands ?? [],
  );

  for (const command of REQUIRED_DRIFT_COMMANDS) {
    if (!scripts[command.replace(/^pnpm /u, '')]) {
      pushReason(gate, `package.json is missing script ${command}`);
    }
    if (!mappedCommands.has(command)) {
      pushReason(gate, `generate-drift-migration-checklist.yaml does not map ${command}`);
    }
  }

  for (const command of requiredCommands) {
    if (!mappedCommands.has(command)) {
      pushReason(gate, `readiness artifact requires ${command} but it is not mapped in the drift checklist`);
    }
  }

  for (const entry of entries) {
    if (typeof entry.current_canonical_input_root === 'string' && !entry.current_canonical_input_root.startsWith('spec')) {
      pushReason(gate, `drift checklist entry ${entry.command} does not keep spec as the current canonical input root`);
    }
    if (typeof entry.post_cutover_canonical_input_root === 'string' && !entry.post_cutover_canonical_input_root.startsWith('.nimi/spec')) {
      pushReason(gate, `drift checklist entry ${entry.command} does not map to a .nimi/spec post-cutover root`);
    }
  }

  return finalizeGate(gate);
}

function evaluateGovernanceRoutingGate() {
  const gate = buildGate('governance_routing_gate');
  const checklistPath = relativeFromProject(GOVERNANCE_CHECKLIST_REL);
  if (!exists(checklistPath)) {
    pushReason(gate, 'governance-routing-cutover-checklist.yaml is missing');
    return finalizeGate(gate);
  }

  const checklist = readYaml(checklistPath).governance_routing_cutover_checklist;
  if (checklist?.posture !== 'subordinate_evidence_table_for_governance_routing_gate') {
    pushReason(gate, 'governance-routing-cutover-checklist.yaml does not declare the governance gate subordinate posture');
  }
  const entries = Array.isArray(checklist?.entries) ? checklist.entries : [];
  const mappedFiles = new Set(entries.map((entry) => entry.file));
  for (const file of REQUIRED_GOVERNANCE_FILES) {
    if (!mappedFiles.has(file)) {
      pushReason(gate, `governance-routing-cutover-checklist.yaml does not include ${file}`);
    }
  }

  for (const relativePath of REQUIRED_GOVERNANCE_FILES) {
    const absPath = relativeFromRepo(relativePath);
    if (!exists(absPath)) {
      pushReason(gate, `${relativePath} is missing`);
      continue;
    }
    const text = readText(absPath);
    if (!/spec\/\*\*/u.test(text)) {
      pushReason(gate, `${relativePath} no longer names spec/** as the current authority surface`);
    }
    if (!/\.nimi\/spec/u.test(text)) {
      pushReason(gate, `${relativePath} no longer names .nimi/spec as the generated canonical tree surface`);
    }
    if (!/(readiness|admission|do not replace|does not authorize)/iu.test(text)) {
      pushReason(gate, `${relativePath} no longer explains that readiness does not equal cutover`);
    }
  }

  return finalizeGate(gate);
}

function evaluateAuthorityAdmissionGate() {
  const gate = buildGate('authority_admission_gate');
  const admissionPath = relativeFromRepo(ADMISSION_DOC_REL);
  if (!exists(admissionPath)) {
    pushReason(gate, 'spec/canonical-authority-cutover-admission.md is missing');
    return finalizeGate(gate);
  }

  const text = readText(admissionPath);
  const frontmatter = parseFrontmatter(text);
  for (const key of REQUIRED_ADMISSION_KEYS) {
    if (!(key in frontmatter)) {
      pushReason(gate, `admission doc is missing frontmatter key ${key}`);
    }
  }
  if (frontmatter.work_type !== 'redesign') {
    pushReason(gate, 'admission doc work_type must remain redesign');
  }
  if (frontmatter.parallel_truth !== 'no') {
    pushReason(gate, 'admission doc must forbid long-lived parallel truth');
  }
  if (frontmatter.long_lived_parallel_truth_allowed !== false) {
    pushReason(gate, 'admission doc must state long_lived_parallel_truth_allowed: false');
  }
  if (!/spec\/\*\*.*remains .*authority/iu.test(text)) {
    pushReason(gate, 'admission doc does not state that spec/** remains today\'s authority');
  }
  if (!/\.nimi\/spec\/\*\*.*remains .*generated canonical tree/iu.test(text)) {
    pushReason(gate, 'admission doc does not state that .nimi/spec/** remains the generated canonical tree today');
  }
  if (!/long-lived parallel truth is not allowed/iu.test(text)) {
    pushReason(gate, 'admission doc does not forbid long-lived parallel truth in prose');
  }

  return finalizeGate(gate);
}

function buildReport() {
  const readinessArtifacts = validateReadinessArtifacts();
  const gates = [
    evaluateCanonicalGenerationGate(),
    evaluateBenchmarkParityGate(),
    evaluateDriftPipelineGate(readinessArtifacts.localArtifact),
    evaluateGovernanceRoutingGate(),
    evaluateAuthorityAdmissionGate(),
  ];

  const unknownGateIds = readinessArtifacts.gateIds.filter((gateId) => !gates.some((gate) => gate.id === gateId));
  if (unknownGateIds.length > 0) {
    throw new Error(`readiness artifact declares gate families without implementation: ${unknownGateIds.join(', ')}`);
  }

  const blockedGates = gates.filter((gate) => !gate.ok);
  return {
    overallStatus: blockedGates.length === 0 ? 'ready_for_admission' : 'no_go',
    gates,
    blockedGates,
  };
}

function renderFailure(report) {
  const lines = [
    'spec-authority-cutover-readiness: NO-GO',
    'overall_status: no_go',
    'blocked_gates:',
  ];
  for (const gate of report.blockedGates) {
    lines.push(`- ${gate.id}`);
    for (const reason of gate.reasons) {
      lines.push(`  - ${reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderSuccess() {
  return 'spec-authority-cutover-readiness: ready_for_admission\n';
}

function main() {
  if (process.argv.length > 2) {
    process.stderr.write('check-spec-authority-cutover-readiness does not accept arguments\n');
    process.exit(2);
  }

  try {
    const report = buildReport();
    if (report.overallStatus === 'ready_for_admission') {
      process.stdout.write(renderSuccess());
      process.exit(0);
    }
    process.stdout.write(renderFailure(report));
    process.exit(1);
  } catch (error) {
    process.stderr.write(`check-spec-authority-cutover-readiness failed: ${String(error.message ?? error)}\n`);
    process.exit(1);
  }
}

main();
