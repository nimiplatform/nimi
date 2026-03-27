#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const rendererRoot = path.join(repoRoot, 'apps/desktop/src/shell/renderer');
const surfacesPath = path.join(repoRoot, 'spec/desktop/kernel/tables/renderer-design-surfaces.yaml');
const sidebarsPath = path.join(repoRoot, 'spec/desktop/kernel/tables/renderer-design-sidebars.yaml');
const overlaysPath = path.join(repoRoot, 'spec/desktop/kernel/tables/renderer-design-overlays.yaml');
const allowlistsPath = path.join(repoRoot, 'spec/desktop/kernel/tables/renderer-design-allowlists.yaml');

const surfacesDoc = readYamlWithFragments(surfacesPath) || {};
const sidebarsDoc = readYamlWithFragments(sidebarsPath) || {};
const overlaysDoc = readYamlWithFragments(overlaysPath) || {};
const allowlistsDoc = readYamlWithFragments(allowlistsPath) || {};
const surfaces = Array.isArray(surfacesDoc?.surfaces) ? surfacesDoc.surfaces : [];
const sidebars = Array.isArray(sidebarsDoc?.sidebars) ? sidebarsDoc.sidebars : [];
const overlays = Array.isArray(overlaysDoc?.overlays) ? overlaysDoc.overlays : [];
const allowlists = Array.isArray(allowlistsDoc?.patterns) ? allowlistsDoc.patterns : [];

const baselineFiles = new Set();
const secondaryFiles = new Set();
const governedSurfaceRules = new Map();
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
    governedSurfaceRules.set(filePath, {
      profile: surfaceProfile,
      testidRequired: item?.testid_required === true,
    });
    if (surfaceProfile === 'baseline') {
      baselineFiles.add(filePath);
    } else {
      secondaryFiles.add(filePath);
    }
  }
}

const governedOverlayRules = new Map();
for (const item of overlays) {
  const moduleRel = String(item?.module || '').trim();
  if (!moduleRel) {
    continue;
  }
  const filePath = path.join(rendererRoot, moduleRel);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    continue;
  }
  const current = governedOverlayRules.get(filePath) || { testidRequired: false };
  if (item?.testid_required === true) {
    current.testidRequired = true;
  }
  governedOverlayRules.set(filePath, current);
}

const governedSidebarRules = new Map();
for (const item of sidebars) {
  const moduleRel = String(item?.module || '').trim();
  if (!moduleRel) {
    continue;
  }
  const filePath = path.join(rendererRoot, moduleRel);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    continue;
  }
  governedSidebarRules.set(filePath, {
    hasSearch: item?.has_search === true,
    hasPrimaryAction: item?.has_primary_action === true,
    hasSections: item?.has_sections === true,
    hasResizeHandle: item?.has_resize_handle === true,
    itemKinds: Array.isArray(item?.item_kinds) ? item.item_kinds.map((value) => String(value).trim()) : [],
    testidRequired: item?.testid_required === true,
  });
}

