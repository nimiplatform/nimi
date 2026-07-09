#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const rendererDependencyPattern = /(?:@pixiv\/three-vrm|@pixiv\/three-vrm-animation|@pixiv\/three-vrm-core|@react-three\/fiber|@react-three\/drei|CubismSdkForWeb|GLTFLoader|VRMLoader|vendor-live2d|vendor-three)/u;
const broadThreeImportPattern = /(?:from\s+['"]three(?:\/[^'"]*)?['"]|import\s*\(\s*['"]three(?:\/[^'"]*)?['"]\s*\))/u;

const appRoots = [
  'apps/desktop/src',
  'apps/desktop/src-electron',
  'apps/desktop/src-tauri/src',
  'apps/zhiyu/src',
  'apps/zhiyu/src-electron',
];

const kitPreviewRoots = [
  'kit/features/agent-center/src',
];

const kitPreviewFiles = [
  'kit/features/avatar/src/agent-center-preview.tsx',
  'kit/features/avatar/src/ui.ts',
];

function repoPath(relPath) {
  return path.join(repoRoot, ...relPath.split('/'));
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
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

function collectMatches(source, relPath, pattern, label) {
  const findings = [];
  const regex = new RegExp(pattern.source, `${pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`}`);
  let match = regex.exec(source);
  while (match) {
    findings.push(`${relPath}:${lineOf(source, match.index)} forbidden ${label}: ${match[0]}`);
    match = regex.exec(source);
  }
  return findings;
}

async function readJson(relPath) {
  return JSON.parse(await fs.readFile(repoPath(relPath), 'utf8'));
}

function dependencyKeys(manifest) {
  return [
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {}),
    ...Object.keys(manifest.peerDependencies || {}),
    ...Object.keys(manifest.optionalDependencies || {}),
  ];
}

const findings = [];

for (const root of [...appRoots, ...kitPreviewRoots]) {
  for (const filePath of await collectFiles(root)) {
    const relPath = toRepoRelative(filePath);
    const source = await fs.readFile(filePath, 'utf8');
    findings.push(...collectMatches(source, relPath, rendererDependencyPattern, 'concrete Avatar renderer dependency'));
    findings.push(...collectMatches(source, relPath, broadThreeImportPattern, 'three renderer import'));
  }
}

for (const relPath of kitPreviewFiles) {
  const source = await fs.readFile(repoPath(relPath), 'utf8');
  findings.push(...collectMatches(source, relPath, rendererDependencyPattern, 'concrete Avatar renderer dependency'));
  findings.push(...collectMatches(source, relPath, broadThreeImportPattern, 'three renderer import'));
}

for (const relPath of ['apps/desktop/package.json', 'apps/zhiyu/package.json']) {
  const manifest = await readJson(relPath);
  for (const dep of dependencyKeys(manifest)) {
    if (
      dep === 'three'
      || dep.startsWith('@pixiv/three-vrm')
      || dep.startsWith('@react-three/')
      || dep.includes('cubism')
    ) {
      findings.push(`${relPath}: forbidden renderer dependency ${dep}`);
    }
  }
}

const avatarManifest = await readJson('apps/avatar/package.json');
const avatarDeps = dependencyKeys(avatarManifest);
for (const expected of ['three', '@pixiv/three-vrm', '@react-three/fiber']) {
  if (!avatarDeps.includes(expected)) {
    findings.push(`apps/avatar/package.json: expected Avatar-owned renderer dependency missing: ${expected}`);
  }
}

if (findings.length > 0) {
  process.stderr.write('agent-center-renderer-deps failed\n');
  for (const finding of findings.slice(0, 120)) {
    process.stderr.write(`- ${finding}\n`);
  }
  if (findings.length > 120) {
    process.stderr.write(`- ... ${findings.length - 120} more finding(s)\n`);
  }
  process.exit(1);
}

process.stdout.write('agent-center-renderer-deps: OK\n');
