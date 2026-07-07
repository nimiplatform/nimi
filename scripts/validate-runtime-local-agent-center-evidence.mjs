#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAN_ID = 'runtime-local-agent-center-2026-07-07';
const REQUIRED_TABS = ['overview', 'model', 'behavior', 'cognition', 'appearance'];
const ROLLUP_MARKERS = new Set(['evidence-rollup.md', 'acceptance-summary.md']);
const FORBIDDEN_DIAGNOSTIC_SOURCES = new Set([
  'ai-config',
  'conversation-capability',
  'local-route-cache',
  'app-local-bindings',
]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const args = {
    root: '',
    allowMockStaleConflict: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.root = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--allow-mock-stale-conflict') {
      args.allowMockStaleConflict = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.root) {
    throw new Error('missing required --root <evidence-root>');
  }
  return args;
}

function toDisplayPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/') || filePath;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectEvidenceFiles(dirPath) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`evidence root is not readable: ${dirPath}: ${error.message}`);
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectEvidenceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('-evidence.json')) {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function isRollupOnlyRoot(rootPath) {
  let entries = [];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => entry.isFile() && ROLLUP_MARKERS.has(entry.name));
}

function fail(violations, filePath, message) {
  violations.push(`${toDisplayPath(filePath)}: ${message}`);
}

function requireObject(violations, filePath, value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(violations, filePath, `${field} must be an object`);
    return null;
  }
  return value;
}

function requireString(violations, filePath, value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(violations, filePath, `${field} must be a non-empty string`);
    return '';
  }
  return value.trim();
}

function requireBoolean(violations, filePath, value, field) {
  if (typeof value !== 'boolean') {
    fail(violations, filePath, `${field} must be a boolean`);
    return false;
  }
  return value;
}

function requireNumber(violations, filePath, value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(violations, filePath, `${field} must be a finite number`);
    return 0;
  }
  return value;
}

function requireArray(violations, filePath, value, field) {
  if (!Array.isArray(value)) {
    fail(violations, filePath, `${field} must be an array`);
    return [];
  }
  return value;
}

async function validateScreenshots(violations, filePath, evidence) {
  const screenshots = requireObject(violations, filePath, evidence.screenshots, 'screenshots');
  if (!screenshots) return;

  const refs = [
    ['screenshots.desktop', screenshots.desktop],
    ['screenshots.narrow', screenshots.narrow],
  ];
  for (const panel of Array.isArray(screenshots.panels) ? screenshots.panels : []) {
    refs.push(['screenshots.panels[]', panel]);
  }

  for (const [field, ref] of refs) {
    const relativePath = requireString(violations, filePath, ref, field);
    if (!relativePath) continue;
    if (path.isAbsolute(relativePath)) {
      fail(violations, filePath, `${field} must be relative to the evidence JSON file`);
      continue;
    }
    const screenshotPath = path.resolve(path.dirname(filePath), relativePath);
    if (!await pathExists(screenshotPath)) {
      fail(violations, filePath, `screenshot not found for ${field}: ${relativePath}`);
    }
  }
}

function validateBaseFields(violations, filePath, evidence) {
  if (evidence.planId !== PLAN_ID) {
    fail(violations, filePath, `planId must be ${PLAN_ID}`);
  }
  for (const field of ['checkpoint', 'app', 'scenario', 'stage', 'timestamp']) {
    requireString(violations, filePath, evidence[field], field);
  }
  if (evidence.timestamp && Number.isNaN(Date.parse(evidence.timestamp))) {
    fail(violations, filePath, 'timestamp must be an ISO-parseable timestamp');
  }
}

function validateRuntime(violations, filePath, evidence) {
  const runtime = requireObject(violations, filePath, evidence.runtime, 'runtime');
  if (!runtime) return;
  requireBoolean(violations, filePath, runtime.available, 'runtime.available');

  if (evidence.scenario === 'live-runtime') {
    if (runtime.available !== true) {
      fail(violations, filePath, 'live-runtime evidence must set runtime.available true');
    }
    for (const field of ['authState', 'sdkState', 'runtimeSourceRef', 'localAgentRef']) {
      requireString(violations, filePath, runtime[field], `runtime.${field}`);
    }
  }

  if (evidence.scenario === 'no-runtime' && runtime.available !== false) {
    fail(violations, filePath, 'no-runtime evidence must set runtime.available false');
  }
}

