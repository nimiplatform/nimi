import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectRootExports,
  parseModuleExports,
  validateRegistry,
} from './lib/agent-export-posture-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

test('parseModuleExports extracts the admitted export declaration forms', () => {
  const source = [
    'export async function* streamThing(input) {}',
    'export function plainThing() {}',
    'export class ThingClient {}',
    'export abstract class AbstractThing {}',
    'export const THING_TIERS: readonly string[] = [];',
    'export const enum ThingConstEnum {}',
    'export interface ThingSpec<TValue> {}',
    'export type ThingEvent<T = unknown> =',
    'export enum ThingMode {}',
    "export { renamed as publicName, direct } from './other';",
    "export { type InlineType, runtimeValue } from './other';",
    "export type { OnlyType } from './other';",
    "export * from './forwarded';",
    "export * as nested from './ns';",
  ].join('\n');
  const { named, stars, errors } = parseModuleExports(source);
  assert.deepEqual(errors, []);
  const byName = new Map(named.map((entry) => [entry.name, entry.kind]));
  assert.equal(byName.get('streamThing'), 'value');
  assert.equal(byName.get('plainThing'), 'value');
  assert.equal(byName.get('ThingClient'), 'value');
  assert.equal(byName.get('AbstractThing'), 'value');
  assert.equal(byName.get('THING_TIERS'), 'value');
  assert.equal(byName.get('ThingConstEnum'), 'value');
  assert.equal(byName.get('ThingSpec'), 'type');
  assert.equal(byName.get('ThingEvent'), 'type');
  assert.equal(byName.get('ThingMode'), 'value');
  assert.equal(byName.get('publicName'), 'unknown');
  assert.equal(byName.get('direct'), 'unknown');
  assert.equal(byName.get('InlineType'), 'type');
  assert.equal(byName.get('runtimeValue'), 'unknown');
  assert.equal(byName.get('OnlyType'), 'type');
  assert.equal(byName.get('nested'), 'value');
  assert.equal(byName.has('enum'), false, 'const enum must not register a phantom "enum" symbol');
  assert.deepEqual(stars, ['./forwarded']);
});

test('parseModuleExports catches multi-line named export blocks', () => {
  const source = [
    'export {',
    '  longSymbolNameOne,',
    '  longSymbolNameTwo as publicTwo,',
    "} from './other';",
  ].join('\n');
  const { named, errors } = parseModuleExports(source);
  assert.deepEqual(errors, []);
  const names = named.map((entry) => entry.name);
  assert.deepEqual(names.sort(), ['longSymbolNameOne', 'publicTwo']);
});

test('parseModuleExports fails closed on inadmissible or unrecognized export forms', () => {
  const cases = [
    ['export default function f() {}', /default exports are not admissible/],
    ['export = legacyAssignment;', /export-assignment is not admissible/],
    ['export @decorator class Weird {}', /unrecognized export form/],
  ];
  for (const [line, expected] of cases) {
    const { errors } = parseModuleExports(line);
    assert.equal(errors.length, 1, `expected exactly one error for: ${line}`);
    assert.match(errors[0], expected);
  }
});

test('collectRootExports follows star re-exports, maps .js specifiers, flags duplicates and package-specifier stars', () => {
  const files = new Map([
    ['root/index.ts', [
      'export const topLevel = 1;',
      "export * from './child.js';",
      "export * from './sibling';",
      "export * from '@nimiplatform/kit';",
    ].join('\n')],
    ['root/child.ts', 'export interface ChildShape {}'],
    ['root/sibling.ts', 'export interface ChildShape {}\nexport function siblingFn() {}'],
  ]);
  const { exportsBySymbol, errors } = collectRootExports({
    rootDir: 'root',
    entryFile: 'index.ts',
    readFile: (filePath) => {
      const key = filePath.replace(/\\/g, '/');
      const content = files.get(key);
      if (content === undefined) {
        throw new Error(`unexpected read: ${key}`);
      }
      return content;
    },
  });
  assert.equal(exportsBySymbol.get('topLevel')?.kind, 'value');
  assert.equal(exportsBySymbol.get('ChildShape')?.module, 'child.ts', '.js specifier must resolve to the .ts source');
  assert.equal(exportsBySymbol.get('siblingFn')?.module, 'sibling.ts');
  assert.ok(exportsBySymbol.get('ChildShape')?.duplicates?.length, 'duplicate export must be flagged');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /package specifier "@nimiplatform\/kit" is not admissible/);
});

function baseRegistry(entries) {
  return {
    postures: [
      { id: 'runtime-projection' },
      { id: 'ephemeral-client-orchestration' },
      { id: 'pure-sugar' },
    ],
    entries,
  };
}

function exportsOf(...symbols) {
  return new Map(symbols.map(([name, kind, module]) => [name, { kind, module }]));
}

