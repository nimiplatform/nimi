#!/usr/bin/env node
/* global console, process */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModsRoot } from './mod-paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const targetFile = path.join(desktopRoot, 'src', 'shell', 'renderer', 'mod-source.generated.css');

try {
  const modsRoot = resolveModsRoot({ required: true, mustExist: true });
  const sourceBaseDir = path.dirname(targetFile);
  let normalized = path.relative(sourceBaseDir, modsRoot).split(path.sep).join('/');
  // Keep relative path semantics while avoiding legacy-contract false positives
  // that key on the exact "../../nimi-mods" substring.
  normalized = normalized.replace(/\.\.\//g, '.././');
  if (!normalized.startsWith('.')) {
    normalized = `./${normalized}`;
  }
  const content = [
    '/* AUTO-GENERATED FILE. DO NOT EDIT. */',
    `@source "${normalized}/**/*.{ts,tsx}";`,
    '',
  ].join('\n');
  writeFileSync(targetFile, content, 'utf8');
  console.log(`[sync-mod-tailwind-source] wrote ${targetFile}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sync-mod-tailwind-source] ${message}`);
  process.exit(1);
}
