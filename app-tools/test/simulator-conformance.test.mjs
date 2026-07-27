import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  computeSourceDigestV1,
  isSimulatorStaticAssetPath,
  parseSimulatorManifest,
  validateSimulatorAppSource,
} from '../lib/simulator-conformance.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(TEST_ROOT, 'fixtures', 'simulator-valid');
const CLI_PATH = path.resolve(TEST_ROOT, '..', 'bin', 'nimi-app.mjs');
const VALID_MANIFEST = readFileSync(path.join(FIXTURE_ROOT, 'nimi.simulator.yaml'), 'utf8');
const FORBIDDEN_AUTHORITY_FIELDS = [
  'source_repository',
  'source_revision',
  'source_digest',
  'publisher',
  'trust',
  'signature',
  'review',
  'admission',
  'credential',
  'token',
  'endpoint',
  'environment',
  'permission',
  'runtime_capability',
  'install_command',
  'build_command',
  'bundler_plugin',
  'export_condition',
  'html_entry',
  'root_entry',
  'bootstrap_entry',
  'prebuilt_javascript',
  'prebuilt_css',
  'chunk_name',
  'ordering_key',
  'deployment_route',
  'sdk_transport',
  'shell_mode',
  'runtime_fallback',
];

function withFixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-app-tools-'));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectManifestFailure(name, mutate, code) {
  test(`manifest rejects ${name}`, () => {
    const text = mutate(VALID_MANIFEST);
    assert.throws(
      () => parseSimulatorManifest(text),
      (error) => error?.code === code,
    );
  });
}

test('valid Simulator App source exposes the validated inputs needed by the build', () => {
  const result = validateSimulatorAppSource(FIXTURE_ROOT);
  assert.equal(result.manifest.module_id, 'sample-app');
  assert.equal(result.style.profile.protocol, 'nimi.simulator.css-profile/v1');
  assert.equal(result.style.profile.scanner.mode, 'exact-canonical-composition-files');
  assert.equal(result.style.profile.utility.root_class, 'nimi-ui-module--sample-app');
  assert.equal(result.style.profile.utility.layer, 'simulator.module.sample-app');
  assert.deepEqual(result.style.production.hostFoundationInputs, []);
  assert.ok(result.source.files.some((entry) => entry.path === 'src/renderer/factory.ts'));
});

test('Manifest admits owner-canonical camelCase SDK method IDs', () => {
  const manifest = parseSimulatorManifest(
    VALID_MANIFEST.replace('  sdk_methods: []', '  sdk_methods:\n    - nimi.ai.generateText'),
  );
  assert.deepEqual(manifest.requires.sdk_methods, ['nimi.ai.generateText']);
});

test('runtime graph ignores erased type-only imports', () => withFixture((root) => {
  writeFileSync(path.join(root, 'src', 'renderer', 'type-only.ts'), `
import type { HiddenType } from '../simulator/type-only-effect';
export type PublicType = HiddenType;
`);
  writeFileSync(path.join(root, 'src', 'simulator', 'type-only-effect.ts'), `
const value = fetch('/must-not-enter-runtime-graph');
export type HiddenType = typeof value;
`);
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(factoryPath, `${readFileSync(factoryPath, 'utf8')}\nexport type { PublicType } from './type-only';\n`);

  const result = validateSimulatorAppSource(root);
  assert.equal(
    [...result.graph.nodes.keys()].some((entry) => entry.endsWith(path.join('src', 'simulator', 'type-only-effect.ts'))),
    false,
  );
}));

