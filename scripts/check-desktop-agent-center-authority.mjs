#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const scanRoots = [
  'apps/desktop/src/shell/renderer/features/chat',
  'apps/desktop/src/shell/renderer/features/runtime-config',
  'apps/desktop/src/shell/renderer/app-shell/providers',
  'apps/desktop/src/shell/renderer/infra',
];

const requiredFiles = [
  'apps/desktop/src/shell/renderer/infra/runtime-agent-ai-config.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-runtime.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx',
];

const removedFiles = [
  'apps/desktop/src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.ts',
];

const forbiddenFiles = [
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-panel-components.tsx',
];

const oldExecutionSnake = ['execution', 'config'].join('_');
const oldMemoryIntent = ['memory', 'embedding', 'intent'].join('_');
const globalForbidden = [
  { label: 'old runtime agent execution config file path', regex: new RegExp(escapeRegExp(['runtime', 'agent', 'execution', 'config'].join('-')), 'gu') },
  { label: 'old config camelCase surface', regex: new RegExp(`\\b${escapeRegExp(['execution', 'Config'].join(''))}\\b`, 'gu') },
  { label: 'old config PascalCase type surface', regex: new RegExp(`\\b${escapeRegExp(['Execution', 'Config'].join(''))}\\b`, 'gu') },
  { label: 'old runtime execution config scope', regex: new RegExp(escapeRegExp(['runtime', 'agent', oldExecutionSnake].join('.')), 'gu') },
  { label: 'old execution_config token', regex: new RegExp(escapeRegExp(oldExecutionSnake), 'gu') },
  { label: 'old memory embedding intent token', regex: new RegExp(escapeRegExp(oldMemoryIntent), 'gu') },
  { label: 'old memory embedding intent RPC', regex: new RegExp(`(?:Get|Set)${escapeRegExp(['MemoryEmbedding', 'RuntimeIntent'].join(''))}`, 'gu') },
  { label: 'old runtime config memory embedding intent helper', regex: new RegExp(`(?:Get|Set)${escapeRegExp(['MemoryEmbedding', 'BindingIntent'].join(''))}`, 'gu') },
  { label: 'app-local voice route/model truth', regex: /\b(?:speechSynthesis|speechModelId|speechRoutePolicy)\b/gu },
  {
    label: 'orphaned Desktop Agent Center section implementation',
    regex: /\b(?:export\s+function\s+(?:ChatAgentCognitionPanel|AgentDiagnosticsPanel|AgentConversationDiagnosticsContent)|(?:export\s+)?type\s+AgentCenterSectionId\s*=|AUTONOMY_MODE_OPTIONS)\b/gu,
  },
];

const agentCenterForbidden = [
  { label: 'app-local route/provider/model truth in Agent Center', regex: /\b(?:ConversationCapabilityProjection|AISnapshot|selectedBindings|runtimeFields)\b/gu },
  { label: 'arbitrary Agent Center app content slot', regex: /\b(?:diagnosticsContent|modelContent|avatarContent|localAppearanceContent)\b/gu },
];

function repoPath(relPath) {
  return path.join(repoRoot, ...relPath.split('/'));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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

async function collectFiles(relDir) {
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
      } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(entry.name)) {
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

function collectForbidden(source, relPath, findings) {
  const checks = [
    ...globalForbidden,
    ...(isAgentCenterAuthorityFile(relPath) ? agentCenterForbidden : []),
  ];
  for (const check of checks) {
    check.regex.lastIndex = 0;
    let match = check.regex.exec(source);
    while (match) {
      findings.push(`${relPath}:${lineOf(source, match.index)} forbidden ${check.label}: ${match[0]}`);
      match = check.regex.exec(source);
    }
  }
}

function isAgentCenterAuthorityFile(relPath) {
  return /\/chat-agent-(?:shell-presentation-settings|center)/u.test(relPath);
}

function requireIncludes(source, relPath, tokens, findings) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      findings.push(`${relPath}: missing ${token}`);
    }
  }
}

const findings = [];
const scanned = [];

for (const relPath of requiredFiles) {
  if (!await exists(relPath)) {
    findings.push(`${relPath}: required Desktop Agent Center authority file is missing`);
  }
}

for (const relPath of removedFiles) {
  if (await exists(relPath)) {
    findings.push(`${relPath}: excluded dead memory lifecycle surface remains reachable`);
  }
}

for (const relPath of forbiddenFiles) {
  if (await exists(relPath)) {
    findings.push(`${relPath}: forbidden Desktop-owned Agent Center implementation remains after Kit hardcut`);
  }
}

for (const root of scanRoots) {
  for (const filePath of await collectFiles(root)) {
    const relPath = toRepoRelative(filePath);
    const source = await fs.readFile(filePath, 'utf8');
    scanned.push(relPath);
    collectForbidden(source, relPath, findings);
  }
}

if (await exists('apps/desktop/src/shell/renderer/infra/runtime-agent-ai-config.ts')) {
  requireIncludes(
    await readText('apps/desktop/src/shell/renderer/infra/runtime-agent-ai-config.ts'),
    'apps/desktop/src/shell/renderer/infra/runtime-agent-ai-config.ts',
    [
      'createNimiRuntimeAgentAIConfigModule',
      'NimiRuntimeAgentAIConfigSnapshot',
      'NimiRuntimeAgentAIConfigReadinessSnapshotProjection',
      'isRuntimeAgentTextReadinessReady',
    ],
    findings,
  );
}

if (await exists('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx')) {
  requireIncludes(
    await readText('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx'),
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx',
    [
      '@nimiplatform/kit/features/agent-center',
      'agentAIConfig: input.runtimeAgentAIConfig',
      'readiness: input.runtimeAgentAIConfigReadiness',
      'inspect: input.runtimeInspect',
      'runtimeAdapter={runtimeAdapter}',
      'appearanceAdapter={props.appearanceAdapter}',
      'providerResolver: getDesktopRouteModelPickerProvider',
    ],
    findings,
  );
}

if (await exists('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-runtime.ts')) {
  requireIncludes(
    await readText('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-runtime.ts'),
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-runtime.ts',
    [
      'createRuntimeAgentCenterAdapter',
      'runtimeAgentCenterAdapter',
    ],
    findings,
  );
}

if (findings.length > 0) {
  process.stderr.write('desktop agent center authority check failed\n');
  process.stderr.write(`scanned: ${scanned.join(', ')}\n`);
  for (const finding of findings.slice(0, 80)) {
    process.stderr.write(`- ${finding}\n`);
  }
  if (findings.length > 80) {
    process.stderr.write(`- ... ${findings.length - 80} more finding(s)\n`);
  }
  process.exit(1);
}

process.stdout.write(`desktop-agent-center-authority: OK (${scanned.length} files scanned)\n`);
