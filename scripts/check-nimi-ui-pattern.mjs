#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function readYaml(rel) {
  return YAML.parse(read(rel));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const tokensTable = readYaml('config/platform-nimi-ui-tokens.yaml');
const themesTable = readYaml('config/platform-nimi-ui-themes.yaml');
const compositionsTable = readYaml('config/platform-nimi-ui-compositions.yaml');
const primitivesTable = readYaml('config/platform-nimi-ui-primitives.yaml');

function discoverAppKitTables(fileName) {
  const appsRoot = path.join(repoRoot, 'apps');
  const rels = [];
  const migratedConfigsByFileName = {
    'nimi-kit-compositions.yaml': [
      'config/desktop-shell-ui-kit-compositions.yaml',
      'config/avatar-nimi-kit-compositions.yaml',
    ],
    'nimi-kit-adoption.yaml': ['config/avatar-nimi-kit-adoption.yaml'],
  };
  rels.push(...(migratedConfigsByFileName[fileName] ?? []));
  if (fs.existsSync(appsRoot)) {
    rels.push(...fs
      .readdirSync(appsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join('apps', entry.name, 'spec', 'kernel', 'tables', fileName)));
  }
  const nimiSpecRoot = path.join(repoRoot, '.nimi', 'spec');
  if (fs.existsSync(nimiSpecRoot)) {
    rels.push(...fs
      .readdirSync(nimiSpecRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !['platform', '_meta'].includes(entry.name))
      .map((entry) => path.join('.nimi', 'spec', entry.name, 'kernel', 'tables', fileName)));
  }
  return rels
    .filter((rel) => fs.existsSync(path.join(repoRoot, rel)))
    .map((rel) => ({ rel, doc: readYaml(rel) }));
}

const hardFailures = [];
const tokenRows = Array.isArray(tokensTable?.tokens) ? tokensTable.tokens : [];
const tokenIds = new Set(tokenRows.map((row) => String(row?.id || '').trim()).filter(Boolean));
const accentTokenIds = new Set(
  tokenRows
    .filter((row) => String(row?.theme_layer || 'foundation').trim() === 'accent')
    .map((row) => String(row?.id || '').trim())
    .filter(Boolean),
);

for (const [rel, doc, key] of [
  ['config/platform-nimi-ui-compositions.yaml', compositionsTable, 'components'],
]) {
  const rows = Array.isArray(doc?.[key]) ? doc[key] : [];
  if (rows.length > 0) {
    hardFailures.push(`${rel}: platform design tables must not carry concrete app consumption inventory`);
  }
}

const appThemeTables = discoverAppKitTables('nimi-kit-themes.yaml');
const themeRows = [
  ...(Array.isArray(themesTable?.packs) ? themesTable.packs : []),
  ...appThemeTables.flatMap(({ doc }) => (Array.isArray(doc?.packs) ? doc.packs : [])),
];
const themeCoverage = new Map();
const themeKinds = new Map();
for (const row of themeRows) {
  const themeId = String(row?.theme_id || '').trim();
  const packKind = String(row?.pack_kind || '').trim();
  const values = row?.values && typeof row.values === 'object' ? row.values : {};
  if (!themeId || !packKind) continue;
  if (!themeCoverage.has(themeId)) themeCoverage.set(themeId, new Set());
  for (const tokenId of Object.keys(values)) {
    themeCoverage.get(themeId).add(tokenId);
  }
  if (!themeKinds.has(themeId)) themeKinds.set(themeId, packKind);
}

for (const [themeId, coverage] of themeCoverage) {
  const kind = themeKinds.get(themeId);
  if (kind === 'foundation') {
    for (const tokenId of tokenIds) {
      if (accentTokenIds.has(tokenId)) continue;
      if (!coverage.has(tokenId)) {
        hardFailures.push(`foundation pack ${themeId}: missing token value for ${tokenId}`);
      }
    }
    continue;
  }
  if (kind === 'density') {
    // Density packs (P-DESIGN-028) carry sizing/typography overrides only;
    // they must not redefine color/material/backdrop/radius/stroke/elevation/
    // motion values or any accent-layer token.
    for (const tokenId of coverage) {
      if (accentTokenIds.has(tokenId)) {
        hardFailures.push(`density pack ${themeId}: must not override accent-layer token ${tokenId}`);
        continue;
      }
      if (!tokenId.startsWith('sizing.') && !tokenId.startsWith('typography.')) {
        hardFailures.push(`density pack ${themeId}: token ${tokenId} is outside the admitted sizing.*/typography.* override scope`);
      }
    }
    continue;
  }
  for (const tokenId of accentTokenIds) {
    if (!coverage.has(tokenId)) {
      hardFailures.push(`accent pack ${themeId}: missing token value for ${tokenId}`);
    }
  }
}

