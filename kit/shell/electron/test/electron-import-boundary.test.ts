import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ELECTRON_SRC_ROOT = path.resolve(import.meta.dirname, '../src');

const FORBIDDEN_STATIC_IMPORTS = new Set([
  'lucide-react',
  'hls.js',
  'three',
  'motion',
  'react',
  'react-dom',
  'react-markdown',
  'remark-gfm',
  'wlipsync',
  'simplex-noise',
  '@tanstack/react-virtual',
  'sharp',
  'zod',
]);

function collectTsFiles(root: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.(?:ts|tsx|mts|cts)$/u.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function packageSpecifier(specifier: string): string {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }
  return specifier.split('/')[0] ?? specifier;
}

describe('kit/shell/electron static import boundary', () => {
  it('never statically imports renderer UI, 3D, media, or optional image-codec packages', () => {
    const violations: string[] = [];
    const staticImportPattern = /^\s*(?:import|export)\s+(?!type\b)(?:[\s\S]*?\s+from\s+)?['"]([^.'"][^'"]*)['"]/gmu;
    for (const filePath of collectTsFiles(ELECTRON_SRC_ROOT)) {
      const source = readFileSync(filePath, 'utf8');
      for (const match of source.matchAll(staticImportPattern)) {
        const rawSpecifier = match[1];
        if (!rawSpecifier || rawSpecifier.startsWith('node:')) continue;
        const pkg = packageSpecifier(rawSpecifier);
        if (FORBIDDEN_STATIC_IMPORTS.has(pkg) || pkg.startsWith('@radix-ui/')) {
          violations.push(`${path.relative(ELECTRON_SRC_ROOT, filePath)}: ${rawSpecifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
