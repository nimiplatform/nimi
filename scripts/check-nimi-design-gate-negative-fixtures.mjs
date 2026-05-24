#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml', `tokens:
  - id: color.surface
    css_var: --nimi-surface-card
    theme_layer: foundation
  - id: color.accent
    css_var: --nimi-accent
    theme_layer: accent
`);
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml', `packs:
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
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml', 'modules: []\n');
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-compositions.yaml', 'components: []\n');
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-allowlists.yaml', 'items: []\n');
  write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml', 'primitives: []\n');
  write(root, 'kit/ui/src/generated/themes/nimi-light.css', ':root { --nimi-surface-card: #fff; }\n');
  write(root, 'kit/ui/src/generated/themes/nimi-dark.css', ':root { --nimi-surface-card: #000; }\n');
  write(root, 'kit/ui/src/generated/themes/nimi-accent.css', ':root { --nimi-accent: #00aa88; }\n');
  write(root, 'kit/ui/src/design-tokens.ts', 'export const ACCENT_PACK_IDS = ["nimi-accent"] as const;\n');
  write(root, 'kit/ui/src/styles.css', '');
  write(root, 'apps/probe/spec/kernel/tables/nimi-kit-adoption.yaml', `version: 1
app: probe
app_entry:
  style: apps/probe/src/styles.css
  bootstrap: apps/probe/src/main.tsx
  theme_provider: apps/probe/src/main.tsx
modules:
  - id: probe.surface
    app: probe
    module: apps/probe/src/surface.tsx
    families:
      - surface
    testid_required: false
    exception_policy: none
    source_rule: P-DESIGN-020
    scheme_support:
      - light
      - dark
    default_scheme: light
    accent_pack: nimi-accent
`);
  write(root, 'apps/probe/spec/kernel/tables/nimi-kit-compositions.yaml', 'version: 1\napp: probe\ncomponents: []\n');
  write(root, 'apps/probe/spec/kernel/tables/nimi-kit-allowlists.yaml', 'version: 1\napp: probe\nitems: []\n');
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
  write(root, '.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml', `modules:
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
`);
  write(root, 'kit/package.json', JSON.stringify({
    name: '@nimiplatform/kit-fixture',
    exports: {
      './ui': './ui/src/index.ts',
      './auth': './auth/src/index.ts',
      './core': './core/src/index.ts',
      './telemetry': './telemetry/src/index.ts',
    },
  }, null, 2));
  write(root, 'kit/README.md', '# Kit\n\n## Reuse First\n');
  for (const moduleName of ['ui', 'auth', 'core', 'telemetry']) {
    write(root, `kit/${moduleName}/README.md`, `# ${moduleName}\n`);
    write(root, `kit/${moduleName}/src/index.ts`, 'export const ok = true;\n');
  }
  fs.mkdirSync(path.join(root, 'kit/features'), { recursive: true });
}