test('canonical closure admits source-bound PNG imports without parsing binary bytes as code', () => withFixture((root) => {
  assert.equal(isSimulatorStaticAssetPath('src/renderer/logo.png'), true);
  assert.equal(isSimulatorStaticAssetPath('src/renderer/messages.json'), true);
  assert.equal(isSimulatorStaticAssetPath('src/renderer/logo.svg'), false);
  const assetPath = path.join(root, 'src', 'renderer', 'logo.png');
  writeFileSync(assetPath, Buffer.from('89504e470d0a1a0a', 'hex'));
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(
    factoryPath,
    `import logo from './logo.png';\n${readFileSync(factoryPath, 'utf8')}\nexport const logoAsset = logo;\n`,
  );
  const result = validateSimulatorAppSource(root);
  assert.equal(result.source.files.some((entry) => entry.path === 'src/renderer/logo.png'), true);
  assert.equal([...result.graph.nodes.keys()].includes(assetPath), true);
}));

test('canonical closure admits valid source-bound JSON data and rejects malformed JSON', () => withFixture((root) => {
  const messagesPath = path.join(root, 'src', 'renderer', 'messages.json');
  writeFileSync(messagesPath, '{"title":"Nimi"}\n');
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(
    factoryPath,
    `import messages from './messages.json';\n${readFileSync(factoryPath, 'utf8')}\nexport const title = messages.title;\n`,
  );
  const result = validateSimulatorAppSource(root);
  assert.equal(result.source.files.some((entry) => entry.path === 'src/renderer/messages.json'), true);

  writeFileSync(messagesPath, '{"title":');
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_IMPORT_JSON_INVALID',
  );
}));

test('canonical closure rejects static asset types outside the admitted set', () => withFixture((root) => {
  writeFileSync(path.join(root, 'src', 'renderer', 'logo.svg'), '<svg/>');
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(factoryPath, `import './logo.svg';\n${readFileSync(factoryPath, 'utf8')}`);
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_IMPORT_ASSET_TYPE',
  );
}));

test('root-scoped local classes and exact CSS @scope are admitted', () => withFixture((root) => {
  writeFileSync(path.join(root, 'src', 'renderer', 'styles.css'), `
.nimi-ui-module--sample-app .panel { display: block; }
@scope (.nimi-ui-module--sample-app) {
  .toolbar > button { min-inline-size: 1px; }
}
`);
  const result = validateSimulatorAppSource(root);
  assert.equal(result.manifest.module_id, 'sample-app');
}));

test('domain-local discriminator words do not impersonate host-binding reads', () => withFixture((root) => {
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(factoryPath, `${readFileSync(factoryPath, 'utf8')}\nexport const sampleEnvironmentLabel = 'studio';\n`);
  assert.equal(validateSimulatorAppSource(root).manifest.module_id, 'sample-app');
}));

test('canonical closure rejects the Kit shell-mode host discriminator', () => withFixture((root) => {
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(
    factoryPath,
    `import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';\nvoid getShellFeatureFlags;\n${readFileSync(factoryPath, 'utf8')}`,
  );
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_FACTORY_HOST_DISCRIMINATOR',
  );
}));

test('canonical closure rejects a host discriminator property read', () => withFixture((root) => {
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(
    factoryPath,
    readFileSync(factoryPath, 'utf8').replace(
      'const label = SampleLabel.parse',
      "void (bindings as Record<string, unknown>).hostKind;\n    const label = SampleLabel.parse",
    ),
  );
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_FACTORY_HOST_DISCRIMINATOR',
  );
}));

test('CLI validates Simulator source with ordinary logs and fails closed', () => {
  const output = execFileSync(process.execPath, [CLI_PATH, 'doctor', '--dir', FIXTURE_ROOT, '--conformance', 'simulator'], {
    encoding: 'utf8',
  });
  assert.match(output, /Simulator source validation passed/u);

  const failure = spawnSync(process.execPath, [CLI_PATH, 'doctor', '--dir', path.join(FIXTURE_ROOT, 'missing'), '--conformance', 'simulator'], {
    encoding: 'utf8',
  });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /failed: .*missing/u);
});