test('validateRegistry rejects unregistered exports, stale entries, and posture violations', () => {
  const registry = baseRegistry([
    { symbol: 'staleThing', module: 'root/a.ts', kind: 'value', posture: 'pure-sugar' },
    { symbol: 'projector', module: 'root/a.ts', kind: 'value', posture: 'runtime-projection' },
    { symbol: 'oddRef', module: 'root/a.ts', kind: 'value', posture: 'runtime-projection', authority_ref: ['bogus:X'] },
    { symbol: 'badRule', module: 'root/a.ts', kind: 'value', posture: 'runtime-projection', authority_ref: ['rule:S-NOPE-999'] },
    { symbol: 'malformedRule', module: 'root/a.ts', kind: 'value', posture: 'runtime-projection', authority_ref: ['rule:not-a-rule'] },
    { symbol: 'badGroup', module: 'root/a.ts', kind: 'value', posture: 'runtime-projection', authority_ref: ['group:missing_group'] },
    { symbol: 'badContract', module: 'root/a.ts', kind: 'value', posture: 'runtime-projection', authority_ref: ['contract:nope.md'] },
    { symbol: 'wrongKind', module: 'root/a.ts', kind: 'type', posture: 'pure-sugar' },
    { symbol: 'wrongModule', module: 'root/b.ts', kind: 'value', posture: 'pure-sugar' },
    { symbol: 'badPosture', module: 'root/a.ts', kind: 'value', posture: 'not-a-posture' },
    { symbol: 'orphan', module: 'elsewhere/c.ts', kind: 'value', posture: 'pure-sugar' },
  ]);
  const rootExports = exportsOf(
    ['unregistered', 'value', 'a.ts'],
    ['projector', 'value', 'a.ts'],
    ['oddRef', 'value', 'a.ts'],
    ['badRule', 'value', 'a.ts'],
    ['malformedRule', 'value', 'a.ts'],
    ['badGroup', 'value', 'a.ts'],
    ['badContract', 'value', 'a.ts'],
    ['wrongKind', 'value', 'a.ts'],
    ['wrongModule', 'value', 'a.ts'],
    ['badPosture', 'value', 'a.ts'],
  );
  const { ok, errors } = validateRegistry({
    registry,
    rootExports,
    root: 'root',
    enforcedRoots: ['root'],
    methodGroupIds: new Set(['agent_service_projection']),
    ruleIds: new Set(['S-SURFACE-021']),
    contractExists: () => false,
  });
  assert.equal(ok, false);
  const text = errors.join('\n');
  assert.match(text, /unregistered.*has no authority posture entry/);
  assert.match(text, /staleThing is stale/);
  assert.match(text, /projector.*requires at least one authority_ref/);
  assert.match(text, /oddRef.*unknown format/);
  assert.match(text, /badRule.*does not resolve to a rule heading/);
  assert.match(text, /malformedRule.*not a well-formed rule reference/);
  assert.match(text, /badGroup.*does not resolve/);
  assert.match(text, /badContract.*does not exist/);
  assert.match(text, /wrongKind.*does not match source kind/);
  assert.match(text, /wrongModule is stale/);
  assert.match(text, /badPosture.*not a declared posture id/);
  assert.match(text, /orphan.*outside every enforced coverage root/);
});

test('validateRegistry surfaces collector errors as failures', () => {
  const registry = baseRegistry([]);
  const { ok, errors } = validateRegistry({
    registry,
    rootExports: new Map(),
    collectErrors: ['index.ts: unrecognized export form: "export default weird"'],
    root: 'root',
    enforcedRoots: ['root'],
    methodGroupIds: new Set(),
    ruleIds: new Set(),
    contractExists: () => false,
  });
  assert.equal(ok, false);
  assert.match(errors.join('\n'), /unrecognized export form/);
});

test('validateRegistry accepts a fully aligned registry', () => {
  const registry = baseRegistry([
    {
      symbol: 'projector',
      module: 'root/a.ts',
      kind: 'value',
      posture: 'runtime-projection',
      authority_ref: ['rule:S-SURFACE-021', 'group:agent_service_projection', 'contract:exists.md'],
    },
    { symbol: 'helper', module: 'root/a.ts', kind: 'type', posture: 'pure-sugar' },
  ]);
  const rootExports = exportsOf(['projector', 'value', 'a.ts'], ['helper', 'type', 'a.ts']);
  const { ok, errors } = validateRegistry({
    registry,
    rootExports,
    root: 'root',
    enforcedRoots: ['root'],
    methodGroupIds: new Set(['agent_service_projection']),
    ruleIds: new Set(['S-SURFACE-021']),
    contractExists: (rel) => rel === 'exists.md',
  });
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});

test('integration: repo registry matches the real core/agent export surface', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/check-sdk-agent-export-posture.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `check failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /sdks\/typescript\/core\/agent ok \(\d+ public exports\)/);
});
