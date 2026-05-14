import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHostedPackageModuleSource,
  isHostedPackageExportBinding,
} from '../src/runtime/mod/discovery/hosted-packages';
import { rewriteRuntimeModSourceImportSpecifiers } from '../src/runtime/mod/discovery/module-loader';

test('module loader rewrites supported bare package imports to hosted module urls', () => {
  const source = [
    'import React from "react";',
    'import { jsx } from "react/jsx-runtime";',
    'import { createHookClient } from "@nimiplatform/sdk/mod";',
    'import { ReasonCode } from "@nimiplatform/sdk/types";',
    'const loadShell = () => import("@nimiplatform/sdk/mod/shell");',
    'export * from "@nimiplatform/sdk/mod/lifecycle";',
    'import "./chunk.js";',
  ].join('\n');

  const rewritten = rewriteRuntimeModSourceImportSpecifiers(
    source,
    '/mods/test-ai/dist/mods/test-ai/index.js',
  );

  assert.match(
    rewritten,
    /import React from "blob:[^"]+";/,
    'react bare import should resolve to hosted blob module',
  );
  assert.match(
    rewritten,
    /import \{ createHookClient \} from "blob:[^"]+";/,
    'sdk mod bare import should resolve to hosted blob module',
  );
  assert.match(
    rewritten,
    /const loadShell = \(\) => import\("blob:[^"]+"\);/,
    'dynamic sdk shell import should resolve to hosted blob module',
  );
  assert.match(
    rewritten,
    /export \* from "blob:[^"]+";/,
    're-exported lifecycle import should resolve to hosted blob module',
  );
  assert.match(
    rewritten,
    /import "file:\/\/\/mods\/test-ai\/dist\/mods\/test-ai\/chunk\.js";/,
    'relative imports should still resolve against entry path',
  );
});

test('hosted package module shim does not emit reserved-word export bindings', () => {
  assert.equal(isHostedPackageExportBinding('createHookClient'), true);
  assert.equal(isHostedPackageExportBinding('$valid'), true);
  assert.equal(isHostedPackageExportBinding('arguments'), false);
  assert.equal(isHostedPackageExportBinding('catch'), false);
  assert.equal(isHostedPackageExportBinding('default'), false);
  assert.equal(isHostedPackageExportBinding('eval'), false);
  assert.equal(isHostedPackageExportBinding('false'), false);
  assert.equal(isHostedPackageExportBinding('implements'), false);
  assert.equal(isHostedPackageExportBinding('let'), false);
  assert.equal(isHostedPackageExportBinding('null'), false);
  assert.equal(isHostedPackageExportBinding('private'), false);
  assert.equal(isHostedPackageExportBinding('true'), false);
  assert.equal(isHostedPackageExportBinding('not-valid-name'), false);
});

test('hosted package module source filters invalid export bindings before emission', () => {
  const source = buildHostedPackageModuleSource('test-package', {
    validName: 1,
    null: null,
    true: true,
    catch: 'reserved',
    'not-valid-name': 'invalid',
  });

  assert.match(source, /export const validName = module\["validName"\];/);
  assert.doesNotMatch(source, /export const null\b/);
  assert.doesNotMatch(source, /export const true\b/);
  assert.doesNotMatch(source, /export const catch\b/);
  assert.doesNotMatch(source, /not-valid-name/);
});
