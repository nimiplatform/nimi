#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const repoRoot = process.cwd();
const rendererRoot = path.join(repoRoot, 'apps/desktop/src/shell/renderer');
const surfacesPath = path.join(repoRoot, 'spec/desktop/kernel/tables/renderer-design-surfaces.yaml');
const allowlistsPath = path.join(repoRoot, 'spec/desktop/kernel/tables/renderer-design-allowlists.yaml');

const surfacesDoc = readYamlWithFragments(surfacesPath) || {};
const allowlistsDoc = readYamlWithFragments(allowlistsPath) || {};
const surfaces = Array.isArray(surfacesDoc?.surfaces) ? surfacesDoc.surfaces : [];
const allowlists = Array.isArray(allowlistsDoc?.patterns) ? allowlistsDoc.patterns : [];

const baselineFiles = new Set();
const secondaryFiles = new Set();
for (const item of surfaces) {
  const surfaceProfile = String(item?.surface_profile || '').trim();
  if (surfaceProfile !== 'baseline' && surfaceProfile !== 'secondary') {
    continue;
  }
  const moduleRel = String(item?.module || '').trim();
  if (!moduleRel) {
    continue;
  }
  const filePath = path.join(rendererRoot, moduleRel);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    if (surfaceProfile === 'baseline') {
      baselineFiles.add(filePath);
    } else {
      secondaryFiles.add(filePath);
    }
  }
}

const sharedFiles = [
  'apps/desktop/src/shell/renderer/components/design-tokens.ts',
  'apps/desktop/src/shell/renderer/components/surface.tsx',
  'apps/desktop/src/shell/renderer/components/action.tsx',
  'apps/desktop/src/shell/renderer/components/overlay.tsx',
  'apps/desktop/src/shell/renderer/components/tooltip.tsx',
].map((rel) => path.join(repoRoot, rel)).filter((filePath) => fs.existsSync(filePath));

const filesToCheck = [...new Set([...baselineFiles, ...sharedFiles])];
const advisoryFiles = [...new Set([...baselineFiles, ...secondaryFiles])];

const hardFailures = [];
const advisory = {
  localButtonDefinitions: 0,
  filesWithoutSharedSurface: 0,
  filesWithRawButtonsAndNoSharedAction: 0,
  overlayFilesWithoutSharedOverlay: 0,
  secondaryFilesWithoutSharedSurface: 0,
  secondaryFilesWithRawButtonsAndNoSharedAction: 0,
  secondaryOverlayFilesWithoutSharedOverlay: 0,
};

function rel(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function getAllowlistEntries(filePath, patternType) {
  const fileRel = rel(filePath);
  return allowlists.filter((entry) => String(entry?.pattern_type || '').trim() === patternType
    && String(entry?.scope || '').trim() === fileRel);
}

function hasAllowlistEntries(filePath, patternType) {
  return getAllowlistEntries(filePath, patternType).length > 0;
}

function isAllowlisted(filePath, patternType, sourceText) {
  const entries = getAllowlistEntries(filePath, patternType);
  return entries.some((entry) => {
    const pattern = String(entry?.pattern || '').trim();
    if (!pattern) {
      return false;
    }
    return new RegExp(pattern, 'u').test(sourceText);
  });
}

function collectMatches(content, regex) {
  return [...content.matchAll(regex)].map((match) => match[0]);
}

for (const filePath of filesToCheck) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileRel = rel(filePath);

  const rawBrandMatches = collectMatches(content, /#4ECCA3/gu);
  if (rawBrandMatches.length > 0 && !isAllowlisted(filePath, 'raw_color', content)) {
    hardFailures.push(`${fileRel}: raw brand color #4ECCA3 is forbidden on baseline/shared surfaces`);
  }

  const emeraldMatches = collectMatches(content, /\bemerald-[A-Za-z0-9/-]+\b/gu);
  if (emeraldMatches.length > 0 && !isAllowlisted(filePath, 'token_bypass', content)) {
    hardFailures.push(`${fileRel}: emerald-* token bypass is forbidden on baseline/shared surfaces`);
  }

  const roundedMatches = collectMatches(content, /rounded-\[[^\]]+\]/gu);
  if (roundedMatches.length > 0 && !hasAllowlistEntries(filePath, 'class_pattern')) {
    hardFailures.push(`${fileRel}: rounded-[...] requires renderer-design allowlist coverage`);
  }

  const zMatches = collectMatches(content, /z-\[[^\]]+\]/gu);
  if (zMatches.length > 0 && !hasAllowlistEntries(filePath, 'class_pattern')) {
    hardFailures.push(`${fileRel}: z-[...] requires renderer-design allowlist coverage`);
  }

  if (content.includes('style={{') && !isAllowlisted(filePath, 'inline_style', content)) {
    hardFailures.push(`${fileRel}: inline style requires renderer-design allowlist coverage`);
  }

  const definesLocalOverlay = /(Modal|Dialog|Popover|Tooltip)\s*\(/u.test(content) || /export function .*?(Modal|Dialog|Popover|Tooltip)\b/u.test(content);
  if (definesLocalOverlay && /features\/(explore|contacts)\//u.test(fileRel) && !content.includes("@renderer/components/overlay.js")) {
    hardFailures.push(`${fileRel}: local overlay shell must import @renderer/components/overlay.js`);
  }

}

