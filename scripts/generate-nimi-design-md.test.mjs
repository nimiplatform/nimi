import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

const repoRoot = path.resolve('.');
const scriptRel = path.join('scripts', 'generate-nimi-design-md.mjs');
const scriptPath = path.join(repoRoot, scriptRel);

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(root, rel) {
  return JSON.parse(read(root, rel));
}

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/u);
  assert.ok(match, 'expected YAML front matter');
  return YAML.parse(match[1]);
}

function run(root, args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function buildFixture({ declareFragments = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-design-md-'));
  write(root, 'kit/README.md', '# @nimiplatform/kit\n');
  write(root, '.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml', `version: 1
modules:
  - id: kit.ui
    description: Cross-app design system built on Radix UI + CVA + Tailwind, with nimi semantic tokens
    exports:
      - ./ui
      - ./ui/styles.css
    source_rule: P-KIT-010
`);
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml', `version: 2
tokens:
  - id: surface.card
    category: surface
    semantic_name: Surface card
    css_var: --nimi-surface-card
    primitive_family: surface
    source_rule: P-DESIGN-003
    theme_layer: foundation
  - id: action.primary_bg
    category: action
    semantic_name: Primary action background
    css_var: --nimi-action-primary-bg
    primitive_family: action
    source_rule: P-DESIGN-003
    theme_layer: accent
  - id: status.info
    category: status
    semantic_name: Info state
    css_var: --nimi-status-info
    primitive_family: status
    source_rule: P-DESIGN-003
    theme_layer: accent
  - id: typography.body.size
    category: typography
    semantic_name: Body size
    css_var: --nimi-type-body-size
    primitive_family: typography
    source_rule: P-DESIGN-003
    theme_layer: foundation
  - id: typography.font_sans
    category: typography
    semantic_name: Sans font family
    css_var: --nimi-type-font-sans
    primitive_family: typography
    source_rule: P-DESIGN-003
    theme_layer: foundation
  - id: radius.sm
    category: radius
    semantic_name: Radius small
    css_var: --nimi-radius-sm
    primitive_family: shape
    source_rule: P-DESIGN-003
    theme_layer: foundation
  - id: motion.fast
    category: motion
    semantic_name: Fast motion
    css_var: --nimi-motion-fast
    primitive_family: motion
    source_rule: P-DESIGN-003
    theme_layer: foundation
`);
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml', `version: 2
packs:
  - theme_id: nimi-light
    pack_kind: foundation
    values:
      surface.card: '#ffffff'
      typography.font_sans: '"Inter", "Noto Sans SC", system-ui, sans-serif'
      typography.body.size: 0.875rem
      radius.sm: 8px
      motion.fast: 160ms
  - theme_id: nimi-dark
    pack_kind: foundation
    values:
      surface.card: '#162033'
      typography.body.size: 0.875rem
      radius.sm: 8px
      motion.fast: 160ms
  - theme_id: nimi-accent
    pack_kind: accent
    values:
      action.primary_bg: '#4ECCA3'
      status.info: '#3B82F6'
`);
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml', `version: 2
surfaces:
  - primitive.surface
  - primitive.action
${declareFragments ? `fragments:
  primitives:
    - .nimi/spec/platform/kernel/tables/nimi-ui-primitives/surface-action.yaml
` : ''}
`);
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-primitives/surface-action.yaml', `version: 2
primitives:
  - id: primitive.surface
    family: surface
    component: Surface
    source_rule: P-DESIGN-011
    slots:
      - id: root
        class_name: nimi-surface
        styles:
          background-color: var(--nimi-surface-card)
          border-radius: var(--nimi-radius-lg)
    class_groups:
      tone:
        - id: card
          class_name: nimi-surface--card
  - id: primitive.action
    family: action
    component: Button
    source_rule: P-DESIGN-011
    slots:
      - id: root
        class_name: nimi-action
        styles:
          background-color: var(--nimi-action-primary-bg)
    class_groups:
      tone:
        - id: primary
          class_name: nimi-action--primary
          styles:
            background-color: var(--nimi-status-info)
`);
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-compositions.yaml', `version: 1
components: []
density_modes:
  - id: density.compact
    kind: density_mode
    title: Compact density
    source_rule: P-DESIGN-024
    intent: Repeated operational desktop work with high scan efficiency.
    use_for:
      - Desktop ordinary shell chrome
    avoid_for:
      - Identity-led hero moments
    typography:
      body: 13-14px
`);
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml', 'version: 1\nmodules: []\n');
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-allowlists.yaml', 'version: 1\nitems: []\n');
  return root;
}

test('renders Google DESIGN.md-shaped Nimi design projection from spec authority', () => {
  const root = buildFixture();
  try {
    const result = run(root, ['--write']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const body = read(root, 'kit/DESIGN.md');
    const frontMatter = parseFrontMatter(body);
    assert.match(body, /^---\nname: Nimi Kit Design System\n/m);
    assert.match(body, /systemVersion: 1/m);
    assert.match(body, /designVersion: 2/m);
    assert.match(body, /sources:\n  - \.nimi\/spec\/platform\/kernel\/tables\/nimi-ui-tokens.yaml/m);
    assert.equal(frontMatter.tokens, undefined);
    assert.equal(frontMatter.componentStandards, undefined);
    assert.deepEqual(Object.keys(frontMatter.colors), ['info', 'primary', 'surface']);
    assert.equal(frontMatter.components.button.backgroundColor, '{colors.primary}');
    assert.equal(frontMatter.components['button-tone-primary'].backgroundColor, '{colors.info}');
    assert.equal(frontMatter.components.surface.backgroundColor, '{colors.surface}');
    assert.equal(frontMatter.artifacts.designTokens, 'kit/design_tokens.json');
    assert.equal(frontMatter.artifacts.fullProjection, 'kit/design-projection.json');
    assert.equal(frontMatter.artifacts.tailwindTheme, 'kit/tailwind-theme.css');
    assert.equal(frontMatter.artifacts.tailwindConfig, undefined);
    assert.ok(body.split(/\r?\n/).length < 450, 'DESIGN.md should stay compact for agent consumption');
    assert.match(body, /# Nimi Kit Design System/m);
    assert.match(body, /## Colors/m);
    assert.match(body, /## Typography/m);
    assert.match(body, /## Components/m);
    assert.match(body, /## Do's and Don'ts/m);
    assert.match(body, /- \*\*Compact density:\*\* Repeated operational desktop work with high scan efficiency\./m);
    assert.match(body, /- `Surface` \(`primitive.surface`\): family `surface`, source `P-DESIGN-011`/m);
    assert.match(body, /- Do consume `@nimiplatform\/kit\/ui`/m);

    const fullProjection = readJson(root, 'kit/design-projection.json');
    assert.equal(fullProjection.colors.info, '#3B82F6');
    assert.equal(fullProjection.tokens.all.surface['surface.card'].cssVar, '--nimi-surface-card');
    assert.equal(fullProjection.componentStandards.primitives.length, 2);
    assert.equal(fullProjection.componentStandards.compositions.length, 0);
    assert.equal(fullProjection.componentStandards.densityModes[0].id, 'density.compact');

    const designTokens = readJson(root, 'kit/design_tokens.json');
    assert.equal(designTokens.colors.info.$value, '#3B82F6');
    assert.equal(designTokens.colors.primary.$type, 'color');
    assert.equal(designTokens.colors.primary.$value, '#4ECCA3');
    assert.equal(designTokens.typography.body.$value.fontSize, '0.875rem');

    const tailwindTheme = read(root, 'kit/tailwind-theme.css');
    assert.match(tailwindTheme, /@theme \{/);
    assert.match(tailwindTheme, /--color-primary: #4ECCA3;/);
    assert.match(tailwindTheme, /--font-body: "Inter", "Noto Sans SC"/);
    assert.match(tailwindTheme, /--text-body: 0\.875rem;/);
    assert.match(tailwindTheme, /--radius-sm: 8px;/);
    assert.equal(fs.existsSync(path.join(root, 'kit', 'tailwind.config.js')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discovers primitive fragment files when aggregate primitive table has only surfaces', () => {
  const root = buildFixture({ declareFragments: false });
  try {
    const result = run(root, ['--write']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const fullProjection = readJson(root, 'kit/design-projection.json');
    assert.match(JSON.stringify(fullProjection.componentStandards.primitives), /primitive\.action/);
    const body = read(root, 'kit/DESIGN.md');
    assert.match(body, /- `Surface` \(`primitive.surface`\): family `surface`, source `P-DESIGN-011`/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--check fails when a generated design artifact drifts from spec-derived output', () => {
  const root = buildFixture();
  try {
    assert.equal(run(root, ['--write']).status, 0);
    fs.appendFileSync(path.join(root, 'kit', 'design_tokens.json'), '\n', 'utf8');

    const result = run(root, ['--check']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Nimi DESIGN\.md projection drift detected/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
