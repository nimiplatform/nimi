import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git']);

function listSourceFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(path));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      out.push(path);
    }
  }
  return out;
}

export function assertNoDirectKnowledgeJsonReads(options: {
  rootDir: string;
  assetIds: string[];
  allowedFiles?: string[];
}) {
  const rootDir = resolve(options.rootDir);
  const allowed = new Set((options.allowedFiles ?? []).map((file) => resolve(file)));
  const matches: string[] = [];
  for (const file of listSourceFiles(rootDir)) {
    if (allowed.has(file)) {
      continue;
    }
    const source = readFileSync(file, 'utf-8');
    for (const assetId of options.assetIds) {
      const escaped = assetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const directPatterns = [
        new RegExp(`data/knowledge/${escaped}\\.json`),
        new RegExp(`readKnowledgeJson\\(['"\`]${escaped}\\.json['"\`]\\)`),
        new RegExp(`include_str!\\([^)]*${escaped}\\.json`),
      ];
      if (directPatterns.some((pattern) => pattern.test(source))) {
        matches.push(`${relative(rootDir, file)} -> ${assetId}.json`);
      }
    }
  }
  if (matches.length > 0) {
    throw new Error(`direct knowledge JSON reads detected:\n${matches.sort().join('\n')}`);
  }
}
