#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// AIProfile consumer paths admitted by P-AIPS-008. These globs are the
// only places allowed to consume factory AIProfile / AIConfig apply
// surfaces, and they must not embed provider / connector / engine /
// model identifier string constants. The generated `platform-catalog`
// file is intentionally excluded — it is a regenerated projection of
// the Platform-owned factory `AIProfile` catalog table, which is the
// canonical owner of admitted dependency identifiers (e.g.,
// `native-engine-package.llama`, `accelerator.cuda.runtime`) and is
// not consumer code.
const TARGET_GLOBS = [
  'apps/desktop/src/shell/renderer/features/nimi-home',
  'apps/desktop/src/shell/renderer/first-run',
  'apps/avatar/src/ai-profile',
  'apps/parentos/src/ai-profile',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.go', '.rs']);

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '.vite',
  'build',
  'coverage',
  'dist',
  'gen',
  'generated',
  'node_modules',
  'out',
  'target',
  'tmp',
]);

const SKIP_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\.fixture\./,
  /__fixtures__/,
];

const FORBIDDEN_PROVIDER_PATTERN = /\b(openai|anthropic|claude(?:-[a-z0-9-]+)?|gpt(?:-[a-z0-9.]+)?|gemini(?:-[a-z0-9.-]+)?|deepseek(?:-[a-z0-9.-]+)?|qwen(?:[0-9a-z.-]+)?|mistral(?:-[a-z0-9.-]+)?|llama(?:[.-][a-z0-9.-]+)?|ollama|llamacpp|vllm|openvino|cohere|together|groq|fireworks|moonshot|baichuan|zhipu|glm-[0-9]+|spark-[0-9]+|hunyuan|kimi|step-[0-9]+|nova-[a-z0-9]+|titan-[a-z0-9-]+|jamba(?:-[a-z0-9]+)?|sonar(?:-[a-z0-9.-]+)?|grok(?:-[a-z0-9.-]+)?|o1(?:-[a-z0-9-]+)?|o3(?:-[a-z0-9-]+)?|o4(?:-[a-z0-9-]+)?)\b/i;

const STRING_LITERAL_PATTERN = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

async function collectFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (SKIP_FILE_PATTERNS.some(re => re.test(entry.name))) {
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

async function collectViolations(files) {
  const violations = [];
  const thisFile = path.join(repoRoot, 'scripts', 'check-no-ai-profile-provider-model-constants.mjs');
  for (const file of files) {
    if (file === thisFile) {
      continue;
    }
    const source = await fs.readFile(file, 'utf8');
    STRING_LITERAL_PATTERN.lastIndex = 0;
    let match = STRING_LITERAL_PATTERN.exec(source);
    while (match) {
      const literal = match[2];
      if (literal && FORBIDDEN_PROVIDER_PATTERN.test(literal)) {
        const { line, column } = getLineColumn(source, match.index);
        const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/');
        violations.push(`${relative}:${line}:${column}: forbidden factory AIProfile provider/model identifier "${literal}"`);
      }
      match = STRING_LITERAL_PATTERN.exec(source);
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-no-aips-pmc-'));
  const negativePath = path.join(tempRoot, 'negative.ts');
  const positivePath = path.join(tempRoot, 'positive.ts');

  await fs.writeFile(
    negativePath,
    [
      "import { applyAIProfileToConfig } from '@nimiplatform/sdk/mod';",
      'const profileId = scopeRef.resolveProfileAlias();',
      'await applyAIProfileToConfig(baseConfig, profile);',
      '',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(
    positivePath,
    [
      "import { applyAIProfileToConfig } from '@nimiplatform/sdk/mod';",
      "const profileId = 'gpt-4o';",
      'await applyAIProfileToConfig(baseConfig, profile);',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const negativeViolations = await collectViolations([negativePath]);
    if (negativeViolations.length !== 0) {
      throw new Error(`self-test failed: negative fixture flagged: ${negativeViolations.join(', ')}`);
    }

    const positiveViolations = await collectViolations([positivePath]);
    if (positiveViolations.length === 0) {
      throw new Error('self-test failed: positive fixture (gpt-4o constant) was not flagged');
    }

    process.stdout.write('check-no-ai-profile-provider-model-constants self-test passed\n');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const files = [];
  for (const targetGlob of TARGET_GLOBS) {
    files.push(...await collectFiles(path.join(repoRoot, targetGlob)));
  }
  const violations = await collectViolations(files);

  if (violations.length > 0) {
    process.stderr.write('Factory AIProfile consumer code must not embed provider/connector/engine/model identifier string constants.\n');
    process.stderr.write('Reference: .nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md (P-AIPS-008).\n');
    process.stderr.write('Catalog rows are the only authorized location; use scopeRef + profileId references instead of string constants.\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`check-no-ai-profile-provider-model-constants passed (${files.length} factory AIProfile consumer file(s) scanned across ${TARGET_GLOBS.length} target glob(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-no-ai-profile-provider-model-constants failed: ${String(error)}\n`);
  process.exitCode = 1;
});