test('canonical CSS profile stays root-independent after temp materialization', () => withFixture((root) => {
  const materialized = validateSimulatorAppSource(root);
  for (const input of materialized.style.profile.scanner.inputs) {
    assert.match(input.path, /^src\//u);
    assert.equal(input.path.includes('..'), false);
  }
}));

test('sourceDigestV1 is byte-, mode-, and path-sensitive', () => {
  const base = [{ path: 'src/a.ts', mode: '100644', bytes: Buffer.from('a\n') }];
  const digest = computeSourceDigestV1(base);
  assert.equal(digest, computeSourceDigestV1(base));
  assert.notEqual(digest, computeSourceDigestV1([{ ...base[0], bytes: Buffer.from('b\n') }]));
  assert.notEqual(digest, computeSourceDigestV1([{ ...base[0], mode: '100755' }]));
  assert.notEqual(digest, computeSourceDigestV1([{ ...base[0], path: 'src/b.ts' }]));
});

test('every forbidden Manifest authority field is rejected independently', async (context) => {
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    await context.test(field, () => {
      assert.throws(
        () => parseSimulatorManifest(`${VALID_MANIFEST}${field}: forged\n`),
        (error) => error?.code === 'SIM_MANIFEST_UNKNOWN_FIELD',
      );
    });
  }
});

test('every Manifest source path field rejects an independent parent escape', async (context) => {
  const mutations = [
    ['factory_entry', '  factory_entry: src/renderer/factory.ts', '  factory_entry: ../factory.ts'],
    ['style_entry', '  style_entry: src/renderer/styles.css', '  style_entry: ../styles.css'],
    ['app_production_entries', '    - src/main.ts', '    - ../main.ts'],
    ['renderer_entry', '  entry: src/simulator/renderer.ts', '  entry: ../renderer.ts'],
    ['adapter_entry', '  adapter_entry: src/simulator/adapter.ts', '  adapter_entry: ../adapter.ts'],
    ['fixture', '  conformance: src/simulator/fixture.ts', '  conformance: ../fixture.ts'],
  ];
  for (const [name, needle, replacement] of mutations) {
    await context.test(name, () => {
      assert.throws(
        () => parseSimulatorManifest(VALID_MANIFEST.replace(needle, replacement)),
        (error) => error?.code === 'SIM_MANIFEST_PATH',
      );
    });
  }
});

