#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.cwd();
const tablesDir = path.join(repoRoot, 'config');
const kitDesignPath = path.join(repoRoot, 'kit', 'DESIGN.md');
const rootDesignPath = path.join(repoRoot, 'DESIGN.md');
const kitFullProjectionPath = path.join(repoRoot, 'kit', 'design-projection.json');
const kitDesignTokensPath = path.join(repoRoot, 'kit', 'design_tokens.json');
const kitTailwindThemePath = path.join(repoRoot, 'kit', 'tailwind-theme.css');
const deprecatedKitTailwindConfigPath = path.join(repoRoot, 'kit', 'tailwind.config.js');

const SPEC_SOURCE_RELS = [
  'config/platform-nimi-ui-tokens.yaml',
  'config/platform-nimi-ui-themes.yaml',
  'config/platform-nimi-ui-primitives.yaml',
  'config/platform-nimi-ui-primitives/*.yaml',
  'config/platform-nimi-ui-compositions.yaml',
  'config/platform-nimi-kit-registry.yaml',
];

function repoRel(absPath) {
  return path.relative(repoRoot, absPath).replaceAll(path.sep, '/');
}

async function readYamlRel(rel) {
  const raw = await fs.readFile(path.join(repoRoot, rel), 'utf8');
  return YAML.parse(raw) ?? {};
}