const generatedThemesDir = path.join(repoRoot, 'kit', 'ui', 'src', 'generated', 'themes');
for (const legacyTheme of ['relay-dark.css', 'overtone-studio.css']) {
  if (fs.existsSync(path.join(generatedThemesDir, legacyTheme))) {
    hardFailures.push(`kit/ui/src/generated/themes/${legacyTheme}: legacy generated theme output must not exist`);
  }
}
const accentCssVars = new Set(
  tokenRows
    .filter((row) => String(row?.theme_layer || 'foundation').trim() === 'accent')
    .map((row) => String(row?.css_var || '').trim())
    .filter(Boolean),
);
for (const row of themeRows) {
  const themeId = String(row?.theme_id || '').trim();
  if (String(row?.pack_kind || '').trim() !== 'accent' || !themeId) continue;
  const rel = `kit/ui/src/generated/themes/${themeId}.css`;
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    hardFailures.push(`${rel}: generated accent theme output is missing`);
    continue;
  }
  const content = fs.readFileSync(abs, 'utf8');
  if (/@theme\s*\{/u.test(content)) {
    hardFailures.push(`${rel}: generated accent themes must not emit local @theme blocks`);
  }
  for (const match of content.matchAll(/^\s*(--[^:\s]+)\s*:/gmu)) {
    const property = String(match[1] || '').trim();
    if (!accentCssVars.has(property)) {
      hardFailures.push(`${rel}: generated accent theme emits non-table token ${property}`);
    }
  }
}

