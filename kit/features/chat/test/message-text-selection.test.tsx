import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatMarkdownRenderer } from '../src/components/chat-markdown-renderer.js';
import { captureMessageSelection, highlightMessageQuote, readMessageText } from '../src/components/message-text-selection.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixtures = JSON.parse(readFileSync('../config/conversation-quote-text-v1.cases.json', 'utf8')) as { cases: { name: string; markdown: string; text: string }[] };
let root: Root | undefined;
let container: HTMLDivElement;
async function render(markdown: string) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root!.render(<ChatMarkdownRenderer content={markdown} />); });
}
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); document.getSelection()?.removeAllRanges(); });
describe('canonical readable text and selection mapping', () => {
  for (const item of fixtures.cases) it(`matches the Runtime representation: ${item.name}`, async () => {
    await render(item.markdown);
    expect(readMessageText(container).text).toBe(item.text);
  });
  it('maps the second repeated Unicode fragment and highlights that exact interval', async () => {
    await render('重复🙂，é，👩‍👩‍👧‍👦，重复🙂，مرحبا');
    const node = container.querySelector('p')!.firstChild!;
    const value = node.textContent!;
    const start = value.lastIndexOf('重复🙂');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + '重复🙂'.length);
    document.getSelection()!.addRange(range);
    const captured = captureMessageSelection(container);
    expect(captured.kind).toBe('selected');
    if (captured.kind !== 'selected') throw new Error('Missing selection');
    expect(captured.selection.startByte).toBe(new TextEncoder().encode(value.slice(0, start)).length);
    document.getSelection()!.removeAllRanges();
    expect(highlightMessageQuote(container, captured.selection)).toBe(true);
    expect(document.getSelection()!.anchorOffset).toBe(start);
    expect(document.getSelection()!.toString()).toBe('重复🙂');
  });
  it('keeps full code text even when later lines are folded', async () => {
    const code = Array.from({ length: 25 }, (_, index) => `  line ${index}  `).join('\n');
    await render(`\`\`\`txt\n${code}\n\`\`\``);
    expect(readMessageText(container).text).toBe(code);
    expect(container.textContent).not.toContain('line 24');
  });
  it('maps a hard line break to one LF without duplicating the renderer newline', async () => {
    await render('line  \nnext');
    expect(readMessageText(container).text).toBe('line\nnext');
  });
  it('maps a selected part of an unlabelled single-line code block to canonical bytes', async () => {
    await render('before\n\n```\nfoo\n```\n\nafter');
    const node = container.querySelector('[data-chat-code-offset="0"]')!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 2);
    document.getSelection()!.addRange(range);
    const captured = captureMessageSelection(container);
    expect(captured.kind).toBe('selected');
    if (captured.kind !== 'selected') throw new Error('Missing code selection');
    expect(captured.selection).toMatchObject({ text: 'fo', sourceText: 'before\n\nfoo\n\nafter', startByte: 8, endByte: 10 });
    document.getSelection()!.removeAllRanges();
    expect(highlightMessageQuote(container, captured.selection)).toBe(true);
    expect(document.getSelection()!.toString()).toBe('fo');
  });
});