async function readYamlOptionalRel(rel, fallback) {
  try {
    return await readYamlRel(rel);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toKebab(value) {
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[._\s/]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function toTitle(value) {
  return String(value || '')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function quoteTokenRef(group, key) {
  return `{${group}.${key}}`;
}

function plainScalar(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  if (/^-?\d+(?:\.\d+)?$/u.test(text)) {
    return Number(text);
  }
  return text;
}

function isColorLike(value) {
  const text = String(value ?? '').trim();
  return /^(#(?:[0-9a-f]{3,8})|rgba?\(|hsla?\(|hwb\(|oklch\(|oklab\(|lch\(|lab\(|color-mix\(|transparent$|currentColor$)/iu.test(text);
}

function isDimensionLike(value) {
  return /^-?\d+(?:\.\d+)?(?:px|rem|em|%)$/iu.test(String(value ?? '').trim());
}

function tokenRows(tokensDoc) {
  return normalizeArray(tokensDoc?.tokens).filter((token) => String(token?.id || '').trim());
}

function themePacks(themesDoc) {
  return normalizeArray(themesDoc?.packs).filter((pack) => String(pack?.theme_id || '').trim());
}

function packValues(pack) {
  return normalizeObject(pack?.values);
}

function firstPackValue(packs, tokenId, preferredKinds = []) {
  const ordered = [
    ...packs.filter((pack) => preferredKinds.includes(String(pack?.pack_kind || ''))),
    ...packs.filter((pack) => !preferredKinds.includes(String(pack?.pack_kind || ''))),
  ];
  for (const pack of ordered) {
    const values = packValues(pack);
    if (Object.prototype.hasOwnProperty.call(values, tokenId)) {
      return values[tokenId];
    }
  }
  return undefined;
}

function buildTokenIndex(tokens) {
  const byId = new Map();
  const byCssVar = new Map();
  for (const token of tokens) {
    const id = String(token.id);
    byId.set(id, token);
    const cssVar = String(token.css_var || '').trim();
    if (cssVar) byCssVar.set(cssVar, token);
  }
  return { byId, byCssVar };
}

async function loadPrimitiveRows(primitivesDoc) {
  const direct = normalizeArray(primitivesDoc?.primitives);
  let fragmentRels = normalizeArray(primitivesDoc?.fragments?.primitives);
  if (fragmentRels.length === 0) {
    fragmentRels = await discoverPrimitiveFragmentRels();
  }
  const fragments = [];
  for (const fragmentRel of fragmentRels) {
    const normalizedRel = normalizeFragmentRel(fragmentRel);
    const doc = await readYamlRel(normalizedRel);
    fragments.push(...normalizeArray(doc?.primitives));
  }
  return [...direct, ...fragments].filter((primitive) => String(primitive?.id || '').trim());
}

async function discoverPrimitiveFragmentRels() {
  const dir = path.join(tablesDir, 'platform-nimi-ui-primitives');
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/iu.test(entry.name))
    .map((entry) => repoRel(path.join(dir, entry.name)))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeFragmentRel(fragmentRel) {
  const rel = String(fragmentRel || '').trim().replaceAll('\\', '/');
  if (!rel) return rel;
  if (rel.startsWith('.nimi/') || rel.startsWith('apps/') || rel.startsWith('kit/') || rel.startsWith('config/')) {
    return rel;
  }
  return path.posix.join('config', rel);
}

function buildOfficialColors(tokens, packs) {
  const colors = {};
  const tokenIds = new Set(tokens.map((token) => String(token.id)));
  const aliases = {
    primary: 'action.primary_bg',
    'primary-hover': 'action.primary_bg_hover',
    'on-primary': 'action.primary_text',
    secondary: 'text.secondary',
    neutral: 'surface.app_background',
    surface: 'surface.card',
    'surface-panel': 'surface.panel',
    danger: 'status.danger',
    success: 'status.success',
    warning: 'status.warning',
    info: 'status.info',
  };
  for (const [alias, tokenId] of Object.entries(aliases)) {
    if (!tokenIds.has(tokenId)) continue;
    const value = firstPackValue(packs, tokenId, ['foundation', 'accent']);
    if (isColorLike(value) && !String(value).includes('var(')) {
      colors[alias] = String(value).trim();
    }
  }
  return sortObject(colors);
}

function buildTypography(tokens, packs) {
  const lightValues = packValues(packs.find((pack) => String(pack?.theme_id) === 'nimi-light') ?? packs[0] ?? {});
  const roles = new Map();
  const fontSans = lightValues['typography.font_sans'];
  const fontMono = lightValues['typography.font_mono'];

  for (const token of tokens) {
    const id = String(token.id);
    const match = id.match(/^typography\.([a-z0-9_]+)\.(size|line_height|weight|letter_spacing)$/u);
    if (!match) continue;
    const [, role, property] = match;
    const key = toKebab(role);
    const target = roles.get(key) ?? {};
    const value = lightValues[id] ?? firstPackValue(packs, id, ['foundation']);
    if (value === undefined || value === null) continue;
    if (!target.fontFamily) {
      target.fontFamily = role === 'mono' && fontMono ? String(fontMono) : String(fontSans || 'system-ui, sans-serif');
    }
    if (property === 'size') target.fontSize = plainScalar(value);
    if (property === 'line_height') target.lineHeight = plainScalar(value);
    if (property === 'weight') target.fontWeight = plainScalar(value);
    if (property === 'letter_spacing') target.letterSpacing = plainScalar(value);
    roles.set(key, target);
  }

  return sortObject(Object.fromEntries([...roles.entries()].sort(([left], [right]) => left.localeCompare(right))));
}

function buildScale(tokens, packs, prefix) {
  const scale = {};
  for (const token of tokens) {
    const id = String(token.id);
    if (!id.startsWith(`${prefix}.`)) continue;
    const value = firstPackValue(packs, id, ['foundation']);
    if (value === undefined || value === null) continue;
    const key = toKebab(id.slice(prefix.length + 1));
    scale[key] = plainScalar(value);
  }
  return sortObject(scale);
}

function cssVarToTokenReference(cssValue, tokenIndex, groupKeyByTokenId) {
  const match = String(cssValue ?? '').match(/var\((--[a-zA-Z0-9_-]+)\)/u);
  if (!match) return null;
  const token = tokenIndex.byCssVar.get(match[1]);
  if (!token) return null;
  const ref = groupKeyByTokenId.get(String(token.id));
  return ref ? quoteTokenRef(ref.group, ref.key) : null;
}

function componentPropForStyle(styleKey) {
  const key = String(styleKey || '').toLowerCase();
  if (key === 'background' || key === 'background-color') return 'backgroundColor';
  if (key === 'color') return 'textColor';
  if (key === 'border-radius') return 'rounded';
  if (key === 'padding' || key === 'padding-inline') return 'padding';
  if (key === 'min-height' || key === 'height') return 'height';
  if (key === 'width') return 'width';
  if (key === 'font-size') return 'typography';
  return null;
}

function addStyleRefs(entry, styles, tokenIndex, groupKeyByTokenId) {
  for (const [styleKey, value] of Object.entries(normalizeObject(styles))) {
    const prop = componentPropForStyle(styleKey);
    if (!prop) continue;
    let ref = cssVarToTokenReference(value, tokenIndex, groupKeyByTokenId);
    if (!ref) continue;
    if (styleKey === 'font-size') {
      ref = ref.replace(/\.size\}$/u, '}');
    }
    entry[prop] = ref;
  }
}

function mergeComponentEntry(components, key, entry) {
  if (Object.keys(entry).length === 0) return;
  components[key] = sortObject({
    ...normalizeObject(components[key]),
    ...entry,
  });
}

function buildGroupKeyIndex(tokens, colors, typography, rounded, spacing) {
  const index = new Map();
  const colorAliases = {
    'action.primary_bg': 'primary',
    'action.primary_bg_hover': 'primary-hover',
    'action.primary_text': 'on-primary',
    'text.secondary': 'secondary',
    'surface.app_background': 'neutral',
    'surface.card': 'surface',
    'surface.panel': 'surface-panel',
    'status.danger': 'danger',
    'status.success': 'success',
    'status.warning': 'warning',
    'status.info': 'info',
  };
  const register = (tokenPrefix, group, keys) => {
    for (const key of Object.keys(keys)) {
      index.set(`${tokenPrefix}.${key.replaceAll('-', '_')}`, { group, key });
    }
  };

  for (const token of tokens) {
    const id = String(token.id);
    const alias = colorAliases[id];
    if (alias && Object.prototype.hasOwnProperty.call(colors, alias)) {
      index.set(id, { group: 'colors', key: alias });
    }
    const kebab = toKebab(id);
    if (Object.prototype.hasOwnProperty.call(colors, kebab)) index.set(id, { group: 'colors', key: kebab });
    if (id.startsWith('radius.')) {
      const key = toKebab(id.slice('radius.'.length));
      if (Object.prototype.hasOwnProperty.call(rounded, key)) index.set(id, { group: 'rounded', key });
    }
    if (id.startsWith('spacing.')) {
      const key = toKebab(id.slice('spacing.'.length));
      if (Object.prototype.hasOwnProperty.call(spacing, key)) index.set(id, { group: 'spacing', key });
    }
  }

  register('typography', 'typography', typography);
  return index;
}

function buildOfficialComponents(primitives, tokenIndex, groupKeyByTokenId) {
  const components = {};
  for (const primitive of primitives) {
    const component = String(primitive?.component || primitive?.family || primitive?.id || '').trim();
    if (!component) continue;
    const key = toKebab(component);

    for (const slot of normalizeArray(primitive?.slots)) {
      const slotId = String(slot?.id || '').trim();
      const entry = {};
      addStyleRefs(entry, slot?.styles, tokenIndex, groupKeyByTokenId);
      mergeComponentEntry(
        components,
        slotId && slotId !== 'root' ? `${key}-slot-${toKebab(slotId)}` : key,
        entry,
      );
    }

    for (const [group, rows] of Object.entries(normalizeObject(primitive?.class_groups))) {
      for (const row of normalizeArray(rows)) {
        const rowId = String(row?.id || '').trim();
        const entry = {};
        addStyleRefs(entry, row?.styles, tokenIndex, groupKeyByTokenId);
        mergeComponentEntry(components, `${key}-${toKebab(group)}${rowId ? `-${toKebab(rowId)}` : ''}`, entry);
      }
    }
  }
  return sortObject(components);
}

function buildNimiTokenExtension(tokens, packs) {
  const byCategory = {};
  for (const token of tokens) {
    const id = String(token.id);
    const category = String(token.category || id.split('.')[0] || 'token');
    const valueByTheme = {};
    for (const pack of packs) {
      const values = packValues(pack);
      if (Object.prototype.hasOwnProperty.call(values, id)) {
        valueByTheme[String(pack.theme_id)] = plainScalar(values[id]);
      }
    }
    const entry = {
      cssVar: String(token.css_var || ''),
      primitiveFamily: String(token.primitive_family || ''),
      themeLayer: String(token.theme_layer || ''),
      sourceRule: String(token.source_rule || ''),
      values: sortObject(valueByTheme),
    };
    if (!byCategory[category]) byCategory[category] = {};
    byCategory[category][id] = entry;
  }
  return sortObject(Object.fromEntries(
    Object.entries(byCategory)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, entries]) => [category, sortObject(entries)]),
  ));
}

function buildPrimitiveStandards(primitives) {
  return primitives
    .map((primitive) => {
      const slots = normalizeArray(primitive?.slots).map((slot) => ({
        id: String(slot?.id || ''),
        className: String(slot?.class_name || ''),
      })).filter((slot) => slot.id || slot.className);
      const variants = {};
      for (const [group, rows] of Object.entries(normalizeObject(primitive?.class_groups))) {
        variants[group] = normalizeArray(rows)
          .map((row) => ({
            id: String(row?.id || ''),
            className: String(row?.class_name || ''),
            selector: String(row?.selector || ''),
          }))
          .filter((row) => row.id || row.className || row.selector);
      }
      return {
        id: String(primitive.id),
        family: String(primitive.family || ''),
        component: String(primitive.component || ''),
        sourceRule: String(primitive.source_rule || ''),
        slots,
        variants: sortObject(variants),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function yamlBlock(value) {
  return YAML.stringify(value, {
    lineWidth: 0,
    aliasDuplicateObjects: false,
  }).trimEnd();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function renderFrontMatter({
  tokensDoc,
  themesDoc,
  primitivesDoc,
  kitRegistry,
  compositionsDoc,
  primitives,
}) {
  const tokens = tokenRows(tokensDoc);
  const packs = themePacks(themesDoc);
  const tokenIndex = buildTokenIndex(tokens);
  const colors = buildOfficialColors(tokens, packs);
  const typography = buildTypography(tokens, packs);
  const rounded = buildScale(tokens, packs, 'radius');
  const spacing = buildScale(tokens, packs, 'spacing');
  const groupKeyByTokenId = buildGroupKeyIndex(tokens, colors, typography, rounded, spacing);
  const components = buildOfficialComponents(primitives, tokenIndex, groupKeyByTokenId);
  const kitUiModule = normalizeArray(kitRegistry?.modules).find((module) => String(module?.id) === 'kit.ui') ?? {};

  return {
    name: 'Nimi Kit Design System',
    version: 'alpha',
    description: 'Spec-derived DESIGN.md projection for Nimi Kit UI/UX agents and drift gates.',
    systemVersion: 1,
    designVersion: Number(tokensDoc?.version || themesDoc?.version || primitivesDoc?.version || 1),
    authority: {
      owner: 'platform',
      canonical: '.nimi/spec/platform/ui-design-system.authority.yaml',
      projection: 'kit/DESIGN.md',
      generatedBy: 'scripts/generate-nimi-design-md.mjs',
      writeCommand: 'node scripts/generate-nimi-design-md.mjs --write',
      checkCommand: 'node scripts/generate-nimi-design-md.mjs --check',
    },
    sources: SPEC_SOURCE_RELS,
    colors,
    typography,
    rounded,
    spacing,
    components,
    tokens: {
      colors: clone(colors),
      typography: clone(typography),
      rounded: clone(rounded),
      spacing: clone(spacing),
      all: buildNimiTokenExtension(tokens, packs),
    },
    componentStandards: {
      primitives: buildPrimitiveStandards(primitives),
      kitUi: {
        description: String(kitUiModule.description || ''),
        sourceRule: String(kitUiModule.source_rule || ''),
        exports: normalizeArray(kitUiModule.exports).map(String),
      },
      compositions: normalizeArray(compositionsDoc?.components),
      densityModes: normalizeArray(compositionsDoc?.density_modes),
    },
  };
}

function compactColorsForComponents(colors, components) {
  const usedColors = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      const match = value.match(/^\{colors\.([^}]+)\}$/u);
      if (match) usedColors.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };

  visit(components);
  return sortObject(
    Object.fromEntries(
      Object.entries(normalizeObject(colors)).filter(([key]) => usedColors.has(key)),
    ),
  );
}

function renderCompactFrontMatter(fullProjection) {
  return {
    name: fullProjection.name,
    version: fullProjection.version,
    description: fullProjection.description,
    systemVersion: fullProjection.systemVersion,
    designVersion: fullProjection.designVersion,
    authority: fullProjection.authority,
    sources: fullProjection.sources,
    colors: compactColorsForComponents(fullProjection.colors, fullProjection.components),
    typography: clone(fullProjection.typography),
    rounded: clone(fullProjection.rounded),
    spacing: clone(fullProjection.spacing),
    components: clone(fullProjection.components),
    artifacts: {
      designTokens: 'kit/design_tokens.json',
      fullProjection: 'kit/design-projection.json',
      tailwindTheme: 'kit/tailwind-theme.css',
      runtimeCss: 'kit/ui/src/generated/theme-base.css',
    },
  };
}

function renderMarkdownBody(frontMatter) {
  const primitiveRows = normalizeArray(frontMatter.componentStandards?.primitives);
  const densityRows = normalizeArray(frontMatter.componentStandards?.densityModes);
  const colors = normalizeObject(frontMatter.colors);
  const typography = normalizeObject(frontMatter.typography);
  const spacing = normalizeObject(frontMatter.spacing);
  const rounded = normalizeObject(frontMatter.rounded);
  const components = normalizeObject(frontMatter.components);
  const colorLines = Object.entries(colors).slice(0, 18).map(([key, value]) => `- **${key}** (${value}): projected from Nimi semantic UI tokens.`);
  const typographyLines = Object.entries(typography).map(([key, value]) => {
    const parts = [
      value.fontFamily ? `family ${inlineCode(value.fontFamily)}` : '',
      value.fontSize ? `size ${inlineCode(value.fontSize)}` : '',
      value.fontWeight ? `weight ${inlineCode(value.fontWeight)}` : '',
      value.lineHeight ? `line height ${inlineCode(value.lineHeight)}` : '',
      value.letterSpacing !== undefined ? `tracking ${inlineCode(value.letterSpacing)}` : '',
    ].filter(Boolean);
    return `- **${key}:** ${parts.join(', ')}.`;
  });
  const componentLines = primitiveRows.map((primitive) => {
    const variants = Object.entries(normalizeObject(primitive.variants))
      .map(([group, rows]) => `${group}:${normalizeArray(rows).length}`)
      .join(', ');
    const suffix = variants ? `; variants ${variants}` : '';
    return `- \`${primitive.component || primitive.id}\` (\`${primitive.id}\`): family \`${primitive.family}\`, source \`${primitive.sourceRule}\`${suffix}.`;
  });

  return [
    '# Nimi Kit Design System',
    '',
    '> AUTO-GENERATED by `scripts/generate-nimi-design-md.mjs`. Do not edit directly.',
    '> Canonical authority remains `.nimi/spec/platform/ui-design-system.authority.yaml`; this file is the AI-readable DESIGN.md projection.',
    '',
    '## Overview',
    '',
    'Nimi Kit is the shared UI foundation for Nimi apps. It projects platform-owned semantic tokens, primitive contracts, and component usage rules into a compact DESIGN.md file that coding agents and design tools can read before touching UI/UX surfaces.',
    '',
    'The product posture is industrial-grade, dense where needed, and explicit about ownership: app UI should consume Kit primitives first, extend Kit when a reusable primitive is missing, and avoid app-local design truth for shared interaction patterns.',
    '',
    '## Density',
    '',
    'Density modes are canonical composition guidance from `nimi-ui-compositions.yaml`. Desktop operational surfaces default to compact density; regular density remains the Kit primitive baseline; expressive density is opt-in for identity/content presentation only.',
    '',
    ...densityRows.flatMap(renderDensityCompositionLines),
    ...(densityRows.length ? [] : ['- No density modes are currently admitted.']),
    '',
    '## Colors',
    '',
    'Colors come from `nimi-ui-tokens.yaml` and `nimi-ui-themes.yaml`. The front matter exposes Google DESIGN.md-compatible `colors` using the default foundation/accent values. `kit/design-projection.json` preserves every original Nimi token id, CSS variable, theme layer, source rule, and per-theme value.',
    '',
    ...colorLines,
    '',
    '## Typography',
    '',
    'Typography roles use semantic Nimi token ids and preserve CJK-specific line-height/tracking in the extension token map. UI agents should choose the smallest role that fits the surface and keep dense operational panels below hero-scale type.',
    '',
    ...typographyLines,
    '',
    '## Layout',
    '',
    'Layout uses the Nimi spacing scale, not ad hoc pixel values. Reusable page shells, galleries, settings panels, tables, form rows, and overlays must be composed from Kit primitives and documented compositions before app-local layout rules are added.',
    '',
    ...Object.entries(spacing).map(([key, value]) => `- \`${key}\`: ${inlineCode(value)}`),
    '',
    '## Elevation & Depth',
    '',
    'Depth is conveyed through explicit semantic elevation and material tokens. Glass treatments are admitted only through Kit material primitives and must preserve contrast, reduced-transparency states, and stable borders.',
    '',
    ...Object.entries(frontMatter.tokens?.all?.elevation ?? {}).map(([key, value]) => `- \`${key}\`: ${inlineCode(Object.values(value.values ?? {})[0] ?? '')}`),
    '',
    '## Shapes',
    '',
    'Shape language is tokenized through `radius.*`. Components must use the rounded scale from front matter rather than local radius literals.',
    '',
    ...Object.entries(rounded).map(([key, value]) => `- \`${key}\`: ${inlineCode(value)}`),
    '',
    '## Components',
    '',
    'Components map the Google DESIGN.md `components` object to the admitted Nimi primitive catalog. The richer `kit/design-projection.json` keeps slots, classes, variant groups, and source rules for precise implementation.',
    '',
    ...componentLines,
    '',
    'Official component token aliases:',
    '',
    ...Object.entries(components).map(([key, value]) => `- \`${key}\`: ${Object.entries(value).map(([prop, propValue]) => `${prop} ${inlineCode(propValue)}`).join(', ') || 'see componentStandards extension'}.`),
    '',
    "## Do's and Don'ts",
    '',
    '- Do consume `@nimiplatform/kit/ui` primitives before creating app-local UI chrome.',
    '- Do default Desktop operational surfaces to compact density unless a spec-admitted composition says otherwise.',
    '- Do require an explicit expressive-density boundary before using hero-scale type, large card radii, or cinematic spacing.',
    '- Do update `config/platform-nimi-ui-*.yaml` first when the design tables change.',
    '- Do regenerate this projection with `node scripts/generate-nimi-design-md.mjs --write` after admitted spec changes.',
    '- Do verify drift with `node scripts/generate-nimi-design-md.mjs --check` and the relevant Kit gates.',
    '- Do use `kit/design_tokens.json` and `kit/tailwind-theme.css` for Google-style tool interoperability adapted to Tailwind v4.',
    '- Don\'t hand-edit `kit/DESIGN.md` or root `DESIGN.md`.',
    '- Don\'t treat `kit/design_tokens.json` or `kit/tailwind-theme.css` as runtime authority; Nimi runtime CSS is still generated from `.nimi/spec` through `generate-nimi-ui-lib.mjs`.',
    '- Don\'t create app-local token, radius, spacing, glass, or primitive truth for shared Nimi surfaces.',
    '- Don\'t use expressive scale for runtime failure, setup, repair, blocked, diagnostics, settings, developer tools, or runtime configuration surfaces.',
    '- Don\'t treat this file as stronger than `.nimi/spec/platform/ui-design-system.authority.yaml`; it is a generated projection.',
    '',
  ].join('\n');
}

function formatList(value) {
  const rows = normalizeArray(value).map((item) => String(item || '').trim()).filter(Boolean);
  return rows.length ? rows.join('; ') : '';
}

function formatDensityRecord(value) {
  const object = normalizeObject(value);
  const entries = Object.entries(object)
    .map(([key, item]) => `${toKebab(key)} ${inlineCode(Array.isArray(item) ? item.join(', ') : item)}`);
  return entries.join(', ');
}

function renderDensityCompositionLines(composition) {
  const title = String(composition?.title || composition?.id || '').trim();
  const intent = String(composition?.intent || '').trim();
  const useFor = formatList(composition?.use_for);
  const avoidFor = formatList(composition?.avoid_for);
  const lines = [`- **${title}:** ${intent}`];
  if (useFor) lines.push(`  - Use for: ${useFor}.`);
  if (avoidFor) lines.push(`  - Avoid for: ${avoidFor}.`);
  for (const key of ['typography', 'shape', 'spacing', 'controls', 'motion', 'admission']) {
    const detail = formatDensityRecord(composition?.[key]);
    if (detail) lines.push(`  - ${toTitle(key)}: ${detail}.`);
  }
  return lines;
}

function inlineCode(value) {
  return `\`${String(value).replaceAll('`', "'")}\``;
}

function renderKitDesign(fullProjection) {
  const frontMatter = renderCompactFrontMatter(fullProjection);
  return [
    '---',
    yamlBlock(frontMatter),
    '---',
    '',
    renderMarkdownBody(fullProjection),
  ].join('\n');
}

function renderRootDesign(frontMatter) {
  const rootFrontMatter = {
    name: 'Nimi Design Projection',
    version: 'alpha',
    description: 'Repository entrypoint for the generated Nimi Kit DESIGN.md projection.',
    authority: frontMatter.authority,
    sources: frontMatter.sources,
    projection: {
      target: 'kit/DESIGN.md',
      kind: 'entrypoint',
    },
    artifacts: {
      designTokens: 'kit/design_tokens.json',
      fullProjection: 'kit/design-projection.json',
      tailwindTheme: 'kit/tailwind-theme.css',
    },
  };
  return [
    '---',
    yamlBlock(rootFrontMatter),
    '---',
    '',
    '# Nimi Design Projection',
    '',
    '> AUTO-GENERATED by `scripts/generate-nimi-design-md.mjs`. Do not edit directly.',
    '',
    'The compact UI/UX design projection for coding agents is [kit/DESIGN.md](kit/DESIGN.md). Machine-readable artifacts live next to it: [kit/design_tokens.json](kit/design_tokens.json), [kit/design-projection.json](kit/design-projection.json), and [kit/tailwind-theme.css](kit/tailwind-theme.css).',
    '',
    'Canonical authority remains `.nimi/spec/platform/ui-design-system.authority.yaml`; this root file exists so tools that look for repository-level `DESIGN.md` can discover the Kit projection without inventing a second design source.',
    '',
    '## Overview',
    '',
    'Use `kit/DESIGN.md` before creating or changing Nimi UI. If the desired behavior is not represented there, update the platform spec tables first and regenerate the projection.',
    '',
    "## Do's and Don'ts",
    '',
    '- Do read `kit/DESIGN.md` for complete tokens, components, and guardrails.',
    '- Do treat `.nimi/spec/platform/ui-design-system.authority.yaml` as canonical authority.',
    '- Do regenerate all design artifacts from the same script after admitted spec changes.',
    '- Don\'t hand-edit generated DESIGN.md files.',
    '',
  ].join('\n');
}

function toDtcgDesignTokens(fullProjection) {
  const colorTokens = {};
  for (const [key, value] of Object.entries(normalizeObject(fullProjection.colors))) {
    colorTokens[key] = {
      $type: 'color',
      $value: value,
    };
  }

  const typographyTokens = {};
  for (const [key, value] of Object.entries(normalizeObject(fullProjection.typography))) {
    typographyTokens[key] = {
      $type: 'typography',
      $value: clone(value),
    };
  }

  const roundedTokens = {};
  for (const [key, value] of Object.entries(normalizeObject(fullProjection.rounded))) {
    roundedTokens[key] = {
      $type: 'dimension',
      $value: value,
    };
  }

  const spacingTokens = {};
  for (const [key, value] of Object.entries(normalizeObject(fullProjection.spacing))) {
    spacingTokens[key] = {
      $type: 'dimension',
      $value: value,
    };
  }

  const componentTokens = {};
  for (const [component, props] of Object.entries(normalizeObject(fullProjection.components))) {
    componentTokens[component] = Object.fromEntries(
      Object.entries(normalizeObject(props)).map(([prop, value]) => [
        prop,
        {
          $type: 'string',
          $value: value,
        },
      ]),
    );
  }

  return {
    name: {
      $type: 'string',
      $value: fullProjection.name,
    },
    colors: colorTokens,
    typography: typographyTokens,
    rounded: roundedTokens,
    spacing: spacingTokens,
    components: componentTokens,
    nimi: {
      $type: 'object',
      $value: {
        canonical: fullProjection.authority?.canonical,
        projection: fullProjection.authority?.projection,
        fullProjection: 'kit/design-projection.json',
      },
    },
  };
}

function cssThemeLine(name, value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return `  ${name}: ${text};`;
}

function renderTailwindThemeCss(fullProjection) {
  const lines = [
    '/* AUTO-GENERATED by scripts/generate-nimi-design-md.mjs. DO NOT EDIT. */',
    '/* Source: config/platform-nimi-ui-*.yaml */',
    '/* Tailwind v4 CSS-first theme projection for tooling and audits; runtime CSS remains kit/ui/src/generated. */',
    '',
    '@theme {',
  ];

  for (const [key, value] of Object.entries(normalizeObject(fullProjection.colors))) {
    lines.push(cssThemeLine(`--color-${toKebab(key)}`, value));
  }

  for (const [key, value] of Object.entries(normalizeObject(fullProjection.typography))) {
    const token = toKebab(key);
    lines.push(cssThemeLine(`--font-${token}`, value?.fontFamily));
    lines.push(cssThemeLine(`--text-${token}`, value?.fontSize));
    lines.push(cssThemeLine(`--text-${token}--line-height`, value?.lineHeight));
    lines.push(cssThemeLine(`--text-${token}--letter-spacing`, value?.letterSpacing));
    lines.push(cssThemeLine(`--text-${token}--font-weight`, value?.fontWeight));
  }

  for (const [key, value] of Object.entries(normalizeObject(fullProjection.rounded))) {
    lines.push(cssThemeLine(`--radius-${toKebab(key)}`, value));
  }

  for (const [key, value] of Object.entries(normalizeObject(fullProjection.spacing))) {
    lines.push(cssThemeLine(`--spacing-${toKebab(key)}`, value));
  }

  lines.push('}', '');
  return `${lines.filter((line) => line !== null).join('\n')}`;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function loadProjectionInputs() {
  const tokensDoc = await readYamlRel('config/platform-nimi-ui-tokens.yaml');
  const themesDoc = await readYamlRel('config/platform-nimi-ui-themes.yaml');
  const primitivesDoc = await readYamlRel('config/platform-nimi-ui-primitives.yaml');
  const compositionsDoc = await readYamlOptionalRel('config/platform-nimi-ui-compositions.yaml', { components: [] });
  const kitRegistry = await readYamlRel('config/platform-nimi-kit-registry.yaml');
  const primitives = await loadPrimitiveRows(primitivesDoc);
  return {
    tokensDoc,
    themesDoc,
    primitivesDoc,
    compositionsDoc,
    kitRegistry,
    primitives,
  };
}

async function buildProjection() {
  const inputs = await loadProjectionInputs();
  const frontMatter = renderFrontMatter(inputs);
  return {
    kit: renderKitDesign(frontMatter),
    root: renderRootDesign(frontMatter),
    fullProjection: stableJson(frontMatter),
    designTokens: stableJson(toDtcgDesignTokens(frontMatter)),
    tailwindTheme: renderTailwindThemeCss(frontMatter),
  };
}

async function writeIfChanged(absPath, content) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf8');
}

async function checkFile(absPath, expected, label, drifted) {
  let current = '';
  try {
    current = await fs.readFile(absPath, 'utf8');
  } catch {
    drifted.push(`${label} missing: ${repoRel(absPath)}`);
    return;
  }
  if (current !== expected) {
    drifted.push(`${label} drifted: ${repoRel(absPath)}`);
  }
}

async function removeGeneratedFileIfExists(absPath) {
  try {
    const current = await fs.readFile(absPath, 'utf8');
    if (current.includes('AUTO-GENERATED by scripts/generate-nimi-design-md.mjs')) {
      await fs.unlink(absPath);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function checkDeprecatedFileAbsent(absPath, label, drifted) {
  try {
    await fs.access(absPath);
    drifted.push(`${label} deprecated artifact still exists: ${repoRel(absPath)}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const writeMode = process.argv.includes('--write');
  const projection = await buildProjection();

  if (writeMode) {
    await writeIfChanged(kitDesignPath, projection.kit);
    await writeIfChanged(rootDesignPath, projection.root);
    await writeIfChanged(kitFullProjectionPath, projection.fullProjection);
    await writeIfChanged(kitDesignTokensPath, projection.designTokens);
    await writeIfChanged(kitTailwindThemePath, projection.tailwindTheme);
    await removeGeneratedFileIfExists(deprecatedKitTailwindConfigPath);
    process.stdout.write(`wrote ${repoRel(kitDesignPath)}\n`);
    process.stdout.write(`wrote ${repoRel(rootDesignPath)}\n`);
    process.stdout.write(`wrote ${repoRel(kitFullProjectionPath)}\n`);
    process.stdout.write(`wrote ${repoRel(kitDesignTokensPath)}\n`);
    process.stdout.write(`wrote ${repoRel(kitTailwindThemePath)}\n`);
    return;
  }

  if (checkMode) {
    const drifted = [];
    await checkFile(kitDesignPath, projection.kit, 'Kit DESIGN.md projection', drifted);
    await checkFile(rootDesignPath, projection.root, 'Root DESIGN.md projection', drifted);
    await checkFile(kitFullProjectionPath, projection.fullProjection, 'Kit full design projection', drifted);
    await checkFile(kitDesignTokensPath, projection.designTokens, 'Kit DTCG design tokens', drifted);
    await checkFile(kitTailwindThemePath, projection.tailwindTheme, 'Kit Tailwind v4 theme projection', drifted);
    await checkDeprecatedFileAbsent(deprecatedKitTailwindConfigPath, 'Kit Tailwind v3 config projection', drifted);
    if (drifted.length > 0) {
      process.stderr.write('Nimi DESIGN.md projection drift detected.\n');
      for (const item of drifted) {
        process.stderr.write(`- ${item}\n`);
      }
      process.stderr.write('Regenerate intentionally with: node scripts/generate-nimi-design-md.mjs --write\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write('generate-nimi-design-md --check passed\n');
    return;
  }

  process.stdout.write(projection.kit);
}

main().catch((error) => {
  process.stderr.write(`generate-nimi-design-md failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
