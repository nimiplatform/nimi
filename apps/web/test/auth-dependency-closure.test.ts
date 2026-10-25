import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { assertAuthDependencyClosure, localJavaScriptImports, type AuthDependencyReport } from '../scripts/check-auth-dependency-closure.js';

test('the Web side-effect exception remains limited to a re-export-only Kit contract', async () => {
  const source = await readFile(new URL('../../../kit/core/src/sdk-contract.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('sdk-contract.ts', source, ts.ScriptTarget.Latest, true);
  assert.ok(ast.statements.length > 0);
  assert.ok(ast.statements.every(statement => ts.isExportDeclaration(statement)),
    'sdk-contract acquired initialization; review the Web moduleSideEffects exception');
});

test('closure inspection follows side-effect imports and re-exports, with dynamic imports checked separately', () => {
  const source = 'import "./shared.js"; export { value } from "./contract.js"; const load = () => import(`./visual.js`);';
  assert.deepEqual(localJavaScriptImports(source, false), ['./shared.js', './contract.js']);
  assert.deepEqual(localJavaScriptImports(source, true), ['./shared.js', './contract.js', './visual.js']);
});

test('the Auth gate rejects Runtime hidden behind renamed chunks or a later dynamic import', () => {
  const clean = { files: ['assets/renamed.js'], bytes: 1, runtimeSources: [], runtimeMarkers: [],
    realmSources: ['../../sdks/typescript/dist/realm/index.js', '../../sdks/typescript/dist/realm/fetch-transport.js'] };
  const report: AuthDependencyReport = { initial: clean, routes: [{ entry: 'login', static: clean, withAuthDynamicImports: clean }] };
  assert.doesNotThrow(() => assertAuthDependencyClosure(report));
  const runtime = { ...clean, runtimeSources: ['../../sdks/typescript/dist/core-generated/runtime-protobuf/runtime/v1/ai.js'] };
  assert.throws(() => assertAuthDependencyClosure({ ...report, routes: [{ ...report.routes[0]!, withAuthDynamicImports: runtime }] }), /retains Runtime/u);
  const missingRealm = { ...clean, realmSources: [] };
  assert.throws(() => assertAuthDependencyClosure({ ...report, routes: [{ ...report.routes[0]!, static: missingRealm }] }), /lost Realm/u);
});
