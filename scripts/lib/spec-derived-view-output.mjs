import { promises as fs } from 'node:fs';
import path from 'node:path';

export function derivedViewMode(argv = process.argv) {
  return {
    checkMode: argv.includes('--check'),
  };
}

async function listMarkdownFiles(root) {
  const found = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(abs);
      }
    }
  }
  await walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

export async function finalizeDerivedViews({
  checkMode,
  repoRoot,
  outDir,
  scopeLabel,
  entries,
}) {
  const viewEntries = entries.map((entry) => ({
    ...entry,
    relativePath: path.relative(repoRoot, entry.outputPath).replace(/\\/g, '/'),
  }));

  if (checkMode) {
    const existing = await listMarkdownFiles(outDir);
    if (existing.length > 0) {
      process.stderr.write(`${scopeLabel} derived views must not be written to disk:\n`);
      for (const file of existing) {
        process.stderr.write(`  - ${path.relative(repoRoot, file).replace(/\\/g, '/')}\n`);
      }
      process.stderr.write('Render views on demand with `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope <scope>`.\n');
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`${scopeLabel} derived views renderable (${viewEntries.length} views, no files written)\n`);
    return;
  }

  for (const entry of viewEntries) {
    process.stdout.write(`<!-- nimi-derived-view: ${entry.relativePath} -->\n`);
    process.stdout.write(entry.rendered);
    if (!entry.rendered.endsWith('\n')) {
      process.stdout.write('\n');
    }
    process.stdout.write('\n');
  }
}
