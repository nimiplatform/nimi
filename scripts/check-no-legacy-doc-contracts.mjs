#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SCAN_TARGETS = [
  'README.md',
  'AGENTS.md',
  'proto/README.md',
  'docs',
  'spec',
  'apps/desktop/src/shell/renderer/mod-source.generated.css',
];

const SCAN_EXTENSIONS = new Set(['.md', '.css']);
const SKIP_DIR_PREFIXES = ['docs/.vitepress/dist/', 'docs/.vitepress/cache/', 'docs/.vitepress/.temp/'];

const BANNED_PATTERNS = [
  { pattern: /@nimi\//g, label: 'legacy package scope "@nimi/*"' },
  { pattern: /\bruntime-service\.md\b/g, label: 'legacy doc alias "runtime-service.md"' },
  { pattern: /\bruntime-proto\.md\b/g, label: 'legacy doc alias "runtime-proto.md"' },
  { pattern: /\bsdk-design\.md\b/g, label: 'legacy doc alias "sdk-design.md"' },
  { pattern: /\bdesktop-demotion\.md\b/g, label: 'legacy doc alias "desktop-demotion.md"' },
  { pattern: /\bplatform-protocol\.md\b/g, label: 'legacy doc alias "platform-protocol.md"' },
  { pattern: /\barchitecture-overview\.md\b/g, label: 'legacy doc alias "architecture-overview.md"' },
  { pattern: /\brealm-mapping\.md\b/g, label: 'legacy doc alias "realm-mapping.md"' },
  { pattern: /\bmigration-cutover\.md\b/g, label: 'stale cutover runbook entry "migration-cutover.md"' },
  { pattern: /NIMI_MODS_DIR/g, label: 'deprecated env alias "NIMI_MODS_DIR"' },
  { pattern: /desktop\/mods\b(?!-)/g, label: 'legacy in-repo mods directory "desktop/mods"' },
  { pattern: /\.\.\/\.\.\/nimi-mods/g, label: 'legacy relative mods path "../../nimi-mods"' },
  { pattern: /nimi-public/g, label: 'legacy repository name "nimi-public"' },
  { pattern: /docs\/refactory/g, label: 'legacy docs path "docs/refactory"' },
  { pattern: /sync-from-realm\.sh/g, label: 'legacy sync script "sync-from-realm.sh"' },
  { pattern: /\bnimi-dapp\b/g, label: 'legacy app name "nimi-dapp"' },
  { pattern: /\blocal-default\b/g, label: 'legacy provider alias "local-default"' },
  { pattern: /\bai\.modelPacks\b/g, label: 'legacy manifest field "ai.modelPacks"' },
];

async function collectFiles(entry, output) {
  const absolute = path.join(repoRoot, entry);
  const stat = await fs.stat(absolute);
  if (stat.isFile()) {
    const ext = path.extname(absolute).toLowerCase();
    if (SCAN_EXTENSIONS.has(ext)) {
      output.push(absolute);
    }
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }

  const queue = [absolute];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(current, child.name);
      const relPath = path.relative(repoRoot, childPath).replace(/\\/g, '/');
      if (child.isDirectory()) {
        if (SKIP_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix))) {
          continue;
        }
        queue.push(childPath);
      } else if (child.isFile()) {
        const ext = path.extname(childPath).toLowerCase();
        if (SCAN_EXTENSIONS.has(ext)) {
          output.push(childPath);
        }
      }
    }
  }
}

async function main() {
  const files = [];
  for (const target of SCAN_TARGETS) {
    try {
      await collectFiles(target, files);
    } catch {
      // Skip absent optional targets.
    }
  }

  const violations = [];

  for (const filePath of files) {
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const item of BANNED_PATTERNS) {
      if (!item.pattern.test(content)) {
        continue;
      }
      violations.push(`${relPath}: ${item.label}`);
      item.pattern.lastIndex = 0;
    }
  }

  if (violations.length > 0) {
    process.stderr.write('Legacy doc contract check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Legacy doc contract check passed (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-no-legacy-doc-contracts failed: ${String(error)}\n`);
  process.exitCode = 1;
});
