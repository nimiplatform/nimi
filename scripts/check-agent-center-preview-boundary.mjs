#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function repoPath(relPath) {
  return path.join(repoRoot, ...relPath.split('/'));
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

function forbid(source, relPath, checks, findings) {
  for (const check of checks) {
    if (check.regex.test(source)) {
      findings.push(`${relPath}: forbidden ${check.label}`);
    }
  }
}

const findings = [];

const agentCenterUi = await read('kit/features/agent-center/src/components/AgentCenterAppearanceSection.tsx');
requireIncludes(agentCenterUi, 'kit/features/agent-center/src/components/AgentCenterAppearanceSection.tsx', [
  '@nimiplatform/kit/features/avatar',
  'AgentCenterAvatarPreview',
  'resolveAgentCenterAvatarPreviewServiceResult',
  'data-agent-center-appearance-avatar-preview',
  'previewArtifactRef',
  'previewImageRef',
], findings);

const agentCenterLogic = await read('kit/features/agent-center/src/components/AgentCenterAppearanceSection.logic.ts');
requireIncludes(agentCenterLogic, 'kit/features/agent-center/src/components/AgentCenterAppearanceSection.logic.ts', [
  'avatar_preview_service',
  'previewArtifactRef',
], findings);

const shellAdapter = await read('kit/features/agent-center/src/shell-appearance-adapter.ts');
requireIncludes(shellAdapter, 'kit/features/agent-center/src/shell-appearance-adapter.ts', [
  'resolveAvatarAssetPreview',
  'validateAgentCenterAvatarPreviewResolveResult',
  "previewTier: 'avatar_preview_service'",
], findings);

const avatarFacade = await read('kit/features/avatar/src/agent-center-preview.tsx');
requireIncludes(avatarFacade, 'kit/features/avatar/src/agent-center-preview.tsx', [
  "tier: 'avatar_preview_service'",
  'nonPlaceholder: true',
  'nonPlaceholder: false',
  'data-avatar-preview-nonplaceholder="true"',
  'data-avatar-preview-nonplaceholder="false"',
  'AvatarStage',
], findings);
forbid(avatarFacade, 'kit/features/avatar/src/agent-center-preview.tsx', [
  { label: 'direct Avatar app import', regex: /apps\/avatar|@renderer\/|src\/shell\/renderer/u },
], findings);

const avatarService = await read('apps/avatar/src/shell/renderer/agent-center-preview/agent-center-preview-service.ts');
requireIncludes(avatarService, 'apps/avatar/src/shell/renderer/agent-center-preview/agent-center-preview-service.ts', [
  'createLive2DAgentCenterPreviewDescriptor',
  'createVrmAgentCenterPreviewDescriptor',
  'visiblePixels',
  'sampledPixelChecksum',
  'avatar_preview_service:live2d',
  'avatar_preview_service:vrm',
], findings);

const live2dPreview = await read('apps/avatar/src/shell/renderer/live2d/live2d-agent-center-preview.ts');
const vrmPreview = await read('apps/avatar/src/shell/renderer/vrm/vrm-agent-center-preview.ts');
for (const [relPath, source] of [
  ['apps/avatar/src/shell/renderer/live2d/live2d-agent-center-preview.ts', live2dPreview],
  ['apps/avatar/src/shell/renderer/vrm/vrm-agent-center-preview.ts', vrmPreview],
]) {
  requireIncludes(source, relPath, [
    'previewArtifactRef',
    'visiblePixels',
    'sampledPixelChecksum',
  ], findings);
  forbid(source, relPath, [
    { label: 'ready preview without visible-pixel evidence', regex: /validationStatus:\s*'valid'[\s\S]{0,220}visiblePixels:\s*0/u },
  ], findings);
}

const kitFeatureFiles = [
  'kit/features/agent-center/src/components/AgentCenterAppearanceSection.tsx',
  'kit/features/agent-center/src/shell-appearance-adapter.ts',
  'kit/features/avatar/src/agent-center-preview.tsx',
  'kit/features/avatar/src/headless.ts',
  'kit/features/avatar/src/ui.ts',
];
for (const relPath of kitFeatureFiles) {
  const source = await read(relPath);
  forbid(source, relPath, [
    { label: 'direct Avatar app import', regex: /apps\/avatar|@renderer\/|src\/shell\/renderer/u },
    { label: 'concrete renderer dependency', regex: /@pixiv\/three-vrm|@react-three|CubismSdkForWeb|GLTFLoader|VRMLoader|vendor-live2d|vendor-three/u },
  ], findings);
}

if (findings.length > 0) {
  process.stderr.write('agent-center-preview-boundary failed\n');
  for (const finding of findings) {
    process.stderr.write(`- ${finding}\n`);
  }
  process.exit(1);
}

process.stdout.write('agent-center-preview-boundary: OK\n');
