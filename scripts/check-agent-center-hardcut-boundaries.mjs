#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs']);

const requiredAgentCenterOperations = [
  'agent-center.avatarAssetImport',
  'agent-center.avatarAssetValidate',
  'agent-center.avatarAssetResolvePreview',
  'agent-center.live2dAdapterImport',
  'agent-center.backgroundImport',
  'agent-center.backgroundGet',
  'agent-center.backgroundValidate',
  'agent-center.backgroundRemove',
  'agent-center.agentResourcesRemove',
  'agent-center.accountResourcesRemove',
];

const forbiddenFiles = [
  'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-center-local-config-store.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-mutation.ts',
  'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-result.ts',
  'apps/desktop/src-tauri/src/desktop_agent_center_store.rs',
  'apps/zhiyu/src-electron/agent-center-local-config.ts',
  'apps/zhiyu/src-electron/agent-center-local-config-schema.ts',
  'apps/zhiyu/src/shell/agent-chat/zhiyu-agent-center-local-config.ts',
  'apps/zhiyu/src/shell/agent-chat/zhiyu-agent-center-appearance-adapter.ts',
];

const productRoots = [
  'apps/desktop/src',
  'apps/desktop/src-tauri/src',
  'apps/desktop/src-electron',
  'apps/zhiyu/src',
  'apps/zhiyu/src-electron',
  'apps/avatar/src',
  'apps/avatar/src-tauri/src',
  'apps/avatar/src-electron',
  'kit/features',
  'kit/shell/capabilities/src',
  'kit/shell/renderer/src',
  'kit/shell/tauri/src',
  'kit/shell/electron/src',
];

const forbiddenProductPatterns = [
  { label: 'retired Desktop private Agent Center command', regex: /\bdesktop_agent_center_/u },
  { label: 'retired Desktop local config store import', regex: /chat-agent-center-local-config-store/u },
  { label: 'retired Desktop avatar config module', regex: /chat-agent-center-avatar-config/u },
  { label: 'retired Zhiyu local config global', regex: /__nimiZhiyuAgentCenterLocalConfig/u },
  { label: 'retired Zhiyu local config IPC', regex: /zhiyu:agent-center-local-config/u },
  { label: 'retired Agent Center local config type', regex: /\b(?:Zhiyu)?AgentCenterLocalConfig\b/u },
  { label: 'retired Avatar local config resolver', regex: /\bnimi_avatar_resolve_local_avatar_asset\b/u },
  { label: 'retired Avatar local config resolver payload', regex: /\bLocalAvatarAssetResolvePayload\b/u },
  { label: 'Agent Center debug/workbench product surface', regex: /data-zhiyu-live2d-workbench|avatar-debug-workbench|agent-avatar-debug|debugShortcut/u },
];

const forbiddenAgentCenterCapabilityPatterns = [
  { label: 'agent-center configGet operation', regex: /agent-center\.configGet|agentCenter\.configGet|configGet/u },
  { label: 'agent-center configSet operation', regex: /agent-center\.configSet|agentCenter\.configSet|configSet/u },
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
      if (['node_modules', 'dist', 'target', 'generated', 'gen'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
        const relPath = toRepoRelative(fullPath);
        if (!/\/(?:test|tests|e2e)\//u.test(relPath) && !/[.-]test\./u.test(relPath)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(root);
  return files;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function collectPatternViolations(source, relPath, checks) {
  const violations = [];
  for (const check of checks) {
    check.regex.lastIndex = 0;
    let match = check.regex.exec(source);
    while (match) {
      violations.push(`${relPath}:${lineOf(source, match.index)} ${check.label}: ${match[0]}`);
      match = check.regex.exec(source);
    }
  }
  return violations;
}

async function read(relPath) {
  return fs.readFile(repoPath(relPath), 'utf8');
}

function requireIncludes(source, relPath, tokens, findings) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      findings.push(`${relPath}: missing ${token}`);
    }
  }
}

const findings = [];

for (const relPath of forbiddenFiles) {
  if (await exists(relPath)) {
    findings.push(`${relPath}: retired Agent Center local implementation file still exists`);
  }
}

for (const root of productRoots) {
  for (const filePath of await collectFiles(root)) {
    const relPath = toRepoRelative(filePath);
    const source = await fs.readFile(filePath, 'utf8');
    findings.push(...collectPatternViolations(source, relPath, forbiddenProductPatterns));
  }
}

for (const relPath of [
  'kit/shell/capabilities/src',
  'kit/shell/renderer/src/bridge',
  'kit/shell/tauri/src',
  'kit/shell/electron/src',
]) {
  for (const filePath of await collectFiles(relPath)) {
    const source = await fs.readFile(filePath, 'utf8');
    findings.push(...collectPatternViolations(source, toRepoRelative(filePath), forbiddenAgentCenterCapabilityPatterns));
  }
}

const capabilitySource = await read('kit/shell/capabilities/src/agent-center.ts');
const rendererBridgeSource = await read('kit/shell/renderer/src/bridge/agent-center.ts');
const tauriAliasSource = await read('kit/shell/renderer/src/bridge/tauri-api.ts');
const electronHostSource = await read('kit/shell/electron/src/main/agent-center.ts');
const tauriHostSource = await read('kit/shell/tauri/src/capabilities/mod.rs');
requireIncludes(capabilitySource, 'kit/shell/capabilities/src/agent-center.ts', requiredAgentCenterOperations, findings);
requireIncludes(rendererBridgeSource, 'kit/shell/renderer/src/bridge/agent-center.ts', requiredAgentCenterOperations, findings);
requireIncludes(tauriAliasSource, 'kit/shell/renderer/src/bridge/tauri-api.ts', requiredAgentCenterOperations, findings);
requireIncludes(electronHostSource, 'kit/shell/electron/src/main/agent-center.ts', requiredAgentCenterOperations, findings);
requireIncludes(tauriHostSource, 'kit/shell/tauri/src/capabilities/mod.rs', [
  'agent_center_avatar_asset_import',
  'agent_center_avatar_asset_validate',
  'agent_center_avatar_asset_resolve_preview',
  'agent_center_live2d_adapter_import',
  'agent_center_background_import',
  'agent_center_background_get',
  'agent_center_background_validate',
  'agent_center_background_remove',
  'agent_center_agent_resources_remove',
  'agent_center_account_resources_remove',
], findings);

if (findings.length > 0) {
  process.stderr.write('agent-center-hardcut-boundaries failed\n');
  for (const finding of findings.slice(0, 120)) {
    process.stderr.write(`- ${finding}\n`);
  }
  if (findings.length > 120) {
    process.stderr.write(`- ... ${findings.length - 120} more finding(s)\n`);
  }
  process.exit(1);
}

process.stdout.write('agent-center-hardcut-boundaries: OK\n');
