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

function listFilesRecursively(dir, predicate) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(abs, predicate));
      continue;
    }
    if (!predicate || predicate(abs)) out.push(abs);
  }
  return out;
}

const tokensTable = readYaml('spec/platform/kernel/tables/nimi-ui-tokens.yaml');
const themesTable = readYaml('spec/platform/kernel/tables/nimi-ui-themes.yaml');
const adoptionTable = readYaml('spec/platform/kernel/tables/nimi-ui-adoption.yaml');
const compositionsTable = readYaml('spec/platform/kernel/tables/nimi-ui-compositions.yaml');
const allowlistsTable = readYaml('spec/platform/kernel/tables/nimi-ui-allowlists.yaml');
const primitivesTable = readYaml('spec/platform/kernel/tables/nimi-ui-primitives.yaml');

const hardFailures = [];
const tokenRows = Array.isArray(tokensTable?.tokens) ? tokensTable.tokens : [];
const tokenIds = new Set(tokenRows.map((row) => String(row?.id || '').trim()).filter(Boolean));
const accentTokenIds = new Set(
  tokenRows
    .filter((row) => String(row?.theme_layer || 'foundation').trim() === 'accent')
    .map((row) => String(row?.id || '').trim())
    .filter(Boolean),
);

const themeRows = Array.isArray(themesTable?.packs) ? themesTable.packs : [];
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
  for (const tokenId of accentTokenIds) {
    if (!coverage.has(tokenId)) {
      hardFailures.push(`accent pack ${themeId}: missing token value for ${tokenId}`);
    }
  }
}

const appEntries = [
  {
    app: 'desktop',
    styleRel: 'apps/desktop/src/shell/renderer/styles.css',
    mainRel: 'apps/desktop/src/shell/renderer/main.tsx',
  },
  {
    app: 'forge',
    styleRel: 'apps/forge/src/shell/renderer/styles.css',
    mainRel: 'apps/forge/src/shell/renderer/main.tsx',
  },
  {
    app: 'overtone',
    styleRel: 'apps/overtone/src/shell/renderer/styles.css',
    mainRel: 'apps/overtone/src/shell/renderer/main.tsx',
  },
];
const generatedThemesDir = path.join(repoRoot, 'kit', 'ui', 'src', 'generated', 'themes');
for (const legacyTheme of ['relay-dark.css', 'overtone-studio.css']) {
  if (fs.existsSync(path.join(generatedThemesDir, legacyTheme))) {
    hardFailures.push(`kit/ui/src/generated/themes/${legacyTheme}: legacy generated theme output must not exist`);
  }
}

const adoptionRows = Array.isArray(adoptionTable?.modules) ? adoptionTable.modules : [];
const accentPackByApp = new Map();
for (const row of adoptionRows) {
  const app = String(row?.app || '').trim();
  const accentPack = String(row?.accent_pack || '').trim();
  if (!app || !accentPack) continue;
  if (!accentPackByApp.has(app)) {
    accentPackByApp.set(app, accentPack);
  } else if (accentPackByApp.get(app) !== accentPack) {
    hardFailures.push(`adoption registry: app ${app} mixes multiple accent packs`);
  }
}