const sharedFiles = [
  'apps/desktop/src/shell/renderer/components/design-tokens.ts',
  'apps/desktop/src/shell/renderer/components/surface.tsx',
  'apps/desktop/src/shell/renderer/components/action.tsx',
  'apps/desktop/src/shell/renderer/components/sidebar.tsx',
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

function countLocalButtonFamilies(content) {
  const patterns = [
    /\bexport\s+function\s+\w*(?:IconButton|Button)\s*\(/gu,
    /\bfunction\s+\w*(?:IconButton|Button)\s*\(/gu,
    /\bconst\s+\w*(?:IconButton|Button)\s*=\s*(?:async\s*)?\(/gu,
    /\bconst\s+\w*(?:IconButton|Button)\s*=\s*(?:async\s*)?function\b/gu,
  ];
  return patterns.reduce((total, pattern) => total + collectMatches(content, pattern).length, 0);
}

function usesSharedOverlayPrimitive(content) {
  return /(?:components\/overlay\.js|\.\/overlay\.js)/u.test(content);
}

function usesSharedSidebarPrimitive(content) {
  return /(?:components\/sidebar\.js|\.\/sidebar\.js)/u.test(content);
}

function hasStableTestabilityMarkup(content) {
  return /data-testid=/u.test(content) || /E2E_IDS\./u.test(content);
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

}

for (const [filePath, rule] of governedSurfaceRules.entries()) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileRel = rel(filePath);
  if (rule.testidRequired && !hasStableTestabilityMarkup(content)) {
    hardFailures.push(`${fileRel}: governed surface is missing stable testability markup`);
  }
}

for (const [filePath, rule] of governedOverlayRules.entries()) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileRel = rel(filePath);
  if (!usesSharedOverlayPrimitive(content)) {
    hardFailures.push(`${fileRel}: governed overlay module must import components/overlay.js`);
  }
  if (rule.testidRequired && !hasStableTestabilityMarkup(content)) {
    hardFailures.push(`${fileRel}: governed overlay is missing stable testability markup`);
  }
}

for (const [filePath, rule] of governedSidebarRules.entries()) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileRel = rel(filePath);
  if (!usesSharedSidebarPrimitive(content)) {
    hardFailures.push(`${fileRel}: governed sidebar module must import components/sidebar.js`);
  }
  if (rule.testidRequired && !hasStableTestabilityMarkup(content)) {
    hardFailures.push(`${fileRel}: governed sidebar is missing stable testability markup`);
  }
  if (/#F8F9FB|bg-\[#F8F9FB\]/u.test(content)) {
    hardFailures.push(`${fileRel}: governed sidebar must not define a local raw sidebar background`);
  }
  if (/rounded-\[10px\]/u.test(content)) {
    hardFailures.push(`${fileRel}: governed sidebar must not define local rounded-[10px] sidebar rows`);
  }
  if (content.includes('style={{')) {
    hardFailures.push(`${fileRel}: governed sidebar must not define inline style visual contract`);
  }
  if (rule.hasSearch !== /SidebarSearch/u.test(content)) {
    hardFailures.push(`${fileRel}: governed sidebar search slot must match renderer-design-sidebars.yaml`);
  }
  if (rule.hasPrimaryAction !== /primaryAction=/u.test(content)) {
    hardFailures.push(`${fileRel}: governed sidebar primaryAction slot must match renderer-design-sidebars.yaml`);
  }
  if (rule.hasSections !== /SidebarSection/u.test(content)) {
    hardFailures.push(`${fileRel}: governed sidebar sections usage must match renderer-design-sidebars.yaml`);
  }
  if (rule.hasResizeHandle !== /SidebarResizeHandle/u.test(content)) {
    hardFailures.push(`${fileRel}: governed sidebar resize handle usage must match renderer-design-sidebars.yaml`);
  }
  for (const itemKind of rule.itemKinds) {
    const itemKindPattern = new RegExp(`["']${itemKind}["']`, 'u');
    if (!itemKindPattern.test(content)) {
      hardFailures.push(`${fileRel}: governed sidebar must declare SidebarItem kind "${itemKind}"`);
    }
  }
  if (/\b(?:SidebarNav|RuntimeSidebar)\b/u.test(content)) {
    hardFailures.push(`${fileRel}: governed sidebar must not depend on legacy local sidebar family helpers`);
  }
}

for (const filePath of advisoryFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileRel = rel(filePath);
  const isBaseline = baselineFiles.has(filePath);
  const isRootLikeSurface = /(view|list|panel)\.tsx$/u.test(fileRel);
  const containsRawButton = /<button\b/iu.test(content);
  const isOverlayFile = /(modal|dialog|tooltip|popover)/iu.test(path.basename(fileRel));

  advisory.localButtonDefinitions += countLocalButtonFamilies(content);

  if (isBaseline) {
    if (isRootLikeSurface && !content.includes("@renderer/components/surface.js")) {
      advisory.filesWithoutSharedSurface += 1;
    }
    if (containsRawButton && !content.includes("@renderer/components/action.js")) {
      advisory.filesWithRawButtonsAndNoSharedAction += 1;
    }
    if (isOverlayFile && !usesSharedOverlayPrimitive(content)) {
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
  if (isOverlayFile && !usesSharedOverlayPrimitive(content)) {
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
