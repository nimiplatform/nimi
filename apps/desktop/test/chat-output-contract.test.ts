import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildDesktopChatOutputContractSection,
  composeDesktopChatSystemPrompt,
} from '../src/shell/renderer/features/chat/chat-output-contract.js';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('desktop chat output contract helper exposes valid markdown or plain text fallback rules', () => {
  const section = buildDesktopChatOutputContractSection();

  assert.match(section, /^Output Contract:/m);
  assert.match(section, /Only output the user-visible reply body/);
  assert.match(section, /You may use standard Markdown only when it remains fully valid/);
  assert.match(section, /fall back to plain text instead of partial Markdown/);
  assert.match(section, /Headings must be on their own line and must include a space after the # markers/);
  assert.match(section, /List items must stay one item per line/);
  assert.match(section, /do not proactively use fenced code blocks, tables, or HTML/);
  assert.match(section, /fenced code blocks are allowed, but they must be properly closed/);
  assert.match(section, /leave a blank line before the table and after the table/);
  assert.match(section, /Do not put table titles or summary labels on the same line as the table header row/);
});

test('desktop chat output contract helper appends contract after existing system prompt', () => {
  const prompt = composeDesktopChatSystemPrompt('Be concise.');

  assert.match(prompt, /^Be concise\./);
  assert.match(prompt, /\n\nOutput Contract:\n/);
  assert.match(prompt, /fall back to plain text instead of partial Markdown/);
});

test('desktop AI host injects the shared output contract into simple-ai systemPrompt resolution', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-adapter.tsx');

  assert.match(source, /composeDesktopChatSystemPrompt/);
  assert.match(source, /resolveSystemPrompt:\s*\(turnInput\)\s*=>\s*composeDesktopChatSystemPrompt\(turnInput\.systemPrompt\)/);
});
