#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const validModes = new Set(['spec', 'kit', 'desktop', 'zhiyu', 'all']);
const mode = parseMode(process.argv.slice(2));

function parseMode(args) {
  const index = args.indexOf('--mode');
  const value = index >= 0 ? args[index + 1] : 'all';
  if (!validModes.has(value)) {
    process.stderr.write(`unknown mode ${value}. expected one of ${[...validModes].join(', ')}\n`);
    process.exit(2);
  }
  return value;
}

function repoPath(relPath) {
  return path.join(repoRoot, ...relPath.split('/'));
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

async function exists(relPath) {
  try {
    await fs.access(repoPath(relPath));
    return true;
  } catch {
    return false;
  }
}

async function readText(relPath) {
  return fs.readFile(repoPath(relPath), 'utf8');
}

async function collectFiles(relDir, extensions) {
  const root = repoPath(relDir);
  const files = [];

  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'generated' || entry.name === 'gen') {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function assertContains(source, needle, label, relPath, findings) {
  if (!source.includes(needle)) {
    findings.push(`${relPath}: missing ${label}: ${needle}`);
  }
}

function assertNotContains(source, needle, label, relPath, findings) {
  const index = source.indexOf(needle);
  if (index >= 0) {
    findings.push(`${relPath}:${lineOf(source, index)} forbidden ${label}: ${needle}`);
  }
}

function collectForbidden(source, relPath, checks, findings) {
  for (const check of checks) {
    check.regex.lastIndex = 0;
    let match = check.regex.exec(source);
    while (match) {
      findings.push(`${relPath}:${lineOf(source, match.index)} forbidden ${check.label}: ${match[0]}`);
      match = check.regex.exec(source);
    }
  }
}

async function checkSpec() {
  const findings = [];
  const scanned = [];
  const contractPath = '.nimi/spec/platform/kernel/agent-center-contract.md';
  const registryPath = '.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml';
  const desktopKitPath = '.nimi/spec/desktop/kernel/kit-ui-consumption-contract.md';
  const desktopConversationPath = '.nimi/spec/desktop/kernel/conversation-capability-contract.md';
  const zhiyuPath = '.nimi/spec/zhiyu/kernel/configuration-surface-contract.md';
  const avatarPath = '.nimi/spec/avatar/kernel/companion-participation-consumer-contract.md';

  if (!await exists(contractPath)) {
    findings.push(`${contractPath}: missing Agent Center contract`);
  } else {
    const source = await readText(contractPath);
    scanned.push(contractPath);
    assertContains(source, 'kit.features.agent-center', 'Kit Agent Center admission', contractPath, findings);
    assertContains(source, 'Surface Ownership Matrix', 'surface ownership matrix', contractPath, findings);
    assertContains(source, 'Desktop `ChatSettingsPanel` injected as `modelContent`', 'Desktop ChatSettingsPanel classification', contractPath, findings);
    assertContains(source, 'Zhiyu `AgentCenterCapabilityProbePanel` / Capability Studio', 'Zhiyu capability tooling classification', contractPath, findings);
    assertContains(source, 'read-only Runtime projection', 'audio wave decision', contractPath, findings);
    assertContains(source, '`local_history` is admitted only as non-semantic UI recents', 'local_history owner decision', contractPath, findings);
  }

  for (const relPath of [registryPath, desktopKitPath, desktopConversationPath, zhiyuPath, avatarPath]) {
    if (!await exists(relPath)) {
      findings.push(`${relPath}: missing required spec file`);
      continue;
    }
    scanned.push(relPath);
  }

  const registry = await readText(registryPath);
  assertContains(registry, '- kit.features.agent-center', 'registry entry', registryPath, findings);
  assertContains(registry, 'id: kit.features.agent-center', 'registry module', registryPath, findings);
  assertContains(registry, 'source_rule: P-AGENT-CENTER-001', 'registry source rule', registryPath, findings);
  assertNotContains(registry, 'active_modules', 'non-schema registry field', registryPath, findings);

  const desktopKit = await readText(desktopKitPath);
  assertContains(desktopKit, 'D-SHELL-098 Agent Center Kit Consumer Boundary', 'Desktop Kit Agent Center boundary', desktopKitPath, findings);
  assertContains(desktopKit, '`local_history` | Non-semantic UI recents only', 'Desktop local_history decision', desktopKitPath, findings);

  const desktopConversation = await readText(desktopConversationPath);
  assertContains(desktopConversation, 'D-LLM-022 Agent Center Runtime Execution Config Consumer Boundary', 'Desktop Agent Chat execution config boundary', desktopConversationPath, findings);

  const zhiyu = await readText(zhiyuPath);
  assertContains(zhiyu, 'Z-CONFIG-006 Kit Agent Center Consumer Boundary', 'Zhiyu Kit consumer boundary', zhiyuPath, findings);
  assertContains(zhiyu, '`voice.avatar_autoplay` | Host-local playback UI preference only', 'Zhiyu voice owner decision', zhiyuPath, findings);

  const avatar = await readText(avatarPath);
  assertContains(avatar, 'Agent Center Appearance Boundary', 'Avatar appearance boundary', avatarPath, findings);

  return { name: 'spec', findings, scanned };
}

async function checkKit() {
  const findings = [];
  const scanned = [];
  const files = await collectFiles('kit/features/agent-center', new Set(['.ts', '.tsx', '.js', '.mjs', '.md', '.json']));
  if (files.length === 0) {
    findings.push('kit/features/agent-center: missing Kit Agent Center feature implementation');
    return { name: 'kit', findings, scanned };
  }

  const forbidden = [
    { label: 'arbitrary modelContent slot', regex: /\bmodelContent\b/gu },
    { label: 'arbitrary diagnosticsContent slot', regex: /\bdiagnosticsContent\b/gu },
    { label: 'Zhiyu renderGatedSurface slot', regex: /\brenderGatedSurface\b/gu },
    { label: 'Zhiyu technicalSurfaces slot', regex: /\btechnicalSurfaces\b/gu },
    { label: 'capability studio content', regex: /\bCapabilityStudio\b|\bAgentCenterCapabilityProbePanel\b/gu },
    { label: 'apps private import', regex: /from\s+['"][^'"]*apps\//gu },
    { label: 'runtime internal import', regex: /runtime\/internal/gu },
    { label: 'direct SDK import', regex: /from\s+['"]@nimiplatform\/sdk(\/[^'"]*)?['"]/gu },
  ];

  let sawTypedAdapter = false;
  let sawAgentCenter = false;
  for (const filePath of files) {
    const relPath = toRepoRelative(filePath);
    const source = await fs.readFile(filePath, 'utf8');
    scanned.push(relPath);
    collectForbidden(source, relPath, forbidden, findings);
    if (source.includes('RuntimeAgentCenterAdapter') || source.includes('AgentCenterAppearanceAdapter')) {
      sawTypedAdapter = true;
    }
    if (source.includes('AgentCenter')) {
      sawAgentCenter = true;
    }
  }

  if (!sawTypedAdapter) {
    findings.push('kit/features/agent-center: missing typed Runtime/appearance adapter boundary');
  }
  if (!sawAgentCenter) {
    findings.push('kit/features/agent-center: missing AgentCenter public surface');
  }

  return { name: 'kit', findings, scanned };
}

async function checkDesktop() {
  const findings = [];
  const scanned = [];
  const placementFiles = [
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx',
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-panel.tsx',
  ];
  const forbidden = [
    { label: 'Desktop ChatSettingsPanel inside Agent Center placement', regex: /\bChatSettingsPanel\b/gu },
    { label: 'arbitrary modelContent slot', regex: /\bmodelContent\b/gu },
    { label: 'arbitrary diagnosticsContent slot', regex: /\bdiagnosticsContent\b/gu },
    { label: 'arbitrary avatarContent slot', regex: /\bavatarContent\b/gu },
    { label: 'arbitrary localAppearanceContent slot', regex: /\blocalAppearanceContent\b/gu },
    { label: 'exported reusable Desktop AgentCenterPanel', regex: /export\s+(function|const)\s+AgentCenterPanel/gu },
  ];
  let sawKitImport = false;

  for (const relPath of placementFiles) {
    if (!await exists(relPath)) {
      continue;
    }
    const source = await readText(relPath);
    scanned.push(relPath);
    collectForbidden(source, relPath, forbidden, findings);
    if (source.includes('@nimiplatform/kit/features/agent-center')) {
      sawKitImport = true;
    }
  }

  if (!sawKitImport) {
    findings.push('apps/desktop Agent Center placement: missing @nimiplatform/kit/features/agent-center import');
  }

  return { name: 'desktop', findings, scanned };
}

async function checkZhiyu() {
  const findings = [];
  const scanned = [];
  const files = await collectFiles('apps/zhiyu/src/shell', new Set(['.ts', '.tsx', '.js', '.mjs']));
  const forbidden = [
    { label: 'Zhiyu AIConfig settings inside Agent Center', regex: /\bZhiyuAiConfigSettings\b/gu },
    { label: 'Agent Center capability probe inside Agent Center', regex: /\bAgentCenterCapabilityProbePanel\b/gu },
    { label: 'Capability Studio inside Agent Center', regex: /\bCapabilityStudio\b|capability-studio/gu },
    { label: 'technicalSurfaces slot', regex: /\btechnicalSurfaces\b/gu },
    { label: 'renderGatedSurface slot', regex: /\brenderGatedSurface\b/gu },
    { label: 'app-specific DiagnosticSurface inside Agent Center', regex: /\bDiagnosticSurface\b/gu },
  ];
  let sawKitImport = false;

  for (const filePath of files) {
    const relPath = toRepoRelative(filePath);
    const source = await fs.readFile(filePath, 'utf8');
    if (!source.includes('AgentCenter') && !source.includes('agent-center') && !source.includes('zhiyu-agent-center')) {
      continue;
    }
    scanned.push(relPath);
    collectForbidden(source, relPath, forbidden, findings);
    if (source.includes('@nimiplatform/kit/features/agent-center')) {
      sawKitImport = true;
    }
  }

  if (!sawKitImport) {
    findings.push('apps/zhiyu Agent Center placement: missing @nimiplatform/kit/features/agent-center import');
  }

  return { name: 'zhiyu', findings, scanned };
}

async function main() {
  const checks = [];
  if (mode === 'all' || mode === 'spec') checks.push(await checkSpec());
  if (mode === 'all' || mode === 'kit') checks.push(await checkKit());
  if (mode === 'all' || mode === 'desktop') checks.push(await checkDesktop());
  if (mode === 'all' || mode === 'zhiyu') checks.push(await checkZhiyu());

  let failed = false;
  for (const result of checks) {
    if (result.findings.length > 0) {
      failed = true;
      process.stderr.write(`runtime local agent center surface ownership check failed (${result.name})\n`);
      if (result.scanned.length > 0) {
        process.stderr.write(`scanned: ${result.scanned.join(', ')}\n`);
      }
      for (const finding of result.findings) {
        process.stderr.write(`- ${finding}\n`);
      }
      continue;
    }
    process.stdout.write(`runtime local agent center surface ownership check passed (${result.name}; ${result.scanned.length} files scanned)\n`);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`check-runtime-local-agent-center-surface-ownership failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
