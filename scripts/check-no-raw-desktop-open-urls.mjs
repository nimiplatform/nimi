#!/usr/bin/env node
import {
  collectFiles,
  failWith,
  findPatternViolations,
  pass,
} from './lib/desktop-open-checks.mjs';

const files = collectFiles([
  'apps/zhiyu/src',
  'apps/desktop/src/shell/renderer',
  'kit/core/src',
  'kit/shell/renderer/src',
  'kit/shell/electron/src',
  'kit/shell/tauri/src',
  'sdks/typescript/core',
]);

const violations = findPatternViolations(files, [
  /nimi-desktop:\/\//u,
  /__nimi_desktop_launch__/u,
  /desktop-launch:\/\/open-intent/u,
  /open_desktop_explore_character_persona/u,
], {
  allow: (relPath, line) => (
    relPath.endsWith('desktop-open-intent-listener.ts')
      || (relPath.includes('/oauth') && line.includes('__nimi_desktop_launch__'))
  ),
});

failWith('Raw Desktop Open transport strings are forbidden in app/SDK/Kit product code.', violations);
pass('raw desktop open URL guard passed');