for (const entry of appEntries) {
  const styleContent = read(entry.styleRel);
  const accentPack = accentPackByApp.get(entry.app);
  if (!styleContent.includes('@nimiplatform/nimi-kit/ui/styles.css')) {
    hardFailures.push(`${entry.styleRel}: must import @nimiplatform/nimi-kit/ui/styles.css`);
  }
  for (const requiredImport of [
    '@nimiplatform/nimi-kit/ui/themes/light.css',
    '@nimiplatform/nimi-kit/ui/themes/dark.css',
    accentPack ? `@nimiplatform/nimi-kit/ui/themes/${accentPack}.css` : '',
  ].filter(Boolean)) {
    if (!styleContent.includes(requiredImport)) {
      hardFailures.push(`${entry.styleRel}: must import ${requiredImport}`);
    }
  }
  if (styleContent.includes('@nimiplatform/nimi-kit/ui/themes/relay-dark.css') || styleContent.includes('@nimiplatform/nimi-kit/ui/themes/overtone-studio.css')) {
    hardFailures.push(`${entry.styleRel}: must not import legacy app-specific theme packs`);
  }
  if (/@theme\s*\{/u.test(styleContent)) {
    hardFailures.push(`${entry.styleRel}: app styles must not define app-local @theme blocks`);
  }
  if (/:root\s*\{[\s\S]*--(?:ot|nimi)-/u.test(styleContent) || /:root\s*\{[\s\S]*--color-(?:mint|brand|bg-base)/u.test(styleContent)) {
    hardFailures.push(`${entry.styleRel}: app styles must not define app-local root token authority`);
  }
  if (/(^|\n)\s*\.nimi-[^\n]*\{/u.test(styleContent)) {
    hardFailures.push(`${entry.styleRel}: app styles must not redefine shared .nimi-* selectors`);
  }
  if (/--nimi-[a-z0-9-]+\s*:/u.test(styleContent)) {
    hardFailures.push(`${entry.styleRel}: app styles must not assign --nimi-* token values`);
  }
  if (/--ot-[a-z0-9-]+\b/u.test(styleContent) || /--color-ot-[a-z0-9-]+\b/u.test(styleContent)) {
    hardFailures.push(`${entry.styleRel}: app styles must not depend on phased-out overtone accent aliases`);
  }
  if (entry.app === 'desktop' && (styleContent.includes('--color-brand-') || styleContent.includes('--color-accent-'))) {
    hardFailures.push(`${entry.styleRel}: desktop governed styles must not depend on phased-out brand/accent aliases`);
  }

  const mainContent = read(entry.mainRel);
  if (!mainContent.includes('@nimiplatform/nimi-kit/ui') || !mainContent.includes('NimiThemeProvider')) {
    hardFailures.push(`${entry.mainRel}: must use NimiThemeProvider from @nimiplatform/nimi-kit/ui`);
  }
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

for (const rel of [
  'apps/overtone/src/shell/renderer/App.tsx',
  'apps/overtone/src/shell/renderer/app-shell/layouts/studio-layout.tsx',
  'apps/overtone/src/shell/renderer/styles.css',
]) {
  const content = read(rel);
  if (/--ot-[a-z0-9-]+\b/u.test(content) || /--color-ot-[a-z0-9-]+\b/u.test(content)) {
    hardFailures.push(`${rel}: shared chrome source must not use phased-out overtone accent aliases`);
  }
}

const allowlists = Array.isArray(allowlistsTable?.items) ? allowlistsTable.items : [];
const compositionRows = Array.isArray(compositionsTable?.components) ? compositionsTable.components : [];

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

function scopeAllows(relPath, propertyName) {
  return allowlists.some((item) => {
    const scope = String(item?.scope || '').trim();
    const pattern = String(item?.pattern || '').trim();
    if (!scope || !pattern) return false;
    const scopeParts = scope.split(/\s+/u).filter(Boolean);
    if (!scopeParts.some((part) => relPath.startsWith(part))) return false;
    return new RegExp(pattern, 'u').test(propertyName);
  });
}

for (const row of adoptionRows) {
  const rel = String(row?.module || '').trim();
  const exceptionPolicy = String(row?.exception_policy || '').trim();
  if (!rel || exceptionPolicy === 'controlled_exception') {
    continue;
  }
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    hardFailures.push(`${rel}: governed module missing`);
    continue;
  }
  const content = read(rel);
  if (!content.includes('@nimiplatform/nimi-kit/ui')) {
    hardFailures.push(`${rel}: governed module must import @nimiplatform/nimi-kit/ui`);
  }
  if (Boolean(row?.testid_required) && !content.includes('data-testid') && !content.includes('E2E_IDS.')) {
    hardFailures.push(`${rel}: governed module requires stable testid coverage`);
  }
  for (const pattern of ['bg-[#', 'text-[#', 'border-[#', 'rounded-[']) {
    if (content.includes(pattern)) {
      hardFailures.push(`${rel}: raw visual token pattern "${pattern}" is forbidden in governed modules`);
    }
  }
  if (content.includes('#') && /#[0-9a-fA-F]{3,8}/u.test(content)) {
    hardFailures.push(`${rel}: raw hex colors are forbidden in governed modules`);
  }
  if (content.includes('style={{')) {
    const styleProps = [...content.matchAll(/style=\{\{([^}]*)\}\}/gu)].flatMap((match) =>
      String(match[1] || '')
        .split(',')
        .map((part) => part.split(':')[0]?.trim())
        .filter(Boolean),
    );
    for (const prop of styleProps) {
      if (!scopeAllows(rel, prop)) {
        hardFailures.push(`${rel}: inline style property "${prop}" is forbidden outside allowlists`);
      }
    }
  }
}

const compositionsByModule = new Map();
for (const row of compositionRows) {
  const relModule = String(row?.module || '').trim();
  if (!relModule) continue;
  if (!compositionsByModule.has(relModule)) compositionsByModule.set(relModule, []);
  compositionsByModule.get(relModule).push(row);
}

for (const [relModule, rows] of compositionsByModule) {
  const content = read(relModule);
  const importedSharedTargets = new Set(
    [...content.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@nimiplatform\/nimi-kit\/ui'/gu)]
      .flatMap((match) => String(match[1] || '').split(','))
      .map((part) => part.trim())
      .filter(Boolean),
  );

  const overtoneExports = new Set(
    [...content.matchAll(/export\s+(?:const|function)\s+(Ot[A-Za-z0-9_]+)/gu)]
      .map((match) => String(match[1] || '').trim())
      .filter(Boolean),
  );
  const registeredComponents = new Set(rows.map((row) => String(row?.component || '').trim()).filter(Boolean));
  for (const componentName of overtoneExports) {
    if (!registeredComponents.has(componentName)) {
      hardFailures.push(`${relModule}: exported composition ${componentName} must be registered in nimi-ui-compositions.yaml`);
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

for (const docRel of ['apps/overtone/design.md']) {
  if (!fs.existsSync(path.join(repoRoot, docRel))) continue;
  const content = read(docRel);
  if (/\bdesign\b/i.test(content) && !content.includes('P-DESIGN-')) {
    hardFailures.push(`${docRel}: app-local design authority docs must reference P-DESIGN-*`);
  }
}

const overtoneRendererRoot = path.join(repoRoot, 'apps/overtone/src/shell/renderer');
if (fs.existsSync(overtoneRendererRoot)) {
  const overtoneFiles = listFilesRecursively(
    overtoneRendererRoot,
    (abs) => /\.(?:ts|tsx|css)$/u.test(abs) && !/\.test\./u.test(abs),
  );
  for (const abs of overtoneFiles) {
    const rel = path.relative(repoRoot, abs).replace(/\\/gu, '/');
    const content = fs.readFileSync(abs, 'utf8');
    if (/\bot-btn-(?:primary|secondary|tertiary|icon)\b/u.test(content)) {
      hardFailures.push(`${rel}: legacy Overtone action authority classes are forbidden; use OtButton or shared action primitives`);
    }
    if (/\bot-input(?!-)\b/u.test(content)) {
      hardFailures.push(`${rel}: legacy Overtone field authority class "ot-input" is forbidden; use OtInput or shared field primitives`);
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
