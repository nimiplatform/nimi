import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYamlWithFragments } from '../../../scripts/lib/read-yaml-with-fragments.mjs';

export const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '../../..');
export const checkMode = process.argv.includes('--check');
export const realmOnly = process.argv.includes('--realm-only');
export const generatedBy = 'sdks/generators/generate.mjs';
export const languages = ['typescript', 'python', 'go', 'rust'];

export function relPath(abs) {
  return path.relative(repoRoot, abs).replaceAll(path.sep, '/');
}

export function readText(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

export function readYaml(rel) {
  return readYamlWithFragments(path.join(repoRoot, rel));
}

export function writeJson(rel, value) {
  const abs = path.join(repoRoot, rel);
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (checkMode) {
    if (!existsSync(abs)) {
      throw new Error(`missing generated artifact: ${rel}`);
    }
    const current = readFileSync(abs, 'utf8');
    if (current !== rendered) {
      throw new Error(`generated artifact drift: ${rel}`);
    }
    return;
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, rendered, 'utf8');
}

export function writeText(rel, rendered) {
  const abs = path.join(repoRoot, rel);
  const content = rendered.endsWith('\n') ? rendered : `${rendered}\n`;
  if (checkMode) {
    if (!existsSync(abs)) {
      throw new Error(`missing generated artifact: ${rel}`);
    }
    const current = readFileSync(abs, 'utf8');
    if (current !== content) {
      throw new Error(`generated artifact drift: ${rel}`);
    }
    return;
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}