const designTokenFacade = read('kit/ui/src/design-tokens.ts');
if (/export\s+type\s+NimiAccentPack\s*=\s*['"]/u.test(designTokenFacade)) {
  hardFailures.push('kit/ui/src/design-tokens.ts: NimiAccentPack must be derived from generated ACCENT_PACK_IDS');
}
if (/export\s+const\s+NIMI_ACCENT_PACKS\s*=\s*\[/u.test(designTokenFacade)) {
  hardFailures.push('kit/ui/src/design-tokens.ts: NIMI_ACCENT_PACKS must be derived from generated ACCENT_PACK_IDS');
}

const handwrittenLibCss = read('kit/ui/src/styles.css');
const generatedSelectors = new Set();
for (const primitive of Array.isArray(primitivesTable?.primitives) ? primitivesTable.primitives : []) {
  for (const slot of Array.isArray(primitive?.slots) ? primitive.slots : []) {
    const className = String(slot?.class_name || '').trim();
    if (className) generatedSelectors.add(className);
  }
  const classGroups = primitive?.class_groups && typeof primitive.class_groups === 'object' ? primitive.class_groups : {};
  for (const entries of Object.values(classGroups)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const className = String(entry?.class_name || '').trim();
      if (className) generatedSelectors.add(className);
    }
  }
}
for (const selector of generatedSelectors) {
  const pattern = new RegExp(`(^|\\n)\\s*\\.${escapeRegex(selector)}[^\\n]*\\{`, 'u');
  if (pattern.test(handwrittenLibCss)) {
    hardFailures.push(`kit/ui/src/styles.css: generator-owned selector .${selector} must not be hand-authored`);
  }
}

const appCompositionTables = discoverAppKitTables('nimi-kit-compositions.yaml');
const compositionRows = [
  ...(Array.isArray(compositionsTable?.components) ? compositionsTable.components : []),
  ...appCompositionTables.flatMap(({ doc }) => (Array.isArray(doc?.components) ? doc.components : [])),
];

function extractComponentBlock(content, componentName) {
  const startPatterns = [
    new RegExp(`export\\s+const\\s+${escapeRegex(componentName)}\\b`, 'u'),
    new RegExp(`export\\s+function\\s+${escapeRegex(componentName)}\\b`, 'u'),
  ];
  let startIndex = -1;
  for (const pattern of startPatterns) {
    const match = pattern.exec(content);
    if (match) {
      startIndex = match.index;
      break;
    }
  }
  if (startIndex < 0) return '';

  const displayNamePattern = new RegExp(`${escapeRegex(componentName)}\\.displayName\\s*=`, 'u');
  const displayNameMatch = displayNamePattern.exec(content.slice(startIndex));
  if (displayNameMatch) {
    const endIndex = startIndex + displayNameMatch.index + displayNameMatch[0].length;
    return content.slice(startIndex, endIndex);
  }

  const nextExportPattern = /\nexport\s+(?:const|function)\s+/gu;
  nextExportPattern.lastIndex = startIndex + 1;
  const nextExportMatch = nextExportPattern.exec(content);
  return content.slice(startIndex, nextExportMatch ? nextExportMatch.index : content.length);
}

const compositionsByModule = new Map();
for (const row of compositionRows) {
  const relModule = String(row?.module || '').trim();
  if (!relModule) continue;
  if (!compositionsByModule.has(relModule)) compositionsByModule.set(relModule, []);
  compositionsByModule.get(relModule).push(row);
}
const exportedComponentPrefixesByModule = new Map();
for (const { doc } of appCompositionTables) {
  for (const item of Array.isArray(doc?.exported_component_prefixes) ? doc.exported_component_prefixes : []) {
    const relModule = String(item?.module || '').trim();
    const prefix = String(item?.prefix || '').trim();
    if (!relModule || !prefix) continue;
    if (!exportedComponentPrefixesByModule.has(relModule)) exportedComponentPrefixesByModule.set(relModule, []);
    exportedComponentPrefixesByModule.get(relModule).push(prefix);
  }
}

for (const [relModule, rows] of compositionsByModule) {
  const content = read(relModule);
  const importedSharedTargets = new Set(
    [...content.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@nimiplatform\/kit\/ui'/gu)]
      .flatMap((match) => String(match[1] || '').split(','))
      .map((part) => part.trim())
      .filter(Boolean),
  );

  const registeredComponents = new Set(rows.map((row) => String(row?.component || '').trim()).filter(Boolean));
  for (const prefix of exportedComponentPrefixesByModule.get(relModule) || []) {
    const exportedComponents = new Set(
      [...content.matchAll(new RegExp(`export\\s+(?:const|function)\\s+(${escapeRegex(prefix)}[A-Za-z0-9_]+)`, 'gu'))]
        .map((match) => String(match[1] || '').trim())
        .filter(Boolean),
    );
    for (const componentName of exportedComponents) {
      if (!registeredComponents.has(componentName)) {
        hardFailures.push(`${relModule}: exported composition ${componentName} must be registered in the app-local nimi-kit composition manifest`);
      }
    }
  }

  for (const row of rows) {
    const id = String(row?.id || '').trim();
    const componentName = String(row?.component || '').trim();
    const classification = String(row?.classification || '').trim();
    const sharedTargets = Array.isArray(row?.shared_targets) ? row.shared_targets.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const block = extractComponentBlock(content, componentName);
    if (!block) {
      hardFailures.push(`${relModule}: registered composition ${componentName} could not be resolved`);
      continue;
    }
    if (classification === 'thin_wrapper') {
      for (const target of sharedTargets) {
        if (!importedSharedTargets.has(target)) {
          hardFailures.push(`${relModule}: thin wrapper ${componentName} must import shared target ${target}`);
        }
      }
      if (!sharedTargets.some((target) => block.includes(`<${target}`))) {
        hardFailures.push(`${relModule}: thin wrapper ${componentName} must delegate directly to one of ${sharedTargets.join(', ')}`);
      }
      if (/\bot-[a-z0-9_-]+\b/u.test(block) || /\b(?:text|bg|border|shadow)-ot-/u.test(block)) {
        hardFailures.push(`${relModule}: thin wrapper ${componentName} must not define app-owned visual contract classes`);
      }
      if (/style=\{\{/u.test(block)) {
        hardFailures.push(`${relModule}: thin wrapper ${componentName} must not use inline visual style authority`);
      }
    }
  }
}


if (hardFailures.length > 0) {
  for (const failure of hardFailures) {
    console.error(`ERROR: ${failure}`);
  }
  process.exit(1);
}

console.log('nimi-ui-pattern: OK');