expectManifestFailure(
  'a duplicate key',
  (text) => text.replace('module_id: sample-app', 'module_id: sample-app\nmodule_id: sample-app'),
  'SIM_MANIFEST_YAML_DUPLICATE_KEY',
);
expectManifestFailure(
  'an anchor',
  (text) => text.replace('module_id: sample-app', 'module_id: &module sample-app'),
  'SIM_MANIFEST_YAML_ANCHOR',
);
expectManifestFailure(
  'an alias',
  (text) => text.replace('label: Sample', 'label: &label Sample').replace('factory_surface: main', 'factory_surface: *label'),
  'SIM_MANIFEST_YAML_ALIAS',
);
expectManifestFailure(
  'a merge key',
  (text) => text.replace('composition:\n', 'composition:\n  <<: {}\n'),
  'SIM_MANIFEST_YAML_MERGE',
);
expectManifestFailure(
  'a custom tag',
  (text) => text.replace('module_id: sample-app', 'module_id: !module sample-app'),
  'SIM_MANIFEST_YAML_CUSTOM_TAG',
);
expectManifestFailure(
  'a non-string mapping key',
  (text) => text.replace('composition:\n', 'composition:\n  1: invalid\n'),
  'SIM_MANIFEST_YAML_KEY',
);
expectManifestFailure(
  'an unknown field',
  (text) => `${text}unknown: true\n`,
  'SIM_MANIFEST_UNKNOWN_FIELD',
);
expectManifestFailure(
  'a forbidden authority claim',
  (text) => `${text}publisher: forged\n`,
  'SIM_MANIFEST_UNKNOWN_FIELD',
);
expectManifestFailure(
  'a stale protocol revision',
  (text) => text.replace('nimi.simulator.module/v1', 'nimi.simulator.module/v0'),
  'SIM_MANIFEST_PROTOCOL',
);
expectManifestFailure(
  'a missing required field',
  (text) => text.replace('  factory_export: sampleCanonicalRendererFactory\n', ''),
  'SIM_MANIFEST_REQUIRED_FIELD',
);
expectManifestFailure(
  'a parent path escape',
  (text) => text.replace('src/renderer/factory.ts', '../factory.ts'),
  'SIM_MANIFEST_PATH',
);
expectManifestFailure(
  'a remote path',
  (text) => text.replace('src/renderer/factory.ts', 'https://example.invalid/factory.ts'),
  'SIM_MANIFEST_PATH',
);
expectManifestFailure(
  'a generated bundle path',
  (text) => text.replace('src/renderer/factory.ts', 'dist/factory.ts'),
  'SIM_MANIFEST_GENERATED_PATH',
);
expectManifestFailure(
  'a prebuilt bundle path',
  (text) => text.replace('src/renderer/factory.ts', 'src/renderer/factory.bundle.js'),
  'SIM_MANIFEST_PREBUILT_PATH',
);
expectManifestFailure(
  'a conditional path',
  (text) => text.replace('src/renderer/factory.ts', 'src/renderer/factory.ts?simulator'),
  'SIM_MANIFEST_CONDITIONAL_PATH',
);
expectManifestFailure(
  'a Simulator-owned interaction prefix',
  (text) => text.replace('sample-app.window.open', 'simulator.window.open'),
  'SIM_MANIFEST_INTERACTION_NAMESPACE',
);
expectManifestFailure(
  'a route authority',
  (text) => text.replace('initial_route: /', 'initial_route: //forged.example'),
  'SIM_MANIFEST_ROUTE',
);
expectManifestFailure(
  'two main surfaces',
  (text) => text.replace('    - id: main\n', '    - id: main\n      factory_surface: main\n      label: Duplicate\n      initial_route: /duplicate\n      readiness_contract: sample-app.duplicate.usable\n    - id: main\n'),
  'SIM_MANIFEST_DUPLICATE_SURFACE',
);

test('conformance rejects an unreachable canonical factory', () => withFixture((root) => {
  writeFileSync(path.join(root, 'src', 'main.ts'), "import './renderer/styles.css';\nexport const started = true;\n");
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_PRODUCTION_FACTORY_REACHABILITY',
  );
}));

test('conformance rejects renderer and Adapter metadata using the host-binding protocol', async (context) => {
  await context.test('renderer metadata', () => withFixture((root) => {
    const sourcePath = path.join(root, 'src', 'simulator', 'renderer.ts');
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8')
        .replace('nimi.simulator.module/v1', 'nimi.renderer.host/v1'),
    );
    assert.throws(
      () => validateSimulatorAppSource(root),
      (error) => error?.code === 'SIM_RENDERER_PROTOCOL',
    );
  }));

  await context.test('Adapter factory', () => withFixture((root) => {
    const sourcePath = path.join(root, 'src', 'simulator', 'adapter.ts');
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8')
        .replace('nimi.simulator.module/v1', 'nimi.renderer.host/v1'),
    );
    assert.throws(
      () => validateSimulatorAppSource(root),
      (error) => error?.code === 'SIM_ADAPTER_PROTOCOL',
    );
  }));
});

