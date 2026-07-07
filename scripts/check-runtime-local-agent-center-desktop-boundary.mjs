#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const submitFiles = [
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit-run.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-provider.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-turn-types.ts',
];

const placementFiles = [
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-panel.tsx',
];

const diagnosticsFiles = [
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-debug-metadata.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent-utils.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-diagnostics-view-model.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-diagnostics-content.tsx',
  'apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.tsx',
];

const submitForbidden = [
  { label: 'Agent submit route readiness from conversation capability', regex: /\bensureAgentConversationSubmitRouteReady\b/gu },
  { label: 'ConversationCapabilityProjection submit truth', regex: /\bConversationCapabilityProjection\b/gu },
  { label: 'conversation resolvedBinding submit truth', regex: /\bresolvedBinding\b/gu },
  { label: 'Desktop NimiAISnapshot submit truth', regex: /\bNimiAISnapshot\b|\bAISnapshot\b/gu },
  { label: 'Desktop AgentRuntimeResolvedBinding turn truth', regex: /\bAgentRuntimeResolvedBinding\b/gu },
  { label: 'request-carried Runtime Agent execution binding', regex: /\bNimiRuntimeAgentExecutionBinding\b|\bresolveRuntimeAgentTextExecutionBinding\b/gu },
  {
    label: 'app-derived route/model/connector passed to Runtime Agent turn runner',
    regex: /runNimiRuntimeAgentTurn\s*\(\s*\{[\s\S]{0,3200}\b(route|modelId|connectorId)\b/gu,
  },
];

const placementForbidden = [
  { label: 'Desktop ChatSettingsPanel inside Agent Center placement', regex: /\bChatSettingsPanel\b/gu },
  { label: 'arbitrary modelContent slot', regex: /\bmodelContent\b/gu },
  { label: 'arbitrary diagnosticsContent slot', regex: /\bdiagnosticsContent\b/gu },
  { label: 'arbitrary avatarContent slot', regex: /\bavatarContent\b/gu },
  { label: 'arbitrary localAppearanceContent slot', regex: /\blocalAppearanceContent\b/gu },
  { label: 'Desktop-owned reusable AgentCenterPanel export', regex: /export\s+(function|const)\s+AgentCenterPanel\b/gu },
];

const diagnosticsForbidden = [
  { label: 'runtime route diagnostics from Desktop debug metadata', regex: /\bruntimeAgentTurns\.route\b/gu },
  { label: 'runtime model diagnostics from Desktop debug metadata', regex: /\bruntimeAgentTurns\.modelId\b/gu },
  { label: 'runtime connector diagnostics from Desktop debug metadata', regex: /\bruntimeAgentTurns\.connectorId\b/gu },
  { label: 'AIConfig-derived diagnostics route truth', regex: /\baiConfig\b[\s\S]{0,260}\b(route|modelId|provider|connectorId)\b/gu },
  { label: 'conversation-capability-derived diagnostics route truth', regex: /\bconversationCapability\b[\s\S]{0,260}\b(route|modelId|provider|connectorId)\b/giu },
  { label: 'local route cache diagnostics route truth', regex: /\blocalRouteCache\b|\brouteCache\b/gu },
];

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

async function readIfExists(relPath) {
  if (!await exists(relPath)) {
    return null;
  }
  return fs.readFile(repoPath(relPath), 'utf8');
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function collectForbidden(source, relPath, checks, findings) {
  for (const check of checks) {
    check.regex.lastIndex = 0;
    let match = check.regex.exec(source);
    while (match) {
      findings.push(`${relPath}:${lineOf(source, match.index)} forbidden ${check.label}: ${match[0].split('\n')[0]}`);
      match = check.regex.exec(source);
    }
  }
}

async function checkFiles(files, checks, findings, scanned) {
  for (const relPath of files) {
    const source = await readIfExists(relPath);
    if (source === null) {
      continue;
    }
    scanned.push(relPath);
    collectForbidden(source, relPath, checks, findings);
  }
}

async function main() {
  const findings = [];
  const scanned = [];

  await checkFiles(submitFiles, submitForbidden, findings, scanned);
  await checkFiles(placementFiles, placementForbidden, findings, scanned);
  await checkFiles(diagnosticsFiles, diagnosticsForbidden, findings, scanned);

  const placementSources = [];
  for (const relPath of placementFiles) {
    const source = await readIfExists(relPath);
    if (source !== null) {
      placementSources.push({ relPath, source });
    }
  }

  if (placementSources.length === 0) {
    findings.push('Desktop Agent Center placement missing: expected a Kit-consuming placement adapter');
  }

  const sawKitImport = placementSources.some(({ source }) => source.includes('@nimiplatform/kit/features/agent-center'));
  if (!sawKitImport) {
    findings.push('Desktop Agent Center placement must import @nimiplatform/kit/features/agent-center');
  }

  const submitSourceCount = submitFiles.filter((relPath) => scanned.includes(relPath)).length;
  if (submitSourceCount === 0) {
    findings.push('Desktop Agent Chat submit boundary inputs missing; checked no submit files');
  }

  if (findings.length > 0) {
    process.stderr.write('runtime local agent center Desktop boundary check failed\n');
    process.stderr.write(`scanned: ${scanned.join(', ')}\n`);
    for (const finding of findings) {
      process.stderr.write(`- ${finding}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`runtime local agent center Desktop boundary check passed (${scanned.length} files scanned): ${scanned.join(', ')}\n`);
}

main().catch((error) => {
  process.stderr.write(`check-runtime-local-agent-center-desktop-boundary failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
