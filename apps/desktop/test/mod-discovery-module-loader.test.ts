import assert from 'node:assert/strict';
import test from 'node:test';

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
    '/mods/local-chat/dist/mods/local-chat/index.js',
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
    /import "file:\/\/\/mods\/local-chat\/dist\/mods\/local-chat\/chunk\.js";/,
    'relative imports should still resolve against entry path',
  );
});