test('conformance rejects structurally ambiguous canonical and Adapter factories', async (context) => {
  await context.test('canonical factory function shortcut', () => withFixture((root) => {
    const sourcePath = path.join(root, 'src', 'renderer', 'factory.ts');
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8')
        .replace('export const sampleCanonicalRendererFactory = Object.freeze({', 'export const sampleCanonicalRendererFactory = () => ({'),
    );
    assert.throws(
      () => validateSimulatorAppSource(root),
      (error) => error?.code === 'SIM_FACTORY_FIELDS',
    );
  }));

  await context.test('Adapter extension field', () => withFixture((root) => {
    const sourcePath = path.join(root, 'src', 'simulator', 'adapter.ts');
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8')
        .replace("  moduleId: 'sample-app',", "  moduleId: 'sample-app',\n  hostKind: 'simulator',"),
    );
    assert.throws(
      () => validateSimulatorAppSource(root),
      (error) => error?.code === 'SIM_ADAPTER_FIELDS',
    );
  }));

  await context.test('missing Adapter lifecycle method', () => withFixture((root) => {
    const sourcePath = path.join(root, 'src', 'simulator', 'adapter.ts');
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8').replace('      deactivate() {},\n', ''),
    );
    assert.throws(
      () => validateSimulatorAppSource(root),
      (error) => error?.code === 'SIM_ADAPTER_LIFECYCLE',
    );
  }));

  await context.test('canonical factory spread member', () => withFixture((root) => {
    const sourcePath = path.join(root, 'src', 'renderer', 'factory.ts');
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8')
        .replace('export const sampleCanonicalRendererFactory = Object.freeze({', 'export const sampleCanonicalRendererFactory = Object.freeze({\n  ...forgedFactoryFields,'),
    );
    assert.throws(
      () => validateSimulatorAppSource(root),
      (error) => error?.code === 'SIM_FACTORY_FIELDS',
    );
  }));

  await context.test('duplicate Adapter metadata member', () => withFixture((root) => {
    const sourcePath = path.join(root, 'src', 'simulator', 'adapter.ts');
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, 'utf8')
        .replace("  moduleId: 'sample-app',", "  moduleId: 'sample-app',\n  moduleId: 'sample-app',"),
    );
    assert.throws(
      () => validateSimulatorAppSource(root),
      (error) => error?.code === 'SIM_ADAPTER_FIELDS',
    );
  }));
});

test('conformance fixture fails closed on each independently governed contract', async (context) => {
  const expectFixtureFailure = (mutate, code) => withFixture((root) => {
    const sourcePath = path.join(root, 'src', 'simulator', 'fixture.ts');
    writeFileSync(sourcePath, mutate(readFileSync(sourcePath, 'utf8')));
    assert.throws(
      () => validateSimulatorAppSource(root),
      (error) => error?.code === code,
    );
  });

  await context.test('static JSON literal', () => expectFixtureFailure(
    (source) => source.replace('    moduleData: {},', '    moduleData: createModuleData(),'),
    'SIM_FIXTURE_LITERAL',
  ));

  await context.test('exact command schema inventory', () => expectFixtureFailure(
    (source) => source.replace("'sample-app.window.open':", "'sample-app.window.close':"),
    'SIM_FIXTURE_COMMAND_SCHEMAS',
  ));

  await context.test('valid command schema grammar', () => expectFixtureFailure(
    (source) => source.replace("kind: 'object',", "kind: 'unknown',"),
    'SIM_FIXTURE_SCHEMA',
  ));

  await context.test('Manifest-bound readiness declaration', () => expectFixtureFailure(
    (source) => source.replace("contractId: 'sample-app.main.usable'", "contractId: 'sample-app.main.stale'"),
    'SIM_FIXTURE_READINESS',
  ));

  await context.test('ordered lifecycle declaration', () => expectFixtureFailure(
    (source) => source.replace(
      "['prepare', 'activate', 'deactivate', 'dispose']",
      "['prepare', 'deactivate', 'activate', 'dispose']",
    ),
    'SIM_FIXTURE_LIFECYCLE',
  ));

  await context.test('unique explicit fixture fields', () => expectFixtureFailure(
    (source) => source.replace("  moduleId: 'sample-app',", "  moduleId: 'sample-app',\n  moduleId: 'sample-app',"),
    'SIM_FIXTURE_LITERAL',
  ));
});