function validateExecutionConfig(violations, filePath, evidence) {
  const config = evidence.executionConfig;
  if (evidence.scenario === 'live-runtime') {
    const executionConfig = requireObject(violations, filePath, config, 'executionConfig');
    if (!executionConfig) return;
    requireNumber(violations, filePath, executionConfig.revision, 'executionConfig.revision');
    const textGenerate = requireObject(violations, filePath, executionConfig.textGenerate, 'executionConfig.textGenerate');
    if (textGenerate) {
      requireString(violations, filePath, textGenerate.state, 'executionConfig.textGenerate.state');
      if (String(evidence.stage || '').includes('send-ready') && textGenerate.state !== 'ready') {
        fail(violations, filePath, 'live-runtime send-ready evidence requires executionConfig.textGenerate.state ready');
      }
    }
  }

  if (evidence.scenario === 'no-runtime') {
    if (config && typeof config === 'object' && config.revision !== null && config.revision !== undefined) {
      fail(violations, filePath, 'no-runtime evidence must not invent an executionConfig revision');
    }
  }

  const audio = config && typeof config === 'object' ? config.audioSynthesize : null;
  if (audio && typeof audio === 'object') {
    if (audio.editable === true || audio.playable === true) {
      fail(violations, filePath, 'audio.synthesize evidence must be read-only projection, absent, or fail-closed');
    }
    const state = String(audio.state || '');
    if (state === 'editable' || state === 'playable') {
      fail(violations, filePath, `audio.synthesize state is not admitted for this wave: ${state}`);
    }
  }
}

function validateDom(violations, filePath, evidence) {
  const dom = requireObject(violations, filePath, evidence.dom, 'dom');
  if (!dom) return;

  const viewport = requireObject(violations, filePath, dom.viewport, 'dom.viewport');
  if (viewport) {
    if (requireNumber(violations, filePath, viewport.width, 'dom.viewport.width') <= 0) {
      fail(violations, filePath, 'dom.viewport.width must be greater than 0');
    }
    if (requireNumber(violations, filePath, viewport.height, 'dom.viewport.height') <= 0) {
      fail(violations, filePath, 'dom.viewport.height must be greater than 0');
    }
  }

  const agentCenter = requireObject(violations, filePath, dom.agentCenter, 'dom.agentCenter');
  if (agentCenter) {
    requireBoolean(violations, filePath, agentCenter.visible, 'dom.agentCenter.visible');
    if (agentCenter.visible !== true && evidence.scenario !== 'no-runtime') {
      fail(violations, filePath, 'dom.agentCenter.visible must be true');
    }
    const box = requireObject(violations, filePath, agentCenter.boundingBox, 'dom.agentCenter.boundingBox');
    if (box) {
      for (const field of ['x', 'y', 'width', 'height']) {
        requireNumber(violations, filePath, box[field], `dom.agentCenter.boundingBox.${field}`);
      }
      if (agentCenter.visible === true && (box.width <= 0 || box.height <= 0)) {
        fail(violations, filePath, 'dom.agentCenter.boundingBox must have positive width and height');
      }
    }
    if (agentCenter.hasOverflow !== false) {
      fail(violations, filePath, 'dom.agentCenter.hasOverflow must be false');
    }
  }

  const textLayout = requireObject(violations, filePath, dom.textLayout, 'dom.textLayout');
  if (textLayout) {
    if (textLayout.longChineseFits !== true) {
      fail(violations, filePath, 'dom.textLayout.longChineseFits must be true');
    }
    if (textLayout.buttonTextFits !== true) {
      fail(violations, filePath, 'dom.textLayout.buttonTextFits must be true');
    }
    if (textLayout.overlapCount !== 0) {
      fail(violations, filePath, 'dom.textLayout.overlapCount must be 0');
    }
  }

  if (evidence.scenario === 'no-runtime') {
    const controls = requireObject(violations, filePath, dom.controls, 'dom.controls');
    if (controls) {
      if (controls.submitEnabled !== false) {
        fail(violations, filePath, 'no-runtime evidence must set dom.controls.submitEnabled false');
      }
      requireString(violations, filePath, controls.disabledReason, 'dom.controls.disabledReason');
    }
  }
}

function validateInteraction(violations, filePath, evidence, options) {
  const interaction = requireObject(violations, filePath, evidence.interaction, 'interaction');
  if (!interaction) return;

  const tabsVisited = requireArray(violations, filePath, interaction.tabsVisited, 'interaction.tabsVisited');
  const requiresAgentCenterTabs = evidence.scenario !== 'no-runtime'
    || evidence.dom?.agentCenter?.visible === true;
  if (requiresAgentCenterTabs) {
    for (const tab of REQUIRED_TABS) {
      if (!tabsVisited.includes(tab)) {
        fail(violations, filePath, `interaction.tabsVisited missing required Agent Center section: ${tab}`);
      }
    }
  }
  if (interaction.keyboardOperable !== true) {
    fail(violations, filePath, 'interaction.keyboardOperable must be true');
  }

  if (interaction.staleRevisionConflictObserved === true) {
    const source = requireString(violations, filePath, interaction.staleRevisionSource, 'interaction.staleRevisionSource');
    if (source === 'mock-harness-only' && !options.allowMockStaleConflict) {
      fail(violations, filePath, 'mock-harness-only stale conflict evidence is allowed only with --allow-mock-stale-conflict');
    }
    if (source && source !== 'runtime-sdk-upsert-conflict' && source !== 'mock-harness-only') {
      fail(violations, filePath, `unsupported staleRevisionSource: ${source}`);
    }
  }
}

