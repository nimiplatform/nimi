#!/usr/bin/env node
import path from 'node:path';
import { loadYamlFile, exists } from './lib/doc-utils.mjs';
import { moduleRootFrom } from './lib/module-paths.mjs';
import { validateDoc, validateFindingLedger, validateTopic, validatePrompt, validateWorkerOutput, validateAcceptance } from './lib/validators.mjs';

const REQUIRED_FILES = [
  'README.md',
  'contracts/methodology.contract.md',
  'contracts/artifact-model.contract.md',
  'contracts/staged-delivery.contract.md',
  'contracts/finding-lifecycle.contract.md',
  'schema/topic-index.schema.yaml',
  'schema/explore-doc.schema.yaml',
  'schema/baseline-doc.schema.yaml',
  'schema/evidence-doc.schema.yaml',
  'schema/finding-ledger.schema.yaml',
  'schema/prompt.schema.yaml',
  'schema/worker-output.schema.yaml',
  'schema/acceptance.schema.yaml',
  'protocol/dispatch.protocol.yaml',
  'protocol/worker-output.protocol.yaml',
  'protocol/acceptance.protocol.yaml',
  'protocol/phase-lifecycle.protocol.yaml',
  'protocol/reopen-defer.protocol.yaml',
  'gates/gate-policy.yaml',
  'gates/promotion-policy.yaml',
  'samples/minimum-topic/topic.index.yaml',
  'samples/minimum-topic/overview.explore.md',
  'samples/minimum-topic/methodology.baseline.md',
  'samples/minimum-topic/audit.evidence.md',
  'samples/minimum-topic/finding-ledger.yaml',
  'samples/minimum-topic/sample-phase.prompt.md',
  'samples/minimum-topic/sample-phase.worker-output.md',
  'samples/minimum-topic/sample-phase.acceptance.md',
  'cli/cli.mjs',
  'scripts/report-ai-hotspots.mjs',
  'scripts/report-ai-structure-hotspots.mjs',
];

const SCHEMA_FILES = [
  'schema/topic-index.schema.yaml',
  'schema/explore-doc.schema.yaml',
  'schema/baseline-doc.schema.yaml',
  'schema/evidence-doc.schema.yaml',
  'schema/finding-ledger.schema.yaml',
  'schema/prompt.schema.yaml',
  'schema/worker-output.schema.yaml',
  'schema/acceptance.schema.yaml',
];

const PROTOCOL_FILES = [
  'protocol/dispatch.protocol.yaml',
  'protocol/worker-output.protocol.yaml',
  'protocol/acceptance.protocol.yaml',
  'protocol/phase-lifecycle.protocol.yaml',
  'protocol/reopen-defer.protocol.yaml',
];

function fail(message, errors) {
  errors.push(message);
}

function checkRequiredFiles(moduleRoot, errors) {
  for (const relPath of REQUIRED_FILES) {
    const absPath = path.join(moduleRoot, relPath);
    if (!exists(absPath)) {
      fail(`missing module file: ${relPath}`, errors);
    }
  }
}

function checkYamlObject(filePath, errors, requiredKeys) {
  const relPath = path.relative(process.cwd(), filePath) || filePath;
  let doc;
  try {
    doc = loadYamlFile(filePath);
  } catch (error) {
    fail(`invalid YAML in ${relPath}: ${String(error)}`, errors);
    return;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(`YAML root must be a mapping: ${relPath}`, errors);
    return;
  }
  for (const key of requiredKeys) {
    if (!(key in doc)) {
      fail(`missing key "${key}" in ${relPath}`, errors);
    }
  }
}

function checkSchemaFiles(moduleRoot, errors) {
  for (const relPath of SCHEMA_FILES) {
    checkYamlObject(path.join(moduleRoot, relPath), errors, ['id', 'kind']);
  }
}

function checkProtocolFiles(moduleRoot, errors) {
  for (const relPath of PROTOCOL_FILES) {
    checkYamlObject(path.join(moduleRoot, relPath), errors, ['id', 'purpose']);
  }
}

function checkGateFiles(moduleRoot, errors) {
  checkYamlObject(path.join(moduleRoot, 'gates/gate-policy.yaml'), errors, ['hard_gates', 'soft_gates', 'advisory']);
  checkYamlObject(path.join(moduleRoot, 'gates/promotion-policy.yaml'), errors, [
    'local_incubator_root',
    'promoted_root',
    'promotable',
    'promotion_requirements',
  ]);
}

function checkSample(moduleRoot, errors, warnings) {
  const sampleDir = path.join(moduleRoot, 'samples/minimum-topic');
  const topicReport = validateTopic(sampleDir);
  warnings.push(...topicReport.warnings.map((warning) => `sample topic warning: ${warning}`));
  errors.push(...topicReport.errors.map((error) => `sample topic invalid: ${error}`));

  for (const relPath of ['overview.explore.md', 'methodology.baseline.md', 'audit.evidence.md']) {
    const report = validateDoc(path.join(sampleDir, relPath));
    warnings.push(...report.warnings.map((warning) => `sample doc ${relPath}: ${warning}`));
    errors.push(...report.errors.map((error) => `sample doc ${relPath}: ${error}`));
  }

  const ledgerReport = validateFindingLedger(path.join(sampleDir, 'finding-ledger.yaml'), { topicDir: sampleDir });
  warnings.push(...ledgerReport.warnings.map((warning) => `sample ledger warning: ${warning}`));
  errors.push(...ledgerReport.errors.map((error) => `sample ledger invalid: ${error}`));

  const promptReport = validatePrompt(path.join(sampleDir, 'sample-phase.prompt.md'));
  warnings.push(...promptReport.warnings.map((warning) => `sample prompt warning: ${warning}`));
  errors.push(...promptReport.errors.map((error) => `sample prompt invalid: ${error}`));

  const workerOutputReport = validateWorkerOutput(path.join(sampleDir, 'sample-phase.worker-output.md'));
  warnings.push(...workerOutputReport.warnings.map((warning) => `sample worker-output warning: ${warning}`));
  errors.push(...workerOutputReport.errors.map((error) => `sample worker-output invalid: ${error}`));

  const acceptanceReport = validateAcceptance(path.join(sampleDir, 'sample-phase.acceptance.md'));
  warnings.push(...acceptanceReport.warnings.map((warning) => `sample acceptance warning: ${warning}`));
  errors.push(...acceptanceReport.errors.map((error) => `sample acceptance invalid: ${error}`));
}

export function main() {
  const errors = [];
  const warnings = [];
  const moduleRoot = moduleRootFrom(import.meta.url);

  checkRequiredFiles(moduleRoot, errors);
  checkSchemaFiles(moduleRoot, errors);
  checkProtocolFiles(moduleRoot, errors);
  checkGateFiles(moduleRoot, errors);
  checkSample(moduleRoot, errors, warnings);

  for (const warning of warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`ERROR: ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`validate-module: OK ${moduleRoot}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