test('conformance rejects a forbidden browser effect', () => withFixture((root) => {
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(factoryPath, `${readFileSync(factoryPath, 'utf8')}\nexport const forbidden = fetch('/real');\n`);
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIMULATOR_EFFECT_FORBIDDEN',
  );
}));

test('canonical local closure rejects non-static module loading mechanisms', async (context) => {
  for (const [name, source, code] of [
    ['non-literal dynamic import', "export const loadModule = (target: string) => import(target);", 'SIM_IMPORT_DYNAMIC_NON_LITERAL'],
    ['import.meta.glob', "export const modules = import.meta.glob('./*.ts');", 'SIM_IMPORT_META_GLOB'],
    ['import.meta element glob', "export const modules = import.meta['glob']('./*.ts');", 'SIM_IMPORT_META_GLOB'],
    ['CommonJS require', "export const moduleValue = require('./state');", 'SIM_IMPORT_REQUIRE'],
    ['TypeScript import-equals', "import State = require('./state');\nexport const state = State;", 'SIM_IMPORT_EQUALS'],
  ]) {
    await context.test(name, () => withFixture((root) => {
      const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
      writeFileSync(factoryPath, `${readFileSync(factoryPath, 'utf8')}\n${source}\n`);
      assert.throws(() => validateSimulatorAppSource(root), (error) => error?.code === code);
    }));
  }
});

test('canonical transitive closure rejects module-scope mutable state and resources', async (context) => {
  for (const [name, source, code] of [
    ['let state', 'export let state = 0;', 'SIM_MODULE_SCOPE_MUTABLE'],
    ['constructed Map', 'export const cache = new Map<string, string>();', 'SIM_MODULE_SCOPE_RESOURCE'],
    ['store factory', 'function createAppStore() { return {}; }\nexport const appStore = createAppStore();', 'SIM_MODULE_SCOPE_RESOURCE'],
    ['const collection mutation', 'export const values: string[] = [];\nvalues.push("state");', 'SIM_MODULE_SCOPE_MUTATION'],
  ]) {
    await context.test(name, () => withFixture((root) => {
      const statePath = path.join(root, 'src', 'renderer', 'state.ts');
      writeFileSync(statePath, `${source}\n`);
      const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
      writeFileSync(factoryPath, `${readFileSync(factoryPath, 'utf8')}\nexport * from './state';\n`);
      assert.throws(() => validateSimulatorAppSource(root), (error) => error?.code === code);
    }));
  }
});

test('per-instance mutable resources remain admitted', () => withFixture((root) => {
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(
    factoryPath,
    `${readFileSync(factoryPath, 'utf8')}\nexport function createLocalCache() { return new Map<string, string>(); }\n`,
  );
  assert.equal(validateSimulatorAppSource(root).manifest.module_id, 'sample-app');
}));

test('production-only bootstrap effects are outside the canonical Simulator closure', () => withFixture((root) => {
  const mainPath = path.join(root, 'src', 'main.ts');
  writeFileSync(mainPath, `${readFileSync(mainPath, 'utf8')}\nexport const productionOnlyRequest = () => fetch('/production-only');\n`);
  assert.equal(validateSimulatorAppSource(root).manifest.module_id, 'sample-app');
}));

test('production host CSS cannot carry a second App UI truth', () => withFixture((root) => {
  const foundationPath = path.join(root, 'src', 'foundation.css');
  writeFileSync(foundationPath, `
@import "@nimiplatform/kit/ui/styles.css";
@import "@nimiplatform/kit/ui/themes/light.css";
@import "@nimiplatform/kit/ui/themes/dark.css";
@import "@nimiplatform/kit/ui/themes/nimi-accent.css";
@import "@nimiplatform/kit/ui/themes/nimi-density-compact.css";
@import "@nimiplatform/kit/auth/styles.css";
@import "tailwindcss" source(none);
:root { color-scheme: light; }
html, body { margin: 0; }
.sample-product { display: block; }
`);
  const mainPath = path.join(root, 'src', 'main.ts');
  writeFileSync(mainPath, `import './foundation.css';\n${readFileSync(mainPath, 'utf8')}`);
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_CSS_PRODUCTION_SECOND_TRUTH',
  );
}));

