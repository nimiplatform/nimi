import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(desktopDir, 'src');

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(nextPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [nextPath];
  });
}

function relativeDesktopPath(filePath: string): string {
  return path.relative(desktopDir, filePath).replaceAll(path.sep, '/');
}

function findFilesContaining(pattern: RegExp): string[] {
  return listSourceFiles(srcDir)
    .filter((filePath) => pattern.test(fs.readFileSync(filePath, 'utf8')))
    .map(relativeDesktopPath)
    .sort();
}

test('agent hard-cut residues stay confined to explicit host-private and rejection surfaces', () => {
  assert.deepEqual(
    findFilesContaining(/targetType:\s*'AGENT'/),
    ['src/shell/renderer/infra/bootstrap/core-capabilities.ts'],
  );
  assert.deepEqual(
    findFilesContaining(/\bAGENT_LOCAL\b/),
    [
      'src/shell/renderer/features/chat/chat-agent-runtime.ts',
      'src/shell/renderer/infra/bootstrap/core-capabilities.ts',
    ],
  );
  assert.deepEqual(
    findFilesContaining(/HANDLE_PREFIX_UNSUPPORTED/),
    [
      'src/runtime/data-sync/flows/agent-runtime-flow.ts',
      'src/shell/renderer/features/contacts/add-contact-modal.tsx',
    ],
  );
});

test('desktop source no longer contains the deleted product chat route stack', () => {
  assert.equal(
    fs.existsSync(path.join(srcDir, 'runtime/chat')),
    false,
  );
  assert.deepEqual(
    findFilesContaining(/\bresolveChatRoute\b/),
    [],
  );
});
