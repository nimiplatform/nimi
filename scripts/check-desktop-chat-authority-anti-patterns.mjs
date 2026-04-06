#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const CHAT_ROOT = path.join(repoRoot, 'apps/desktop/src/shell/renderer/features/chat');
const PROVIDERS_ROOT = path.join(repoRoot, 'apps/desktop/src/shell/renderer/app-shell/providers');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const ALLOWED_CHAT_STORAGE_FILE = path.join(CHAT_ROOT, 'chat-settings-storage.ts');

const BANNED_IDENTIFIER_PATTERNS = [
  {
    label: 'chat-owned global route selection state',
    regex: /\bglobalChatRouteSelection\b/gu,
  },
  {
    label: 'chat-owned global route selection setter',
    regex: /\bsetGlobalChatRouteSelection\b/gu,
  },
];

const BANNED_CHAT_STORAGE_PATTERNS = [
  {
    label: 'chat route storage key',
    regex: /\bCHAT_[A-Z0-9_]*ROUTE[A-Z0-9_]*STORAGE_KEY\b/gu,
  },
  {
    label: 'chat route persistence helper',
    regex: /\b(?:loadStoredChatRoute|persistStoredChatRoute)\b/gu,
  },
  {
    label: 'route string in chat settings storage',
    regex: /['"`][^'"`\n]*route[^'"`\n]*['"`]/giu,
  },
];

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

async function collectSourceFiles(dir) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function collectPatternViolations(source, relPath, patterns) {
  const violations = [];
  for (const { label, regex } of patterns) {
    regex.lastIndex = 0;
    let match = regex.exec(source);
    while (match) {
      const { line, column } = getLineColumn(source, match.index);
      violations.push(`${relPath}:${line}:${column} ${label}`);
      match = regex.exec(source);
    }
  }
  return violations;
}

async function collectViolations() {
  const files = [
    ...await collectSourceFiles(CHAT_ROOT),
    ...await collectSourceFiles(PROVIDERS_ROOT),
  ];
  const violations = [];

  for (const filePath of files) {
    const relPath = toRepoRelative(filePath);
    const source = await fs.readFile(filePath, 'utf8');

    violations.push(...collectPatternViolations(source, relPath, BANNED_IDENTIFIER_PATTERNS));

    if (filePath.startsWith(CHAT_ROOT) && filePath !== ALLOWED_CHAT_STORAGE_FILE) {
      const storageRegex = /\b(?:localStorage|getItem\s*\(|setItem\s*\()/gu;
      storageRegex.lastIndex = 0;
      let match = storageRegex.exec(source);
      while (match) {
        const { line, column } = getLineColumn(source, match.index);
        violations.push(`${relPath}:${line}:${column} chat feature must not own storage persistence directly`);
        match = storageRegex.exec(source);
      }
    }

    if (filePath === ALLOWED_CHAT_STORAGE_FILE) {
      violations.push(...collectPatternViolations(source, relPath, BANNED_CHAT_STORAGE_PATTERNS));
    }
  }

  return {
    files,
    violations,
  };
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-chat-authority-'));
  const chatRoot = path.join(tempRoot, 'apps/desktop/src/shell/renderer/features/chat');
  const providersRoot = path.join(tempRoot, 'apps/desktop/src/shell/renderer/app-shell/providers');
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.mkdir(providersRoot, { recursive: true });

  const originalChatRoot = CHAT_ROOT;
  const originalProvidersRoot = PROVIDERS_ROOT;
  const originalAllowed = ALLOWED_CHAT_STORAGE_FILE;

  try {
    await fs.writeFile(
      path.join(chatRoot, 'chat-settings-storage.ts'),
      "export const CHAT_THINKING_PREFERENCE_STORAGE_KEY = 'nimi.chat.settings.thinking.v1';\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(chatRoot, 'good.ts'),
      "export const x = 'ok';\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(chatRoot, 'bad.ts'),
      "const y = localStorage.getItem('nimi.chat.route');\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(providersRoot, 'bad-provider.ts'),
      "const globalChatRouteSelection = null;\n",
      'utf8',
    );

    globalThis.__NIMI_CHAT_AUTHORITY_TEST_ROOTS__ = {
      CHAT_ROOT: chatRoot,
      PROVIDERS_ROOT: providersRoot,
      ALLOWED_CHAT_STORAGE_FILE: path.join(chatRoot, 'chat-settings-storage.ts'),
      repoRoot: tempRoot,
    };

    const report = await collectViolationsWithOverrides();
    if (report.violations.length < 2) {
      throw new Error('self-test failed: expected violations were not detected');
    }
    process.stdout.write('check-desktop-chat-authority-anti-patterns self-test passed\n');
  } finally {
    delete globalThis.__NIMI_CHAT_AUTHORITY_TEST_ROOTS__;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function getRoots() {
  const override = globalThis.__NIMI_CHAT_AUTHORITY_TEST_ROOTS__;
  if (override) {
    return override;
  }
  return {
    CHAT_ROOT,
    PROVIDERS_ROOT,
    ALLOWED_CHAT_STORAGE_FILE,
    repoRoot,
  };
}

async function collectViolationsWithOverrides() {
  const roots = getRoots();
  const files = [
    ...await collectSourceFiles(roots.CHAT_ROOT),
    ...await collectSourceFiles(roots.PROVIDERS_ROOT),
  ];
  const violations = [];

  for (const filePath of files) {
    const relPath = path.relative(roots.repoRoot, filePath).replaceAll(path.sep, '/');
    const source = await fs.readFile(filePath, 'utf8');
    violations.push(...collectPatternViolations(source, relPath, BANNED_IDENTIFIER_PATTERNS));

    if (filePath.startsWith(roots.CHAT_ROOT) && filePath !== roots.ALLOWED_CHAT_STORAGE_FILE) {
      const storageRegex = /\b(?:localStorage|getItem\s*\(|setItem\s*\()/gu;
      storageRegex.lastIndex = 0;
      let match = storageRegex.exec(source);
      while (match) {
        const { line, column } = getLineColumn(source, match.index);
        violations.push(`${relPath}:${line}:${column} chat feature must not own storage persistence directly`);
        match = storageRegex.exec(source);
      }
    }

    if (filePath === roots.ALLOWED_CHAT_STORAGE_FILE) {
      violations.push(...collectPatternViolations(source, relPath, BANNED_CHAT_STORAGE_PATTERNS));
    }
  }

  return { files, violations };
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const report = await collectViolations();
  if (report.files.length === 0) {
    process.stderr.write('desktop chat authority anti-pattern check failed: no source files found\n');
    process.exitCode = 1;
    return;
  }
  if (report.violations.length > 0) {
    process.stderr.write('desktop chat authority anti-pattern check failed\n');
    process.stderr.write('chat must project runtime authority and must not introduce chat-owned route truth or persistence\n');
    for (const violation of report.violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`desktop chat authority anti-pattern check passed (${report.files.length} files scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-desktop-chat-authority-anti-patterns failed: ${String(error)}\n`);
  process.exitCode = 1;
});