function validateProblems(violations, filePath, evidence) {
  const problems = requireObject(violations, filePath, evidence.problems, 'problems');
  if (!problems) return;

  for (const field of ['consoleErrors', 'pageErrors', 'accessibilityErrors']) {
    const values = requireArray(violations, filePath, problems[field], `problems.${field}`);
    if (values.length > 0) {
      fail(violations, filePath, `problems.${field} must be empty`);
    }
  }
}

function validateDiagnostics(violations, filePath, evidence) {
  const diagnostics = evidence.diagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') {
    return;
  }
  const displaysRouteTruth = ['route', 'modelId', 'provider'].some((field) => diagnostics[field] !== undefined && diagnostics[field] !== null);
  const source = String(diagnostics.source || '');
  if (displaysRouteTruth && source !== 'runtime-accepted-projection' && source !== 'absent') {
    fail(violations, filePath, 'route/model/provider diagnostics require diagnostics.source runtime-accepted-projection or absent');
  }
  if (FORBIDDEN_DIAGNOSTIC_SOURCES.has(source)) {
    fail(violations, filePath, `diagnostics.source is forbidden: ${source}`);
  }
}

function validateLocalConfig(violations, filePath, evidence) {
  const localConfig = evidence.localConfig;
  const requiresLocalConfig = /local-config|boundary/u.test(`${evidence.checkpoint || ''} ${evidence.stage || ''} ${evidence.scenario || ''}`);
  if (!localConfig || typeof localConfig !== 'object') {
    if (requiresLocalConfig) {
      fail(violations, filePath, 'Agent Center local config boundary evidence requires localConfig proof');
    }
    return;
  }
  const modules = requireArray(violations, filePath, localConfig.modulesChecked, 'localConfig.modulesChecked');
  for (const moduleName of ['appearance', 'avatar_asset', 'local_history', 'voice', 'ui']) {
    if (!modules.includes(moduleName)) {
      fail(violations, filePath, `localConfig.modulesChecked missing ${moduleName}`);
    }
  }
  if (localConfig.unadmittedModulesRejected !== true) {
    fail(violations, filePath, 'localConfig.unadmittedModulesRejected must be true');
  }
  if (localConfig.forbiddenTruthFieldsRejected !== true) {
    fail(violations, filePath, 'localConfig.forbiddenTruthFieldsRejected must be true');
  }
}

async function validateEvidenceFile(filePath, options) {
  const violations = [];
  let evidence = null;
  try {
    evidence = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    fail(violations, filePath, `invalid JSON: ${error.message}`);
    return violations;
  }

  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail(violations, filePath, 'evidence JSON must be an object');
    return violations;
  }

  validateBaseFields(violations, filePath, evidence);
  await validateScreenshots(violations, filePath, evidence);
  validateRuntime(violations, filePath, evidence);
  validateExecutionConfig(violations, filePath, evidence);
  validateDom(violations, filePath, evidence);
  validateInteraction(violations, filePath, evidence, options);
  validateProblems(violations, filePath, evidence);
  validateDiagnostics(violations, filePath, evidence);
  validateLocalConfig(violations, filePath, evidence);

  return violations;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootPath = path.resolve(repoRoot, options.root);
  const evidenceFiles = await collectEvidenceFiles(rootPath);

  if (evidenceFiles.length === 0) {
    if (await isRollupOnlyRoot(rootPath)) {
      process.stdout.write(`runtime local agent center evidence validator: rollup-only root ${toDisplayPath(rootPath)}\n`);
      return;
    }
    throw new Error(`no *-evidence.json files found under ${toDisplayPath(rootPath)}`);
  }

  const violations = [];
  for (const filePath of evidenceFiles) {
    violations.push(...await validateEvidenceFile(filePath, options));
  }

  if (violations.length > 0) {
    process.stderr.write('runtime local agent center evidence validation failed\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`runtime local agent center evidence validator: validated ${evidenceFiles.length} evidence file(s) under ${toDisplayPath(rootPath)}\n`);
}

main().catch((error) => {
  process.stderr.write(`validate-runtime-local-agent-center-evidence failed: ${error.message}\n`);
  process.exitCode = 1;
});
