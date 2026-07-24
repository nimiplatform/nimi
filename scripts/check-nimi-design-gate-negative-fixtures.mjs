#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const reportPath = process.env.NIMI_DESIGN_GATE_FIXTURE_REPORT || '';
const report = {
  ok: false,
  positiveBootstrap: null,
  negativeCases: [],
};

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function copyFromRepo(root, rel) {
  const source = path.join(repoRoot, rel);
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function append(root, rel, content) {
  fs.appendFileSync(path.join(root, rel), content, 'utf8');
}

function runGate(root, scriptRel) {
  return spawnSync(process.execPath, [path.join(repoRoot, scriptRel)], {
    cwd: root,
    encoding: 'utf8',
  });
}

function expectPass(name, result) {
  if (result.status !== 0) {
    throw new Error(`${name}: expected pass, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

function expectFailure(name, result, expectedText) {
  if (result.status === 0) {
    throw new Error(`${name}: expected failure, got pass\n${result.stdout}\n${result.stderr}`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedText)) {
    throw new Error(`${name}: expected failure containing ${JSON.stringify(expectedText)}\n${output}`);
  }
}

function withTempFixture(name, build, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nimi-${name}-`));
  try {
    build(root);
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function buildUiPatternFixture(root) {
  write(root, 'config/platform-nimi-ui-tokens.yaml', `tokens:
  - id: color.surface
    css_var: --nimi-surface-card
    theme_layer: foundation
  - id: color.accent
    css_var: --nimi-accent
    theme_layer: accent
`);
  write(root, 'config/platform-nimi-ui-themes.yaml', `packs:
  - theme_id: nimi-light
    pack_kind: foundation
    values:
      color.surface: '#ffffff'
  - theme_id: nimi-dark
    pack_kind: foundation
    values:
      color.surface: '#000000'
  - theme_id: nimi-accent
    pack_kind: accent
    values:
      color.accent: '#00aa88'
`);
  write(root, 'config/platform-nimi-ui-compositions.yaml', 'components: []\n');
  write(root, 'config/platform-nimi-ui-primitives.yaml', 'primitives: []\n');
  write(root, 'kit/ui/src/generated/themes/nimi-light.css', ':root { --nimi-surface-card: #fff; }\n');
  write(root, 'kit/ui/src/generated/themes/nimi-dark.css', ':root { --nimi-surface-card: #000; }\n');
  write(root, 'kit/ui/src/generated/themes/nimi-accent.css', ':root { --nimi-accent: #00aa88; }\n');
  write(root, 'kit/ui/src/design-tokens.ts', 'export const ACCENT_PACK_IDS = ["nimi-accent"] as const;\n');
  write(root, 'kit/ui/src/styles.css', '');
  write(root, 'apps/probe/spec/kernel/tables/nimi-kit-compositions.yaml', 'version: 1\napp: probe\ncomponents: []\n');
  write(root, 'apps/probe/src/styles.css', `@import "@nimiplatform/kit/ui/styles.css";
@import "@nimiplatform/kit/ui/themes/light.css";
@import "@nimiplatform/kit/ui/themes/dark.css";
@import "@nimiplatform/kit/ui/themes/nimi-accent.css";
`);
  write(root, 'apps/probe/src/main.tsx', `import { NimiThemeProvider } from '@nimiplatform/kit/ui';
export function App() {
  return <NimiThemeProvider><div /></NimiThemeProvider>;
}
`);
  write(root, 'apps/probe/src/surface.tsx', `import { Surface } from '@nimiplatform/kit/ui';
export function ProbeSurface() {
  return <Surface>probe</Surface>;
}
`);
}

function buildKitFixture(root) {
  const standardShellCatalogRel = 'config/platform-standard-shell-capabilities.yaml';
  const standardShellCatalog = YAML.parse(fs.readFileSync(path.join(repoRoot, standardShellCatalogRel), 'utf8'));
  const standardShellFixtureStrings = [
    'NIMI_STANDARD_SHELL_CAPABILITY_SETS',
    ...(Array.isArray(standardShellCatalog?.capabilities)
      ? standardShellCatalog.capabilities.map((capability) => String(capability?.id || '').trim()).filter(Boolean)
      : []),
    ...(Array.isArray(standardShellCatalog?.error_envelope?.codes)
      ? standardShellCatalog.error_envelope.codes.map((code) => String(code || '').trim()).filter(Boolean)
      : []),
    ...(Array.isArray(standardShellCatalog?.capabilities)
      ? standardShellCatalog.capabilities.flatMap((capability) =>
          Array.isArray(capability?.operations)
            ? capability.operations.map((operation) => String(operation?.command || '').trim()).filter(Boolean)
            : [],
        )
      : []),
    ...(Array.isArray(standardShellCatalog?.capability_sets)
      ? standardShellCatalog.capability_sets.flatMap((capabilitySet) => [
          String(capabilitySet?.set_id || '').trim(),
          String(capabilitySet?.source_rule || '').trim(),
          ...(Array.isArray(capabilitySet?.allowed_operations)
            ? capabilitySet.allowed_operations.map((operation) => String(operation || '').trim())
            : []),
          ...(Array.isArray(capabilitySet?.planned_operations)
            ? capabilitySet.planned_operations.map((operation) => String(operation || '').trim())
            : []),
          ...(Array.isArray(capabilitySet?.forbidden_operations)
            ? capabilitySet.forbidden_operations.map((operation) => String(operation || '').trim())
            : []),
          ...(Array.isArray(capabilitySet?.negative_tests)
            ? capabilitySet.negative_tests.map((testId) => String(testId || '').trim())
            : []),
        ].filter(Boolean))
      : []),
  ];
  write(root, 'config/platform-nimi-kit-registry.yaml', `modules:
  - id: kit.ui
    subpath: /ui
    kind: foundation
    description: UI primitives
    source_rule: P-KIT-001
    admission_status: admitted
    owner: platform
    surface_level: ui
    adapter_contract: none
    dependencies: []
    peer_dependencies: []
    exports:
      - ./ui
    headless_exports: []
    ui_exports: []
    reuse_entrypoints: []
  - id: kit.auth
    subpath: /auth
    kind: foundation
    description: Auth UI primitives
    source_rule: P-KIT-001
    admission_status: admitted
    owner: platform
    surface_level: ui
    adapter_contract: none
    dependencies: []
    peer_dependencies: []
    exports:
      - ./auth
    headless_exports: []
    ui_exports: []
    reuse_entrypoints: []
  - id: kit.core
    subpath: /core
    kind: foundation
    description: Core helpers
    source_rule: P-KIT-001
    admission_status: admitted
    owner: platform
    surface_level: logic
    adapter_contract: none
    dependencies: []
    peer_dependencies: []
    exports:
      - ./core
    headless_exports: []
    ui_exports: []
    reuse_entrypoints: []
  - id: kit.telemetry
    subpath: /telemetry
    kind: foundation
    description: Telemetry helpers
    source_rule: P-KIT-001
    admission_status: admitted
    owner: platform
    surface_level: logic
    adapter_contract: none
    dependencies: []
    peer_dependencies: []
    exports:
      - ./telemetry
    headless_exports: []
    ui_exports: []
    reuse_entrypoints: []
  - id: kit.shell.capabilities
    subpath: /shell/capabilities
    kind: infra
    description: Standard shell capabilities
    source_rule: P-KIT-001
    admission_status: admitted
    owner: platform
    surface_level: logic
    adapter_contract: shell-capability-catalog
    dependencies: []
    peer_dependencies: []
    exports:
      - ./shell/capabilities
    headless_exports: []
    ui_exports: []
    reuse_entrypoints: []
`);
  write(
    root,
    'config/platform-nimi-kit-registry.yaml',
    fs.readFileSync(path.join(root, 'config/platform-nimi-kit-registry.yaml'), 'utf8'),
  );
  write(root, 'kit/package.json', JSON.stringify({
    name: '@nimiplatform/kit-fixture',
    exports: {
      './ui': './ui/src/index.ts',
      './auth': './auth/src/index.ts',
      './core': './core/src/index.ts',
      './telemetry': './telemetry/src/index.ts',
      './shell/capabilities': './shell/capabilities/src/index.ts',
    },
  }, null, 2));
  write(root, 'kit/README.md', '# Kit\n\n## Reuse First\n');
  for (const moduleName of ['ui', 'auth', 'core', 'telemetry']) {
    write(root, `kit/${moduleName}/README.md`, `# ${moduleName}\n`);
    write(root, `kit/${moduleName}/src/index.ts`, 'export const ok = true;\n');
  }
  copyFromRepo(root, standardShellCatalogRel);
  write(
    root,
    'config/platform-standard-shell-capabilities.yaml',
    fs.readFileSync(path.join(root, standardShellCatalogRel), 'utf8'),
  );
  write(root, 'kit/shell/capabilities/README.md', '# shell capabilities\n');
  write(
    root,
    'kit/shell/capabilities/src/index.ts',
    `export const STANDARD_SHELL_FIXTURE_STRINGS = [\n${standardShellFixtureStrings
      .map((value) => `  '${value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}',`)
      .join('\n')}\n] as const;\n`,
  );
  fs.mkdirSync(path.join(root, 'kit/features'), { recursive: true });
}

function mutateJson(root, rel, mutate) {
  const abs = path.join(root, rel);
  const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
  mutate(doc);
  fs.writeFileSync(abs, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

withTempFixture('ui-pattern-base', buildUiPatternFixture, (root) => {
  const result = runGate(root, 'scripts/check-nimi-ui-pattern.mjs');
  expectPass('ui-pattern base fixture', result);
  report.positiveBootstrap = {
    platformDesignRows: {
      compositions: 0,
    },
    gates: [
      {
        id: 'check-nimi-ui-pattern',
        status: result.status,
        ok: result.status === 0,
      },
    ],
  };
});


withTempFixture('kit-base', buildKitFixture, (root) => {
  const result = runGate(root, 'scripts/check-nimi-kit.mjs');
  expectPass('kit base fixture', result);
});

withTempFixture('kit-unregistered-export', buildKitFixture, (root) => {
  write(root, 'kit/ui/src/unregistered.ts', 'export const bad = true;\n');
  mutateJson(root, 'kit/package.json', (doc) => {
    doc.exports['./ui/unregistered'] = './ui/src/unregistered.ts';
  });
  const result = runGate(root, 'scripts/check-nimi-kit.mjs');
  expectFailure(
    'kit unregistered export',
    result,
    'kit/package.json: export ./ui/unregistered is not registered in nimi-kit-registry.yaml',
  );
  report.negativeCases.push({
    id: 'kit:unregistered export',
    gate: 'check-nimi-kit',
    expectedText: 'kit/package.json: export ./ui/unregistered is not registered in nimi-kit-registry.yaml',
    status: result.status,
    ok: result.status !== 0,
  });
});

report.ok = report.positiveBootstrap?.gates?.every((entry) => entry.ok) === true
  && report.negativeCases.every((entry) => entry.ok);

if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log('nimi design gate negative fixtures: OK');