for (const filePath of advisoryFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileRel = rel(filePath);
  const isBaseline = baselineFiles.has(filePath);
  const isRootLikeSurface = /(view|list|panel)\.tsx$/u.test(fileRel);
  const containsRawButton = /<button\b/iu.test(content);
  const isOverlayFile = /(modal|dialog|tooltip|popover)/iu.test(path.basename(fileRel));

  advisory.localButtonDefinitions += collectMatches(content, /(?:function|const)\s+\w*(?:IconButton|Button)\b/gu).length;

  if (isBaseline) {
    if (isRootLikeSurface && !content.includes("@renderer/components/surface.js")) {
      advisory.filesWithoutSharedSurface += 1;
    }
    if (containsRawButton && !content.includes("@renderer/components/action.js")) {
      advisory.filesWithRawButtonsAndNoSharedAction += 1;
    }
    if (isOverlayFile && !content.includes("@renderer/components/overlay.js")) {
      advisory.overlayFilesWithoutSharedOverlay += 1;
    }
    continue;
  }

  if (isRootLikeSurface && !content.includes("@renderer/components/surface.js")) {
    advisory.secondaryFilesWithoutSharedSurface += 1;
  }
  if (containsRawButton && !content.includes("@renderer/components/action.js")) {
    advisory.secondaryFilesWithRawButtonsAndNoSharedAction += 1;
  }
  if (isOverlayFile && !content.includes("@renderer/components/overlay.js")) {
    advisory.secondaryOverlayFilesWithoutSharedOverlay += 1;
  }
}

if (hardFailures.length > 0) {
  process.stderr.write('desktop design contract violations detected:\n');
  for (const failure of hardFailures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write('\n');
}

process.stdout.write(`desktop-design-contract advisory: local button families=${advisory.localButtonDefinitions}\n`);
process.stdout.write(`desktop-design-contract advisory: baseline root/list files without shared surface=${advisory.filesWithoutSharedSurface}\n`);
process.stdout.write(`desktop-design-contract advisory: baseline files with raw buttons and no shared action=${advisory.filesWithRawButtonsAndNoSharedAction}\n`);
process.stdout.write(`desktop-design-contract advisory: baseline overlay files without shared overlay=${advisory.overlayFilesWithoutSharedOverlay}\n`);
process.stdout.write(`desktop-design-contract advisory: secondary root/list files without shared surface=${advisory.secondaryFilesWithoutSharedSurface}\n`);
process.stdout.write(`desktop-design-contract advisory: secondary files with raw buttons and no shared action=${advisory.secondaryFilesWithRawButtonsAndNoSharedAction}\n`);
process.stdout.write(`desktop-design-contract advisory: secondary overlay files without shared overlay=${advisory.secondaryOverlayFilesWithoutSharedOverlay}\n`);

if (hardFailures.length > 0) {
  process.exit(1);
}
