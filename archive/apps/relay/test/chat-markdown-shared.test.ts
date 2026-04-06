import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const relayRoot = path.join(import.meta.dirname, '..');
const chatViewPath = path.join(relayRoot, 'src/renderer/features/chat/components/chat-view.tsx');
const packageJsonPath = path.join(relayRoot, 'package.json');
const removedRendererPath = path.join(relayRoot, 'src/renderer/features/chat/components/markdown-renderer.tsx');

const chatViewSource = readFileSync(chatViewPath, 'utf8');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  dependencies?: Record<string, string>;
};

test('relay markdown is sourced from shared nimi-kit chat ui', () => {
  assert.match(chatViewSource, /@nimiplatform\/nimi-kit\/features\/chat\/ui/);
  assert.match(chatViewSource, /ChatMarkdownRenderer/);
  assert.doesNotMatch(chatViewSource, /from '\.\/markdown-renderer\.js'/);
});

test('relay package no longer owns react-markdown dependencies', () => {
  assert.equal(packageJson.dependencies?.['react-markdown'], undefined);
  assert.equal(packageJson.dependencies?.['remark-gfm'], undefined);
});

test('relay app-local markdown renderer component is removed', () => {
  assert.equal(existsSync(removedRendererPath), false);
});