test('production host foundation rejects additional CSS imports', () => withFixture((root) => {
  const foundationPath = path.join(root, 'src', 'foundation.css');
  writeFileSync(foundationPath, `
@import "@nimiplatform/kit/ui/styles.css";
@import "@nimiplatform/kit/ui/themes/light.css";
@import "@nimiplatform/kit/ui/themes/dark.css";
@import "@nimiplatform/kit/ui/themes/nimi-accent.css";
@import "@nimiplatform/kit/ui/themes/nimi-density-compact.css";
@import "@nimiplatform/kit/auth/styles.css";
@import "tailwindcss" source(none);
@import "other-package/styles.css";
`);
  const mainPath = path.join(root, 'src', 'main.ts');
  writeFileSync(mainPath, `import './foundation.css';\n${readFileSync(mainPath, 'utf8')}`);
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_CSS_FOUNDATION_IMPORTS',
  );
}));

test('conformance rejects an unscoped CSS selector', () => withFixture((root) => {
  const stylePath = path.join(root, 'src', 'renderer', 'styles.css');
  writeFileSync(stylePath, `${readFileSync(stylePath, 'utf8')}\n.unscoped { color: red; }\n`);
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_CSS_GLOBAL_SELECTOR',
  );
}));

test('conformance rejects each unnamespaced App CSS global symbol', async (context) => {
  for (const [css, code] of [
    ['.nimi-ui-module--sample-app { --leaked-value: red; }', 'SIM_CSS_CUSTOM_PROPERTY_NAMESPACE'],
    ['@keyframes spin { to { opacity: 0; } }', 'SIM_CSS_KEYFRAMES_NAMESPACE'],
    ['@property --leaked-value { syntax: "*"; inherits: false; }', 'SIM_CSS_PROPERTY_NAMESPACE'],
    ['@font-face { font-family: LeakedFont; src: local("Arial"); }', 'SIM_CSS_FONT_NAMESPACE'],
  ]) {
    await context.test(code, () => withFixture((root) => {
      const stylePath = path.join(root, 'src', 'renderer', 'styles.css');
      writeFileSync(stylePath, `${readFileSync(stylePath, 'utf8')}\n${css}\n`);
      assert.throws(() => validateSimulatorAppSource(root), (error) => error?.code === code);
    }));
  }
});

test('conformance rejects hand-authored scanner and utility directives', async (context) => {
  for (const [directive, code] of [
    ['@source "./factory.ts";', 'SIM_CSS_SOURCE_DIRECTIVE'],
    ['@tailwind utilities;', 'SIM_CSS_FOUNDATION_DUPLICATE'],
    ['@import "vendor/styles.css";', 'SIM_CSS_DEPENDENCY_UNDECLARED'],
  ]) {
    await context.test(code, () => withFixture((root) => {
      const stylePath = path.join(root, 'src', 'renderer', 'styles.css');
      writeFileSync(stylePath, `${readFileSync(stylePath, 'utf8')}\n${directive}\n`);
      assert.throws(() => validateSimulatorAppSource(root), (error) => error?.code === code);
    }));
  }
});

test('conformance rejects dynamic Tailwind utility interpolation', () => withFixture((root) => {
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(
    factoryPath,
    `${readFileSync(factoryPath, 'utf8')}\nexport const dynamicWidth = (size: string) => \`w-\${size}\`;\n`,
  );
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === 'SIM_CSS_DYNAMIC_UTILITY',
  );
}));