function mutateJson(root, rel, mutate) {
  const abs = path.join(root, rel);
  const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
  mutate(doc);
  fs.writeFileSync(abs, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

const uiCases = [
  {
    name: 'platform concrete app row',
    mutate(root) {
      write(root, '.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml', `modules:
  - id: desktop.synthetic
    app: desktop
    module: apps/desktop/src/synthetic.tsx
`);
    },
    expected: 'platform design tables must not carry concrete app consumption inventory',
  },
  {
    name: 'app root token registry',
    mutate(root) {
      append(root, 'apps/probe/src/styles.css', '\n:root { --color-probe: red; }\n');
    },
    expected: 'app styles must not define app-local root token authority',
  },
  {
    name: 'random accent palette authority',
    mutate(root) {
      append(root, 'apps/probe/src/styles.css', '\n.random-accent { --nimi-accent: red; }\n');
    },
    expected: 'apps/probe/src/styles.css: app styles must not assign --nimi-* token values',
  },
  {
    name: 'missing kit accent theme import',
    mutate(root) {
      write(root, 'apps/probe/src/styles.css', `@import "@nimiplatform/kit/ui/styles.css";
@import "@nimiplatform/kit/ui/themes/light.css";
@import "@nimiplatform/kit/ui/themes/dark.css";
`);
    },
    expected: 'apps/probe/src/styles.css: must import @nimiplatform/kit/ui/themes/nimi-accent.css',
  },
  {
    name: 'missing kit theme provider',
    mutate(root) {
      write(root, 'apps/probe/src/main.tsx', `export function App() {
  return <div />;
}
`);
    },
    expected: 'apps/probe/src/main.tsx: must use NimiThemeProvider from @nimiplatform/kit/ui',
  },
  {
    name: 'inline raw glass style',
    mutate(root) {
      write(root, 'apps/probe/src/surface.tsx', `import { Surface } from '@nimiplatform/kit/ui';
export function ProbeSurface() {
  return <Surface style={{ backdropFilter: 'blur(12px)' }}>probe</Surface>;
}
`);
    },
    expected: 'inline style property "backdropFilter" is forbidden outside allowlists',
  },
  {
    name: 'marketing hero gradient card',
    mutate(root) {
      write(root, 'apps/probe/src/surface.tsx', `import { Surface } from '@nimiplatform/kit/ui';
export function ProbeSurface() {
  return (
    <Surface>
      <section style={{ background: 'linear-gradient(135deg, #6945ff, #13d6a0)' }}>
        The Future of AI Collaboration
      </section>
    </Surface>
  );
}
`);
    },
    expected: 'apps/probe/src/surface.tsx: inline style property "background" is forbidden outside allowlists',
  },
  {
    name: 'plain web form styling',
    mutate(root) {
      write(root, 'apps/probe/src/surface.tsx', `import { Surface } from '@nimiplatform/kit/ui';
export function ProbeSurface() {
  return (
    <Surface>
      <form style={{ backgroundColor: 'white' }}>
        <input name="email" />
      </form>
    </Surface>
  );
}
`);
    },
    expected: 'apps/probe/src/surface.tsx: inline style property "backgroundColor" is forbidden outside allowlists',
  },
  {
    name: 'dense border line material bypass',
    mutate(root) {
      write(root, 'apps/probe/src/surface.tsx', `import { Surface } from '@nimiplatform/kit/ui';
export function ProbeSurface() {
  return <Surface><div className="border-[#dfe4ec]">dense lines</div></Surface>;
}
`);
    },
    expected: 'apps/probe/src/surface.tsx: raw visual token pattern "border-[#" is forbidden in governed modules',
  },
  {
    name: 'missing governed module authority',
    mutate(root) {
      write(root, 'apps/probe/spec/kernel/tables/nimi-kit-adoption.yaml', `version: 1
app: probe
app_entry:
  style: apps/probe/src/styles.css
  bootstrap: apps/probe/src/main.tsx
  theme_provider: apps/probe/src/main.tsx
modules:
  - id: probe.missing
    app: probe
    module: apps/probe/src/missing.tsx
    families:
      - surface
    testid_required: false
    exception_policy: none
    source_rule: P-DESIGN-020
    scheme_support:
      - light
      - dark
    default_scheme: light
    accent_pack: nimi-accent
`);
    },
    expected: 'governed module missing',
  },
  {
    name: 'new app-local manifest root discovery',
    mutate(root) {
      write(root, '.nimi/spec/synthetic/kernel/tables/nimi-kit-adoption.yaml', `version: 1
app: synthetic
app_entry:
  style: apps/synthetic/src/styles.css
  bootstrap: apps/synthetic/src/main.tsx
  theme_provider: apps/synthetic/src/main.tsx
modules: []
`);
      write(root, 'apps/synthetic/src/styles.css', '');
      write(root, 'apps/synthetic/src/main.tsx', 'export function Synthetic() { return null; }\n');
    },
    expected: 'apps/synthetic/src/styles.css: must import @nimiplatform/kit/ui/styles.css',
  },
];

withTempFixture('ui-pattern-base', buildUiPatternFixture, (root) => {
  const result = runGate(root, 'scripts/check-nimi-ui-pattern.mjs');
  expectPass('ui-pattern base fixture', result);
  report.positiveBootstrap = {
    app: 'probe',
    manifest: 'apps/probe/spec/kernel/tables/nimi-kit-adoption.yaml',
    style: 'apps/probe/src/styles.css',
    bootstrap: 'apps/probe/src/main.tsx',
    themeProvider: 'apps/probe/src/main.tsx',
    governedModule: 'apps/probe/src/surface.tsx',
    imports: [
      '@nimiplatform/kit/ui/styles.css',
      '@nimiplatform/kit/ui/themes/light.css',
      '@nimiplatform/kit/ui/themes/dark.css',
      '@nimiplatform/kit/ui/themes/nimi-accent.css',
      'NimiThemeProvider',
      'Surface',
    ],
    platformDesignRows: {
      adoption: 0,
      compositions: 0,
      allowlists: 0,
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

for (const testCase of uiCases) {
  withTempFixture(`ui-pattern-${testCase.name.replace(/\s+/gu, '-')}`, buildUiPatternFixture, (root) => {
    testCase.mutate(root);
    const result = runGate(root, 'scripts/check-nimi-ui-pattern.mjs');
    expectFailure(`ui-pattern ${testCase.name}`, result, testCase.expected);
    report.negativeCases.push({
      id: `ui-pattern:${testCase.name}`,
      gate: 'check-nimi-ui-pattern',
      expectedText: testCase.expected,
      status: result.status,
      ok: result.status !== 0,
    });
  });
}

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
